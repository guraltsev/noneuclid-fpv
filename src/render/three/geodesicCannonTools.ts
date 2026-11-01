/**
 * Geodesic emitter (cannon) tools: place, rotate, aim, carry, tie-and-detach, and delete geodesics.
 *
 * This module is the interaction layer between the aim/menu systems and the geodesic world-object logic in
 * `world-objects/geodesic/`. It mutates the runtime object registry (cannons, geodesic segments/intervals) and
 * the shell-owned cannon tool state and menu state through getter/setter dependencies, then triggers the
 * follow-up syncs (palette, portal instances, hitbox debug, dependent measurements and protractor angles).
 * Poses and distances are cell-local (meters; x right, y forward, z up) with yaws in radians
 * counter-clockwise from +x; Three.js-space values only appear for the carried-emitter glow and aim rays.
 * Ids of new cannons and geodesics embed `Date.now()` plus a per-factory counter.
 */
import type { FocusedRuntimeObject } from "./rootAimRay";
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { type DebugLevelId } from "../../diagnostics/debugLevels";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { type Vec3, normalizeVec3 } from "../../math/vec3";
import { testCellCollision } from "../../movement/collision";
import { type PlayerPose } from "../../movement/playerPose";
import {
  type RuntimeMenuState,
  closeRuntimeMenu,
  setRuntimeMenuSelectedTool,
  showRuntimeMenuGeodesicCannonActions,
} from "../../runtime/runtimeMenuState";
import {
  type GeodesicEndpointSelection,
  type GeodesicPortalTraversal,
} from "../../world-objects/geodesic/objects";
import {
  pruneMissingGeodesicIntersectionObjects,
  withDeferredGeodesicIntersections,
} from "../../world-objects/geodesic/intersections";
import {
  getGeodesicEndpointAttachmentsForAnchor,
  resolveGeodesicEndpointSelectionFromSegmentHit,
} from "../../world-objects/geodesic/endpoints";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../world-objects/geodesic/segments";
import {
  collectLockedIncidentGeodesicIdsForEmitter,
  isGeodesicLocked,
  removeGeodesic,
  removeGeodesicCannonAndSegments,
  removeUnlockedGeodesicsFromCannon,
} from "../../world-objects/geodesic/lifecycle";
import { tieAndDetachGeodesicEndpoints } from "../../world-objects/geodesic/curveShortening";
import {
  extendGeodesic,
  placeGeodesicCannonAtFloorPoint,
  placeGeodesicCannonAtGeodesicVertex,
  placeGeodesicCannonOnGeodesic,
  moveEmitterAlongRoute,
  rebuildConnectedGeodesicBetweenEmitters,
  rebuildGeodesicToLength,
  shootGeodesic,
} from "../../world-objects/geodesic/cannon";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import { AimTarget } from "../../interaction/aimTarget";
import {
  carriedGeodesicEmitterPoseToleranceMeters,
  createCarriedGeodesicCannonGlow,
  getDistanceAlongGeodesicSegment,
  resolveCannonGeodesicId,
  resolveDesktopCarriedGeodesicCannonAnchor,
  resolveGeodesicCannonAbsoluteEmitterPoint,
  resolveVrCarriedGeodesicCannonAnchor,
} from "./carriedGeodesicCannon";
import { createDesktopControls } from "./desktopControls";
import { resolveGeodesicCannonAimYawFromAbsolutePoints } from "./geodesicCannonAimTarget";
import { locateDevelopedPoint } from "../../cell-complex/segmentWalk";
import { composeRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import {
  RootAimRay,
  getAimForwardVector,
  getRuntimeObjectInteractionRangeMeters,
  intersectRootRayWithFloor,
} from "./rootAimRay";
import { distanceSquared } from "./runtimeSceneUtils";
import { worldPointToThree } from "./worldAxes";

// A carried emitter's step in one frame is at most this far (meters); a larger move is a jump (a pickup from another face).
const carriedEmitterStepMaxMeters = 1;
// Longest chain of portals searched for a step, and for a jump.
const carriedEmitterStepMaxHops = 2;
const carriedEmitterJumpMaxHops = 6;

/** Editing state of the geodesic emitter (cannon) tools. */
export interface GeodesicCannonToolState {
  /** Cannon currently being edited, carried, or tie-detached. */
  readonly selectedCannonId?: string;
  /** Geodesic of the selected cannon that rotate/aim/carry operate on. */
  readonly activeGeodesicId?: string;
  /** Endpoints picked so far in the tie-and-detach tool (at most two). */
  readonly tieAndDetachEndpointSelections?: readonly GeodesicEndpointSelection[];
}

/**
 * Dependencies of the geodesic cannon tools, supplied by createThreeApp's shell.
 *
 * Plain-value fields are long-lived objects; `get*` members are getters because the shell reassigns the
 * underlying `let` variables (menu state, cannon tool state, world, player pose); the shell's `set*` members write
 * those variables back.
 */
export interface GeodesicCannonToolsDeps {
  /** Scene that receives the carried-emitter glow mesh. */
  readonly scene: THREE.Scene;
  /** Renderer; only `xr.isPresenting` is read, to skip pointer lock in XR. */
  readonly renderer: THREE.WebGLRenderer;
  /** Desktop controls, used to request pointer lock while rotating, aiming, or carrying. */
  readonly controls: ReturnType<typeof createDesktopControls>;
  /** Registry holding cannons, geodesic segments/intervals, and related objects; mutated directly. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Getter for the active compiled world. */
  getWorld(): CompiledCellComplex;
  /** Getter for the runtime menu state (selected tool, open menu). */
  getMenuState(): RuntimeMenuState;
  /** Replaces the shell's menu state. */
  setMenuState(next: RuntimeMenuState): void;
  /** Getter for the cannon tool state. */
  getCannonToolState(): GeodesicCannonToolState;
  /** Replaces the shell's cannon tool state (not merged; pass `{}` to clear). */
  setCannonToolState(next: GeodesicCannonToolState): void;
  /** Getter for the player's pose (cell id and cell-local position). */
  getPlayerPose(): PlayerPose;
  /** Getter for the debug level; "verbose" enables portal-word logging. */
  getDebugLevel(): DebugLevelId;
  /** Resolves the single best aim target for a ray. */
  resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined;
  /** Resolves all aim targets along a ray, in the order the aim system returns them. */
  resolveCurrentAimTargets(ray: RootAimRay): readonly AimTarget[];
  /** True when the target is close enough to interact with. */
  targetIsWithinInteractionRange(target: AimTarget | undefined): boolean;
  /** Logs the clicked target when verbose debugging is on. */
  logVerboseAimClick(target: AimTarget | undefined): void;
  /** Finds the interactable runtime object under the (optional) ray, with its distance. */
  findFocusedRuntimeObject(ray?: RootAimRay): FocusedRuntimeObject | undefined;
  /** Maps geodesic ids to their display names ("G1", ...) for menus. */
  getGeodesicLabelsById(geodesicIds: readonly string[]): Readonly<Record<string, string>>;
  /** Re-syncs the desktop tool palette after tool or menu changes. */
  syncDesktopPalette(): void;
  /** Requests a sync of the instanced copies of runtime objects seen through portals after registry changes; the frame performs it. */
  syncRuntimeObjectPortalInstances(): void;
  /** Requests a refresh of the selectable-hitbox debug wireframes after registry changes; the frame performs it. */
  syncSelectableHitboxDebug(): void;
  /** Recomputes measured lengths attached to a geodesic. */
  refreshMeasuredGeodesicLengthsForGeodesic(geodesicId: string): void;
  /** Deletes measured lengths attached to a geodesic. */
  removeMeasuredGeodesicLengthsForGeodesic(geodesicId: string): void;
  /** Deletes protractor angles that use a geodesic as a leg. */
  removeProtractorAnglesForGeodesic(geodesicId: string): void;
  /** Deletes protractor angles centered on intersection vertices that no longer exist. */
  removeProtractorAnglesForMissingVertices(vertexIds: readonly string[]): void;
  /** Recomputes protractor angles that use a geodesic. */
  refreshProtractorAnglesForGeodesic(geodesicId: string): void;
  /** Recomputes protractor angles that use any of the geodesics. */
  refreshProtractorAnglesForGeodesics(geodesicIds: readonly string[]): void;
}

/**
 * Creates the geodesic cannon tool controller and returns its operations.
 *
 * Entry points: `tryUseGeodesicCannonToolFromAim` (place a cannon, or add a geodesic to one, from an aim ray),
 * `tryExtendFocusedGeodesicFromAim`, `addGeodesicToCannon`, `deleteGeodesicFromCannon`, the mode starters
 * `startGeodesicCannonRotation`/`Aim`/`Carry`/`TieAndDetach`, the per-frame updaters
 * `updateActiveGeodesicCannonRotation`, `updateActiveGeodesicCannonAim`, and `updateCarriedGeodesicCannonPose`, and
 * `finishGeodesicCannonCarry`. Locked geodesics cannot be rotated or aimed. Operations with missing or wrong-kind cannons close the menu and return
 * without throwing. Placement helpers that need a horizontal facing silently do nothing when the aim ray is vertical.
 *
 * Lifecycle: the only owned GPU resource is the lazily created carried-emitter glow mesh, which is added to the
 * scene on first use and only hidden (never removed or disposed) by `clearCarriedGeodesicCannonGlow`; the shell
 * must dispose it with the scene. Closure state (id counters, frozen XR head height, target geodesic length) lives for
 * the factory's lifetime.
 */
export function createGeodesicCannonTools(deps: GeodesicCannonToolsDeps) {
  const {
    scene,
    renderer,
    controls,
    runtimeObjectRegistry,
    resolveCurrentAimTarget,
    resolveCurrentAimTargets,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    getGeodesicLabelsById,
    syncDesktopPalette,
    syncRuntimeObjectPortalInstances,
    syncSelectableHitboxDebug,
    refreshMeasuredGeodesicLengthsForGeodesic,
    removeMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
    refreshProtractorAnglesForGeodesic,
    refreshProtractorAnglesForGeodesics,
  } = deps;
  let geodesicCannonIdCounter = 0;
  let geodesicIdCounter = 0;
  let geodesicCannonRotationHeadHeightMeters: number | undefined;
  let geodesicCannonRotationTargetLengthMeters: number | undefined;
  let carriedGeodesicCannonGlow: THREE.Mesh | undefined;

  /** Forgets the frozen head height and target length once the matching tool mode has ended. */
  function resetGeodesicCannonRotationTracking(mode: { readonly rotating: boolean; readonly aiming: boolean }): void {
    if (!mode.rotating) {
      geodesicCannonRotationHeadHeightMeters = undefined;
    }
    if (!mode.rotating && !mode.aiming) {
      geodesicCannonRotationTargetLengthMeters = undefined;
    }
  }

  function tryUseGeodesicCannonToolFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    if (targetIsWithinInteractionRange(target) && target?.object?.kind === "geodesic-cannon") {
      addGeodesicToCannon(target.object.id, { afterAdd: "return-to-none" });
      return;
    }

    // Aiming at a geodesic crossing places a cannon at that vertex; the yaw below is the horizontal aim direction.
    if (target?.object?.kind === "geodesic-intersection") {
      const forward = getAimForwardVector(ray);
      if (!forward) {
        return;
      }
      let horizontalForward: { readonly x: number; readonly y: number; readonly z: number };
      try {
        horizontalForward = normalizeVec3({ x: forward.x, y: forward.y, z: 0 });
      } catch {
        return;
      }
      const aimYawRadians = Math.atan2(horizontalForward.y, horizontalForward.x);
      const result = placeGeodesicCannonAtGeodesicVertex({
        world: deps.getWorld(),
        registry: runtimeObjectRegistry,
        cellId: target.object.cellId,
        vertexPoint: target.object.aimStickyTarget?.localPoint ?? target.localPoint,
        aimYawRadians,
        id: `geodesic-cannon:${Date.now()}:${geodesicCannonIdCounter++}`,
        createContinuationGeodesicId: () => `geodesic:${Date.now()}:${geodesicIdCounter++}`,
      });
      if (!result.placed || !result.object) {
        return;
      }

      deps.setCannonToolState({
        selectedCannonId: result.object.id,
        activeGeodesicId: result.object.activeGeodesicId ?? result.object.geodesicIds[0],
      });
      deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
      syncDesktopPalette();
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
      return;
    }

    // Aiming at an existing geodesic segment places a cannon on it at the hit distance along the segment.
    if (target?.object?.kind === "geodesic-segment") {
      const forward = getAimForwardVector(ray);
      if (!forward) {
        return;
      }
      let horizontalForward: { readonly x: number; readonly y: number; readonly z: number };
      try {
        // normalizeVec3 throws for a (near-)vertical ray whose horizontal part is zero; ignore the click then.
        horizontalForward = normalizeVec3({ x: forward.x, y: forward.y, z: 0 });
      } catch {
        return;
      }
      const aimYawRadians = Math.atan2(horizontalForward.y, horizontalForward.x);
      const distanceAlongSegmentMeters = target.geodesicSegmentDistanceMeters ??
        getDistanceAlongGeodesicSegment(target.object, target.localPoint);
      const result = placeGeodesicCannonOnGeodesic({
        world: deps.getWorld(),
        registry: runtimeObjectRegistry,
        geodesicId: target.object.geodesicId,
        segmentId: target.object.id,
        distanceAlongSegmentMeters,
        aimYawRadians,
        id: `geodesic-cannon:${Date.now()}:${geodesicCannonIdCounter++}`,
      });
      if (!result.placed || !result.object) {
        return;
      }

      deps.setCannonToolState({
        selectedCannonId: result.object.id,
        activeGeodesicId: target.object.geodesicId,
      });
      deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
      syncDesktopPalette();
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
      return;
    }

    // Otherwise only a floor hit places a new cannon, which immediately fires its first geodesic.
    if (target?.kind !== "floor") {
      return;
    }

    const forward = getAimForwardVector(ray);
    if (!forward) {
      return;
    }
    let horizontalForward: { readonly x: number; readonly y: number; readonly z: number };
    try {
      horizontalForward = normalizeVec3({ x: forward.x, y: forward.y, z: 0 });
    } catch {
      return;
    }
    const aimYawRadians = Math.atan2(horizontalForward.y, horizontalForward.x);
    const result = placeGeodesicCannonAtFloorPoint({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cellId: target.cellId,
      floorPoint: target.localPoint,
      aimYawRadians,
      id: `geodesic-cannon:${Date.now()}:${geodesicCannonIdCounter++}`,
    });
    if (!result.placed || !result.object) {
      return;
    }

    const geodesicId = `geodesic:${Date.now()}:${geodesicIdCounter++}`;
    shootGeodesic({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cannon: result.object,
      geodesicId,
    });
    deps.setCannonToolState({
      selectedCannonId: result.object.id,
      activeGeodesicId: geodesicId,
    });
    deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
    syncDesktopPalette();
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function tryExtendFocusedGeodesicFromAim(ray?: RootAimRay): boolean {
    if (!ray) {
      return false;
    }

    const target = resolveCurrentAimTarget(ray);
    logVerboseAimClick(target);
    if (!targetIsWithinInteractionRange(target)) {
      return false;
    }

    if (target?.object?.kind !== "geodesic-segment") {
      return false;
    }
    const geodesicId = target.object.geodesicId;

    const segment = extendGeodesic({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      geodesicId,
    });
    if (!segment) {
      return false;
    }

    deps.setCannonToolState({
      selectedCannonId: deps.getCannonToolState().selectedCannonId,
      activeGeodesicId: geodesicId,
    });
    refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
    return true;
  }

  function addGeodesicToCannon(
    cannonId: string,
    options: { readonly afterAdd?: "show-cannon-menu" | "return-to-none" } = {},
  ): void {
    const afterAdd = options.afterAdd ?? "show-cannon-menu";
    const cannon = runtimeObjectRegistry.get(cannonId);
    if (cannon?.kind !== "geodesic-cannon") {
      deps.setMenuState(afterAdd === "return-to-none"
        ? closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"))
        : closeRuntimeMenu(deps.getMenuState()));
      syncDesktopPalette();
      return;
    }

    const geodesicId = `geodesic:${Date.now()}:${geodesicIdCounter++}`;
    // The new geodesic leaves in a random direction in [-pi, pi); the registry cannon is not rotated, only this copy.
    const aimYawRadians = Math.random() * Math.PI * 2 - Math.PI;
    const cannonForNewGeodesic = {
      ...cannon,
      aimYawRadians,
      localPose: yawRigidTransform3(aimYawRadians, cannon.localPose.translation),
    };
    const segment = shootGeodesic({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cannon: cannonForNewGeodesic,
      geodesicId,
    });
    const updatedCannon = runtimeObjectRegistry.get(cannonId);
    if (updatedCannon?.kind === "geodesic-cannon") {
      deps.setCannonToolState({
        selectedCannonId: updatedCannon.id,
        activeGeodesicId: geodesicId,
      });
      deps.setMenuState(afterAdd === "return-to-none"
        ? closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"))
        : showRuntimeMenuGeodesicCannonActions(deps.getMenuState(), {
            cannonId: updatedCannon.id,
            geodesicIds: updatedCannon.geodesicIds,
            geodesicLabelsById: getGeodesicLabelsById(updatedCannon.geodesicIds),
            lockedGeodesicIds: getLockedGeodesicIds(updatedCannon.geodesicIds),
            canTieAndDetach: canTieAndDetachGeodesicsFromCannon(updatedCannon.id),
          }));
    }

    if (segment) {
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }
    syncDesktopPalette();
  }

  function startGeodesicCannonRotation(cannonId: string, requestedGeodesicId?: string): void {
    const object = runtimeObjectRegistry.get(cannonId);
    const cannon = object?.kind === "geodesic-cannon" ? object : undefined;
    if (cannon?.kind !== "geodesic-cannon") {
      deps.setMenuState(closeRuntimeMenu(deps.getMenuState()));
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(cannon, requestedGeodesicId);
    if (geodesicId && isGeodesicLocked(runtimeObjectRegistry, geodesicId)) {
      syncDesktopPalette();
      return;
    }

    const selectedCannon = geodesicId && cannon.activeGeodesicId !== geodesicId
      ? { ...cannon, activeGeodesicId: geodesicId }
      : cannon;
    if (selectedCannon !== cannon) {
      runtimeObjectRegistry.update(selectedCannon);
    }
    deps.setCannonToolState({
      selectedCannonId: selectedCannon.id,
      activeGeodesicId: geodesicId,
    });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.setMenuState(closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "geodesic-cannon-rotate")));
    syncDesktopPalette();
    void controls.requestPointerLock();
  }

  function startGeodesicCannonAim(cannonId: string, requestedGeodesicId?: string): void {
    const object = runtimeObjectRegistry.get(cannonId);
    const cannon = object?.kind === "geodesic-cannon" ? object : undefined;
    if (cannon?.kind !== "geodesic-cannon") {
      deps.setMenuState(closeRuntimeMenu(deps.getMenuState()));
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(cannon, requestedGeodesicId);
    if (geodesicId && isGeodesicLocked(runtimeObjectRegistry, geodesicId)) {
      syncDesktopPalette();
      return;
    }

    const selectedCannon = geodesicId && cannon.activeGeodesicId !== geodesicId
      ? { ...cannon, activeGeodesicId: geodesicId }
      : cannon;
    if (selectedCannon !== cannon) {
      runtimeObjectRegistry.update(selectedCannon);
    }
    deps.setCannonToolState({
      selectedCannonId: selectedCannon.id,
      activeGeodesicId: geodesicId,
    });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.setMenuState(closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "geodesic-cannon-aim")));
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function startGeodesicCannonCarry(cannonId: string, requestedGeodesicId?: string): void {
    const cannon = prepareGeodesicCannonForLift(cannonId);
    if (cannon?.kind !== "geodesic-cannon") {
      deps.setMenuState(closeRuntimeMenu(deps.getMenuState()));
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(cannon, requestedGeodesicId);
    const selectedCannon = geodesicId && cannon.activeGeodesicId !== geodesicId
      ? { ...cannon, activeGeodesicId: geodesicId }
      : cannon;
    if (selectedCannon !== cannon) {
      runtimeObjectRegistry.update(selectedCannon);
    }
    deps.setCannonToolState({
      selectedCannonId: selectedCannon.id,
      activeGeodesicId: geodesicId,
    });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.setMenuState(closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "geodesic-cannon-carry")));
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function tryStartFocusedGeodesicCannonCarry(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (!focused || focused.object.kind !== "geodesic-cannon") {
      return false;
    }

    if (focused.distance > getRuntimeObjectInteractionRangeMeters(focused.object)) {
      return false;
    }

    startGeodesicCannonCarry(focused.object.id, focused.object.activeGeodesicId);
    return true;
  }

  function finishGeodesicCannonCarry(): boolean {
    if (deps.getMenuState().selectedTool !== "geodesic-cannon-carry") {
      return false;
    }

    const cannonId = deps.getCannonToolState().selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;
    if (cannon?.kind === "geodesic-cannon") {
      rebuildCarriedGeodesicFromCannon(cannon);
      removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }
    deps.setCannonToolState({});
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
    clearCarriedGeodesicCannonGlow();
    syncDesktopPalette();
    return true;
  }

  function deleteGeodesicFromCannon(cannonId: string, geodesicId: string): void {
    const cannon = runtimeObjectRegistry.get(cannonId);
    if (cannon?.kind !== "geodesic-cannon") {
      deps.setMenuState(closeRuntimeMenu(deps.getMenuState()));
      syncDesktopPalette();
      return;
    }

    removeProtractorAnglesForGeodesic(geodesicId);
    removeMeasuredGeodesicLengthsForGeodesic(geodesicId);
    removeGeodesic(runtimeObjectRegistry, geodesicId);
    const refreshed = runtimeObjectRegistry.get(cannonId);
    const updatedCannon = refreshed?.kind === "geodesic-cannon" ? refreshed : cannon;
    const activeGeodesicId = updatedCannon.activeGeodesicId;
    deps.setCannonToolState({
      selectedCannonId: updatedCannon.id,
      activeGeodesicId,
    });
    deps.setMenuState(showRuntimeMenuGeodesicCannonActions(deps.getMenuState(), {
      cannonId: updatedCannon.id,
      geodesicIds: updatedCannon.geodesicIds,
      geodesicLabelsById: getGeodesicLabelsById(updatedCannon.geodesicIds),
      lockedGeodesicIds: getLockedGeodesicIds(updatedCannon.geodesicIds),
      canTieAndDetach: canTieAndDetachGeodesicsFromCannon(updatedCannon.id),
    }));
    syncDesktopPalette();
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function canTieAndDetachGeodesicsFromCannon(cannonId: string): boolean {
    return getGeodesicEndpointAttachmentsForAnchor(runtimeObjectRegistry, cannonId)
      .filter((attachment) => isGeodesicLocked(runtimeObjectRegistry, attachment.geodesicId))
      .length >= 2;
  }

  function startGeodesicCannonTieAndDetach(cannonId: string): void {
    if (!canTieAndDetachGeodesicsFromCannon(cannonId)) {
      syncDesktopPalette();
      return;
    }

    syncTieAndDetachSelectionHighlights([]);
    deps.setCannonToolState({
      selectedCannonId: cannonId,
      tieAndDetachEndpointSelections: [],
    });
    deps.setMenuState(closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "geodesic-cannon-tie-detach")));
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function trySelectTieAndDetachGeodesicFromAim(ray?: RootAimRay): boolean {
    const cannonId = deps.getCannonToolState().selectedCannonId;
    if (!ray || !cannonId) {
      return false;
    }

    const selectedEndpoint = resolveTieAndDetachEndpointFromAim(ray, cannonId);
    if (!selectedEndpoint) {
      return false;
    }

    const selected = deps.getCannonToolState().tieAndDetachEndpointSelections ?? [];
    if (selected.some((selection) =>
      selection.geodesicId === selectedEndpoint.geodesicId && selection.role === selectedEndpoint.role
    )) {
      return true;
    }

    const nextSelections = [...selected, selectedEndpoint];
    if (nextSelections.length < 2) {
      deps.setCannonToolState({
        ...deps.getCannonToolState(),
        tieAndDetachEndpointSelections: nextSelections,
      });
      syncTieAndDetachSelectionHighlights(nextSelections);
      syncDesktopPalette();
      syncRuntimeObjectPortalInstances();
      return true;
    }

    tieAndDetachGeodesicsFromCannon(cannonId, [nextSelections[0], nextSelections[1]]);
    return true;
  }

  function resolveTieAndDetachEndpointFromAim(ray: RootAimRay, cannonId: string): GeodesicEndpointSelection | undefined {
    const selectable = getGeodesicEndpointAttachmentsForAnchor(runtimeObjectRegistry, cannonId)
      .filter((attachment) => isGeodesicLocked(runtimeObjectRegistry, attachment.geodesicId));
    for (const target of resolveCurrentAimTargets(ray)) {
      if (!targetIsWithinInteractionRange(target)) {
        continue;
      }

      const endpoint = target.object?.kind === "geodesic-segment"
        ? resolveGeodesicEndpointSelectionFromSegmentHit(runtimeObjectRegistry, target.object.id)
        : undefined;
      if (
        endpoint &&
        selectable.some((selection) => selection.geodesicId === endpoint.geodesicId && selection.role === endpoint.role)
      ) {
        return endpoint;
      }
    }

    return undefined;
  }

  function tieAndDetachGeodesicsFromCannon(cannonId: string, selectedEndpoints: readonly [GeodesicEndpointSelection, GeodesicEndpointSelection]): void {
    syncTieAndDetachSelectionHighlights([]);
    const pair = tieAndDetachGeodesicEndpoints({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      detachedEmitterId: cannonId,
      first: selectedEndpoints[0],
      second: selectedEndpoints[1],
      createPairId: () => `curve-shortening:${Date.now()}:${geodesicIdCounter++}`,
      createFreeEndId: () => `free-end:${Date.now()}:${geodesicIdCounter++}`,
    });
    if (!pair) {
      syncDesktopPalette();
      syncRuntimeObjectPortalInstances();
      return;
    }

    deps.setCannonToolState({});
    deps.setMenuState(closeRuntimeMenu(setRuntimeMenuSelectedTool(deps.getMenuState(), "none")));
    removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
    syncDesktopPalette();
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function syncTieAndDetachSelectionHighlights(selectedEndpoints: readonly GeodesicEndpointSelection[]): void {
    for (const object of runtimeObjectRegistry.getObjectsOfKind("geodesic-segment")) {
      const endpoint = resolveGeodesicEndpointSelectionFromSegmentHit(runtimeObjectRegistry, object.id);
      const nextHighlightState = endpoint && selectedEndpoints.some((selection) =>
        selection.geodesicId === endpoint.geodesicId && selection.role === endpoint.role
      )
        ? "tie-detach-selected"
        : undefined;
      if (object.highlightState === nextHighlightState) {
        continue;
      }

      runtimeObjectRegistry.update({
        ...object,
        highlightState: nextHighlightState,
      });
    }
  }

  function prepareGeodesicCannonForLift(
    cannonId: string,
  ): Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }> | undefined {
    const removed = removeUnlockedGeodesicsFromCannon(runtimeObjectRegistry, cannonId);
    if (removed.length > 0) {
      for (const geodesicId of removed) {
        removeProtractorAnglesForGeodesic(geodesicId);
        removeMeasuredGeodesicLengthsForGeodesic(geodesicId);
      }
      removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }

    const cannon = runtimeObjectRegistry.get(cannonId);
    return cannon?.kind === "geodesic-cannon" ? cannon : undefined;
  }

  function updateCarriedGeodesicCannonPose(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    if (deps.getMenuState().selectedTool !== "geodesic-cannon-carry") {
      clearCarriedGeodesicCannonGlow();
      return;
    }

    const cannonId = deps.getCannonToolState().selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;
    if (cannon?.kind !== "geodesic-cannon") {
      return;
    }

    const anchor = xrActive
      ? resolveVrCarriedGeodesicCannonAnchor(cannon, activeAimRay)
      : resolveDesktopCarriedGeodesicCannonAnchor(cannon, activeAimRay);
    if (!anchor) {
      return;
    }

    // The emitter is held at the hand, which may be on another face than the player; store it in the cell it is really in.
    const placement = resolveCarriedEmitterPlacement(cannon, anchor);
    if (!placement) {
      // The hand is behind a wall: the emitter stays where it was.
      syncCarriedGeodesicCannonGlow(anchor);
      return;
    }
    const placed = { ...cannon, cellId: placement.cellId, localPose: placement.localPose };
    // Dragging the emitter into a forbidden zone destroys it (and its geodesics) rather than leaving it there.
    if (carriedGeodesicCannonTouchesForbiddenZone(placed)) {
      deleteCarriedGeodesicCannon(cannon.id);
      return;
    }

    if (
      placed.cellId === cannon.cellId &&
      distanceSquared(placed.localPose.translation, cannon.localPose.translation) <=
        carriedGeodesicEmitterPoseToleranceMeters * carriedGeodesicEmitterPoseToleranceMeters
    ) {
      syncCarriedGeodesicCannonGlow(anchor);
      return;
    }

    // Which portals the emitter crossed follows from where it was and where it is, not from what the player did.
    const moved = moveEmitterAlongRoute({
      registry: runtimeObjectRegistry,
      emitterId: cannon.id,
      cellId: placed.cellId,
      localPose: placed.localPose,
      route: carriedEmitterRoute(cannon, placed),
    });
    if (!moved.moved) {
      // The move cannot be reconciled with the portal words of the emitter's geodesics, so the emitter stays where it was.
      console.warn(`Carried emitter "${cannon.id}" stays in "${cannon.cellId}": no route to "${placed.cellId}" fits the portal word of ${moved.brokenGeodesicIds.join(", ")}.`);
      syncCarriedGeodesicCannonGlow(anchor);
      return;
    }
    const nextCannon = runtimeObjectRegistry.get(cannon.id);
    if (nextCannon?.kind !== "geodesic-cannon") {
      return;
    }
    rebuildCarriedGeodesicFromCannon(nextCannon, { preserveGeodesicOnRebuildFailure: true });
    syncCarriedGeodesicCannonGlow(anchor);
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  // Where the carried emitter is: the cell the hand is in, found by walking from the player to the hand through the portals
  // between them, and its pose in that cell's frame. Undefined when a wall stands between the player and the hand.
  function resolveCarriedEmitterPlacement(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    anchor: { readonly x: number; readonly y: number; readonly z: number },
  ): { readonly cellId: string; readonly localPose: RigidTransform3 } | undefined {
    const playerPose = deps.getPlayerPose();
    const located = locateDevelopedPoint(
      deps.getWorld(),
      playerPose.cellId,
      { x: playerPose.position.x, y: playerPose.position.y },
      { x: anchor.x, y: anchor.y },
    );
    if (located.status !== "end") {
      return undefined;
    }

    return {
      cellId: located.cellId,
      localPose: composeRigidTransform3(located.cellFromStart, yawRigidTransform3(cannon.aimYawRadians, anchor)),
    };
  }

  // The portals a carried emitter crossed between two frames: the chain whose image of the old position is nearest the new
  // one. A frame's step crosses at most a portal or two; a pickup from another face is a jump, searched over longer chains.
  function carriedEmitterRoute(
    before: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    after: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ): readonly GeodesicPortalTraversal[] {
    const from = { cellId: before.cellId, point: before.localPose.translation };
    const to = { cellId: after.cellId, point: after.localPose.translation };
    const step = findNearestImageRoute(deps.getWorld(), from, to, carriedEmitterStepMaxHops);
    const route = step && step.distanceMeters <= carriedEmitterStepMaxMeters
      ? step
      : findNearestImageRoute(deps.getWorld(), from, to, carriedEmitterJumpMaxHops) ?? step;

    return (route?.hops ?? []).map(({ sourceCellId, sourcePortalId, targetCellId, targetPortalId }) => ({
      sourceCellId,
      sourcePortalId,
      targetCellId,
      targetPortalId,
    }));
  }

  function rebuildCarriedGeodesicFromCannon(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    options: { readonly preserveGeodesicOnRebuildFailure?: boolean } = {},
  ): void {
    // Three cases: locked geodesics incident to this emitter (rebuilt as connected geodesics between emitters),
    // else a single locked active geodesic, else a plain unlocked active geodesic regrown from the cannon.
    const geodesicId = cannon.activeGeodesicId ?? deps.getCannonToolState().activeGeodesicId;
    const lockedIncidentGeodesicIds = collectLockedIncidentGeodesicIdsForEmitter(runtimeObjectRegistry, cannon.id);
    if (lockedIncidentGeodesicIds.length === 0 && !geodesicId) {
      return;
    }

    const rebuildLocked = (lockedGeodesicId: string): void => {
      rebuildConnectedGeodesicBetweenEmitters({
        world: deps.getWorld(),
        registry: runtimeObjectRegistry,
        geodesicId: lockedGeodesicId,
        carriedEmitterId: cannon.id,
        carriedPortalWord: collectGeodesicPortalWord(deps.getWorld(), runtimeObjectRegistry, lockedGeodesicId),
        preserveGeodesicOnRebuildFailure: options.preserveGeodesicOnRebuildFailure,
      });
    };

    if (lockedIncidentGeodesicIds.length > 0) {
      const rebuiltGeodesicIds: string[] = [];
      // One scope per carry frame: the intersection markers are recomputed once, after all incident geodesics are rebuilt.
      withDeferredGeodesicIntersections(runtimeObjectRegistry, () => {
        for (const incidentGeodesicId of lockedIncidentGeodesicIds) {
          rebuildLocked(incidentGeodesicId);
          rebuiltGeodesicIds.push(incidentGeodesicId);
        }
      });
      for (const rebuiltGeodesicId of rebuiltGeodesicIds) {
        refreshMeasuredGeodesicLengthsForGeodesic(rebuiltGeodesicId);
      }
      refreshProtractorAnglesForGeodesics(rebuiltGeodesicIds);
    } else if (geodesicId && isGeodesicLocked(runtimeObjectRegistry, geodesicId)) {
      rebuildLocked(geodesicId);
      refreshProtractorAnglesForGeodesic(geodesicId);
      refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    } else if (geodesicId) {
      rebuildActiveGeodesicFromCannon(cannon, { connectEmitters: false, breakOnForbiddenZone: true });
      refreshProtractorAnglesForGeodesic(geodesicId);
      refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    }
  }

  function carriedGeodesicCannonTouchesForbiddenZone(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ): boolean {
    const cell = deps.getWorld().cellsById.get(cannon.cellId);
    if (!cell) {
      return false;
    }

    return testCellCollision({
      cell,
      object: runtimeObjectToDynamicObjectState(cannon),
    }).reason === "forbidden-zone";
  }

  function deleteCarriedGeodesicCannon(cannonId: string): void {
    const geodesicIds = collectIncidentGeodesicIdsForCannon(cannonId);
    for (const geodesicId of geodesicIds) {
      removeProtractorAnglesForGeodesic(geodesicId);
      removeMeasuredGeodesicLengthsForGeodesic(geodesicId);
    }

    removeGeodesicCannonAndSegments(runtimeObjectRegistry, cannonId);
    deps.setCannonToolState({});
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
    clearCarriedGeodesicCannonGlow();
    removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
    syncDesktopPalette();
  }

  // The glow is a child of the scene, which is drawn in the player's frame, so it goes at the hand (the emitter's place as seen
  // from the player's cell), not at the emitter's pose, which is in the frame of whichever face the emitter is on.
  function syncCarriedGeodesicCannonGlow(handPoint: { readonly x: number; readonly y: number; readonly z: number }): void {
    const glow = carriedGeodesicCannonGlow ?? createCarriedGeodesicCannonGlow();
    carriedGeodesicCannonGlow = glow;
    if (!glow.parent) {
      scene.add(glow);
    }

    glow.visible = deps.getMenuState().selectedTool === "geodesic-cannon-carry";
    // Glow cylinder is 1.72 m tall, so center it 0.86 m above the cannon base.
    glow.position.copy(worldPointToThree({ x: handPoint.x, y: handPoint.y, z: handPoint.z + 0.86 }));
  }

  function clearCarriedGeodesicCannonGlow(): void {
    if (carriedGeodesicCannonGlow) {
      carriedGeodesicCannonGlow.visible = false;
    }
  }

  function collectIncidentGeodesicIdsForCannon(cannonId: string): readonly string[] {
    const ids = new Set<string>();
    const cannon = runtimeObjectRegistry.get(cannonId);
    if (cannon?.kind === "geodesic-cannon") {
      for (const geodesicId of cannon.geodesicIds) {
        ids.add(geodesicId);
      }
      if (cannon.activeGeodesicId) {
        ids.add(cannon.activeGeodesicId);
      }
    }

    for (const object of runtimeObjectRegistry.getObjectsOfKind("geodesic-cannon")) {
      for (const [geodesicId, connection] of Object.entries(object.geodesicConnectionsById ?? {})) {
        if (connection.outgoingEmitterId === cannonId || connection.incomingEmitterId === cannonId) {
          ids.add(geodesicId);
        }
      }
    }

    return [...ids];
  }

  function updateActiveGeodesicCannonRotation(yawDeltaRadians: number, finishRequested: boolean): void {
    const cannonId = deps.getCannonToolState().selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;

    if (!cannon || cannon.kind !== "geodesic-cannon") {
      deps.setCannonToolState({});
      deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
      syncDesktopPalette();
      return;
    }

    if (yawDeltaRadians !== 0 && Number.isFinite(yawDeltaRadians)) {
      // Wrap to (-pi, pi]; the yaw is also stored per active geodesic so each emitter keeps its own direction.
      const nextYaw = Math.atan2(
        Math.sin(cannon.aimYawRadians + yawDeltaRadians),
        Math.cos(cannon.aimYawRadians + yawDeltaRadians),
      );
      const activeGeodesicId = deps.getCannonToolState().activeGeodesicId;
      const nextCannon = {
        ...cannon,
        aimYawRadians: nextYaw,
        localPose: yawRigidTransform3(nextYaw, cannon.localPose.translation),
        geodesicEmitterYawRadiansById: activeGeodesicId
          ? {
              ...cannon.geodesicEmitterYawRadiansById,
              [activeGeodesicId]: nextYaw,
            }
          : cannon.geodesicEmitterYawRadiansById,
      };
      runtimeObjectRegistry.update(nextCannon);
      rebuildActiveGeodesicFromCannon(nextCannon, { connectEmitters: false });
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }

    if (finishRequested) {
      const refreshed = runtimeObjectRegistry.get(cannon.id);
      finishActiveGeodesicCannonEdit(refreshed?.kind === "geodesic-cannon" ? refreshed : cannon);
      geodesicCannonRotationTargetLengthMeters = undefined;
      deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
      syncDesktopPalette();
    }
  }

  function updateActiveGeodesicCannonAim(
    finishRequested: boolean,
    activeAimRay: RootAimRay | undefined,
  ): void {
    const cannonId = deps.getCannonToolState().selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;

    if (!cannon || cannon.kind !== "geodesic-cannon") {
      deps.setCannonToolState({});
      finishGeodesicCannonAimMode();
      return;
    }

    if (!playerIsWithinGeodesicCannonAimRange(cannon)) {
      finishGeodesicCannonAimMode();
      return;
    }

    // Aim at the hit point if any, otherwise at the ray's intersection with the floor; yaw is derived from absolute (root-frame) points.
    const aimTarget = activeAimRay ? resolveCurrentAimTarget(activeAimRay) : undefined;
    const targetAbsolutePoint = aimTarget?.rootPoint
      ?? (activeAimRay ? intersectRootRayWithFloor(activeAimRay.origin, activeAimRay.direction) : undefined);
    const nextYaw = resolveGeodesicCannonAimYawFromAbsolutePoints({
      source: resolveGeodesicCannonAbsoluteEmitterPoint(cannon),
      target: targetAbsolutePoint,
    });
    if (nextYaw !== undefined) {
      const yawDelta = Math.atan2(
        Math.sin(nextYaw - cannon.aimYawRadians),
        Math.cos(nextYaw - cannon.aimYawRadians),
      );
      if (Math.abs(yawDelta) > 1e-6) {
        const activeGeodesicId = deps.getCannonToolState().activeGeodesicId;
        const nextCannon = {
          ...cannon,
          aimYawRadians: nextYaw,
          localPose: yawRigidTransform3(nextYaw, cannon.localPose.translation),
          geodesicEmitterYawRadiansById: activeGeodesicId
            ? {
                ...cannon.geodesicEmitterYawRadiansById,
                [activeGeodesicId]: nextYaw,
              }
            : cannon.geodesicEmitterYawRadiansById,
        };
        runtimeObjectRegistry.update(nextCannon);
        rebuildActiveGeodesicFromCannon(nextCannon, { connectEmitters: false });
        syncRuntimeObjectPortalInstances();
        syncSelectableHitboxDebug();
      }
    }

    if (finishRequested) {
      const refreshed = runtimeObjectRegistry.get(cannon.id);
      finishActiveGeodesicCannonEdit(refreshed?.kind === "geodesic-cannon" ? refreshed : cannon);
      finishGeodesicCannonAimMode();
    }
  }

  function playerIsWithinGeodesicCannonAimRange(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ): boolean {
    if (deps.getPlayerPose().cellId !== cannon.cellId) {
      return false;
    }

    const rangeMeters = getRuntimeObjectInteractionRangeMeters(cannon);
    const dx = deps.getPlayerPose().position.x - cannon.localPose.translation.x;
    const dy = deps.getPlayerPose().position.y - cannon.localPose.translation.y;
    return Math.hypot(dx, dy) <= rangeMeters;
  }

  function finishGeodesicCannonAimMode(): void {
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.setMenuState(setRuntimeMenuSelectedTool(deps.getMenuState(), "none"));
    syncDesktopPalette();
  }

  function finishActiveGeodesicCannonEdit(cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>): void {
    rebuildActiveGeodesicFromCannon(cannon, { connectEmitters: true, snapToEmitter: true });
    removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function rebuildActiveGeodesicFromCannon(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    options: {
      readonly connectEmitters?: boolean;
      readonly snapToEmitter?: boolean;
      readonly breakOnForbiddenZone?: boolean;
    } = {},
  ): void {
    const geodesicId = cannon.activeGeodesicId ?? deps.getCannonToolState().activeGeodesicId;
    if (!geodesicId) {
      return;
    }

    const totalLengthMeters = geodesicCannonRotationTargetLengthMeters ?? getGeodesicTotalLengthMeters(geodesicId);
    rebuildGeodesicToLength({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cannon,
      geodesicId,
      totalLengthMeters,
      connectEmitters: options.connectEmitters,
      snapToEmitter: options.snapToEmitter,
      breakOnForbiddenZone: options.breakOnForbiddenZone,
      rebuildLocked: true,
    });
    refreshProtractorAnglesForGeodesic(geodesicId);
    refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    deps.setCannonToolState({
      selectedCannonId: cannon.id,
      activeGeodesicId: geodesicId,
    });
  }

  function getGeodesicTotalLengthMeters(geodesicId: string): number {
    return getGeodesicSegments(runtimeObjectRegistry, geodesicId)
      .reduce((total, segment) => total + segment.lengthMeters, 0);
  }

  function getLockedGeodesicIds(geodesicIds: readonly string[]): readonly string[] {
    return geodesicIds.filter((geodesicId) => isGeodesicLocked(runtimeObjectRegistry, geodesicId));
  }

  function freezeXrHeadHeightDuringGeodesicCannonRotation(headLocalMeters: Vec3 | undefined): Vec3 | undefined {
    if (!headLocalMeters) {
      return headLocalMeters;
    }

    // Latch the head height on first call and keep returning it until resetGeodesicCannonRotationTracking clears it.
    geodesicCannonRotationHeadHeightMeters ??= headLocalMeters.z;
    return {
      ...headLocalMeters,
      z: geodesicCannonRotationHeadHeightMeters,
    };
  }

  return {
    tryUseGeodesicCannonToolFromAim,
    tryExtendFocusedGeodesicFromAim,
    addGeodesicToCannon,
    startGeodesicCannonRotation,
    startGeodesicCannonAim,
    startGeodesicCannonCarry,
    tryStartFocusedGeodesicCannonCarry,
    finishGeodesicCannonCarry,
    deleteGeodesicFromCannon,
    canTieAndDetachGeodesicsFromCannon,
    startGeodesicCannonTieAndDetach,
    trySelectTieAndDetachGeodesicFromAim,
    syncTieAndDetachSelectionHighlights,
    updateCarriedGeodesicCannonPose,
    syncCarriedGeodesicCannonGlow,
    clearCarriedGeodesicCannonGlow,
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getGeodesicTotalLengthMeters,
    getLockedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  };
}
