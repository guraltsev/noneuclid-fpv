/**
 * Pure build step (and Web Worker entry) that turns a base CellComplexSpec plus a deformation state into a fully compiled, topology-validated world with its static portal-path culling tables.
 * The build is: normalize the state with its deformation family, apply it to the base spec, compile, check the result against the compiled base world with family.validateSnapshot, then run buildStaticallyCulledPortalPathTables.
 * Failures never throw out of buildWorldGeometrySnapshotForRequest; they return a "failed" response so the session can record lastError.
 * When loaded in a worker global (self defined, no document) the module answers "message" events with the same function, so the module is also safe to import on the main thread.
 */
import { compileCellComplex, type CompiledCellComplex } from "../cell-complex/compileCellComplex";
import {
  buildStaticallyCulledPortalPathTables,
  type StaticPortalPathCullResult,
} from "../cell-complex/staticPortalPathCull";
import type { CellComplexSpec } from "../cell-complex/specs";
import {
  createDefaultWorldDeformationFamilyRegistry,
  getWorldDeformationFamilyOrThrow,
} from "./worldGeometryDeformationFamilies";
import type { WorldDeformationState } from "./worldGeometryDeformations";

/**
 * Message sent to the geometry builder: the undeformed base spec, the deformation state to realize, and portal-path culling parameters.
 */
export interface BuildWorldGeometrySnapshotRequest {
  /** Caller-chosen id echoed in the response so stale answers can be discarded. */
  readonly requestId: number;
  /**
   * Undeformed world spec; deformations are always applied to this, never to a previously deformed spec.
   */
  readonly baseSpec: CellComplexSpec;
  readonly deformation: WorldDeformationState;
  /** Parameters forwarded to buildStaticallyCulledPortalPathTables for the new world. */
  readonly portalPathOptions: {
    readonly maxDepth: number;
    readonly skipImmediateReverse: boolean;
    readonly toleranceMeters: number;
    readonly maxKeptPathsPerRoot: number;
  };
}

/**
 * Result of a build: "built" with the deformed spec, compiled world, culling tables and completion time (ms on the performance clock, or Date.now), or "failed" with an error message.
 */
export type BuildWorldGeometrySnapshotResponse =
  | {
      readonly kind: "built";
      readonly requestId: number;
      readonly spec: CellComplexSpec;
      readonly world: CompiledCellComplex;
      readonly staticCull: StaticPortalPathCullResult;
      readonly completedAtMs: number;
    }
  | {
      readonly kind: "failed";
      readonly requestId: number;
      readonly message: string;
    };

/**
 * Synchronously builds and validates the snapshot for a request, returning a "failed" response instead of throwing on any error (unknown family, inapplicable spec, topology change, compile failure).
 */
export function buildWorldGeometrySnapshotForRequest(
  request: BuildWorldGeometrySnapshotRequest,
): BuildWorldGeometrySnapshotResponse {
  try {
    const registry = createDefaultWorldDeformationFamilyRegistry();
    const family = getWorldDeformationFamilyOrThrow(registry, request.deformation.kind);
    if (!family.canApplyToSpec(request.baseSpec)) {
      throw new Error(`World deformation family "${request.deformation.kind}" cannot apply to this world spec.`);
    }

    const baseWorld = compileCellComplex(request.baseSpec);
    const deformation = family.normalizeState(request.baseSpec, request.deformation as never);
    const spec = family.applyToSpec(request.baseSpec, deformation);
    const world = compileCellComplex(spec);
    const validationErrors = family.validateSnapshot(baseWorld, world);
    if (validationErrors.length > 0) {
      throw new Error(validationErrors.map((error) => `- ${error}`).join("\n"));
    }

    const staticCull = buildStaticallyCulledPortalPathTables(world, request.portalPathOptions);

    return {
      kind: "built",
      requestId: request.requestId,
      spec,
      world,
      staticCull,
      completedAtMs: nowMs(),
    };
  } catch (error) {
    return {
      kind: "failed",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const workerSelf = typeof self === "undefined" || typeof document !== "undefined"
  ? undefined
  : self as {
      addEventListener(
        type: "message",
        listener: (event: MessageEvent<BuildWorldGeometrySnapshotRequest>) => void,
      ): void;
      postMessage(response: BuildWorldGeometrySnapshotResponse): void;
    };

workerSelf?.addEventListener("message", (event: MessageEvent<BuildWorldGeometrySnapshotRequest>) => {
  workerSelf.postMessage(buildWorldGeometrySnapshotForRequest(event.data));
});

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
