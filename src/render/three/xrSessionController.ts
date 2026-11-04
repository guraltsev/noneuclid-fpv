/**
 * Orchestrates the immersive-VR session of the shell: capability probe, entering, the session's `end` event, restarts that must
 * wait for the session to end, teardown, and the XR head pose and debug readout.
 *
 * The controller owns the session state (`XrSessionState`), the XR debug readout, the active session and its `end`-listener cleanup;
 * the shell reads them through `sessionState()` and `debugState()`. Every state change re-renders the entry overlay, which the
 * shell creates and disposes. `enterVr` never rejects: errors set the state to "failed" with the message. Restarts go through
 * `xrSessionRestart.ts`. Positions are meters; the head pose aliases module-level scratch objects and is valid until the next call.
 */
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import * as THREE from "three";
import {
  createXrSessionState,
  detectXrSessionState,
  transitionXrSessionState,
  type XrNavigatorLike,
  type XrSessionState,
} from "../../interaction/xrSessionState";
import type { PlayerPose } from "../../movement/playerPose";
import type { ClientSession } from "../../runtime/clientSession";
import type { RuntimeInputFrame } from "../../interaction/inputFrame";
import type { XrHeadWorldPose } from "./carriedGeodesicCannon";
import { createInitialXrDebugState } from "./frameDiagnostics";
import type { XrDebugRenderState } from "./renderState";
import { describeXrInputMode } from "./xrDebugPanel";
import type { XrEntryUi } from "./xrEntryUi";
import { xrRigidTransformLocalMatrix } from "./xrPlayerRig";
import { createXrSessionRestartCoordinator, type RestartableXrSession } from "./xrSessionRestart";

// Scratch objects for resolveXrHeadWorldPose; the returned pose aliases them and must not be stored.
const xrHeadWorldMatrix = new THREE.Matrix4();
const xrHeadWorldPosition = new THREE.Vector3();
const xrHeadWorldQuaternion = new THREE.Quaternion();
const xrHeadWorldScale = new THREE.Vector3();

/** The renderer's XR manager, reduced to what the controller reads and writes. */
export interface XrRendererLike {
  readonly isPresenting: boolean;
  getSession?(): (XRSession & RestartableXrSession) | null;
  setSession(session: XRSession): Promise<void>;
}

/** The movement result fields the debug readout remembers. */
export interface XrDebugMoveResult {
  readonly blocked: boolean;
  readonly blockingReason?: string;
  readonly crossedPortalId?: string;
}

/** The debug fields that come from the frame loop's render state rather than from the XR session. */
export type XrRenderDebugFields = Pick<
  XrDebugRenderState,
  | "framePerformance"
  | "webGlRenderInfo"
  | "visiblePortalPathCount"
  | "visiblePortalPaths"
  | "portalInstances"
  | "portalEyes"
  | "stereoPortalPaths"
>;

/** What `createXrSessionController` needs from the shell. */
export interface XrSessionControllerDeps {
  /** The entry overlay, re-rendered after every state change; the shell creates (its button calls `enterVr`) and disposes it. */
  readonly entryUi: Pick<XrEntryUi, "update">;
  /** `navigator`, or a fake; `xr` is absent in unsupported browsers. */
  readonly navigator: XrNavigatorLike;
  readonly secureContext: boolean;
  /** Read for the player pose in the debug readout. */
  readonly session: ClientSession;
  /** The world engine; the player's pose is read from it. */
  readonly engine: WorldEngine;
  readonly initialPlayerPose: PlayerPose;
  readonly xr: XrRendererLike;
  readonly xrRig: {
    readonly root: THREE.Object3D;
    getSharedRenderRootCellId(pose: PlayerPose): string;
  };
  /** Runs when a session ends on its own: reset the rig, the palette input, the hand models and hide the palette. */
  resetAfterSessionEnd(): void;
  /** Objects with an optional `dispose` that teardown also disposes (the rig, the XR controls). */
  readonly disposeOnTeardown: readonly object[];
  /** The frame loop's part of the debug readout, read at each `syncDebugState`. */
  readRenderDebugFields(): XrRenderDebugFields;
}

/** Handle returned by `createXrSessionController`. */
export interface XrSessionController {
  /** Current session state. */
  sessionState(): XrSessionState;
  /** Current XR/location debug readout. */
  debugState(): XrDebugRenderState;
  /** Probes WebXR support once, asynchronously, and updates the entry overlay. */
  detectAvailability(): void;
  /** Requests an immersive-vr session; does nothing unless the state is available, ended or failed. */
  enterVr(): Promise<void>;
  /** Runs `restart` once any presenting session has ended; if ending fails the state becomes "failed" and `restart` is not run. */
  requestAppRestart(restart: () => void): void;
  /** Head pose in world space (rig root times viewer pose); aliases scratch objects. */
  resolveXrHeadWorldPose(xrViewerPose: XRViewerPose | undefined): XrHeadWorldPose | undefined;
  /** Recomputes the debug readout; `moveResult` updates the remembered movement fields. */
  syncDebugState(source: RuntimeInputFrame["source"], moveResult?: XrDebugMoveResult): void;
  /** Detaches the `end` listener, ends the session, cancels a pending restart and disposes `disposeOnTeardown`. */
  endActiveXrSessionOnDispose(): void;
}

/** Creates the controller; it starts with state "unknown" until `detectAvailability` resolves. */
export function createXrSessionController(deps: XrSessionControllerDeps): XrSessionController {
  let sessionState: XrSessionState = createXrSessionState("unknown", { secureContext: deps.secureContext });
  let debugState: XrDebugRenderState = createInitialXrDebugState(sessionState, deps.initialPlayerPose);
  let activeXrSession: XRSession | undefined;
  let sessionEndHandlerCleanup: (() => void) | undefined;
  let disposed = false;
  const restartCoordinator = createXrSessionRestartCoordinator();
  const entryUi = deps.entryUi;

  function transition(status: Parameters<typeof transitionXrSessionState>[1], message?: string): void {
    sessionState = transitionXrSessionState(sessionState, status, message);
    entryUi.update(sessionState);
  }

  function syncDebugState(source: RuntimeInputFrame["source"], moveResult?: XrDebugMoveResult): void {
    const pose = readLocalPlayerPose(deps.engine);
    const presenting = deps.xr.isPresenting;
    debugState = {
      secureContext: sessionState.secureContext,
      sessionStatus: sessionState.status,
      activeInputSource: source,
      currentCellId: pose.cellId,
      playerPosition: pose.position,
      yawRadians: pose.yawRadians,
      lastMovementBlocked: moveResult?.blocked ?? debugState.lastMovementBlocked,
      lastBlockingReason: moveResult?.blockingReason ?? debugState.lastBlockingReason,
      lastCrossedPortalId: moveResult?.crossedPortalId ?? debugState.lastCrossedPortalId,
      inputMode: presenting ? describeXrInputMode([...(deps.xr.getSession?.()?.inputSources ?? [])]) : undefined,
      sharedRenderRootCellId: presenting ? deps.xrRig.getSharedRenderRootCellId(pose) : undefined,
      ...deps.readRenderDebugFields(),
    };
  }

  async function enterVr(): Promise<void> {
    const xr = deps.navigator.xr;

    if (
      !xr?.requestSession ||
      !sessionState.immersiveVrSupported ||
      (sessionState.status !== "available" && sessionState.status !== "ended" && sessionState.status !== "failed")
    ) {
      return;
    }

    transition("entering");
    syncDebugState("desktop");

    try {
      const session = await xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      activeXrSession = session;
      const onXrSessionEnd = (): void => {
        if (disposed) {
          return;
        }
        activeXrSession = undefined;
        transition("ended");
        deps.resetAfterSessionEnd();
        syncDebugState("desktop");
      };
      session.addEventListener("end", onXrSessionEnd);
      sessionEndHandlerCleanup = () => session.removeEventListener("end", onXrSessionEnd);
      await deps.xr.setSession(session);
      transition("active");
      syncDebugState("xr");
    } catch (error) {
      transition("failed", error instanceof Error ? error.message : "Unable to start immersive VR.");
      syncDebugState("desktop");
    }
  }

  entryUi.update(sessionState);

  return {
    sessionState: () => sessionState,
    debugState: () => debugState,
    detectAvailability() {
      void detectXrSessionState(deps.navigator, deps.secureContext).then((state) => {
        if (disposed) {
          return;
        }
        sessionState = state;
        entryUi.update(sessionState);
        syncDebugState("desktop");
      });
    },
    enterVr,
    requestAppRestart(restart) {
      const session = deps.xr.isPresenting ? deps.xr.getSession?.() : undefined;

      restartCoordinator.requestRestart(session, restart, (error) => {
        const message = error instanceof Error ? error.message : "Unable to leave immersive VR before restarting.";
        console.warn("[noneuclid] unable to end XR session before restart", error);
        transition("failed", message);
        syncDebugState("desktop");
      });
    },
    resolveXrHeadWorldPose(xrViewerPose) {
      if (!xrViewerPose) {
        return undefined;
      }

      xrHeadWorldMatrix.copy(deps.xrRig.root.matrixWorld).multiply(xrRigidTransformLocalMatrix(xrViewerPose.transform));
      xrHeadWorldMatrix.decompose(xrHeadWorldPosition, xrHeadWorldQuaternion, xrHeadWorldScale);
      return { position: xrHeadWorldPosition, quaternion: xrHeadWorldQuaternion };
    },
    syncDebugState,
    endActiveXrSessionOnDispose() {
      disposed = true;
      restartCoordinator.cancel();
      sessionEndHandlerCleanup?.();
      sessionEndHandlerCleanup = undefined;
      const session = activeXrSession ?? deps.xr.getSession?.() ?? undefined;
      activeXrSession = undefined;
      if (session) {
        try {
          void Promise.resolve(session.end()).catch(() => undefined);
        } catch {
          // Session already ended or ending; nothing more to do.
        }
      }
      for (const owned of deps.disposeOnTeardown) {
        try {
          (owned as { dispose?: () => void }).dispose?.();
        } catch {
          // Optional dispose must not block the rest of teardown.
        }
      }
    },
  };
}
