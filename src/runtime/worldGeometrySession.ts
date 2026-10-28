/**
 * Owns the live deformation of the cell complex during play: it tracks the committed deformation state (current), the requested target, and at most one in-flight background build.
 * Each step asks the family for nextStep(current, target) (at most maxStepMeters, default 0.08 m, in parameter space), builds the corresponding snapshot via a WorldGeometryBuildClient (a worker by default), validates the compiled result against the currently committed world, and parks it as the ready snapshot.
 * The renderer polls pollReadySnapshot() once per frame; polling is the only way the committed state advances, so each commit is an atomic swap on the render thread. After a commit the session immediately schedules the next step, so a distant target is approached through a sequence of small topology-preserving snapshots.
 * Consistency guarantees: snapshots are always rebuilt from baseSpec (never accumulated), requests carry ids and stale responses are dropped, failures and validation errors only set lastError and leave the committed world untouched, and cancel()/dispose() invalidate outstanding work.
 * The session never touches the player or objects; the committer uses family.createDynamicObjectMaps(previous, next, ...) to transport them.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../cell-complex/specs";
import type { StaticPortalPathCullResult } from "../cell-complex/staticPortalPathCull";
import {
  createDefaultWorldDeformationFamilyRegistry,
  getWorldDeformationFamilyOrThrow,
  type WorldDeformationFamilyRegistry,
} from "./worldGeometryDeformationFamilies";
import {
  deformationStatesEqual,
  type DynamicGeometryStepOptions,
  type WorldDeformationState,
} from "./worldGeometryDeformations";
import {
  createDefaultWorldGeometryBuildClient,
  type WorldGeometryBuildClient,
} from "./worldGeometryWorkerClient";

/**
 * Immutable committed result of one geometry build: deformation state, deformed spec, compiled world, static culling tables and timing.
 */
export interface WorldGeometrySnapshot {
  /** Counter incremented by one per commit; the initial snapshot defines the starting version. */
  readonly version: number;
  /** Normalized deformation state this world realizes. */
  readonly deformation: WorldDeformationState;
  /** Deformed spec the world was compiled from. */
  readonly spec: CellComplexSpec;
  readonly world: CompiledCellComplex;
  /** Statically culled portal-path tables for the world, computed with the session's portalPathOptions. */
  readonly staticCull: StaticPortalPathCullResult;
  /** Timing (ms on the session clock) of the request and whether a Worker built it. */
  readonly buildStats: {
    readonly requestedAtMs: number;
    readonly completedAtMs: number;
    readonly worker: boolean;
  };
}

/** Read-only view of the session's progress for debug overlays and tools. */
export interface LiveGeometryDebugState {
  readonly version: number;
  readonly deformationKind: WorldDeformationState["kind"];
  /** State realized by the last committed snapshot. */
  readonly current: WorldDeformationState;
  /** State the session is stepping toward; equal to current when idle. */
  readonly target: WorldDeformationState;
  /** True while a background build has been requested and not yet answered. */
  readonly buildInFlight: boolean;
  /** Duration of the most recent successful build, request to completion. */
  readonly lastBuildMs?: number;
  /** Clock time of the most recent poll that handed out a snapshot. */
  readonly lastCommitMs?: number;
  /**
   * Message of the most recent failure (build error, validation error, unusable target); cleared when the next build starts.
   */
  readonly lastError?: string;
}

/** Request to move the current deformation toward a new target of the same family. */
export interface WorldDeformationNudge {
  readonly kind: WorldDeformationState["kind"];
  readonly target: WorldDeformationState;
}

/** Controller for incremental, background, topology-preserving deformation of the active world. */
export interface WorldGeometrySession {
  /**
   * Sets the deformation target (normalized by its family) and starts stepping if idle; an inapplicable family only sets lastError, an unknown family or out-of-range state throws, and calls after dispose are ignored.
   */
  setTarget(target: WorldDeformationState): void;
  /**
   * Like setTarget but only accepted when request.kind equals the current state's kind; otherwise records lastError. Ignored after dispose, like setTarget.
   */
  nudge(request: WorldDeformationNudge): void;
  /**
   * Abandons pending work: discards any ready snapshot and in-flight build and resets target to current; the next setTarget clears the canceled flag and schedules builds again.
   */
  cancel(): void;
  /**
   * Returns the ready snapshot at most once and makes it the committed state, then schedules the next step; undefined if nothing is ready. The caller must commit it to the renderer.
   */
  pollReadySnapshot(): WorldGeometrySnapshot | undefined;
  /** Current LiveGeometryDebugState, computed on access. */
  readonly state: LiveGeometryDebugState;
  /** Stops the session permanently, drops ready work and disposes the build client. */
  dispose(): void;
}

/** Dependencies and tuning for createWorldGeometrySession. */
export interface CreateWorldGeometrySessionOptions {
  /** Undeformed world spec every snapshot is rebuilt from. */
  readonly baseSpec: CellComplexSpec;
  /** Already-built snapshot for the starting state; its deformation is both current and initial target. */
  readonly initialSnapshot: WorldGeometrySnapshot;
  /** Deformation families to use; defaults to the default registry. */
  readonly familyRegistry?: WorldDeformationFamilyRegistry;
  /** Where builds run; defaults to a Worker with inline fallback. */
  readonly buildClient?: WorldGeometryBuildClient;
  /** Static portal-path culling parameters passed to every build. */
  readonly portalPathOptions: {
    readonly maxDepth: number;
    readonly skipImmediateReverse: boolean;
    readonly toleranceMeters: number;
    readonly maxKeptPathsPerRoot: number;
  };
  /** Step limits; defaults to maxStepMeters 0.08 and snapToleranceMeters 1e-6. */
  readonly stepOptions?: DynamicGeometryStepOptions;
  /** Clock in milliseconds; defaults to performance.now() or Date.now(). */
  readonly nowMs?: () => number;
}

const defaultStepOptions: DynamicGeometryStepOptions = {
  maxStepMeters: 0.08,
  snapToleranceMeters: 1e-6,
};

/** Creates a WorldGeometrySession that starts idle at initialSnapshot.deformation. */
export function createWorldGeometrySession(options: CreateWorldGeometrySessionOptions): WorldGeometrySession {
  const familyRegistry = options.familyRegistry ?? createDefaultWorldDeformationFamilyRegistry();
  const buildClient = options.buildClient ?? createDefaultWorldGeometryBuildClient();
  const nowMs = options.nowMs ?? defaultNowMs;
  const stepOptions = options.stepOptions ?? defaultStepOptions;
  let currentSnapshot = options.initialSnapshot;
  let current = currentSnapshot.deformation;
  let target = currentSnapshot.deformation;
  let buildInFlight = false;
  let activeRequestId: number | undefined;
  let nextRequestId = 1;
  let readySnapshot: WorldGeometrySnapshot | undefined;
  let lastBuildMs: number | undefined;
  let lastCommitMs: number | undefined;
  let lastError: string | undefined;
  let disposed = false;
  let canceled = false;

  function scheduleNextBuild(): void {
    if (
      disposed ||
      canceled ||
      buildInFlight ||
      readySnapshot ||
      deformationStatesEqual(current, target)
    ) {
      return;
    }

    try {
      const family = getWorldDeformationFamilyOrThrow(familyRegistry, target.kind);
      if (current.kind !== target.kind) {
        current = family.normalizeState(options.baseSpec, target as never);
      }
      const next = family.nextStep(current as never, target as never, stepOptions);
      if (deformationStatesEqual(current, next)) {
        target = current;
        return;
      }

      const requestId = nextRequestId++;
      const requestedAtMs = nowMs();
      activeRequestId = requestId;
      buildInFlight = true;
      lastError = undefined;

      void buildClient.buildSnapshot({
        requestId,
        baseSpec: options.baseSpec,
        deformation: next,
        portalPathOptions: options.portalPathOptions,
      }).then((response) => {
        if (disposed || canceled || response.requestId !== activeRequestId) {
          return;
        }

        buildInFlight = false;
        activeRequestId = undefined;

        if (response.kind === "failed") {
          lastError = response.message;
          return;
        }

        const validationErrors = family.validateSnapshot(currentSnapshot.world, response.world);
        if (validationErrors.length > 0) {
          lastError = validationErrors.join("\n");
          return;
        }

        lastBuildMs = response.completedAtMs - requestedAtMs;
        readySnapshot = {
          version: currentSnapshot.version + 1,
          deformation: next,
          spec: response.spec,
          world: response.world,
          staticCull: response.staticCull,
          buildStats: {
            requestedAtMs,
            completedAtMs: response.completedAtMs,
            worker: buildClient.worker,
          },
        };
      }).catch((error: unknown) => {
        if (disposed || canceled || requestId !== activeRequestId) {
          return;
        }

        buildInFlight = false;
        activeRequestId = undefined;
        lastError = error instanceof Error ? error.message : String(error);
      });
    } catch (error) {
      buildInFlight = false;
      activeRequestId = undefined;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const session: WorldGeometrySession = {
    setTarget(nextTarget) {
      if (disposed) {
        return;
      }

      const family = getWorldDeformationFamilyOrThrow(familyRegistry, nextTarget.kind);
      if (!family.canApplyToSpec(options.baseSpec)) {
        lastError = `World deformation family "${nextTarget.kind}" cannot apply to this world spec.`;
        return;
      }

      target = family.normalizeState(options.baseSpec, nextTarget as never);
      canceled = false;
      scheduleNextBuild();
    },
    nudge(request) {
      if (disposed) {
        return;
      }

      if (request.kind !== current.kind) {
        lastError = `Cannot nudge "${request.kind}" while current deformation is "${current.kind}".`;
        return;
      }

      session.setTarget(request.target);
    },
    cancel() {
      canceled = true;
      target = current;
      readySnapshot = undefined;
      activeRequestId = undefined;
      buildInFlight = false;
    },
    pollReadySnapshot() {
      const snapshot = readySnapshot;
      if (!snapshot) {
        return undefined;
      }

      readySnapshot = undefined;
      currentSnapshot = snapshot;
      current = snapshot.deformation;
      lastCommitMs = nowMs();
      scheduleNextBuild();
      return snapshot;
    },
    get state() {
      return {
        version: currentSnapshot.version,
        deformationKind: current.kind,
        current,
        target,
        buildInFlight,
        lastBuildMs,
        lastCommitMs,
        lastError,
      };
    },
    dispose() {
      disposed = true;
      readySnapshot = undefined;
      buildClient.dispose();
    },
  };

  return session;
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
