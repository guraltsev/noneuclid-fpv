/**
 * Aim-ray resolution for both input modes: the desktop camera center ray and the right (or first) XR controller ray.
 * Turns a RootAimRay (origin/direction/quaternion in the Three.js root frame, meters) into AimTarget hits through resolveAimTargets, cycles between overlapping interactable objects, and finds the object whose tooltip or interaction should be shown.
 * The ray is always cast from the root frame across the currently visible portal paths, with a maximum distance of 24 m.
 * Mutable state is limited to the target-cycle selection, which is keyed by a signature of the candidate list and so resets whenever the candidates change.
 */
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { type DebugLevelId } from "../../glue/debugLevels";
import { type RuntimeMenuState } from "../../runtime/runtimeMenuState";
import {
  createWorldFocusMessageDefinition,
  formatWorldFocusMessageTextForLegacyFallback,
} from "../../ui/worldInteractionDefinition";
import { canExtendGeodesicSegment, isGeodesicLocked } from "../../world-objects/geodesicCannon";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { AimTarget, resolveAimTargets } from "./aimTarget";
import { formatVec3, roundNumber } from "./appDebugHelpers";
import { GeodesicCannonToolState } from "./geodesicCannonTools";
import { renderCameraFarMeters, renderCameraNearMeters } from "./renderCameraClip";
import {
  RootAimRay,
  createAimTargetCycleSignature,
  getRuntimeObjectInteractionRangeMeters,
} from "./rootAimRay";
import { VisiblePortalPath } from "./visiblePortalPaths";
import { createXrPlayerRig, xrRigidTransformLocalMatrix } from "./xrPlayerRig";

/** The interactable object the aim ray currently rests on. */
export interface FocusedRuntimeObject {
  readonly object: RuntimeWorldObject;
  readonly distance: number;
  readonly tooltipAnchor: { readonly x: number; readonly y: number; readonly z: number };
}

/** Dependencies for {@link createAimInteraction}; createThreeApp#shell supplies the live camera, renderer and rig objects as values and the changing state as getters. */
export interface AimInteractionDeps {
  /** Desktop (non-XR) render camera; its world pose defines the desktop aim ray (forward is -z in camera space). */
  readonly camera: THREE.PerspectiveCamera;
  /** Provides the XR session (input sources) and the canvas element used to anchor the desktop tooltip. */
  readonly renderer: THREE.WebGLRenderer;
  /** XR player rig; its root matrixWorld maps controller poses from the XR reference space into the scene. */
  readonly xrRig: ReturnType<typeof createXrPlayerRig>;
  /** Registry of world objects tested for aim hits; also used to check whether a geodesic is locked. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Getter: the currently active (possibly deformed) compiled world. */
  getWorld(): CompiledCellComplex;
  /** Getter: current debug level; only the verbose level enables click logging. */
  getDebugLevel(): DebugLevelId;
  /** Getter: current runtime menu state, whose selectedTool affects which geodesic is ignored and the focus message. */
  getMenuState(): RuntimeMenuState;
  /** Getter: geodesic cannon tool state; activeGeodesicId is excluded from aim hits while aiming a cannon. */
  getCannonToolState(): GeodesicCannonToolState;
  /** Getter: portal paths visible this frame, through which the ray is continued into neighbouring cells. */
  getRuntimeObjectVisiblePaths(): readonly VisiblePortalPath[];
}

/**
 * Creates the aim-interaction helpers bound to the given dependencies.
 * Returns resolveCurrentAimTarget (the selected hit, honoring the cycle index), resolveCurrentAimTargets (all hits), cycleFocusedAimTarget (advance the cycle; true if it moved), findFocusedRuntimeObject (object with tooltip or interaction within range, plus tooltip anchor), targetIsWithinInteractionRange, logVerboseAimClick, resolveActiveRootAimRay (XR controller or camera ray), resolveCameraRootRay, resolveDesktopTooltipScreenPosition (client pixels), getRuntimeObjectTooltipText and getWorldFocusMessageDefinition.
 * Rays are in the Three.js root frame, in meters. No resources need disposal; the internal camera is only a pose carrier.
 */
export function createAimInteraction(deps: AimInteractionDeps) {
  const { camera, renderer, xrRig, runtimeObjectRegistry, getRuntimeObjectVisiblePaths } = deps;
  // Pose-only camera that adapts a RootAimRay to the camera-based resolveAimTargets API.
  const aimRayCamera = new THREE.PerspectiveCamera(70, 1, renderCameraNearMeters, renderCameraFarMeters);
  // Which of several overlapping candidates is selected; valid only while the candidate signature is unchanged.
  let aimTargetCycleState: { readonly signature: string; readonly index: number } | undefined;

  // Selected target: the cycled object candidate if any interactable object is in range, otherwise the first hit of any kind.
  // Side effect: clears the cycle state when there are no candidates or the candidate set changed.
  function resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined {
    const targets = resolveCurrentAimTargets(ray);
    const cycleTargets = getAimTargetCycleCandidates(targets);
    if (cycleTargets.length === 0) {
      aimTargetCycleState = undefined;
      return targets[0];
    }

    const signature = createAimTargetCycleSignature(cycleTargets);
    if (aimTargetCycleState?.signature !== signature) {
      aimTargetCycleState = undefined;
      return cycleTargets[0];
    }

    return cycleTargets[aimTargetCycleState.index % cycleTargets.length] ?? cycleTargets[0];
  }

  function resolveCurrentAimTargetCycleCandidates(ray: RootAimRay): readonly AimTarget[] {
    return getAimTargetCycleCandidates(resolveCurrentAimTargets(ray));
  }

  // While the geodesic-cannon-aim tool is active, the geodesic being aimed is ignored so it cannot block its own aim.
  function resolveCurrentAimTargets(ray: RootAimRay): readonly AimTarget[] {
    const activeGeodesicId = deps.getCannonToolState().activeGeodesicId;
    const ignoredGeodesicIds = deps.getMenuState().selectedTool === "geodesic-cannon-aim" && activeGeodesicId
      ? [activeGeodesicId]
      : undefined;
    const aimCamera = syncAimRayCamera(ray);

    return resolveAimTargets({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      camera: aimCamera,
      visiblePortalPaths: getRuntimeObjectVisiblePaths(),
      maxDistanceMeters: 24,
      ignoredGeodesicIds,
    });
  }

  // Only object hits within interaction range participate in cycling.
  function getAimTargetCycleCandidates(targets: readonly AimTarget[]): readonly AimTarget[] {
    return targets.filter((target) =>
      target.kind === "object" &&
      target.object !== undefined &&
      targetIsWithinInteractionRange(target)
    );
  }

  // Copies the ray pose onto the pose-only aim camera and refreshes its matrices.
  function syncAimRayCamera(ray: RootAimRay): THREE.Camera {
    aimRayCamera.position.copy(ray.origin);
    aimRayCamera.quaternion.copy(ray.quaternion);
    aimRayCamera.updateMatrixWorld(true);
    return aimRayCamera;
  }

  // Advances to the next overlapping candidate (wrapping); returns false when there is no ray or fewer than two candidates.
  function cycleFocusedAimTarget(ray?: RootAimRay): boolean {
    if (!ray) {
      return false;
    }

    const targets = resolveCurrentAimTargetCycleCandidates(ray);
    if (targets.length < 2) {
      return false;
    }

    const signature = createAimTargetCycleSignature(targets);
    const previousIndex = aimTargetCycleState?.signature === signature ? aimTargetCycleState.index : 0;
    aimTargetCycleState = {
      signature,
      index: (previousIndex + 1) % targets.length,
    };
    return true;
  }

  // Returns the aimed object only when it has a tooltip or is interactable and is within range.
  // tooltipAnchor is the hit point in root world coordinates (z up) raised by 0.18 m.
  function findFocusedRuntimeObject(ray?: RootAimRay): {
    readonly object: RuntimeWorldObject;
    readonly distance: number;
    readonly tooltipAnchor: { readonly x: number; readonly y: number; readonly z: number };
  } | undefined {
    if (!ray) {
      return undefined;
    }

    const target = resolveCurrentAimTarget(ray);
    const object = target?.object;
    if (target?.kind !== "object" || !object || (!object.tooltip && !object.interactable)) {
      return undefined;
    }

    if (!targetIsWithinInteractionRange(target)) {
      return undefined;
    }

    return {
      object,
      distance: target.distanceMeters,
      tooltipAnchor: {
        x: target.rootPoint.x,
        y: target.rootPoint.y,
        z: target.rootPoint.z + 0.18,
      },
    };
  }

  // True for object hits farther than 1 mm and within the object's interaction range (meters).
  function targetIsWithinInteractionRange(target: ReturnType<typeof resolveCurrentAimTarget>): boolean {
    const object = target?.object;
    if (target?.kind !== "object" || !object || target.distanceMeters <= 0.001) {
      return false;
    }

    return target.distanceMeters <= getRuntimeObjectInteractionRangeMeters(object);
  }

  // Logs the aim hit to the console when the debug level is verbose.
  function logVerboseAimClick(target: ReturnType<typeof resolveCurrentAimTarget>): void {
    if (deps.getDebugLevel() !== "verbose") {
      return;
    }

    if (!target) {
      console.info("Aim click: no target within 24m.");
      return;
    }

    const fields: Record<string, string | number | undefined> = {
      kind: target.kind,
      cellId: target.cellId,
      portalPathId: target.portalPathId,
      distanceMeters: roundNumber(target.distanceMeters),
      localPoint: formatVec3(target.localPoint),
      rootPoint: formatVec3(target.rootPoint),
      localNormal: formatVec3(target.localNormal),
    };

    if (target.object) {
      const interactionRange = target.object.tooltip?.rangeMeters ?? target.object.interactable?.rangeMeters;
      fields.objectId = target.object.id;
      fields.objectKind = target.object.kind;
      fields.interactionRangeMeters = interactionRange;
      fields.withinInteractionRange = interactionRange === undefined
        ? undefined
        : target.distanceMeters <= interactionRange ? "yes" : "no";
    }

    console.info("Aim click:", fields);
  }

  // XR: controller ray from the supplied frame and reference space (undefined if unavailable); desktop: the camera ray.
  function resolveActiveRootAimRay(
    xrActive: boolean,
    xrFrame?: XRFrame,
    xrReferenceSpace?: XRReferenceSpace | null,
  ): RootAimRay | undefined {
    return xrActive
      ? resolveXrControllerRootRay(xrFrame, xrReferenceSpace ?? null)
      : resolveCameraRootRay();
  }

  // Ray from the camera position along its forward (-z) axis, in the Three.js root frame.
  function resolveCameraRootRay(): RootAimRay {
    camera.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const cameraQuaternion = new THREE.Quaternion();
    camera.getWorldQuaternion(cameraQuaternion);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();
    return { origin, direction, quaternion: cameraQuaternion };
  }

  function resolveXrControllerRootRay(
    xrFrame: XRFrame | undefined,
    xrReferenceSpace: XRReferenceSpace | null,
  ): RootAimRay | undefined {
    const session = renderer.xr.getSession();
    if (!xrFrame || !xrReferenceSpace || !session) {
      return undefined;
    }

    // Prefer the right-hand tracked controller; hand-tracking sources are skipped.
    const sources = [...session.inputSources].filter((source) => source.targetRaySpace && !source.hand);
    const source = sources.find((candidate) => candidate.handedness === "right") ?? sources[0];
    if (!source) {
      return undefined;
    }

    const pose = xrFrame.getPose(source.targetRaySpace, xrReferenceSpace);
    if (!pose) {
      return undefined;
    }

    // Controller pose in the reference space, lifted into the scene by the rig's world transform.
    const worldMatrix = xrRig.root.matrixWorld.clone().multiply(xrRigidTransformLocalMatrix(pose.transform));
    const origin = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(worldMatrix);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(worldMatrix).normalize();
    return { origin, direction, quaternion };
  }

  // Client-pixel position just above the canvas center (crosshair), where the desktop tooltip is anchored.
  function resolveDesktopTooltipScreenPosition(): { readonly x: number; readonly y: number } {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2 - 28,
    };
  }

  // Plain-text fallback of the focus message for the given input mode.
  function getRuntimeObjectTooltipText(object: RuntimeWorldObject, inputMode: "desktop" | "xr"): string | undefined {
    return formatWorldFocusMessageTextForLegacyFallback(
      getWorldFocusMessageDefinition(object),
      inputMode,
    );
  }

  // Focus message for the object; extension is offered only for unlocked geodesic segments that can be extended.
  function getWorldFocusMessageDefinition(object: RuntimeWorldObject) {
    return createWorldFocusMessageDefinition({
      object,
      selectedTool: deps.getMenuState().selectedTool,
      canExtendGeodesic: object.kind === "geodesic-segment" &&
        canExtendGeodesicSegment(object) &&
        !isGeodesicLocked(runtimeObjectRegistry, object.geodesicId),
    });
  }

  return {
    resolveCurrentAimTarget,
      resolveCurrentAimTargets,
    cycleFocusedAimTarget,
    findFocusedRuntimeObject,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    resolveActiveRootAimRay,
    resolveCameraRootRay,
    resolveDesktopTooltipScreenPosition,
    getRuntimeObjectTooltipText,
    getWorldFocusMessageDefinition,
  };
}
