/**
 * Geodesic emitter (cannon) tools: place, rotate, aim, carry, tie-and-detach, and delete geodesics.
 *
 * This module is the interaction layer between the aim/menu systems and the geodesic world-object logic in
 * `world-objects/geodesic/`. It mutates the runtime object registry (cannons, geodesic segments/intervals) and
 * the shell-owned cannon tool state and menu state through getter/setter dependencies, then triggers the
 * follow-up syncs (palette, portal instances, hitbox debug, dependent measurements and protractor angles).
 * Poses and distances are cell-local (meters; x right, y forward, z up) with yaws in radians
 * counter-clockwise from +x; Three.js-space values only appear for aim rays.
 * Ids of new cannons and geodesics embed `Date.now()` plus a per-factory counter.
 */
import { takeObjectIdSerial } from "../../runtime/appSession";
import type { FocusedRuntimeObject } from "./rootAimRay";
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import {
  type RigidTransform3,
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  yawRigidTransform3,
} from "../../math/rigidTransform3";
import { type Vec3, normalizeVec3 } from "../../math/vec3";
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
import type { AppSession } from "../../runtime/appSession";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import { type GeodesicEndpointSelection } from "../../world-objects/geodesic/objects";
import type { GeodesicCannonToolState } from "../../world-objects/geodesic/cannonToolState";
import { pruneMissingGeodesicIntersectionObjects } from "../../world-objects/geodesic/intersections";
import {
  getEmitterGeodesicIds,
  getGeodesicEndpointAttachmentsForAnchor,
  resolveGeodesicEndpointSelectionFromSegmentHit,
} from "../../world-objects/geodesic/endpoints";
import { getGeodesicSegments } from "../../world-objects/geodesic/segments";
import {
  isGeodesicLocked,
  removeGeodesic,
  removeUnlockedGeodesicsFromCannon,
} from "../../world-objects/geodesic/lifecycle";
import { tieAndDetachGeodesicEndpoints } from "../../world-objects/geodesic/curveShortening";
import {
  extendGeodesic,
  placeGeodesicCannonAtFloorPoint,
  placeGeodesicCannonAtGeodesicVertex,
  placeGeodesicCannonOnGeodesic,
  moveEmitterAlongRoute,
  rebuildGeodesicToLength,
  shootGeodesic,
} from "../../world-objects/geodesic/cannon";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import { AimTarget } from "../../interaction/aimTarget";
import { decideHandCarry, handCarryArrived, handCarryLeashMeters } from "../../interaction/handCarry";
import {
  carriedGeodesicEmitterDesktopDistanceMeters,
  getDistanceAlongGeodesicSegment,
  resolveCannonGeodesicId,
  resolveDesktopCarriedGeodesicCannonAnchor,
  resolveGeodesicCannonAbsoluteEmitterPoint,
  resolveVrCarriedGeodesicCannonAnchor,
} from "./carriedGeodesicCannon";
import { createDesktopControls } from "./desktopControls";
import { resolveGeodesicCannonAimYawFromAbsolutePoints } from "./geodesicCannonAimTarget";
import { carryMaxSpeedMetersPerSecond, carryTowardTarget, locateCarrierTarget } from "../../world-objects/carry";
import { rebuildEmitterGeodesics, releaseCarriedEmitter } from "../../world-objects/geodesic/carryEnd";
import {
  RootAimRay,
  getAimForwardVector,
  getRuntimeObjectInteractionRangeMeters,
  intersectRootRayWithFloor,
} from "./rootAimRay";

export type { GeodesicCannonToolState };

// Most portals a straight line from the player to an emitter being aimed may cross (the same reach as the emitter labels).
const geodesicCannonAimMaxHops = 2;

/**
 * Dependencies of the geodesic cannon tools, supplied by createThreeApp's shell.
 *
 * Plain-value fields are long-lived objects; `get*` members are getters because the shell reassigns the
 * underlying `let` variables (menu state, cannon tool state, world, player pose); the shell's `set*` members write
 * those variables back.
 */
export interface GeodesicCannonToolsDeps {
  /** Renderer; only `xr.isPresenting` is read, to skip pointer lock in XR. */
  readonly renderer: THREE.WebGLRenderer;
  /** Desktop controls, used to request pointer lock while rotating, aiming, or carrying. */
  readonly controls: ReturnType<typeof createDesktopControls>;
  /** Registry holding cannons, geodesic segments/intervals, and related objects; mutated directly. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Getter for the active compiled world. */
  getWorld(): CompiledCellComplex;
  /** The shell session; the menu state (selected tool, open menu) is read from it. */
  readonly session: AppSession;
  /** Runs a command through the shell's one command path (menu changes go through it, never by assignment). */
  dispatch(command: RuntimeCommand): void;
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
 * Lifecycle: the tools own no GPU resource (the highlight around a carried emitter is drawn by the runtime-object instance sync).
 * Closure state (id counters, frozen XR head height, target geodesic length) lives for the factory's lifetime.
 */
export function createGeodesicCannonTools(deps: GeodesicCannonToolsDeps) {
  const {
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
  let geodesicCannonRotationHeadHeightMeters: number | undefined;
  let geodesicCannonRotationTargetLengthMeters: number | undefined;

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
        id: `geodesic-cannon:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic-cannon")}`,
        createContinuationGeodesicId: () => `geodesic:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic")}`,
      });
      if (!result.placed || !result.object) {
        return;
      }

      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: result.object.id,
        activeGeodesicId: getEmitterGeodesicIds(runtimeObjectRegistry, result.object.id)[0],
      } });
      deps.dispatch({ kind: "clear-selected-tool" });
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
        id: `geodesic-cannon:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic-cannon")}`,
      });
      if (!result.placed || !result.object) {
        return;
      }

      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: result.object.id,
        activeGeodesicId: target.object.geodesicId,
      } });
      deps.dispatch({ kind: "clear-selected-tool" });
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
      id: `geodesic-cannon:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic-cannon")}`,
    });
    if (!result.placed || !result.object) {
      return;
    }

    const geodesicId = `geodesic:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic")}`;
    shootGeodesic({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cannon: result.object,
      geodesicId,
    });
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: result.object.id,
      activeGeodesicId: geodesicId,
    } });
    deps.dispatch({ kind: "clear-selected-tool" });
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

    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: deps.session.get().cannonToolState.selectedCannonId,
      activeGeodesicId: geodesicId,
    } });
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
      deps.dispatch({ kind: "close-menu" });
      if (afterAdd === "return-to-none") {
        deps.dispatch({ kind: "clear-selected-tool" });
      }
      syncDesktopPalette();
      return;
    }

    const geodesicId = `geodesic:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic")}`;
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
      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: updatedCannon.id,
        activeGeodesicId: geodesicId,
      } });
      if (afterAdd === "return-to-none") {
        deps.dispatch({ kind: "close-menu" });
        deps.dispatch({ kind: "clear-selected-tool" });
      } else {
        const geodesicIds = getEmitterGeodesicIds(runtimeObjectRegistry, updatedCannon.id);
        deps.dispatch({
          kind: "show-geodesic-cannon-actions",
          cannonId: updatedCannon.id,
          geodesicIds,
          geodesicLabelsById: getGeodesicLabelsById(geodesicIds),
          lockedGeodesicIds: getLockedGeodesicIds(geodesicIds),
          canTieAndDetach: canTieAndDetachGeodesicsFromCannon(updatedCannon.id),
        });
      }
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
      deps.dispatch({ kind: "close-menu" });
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(runtimeObjectRegistry, cannon, requestedGeodesicId, deps.session.get().cannonToolState.activeGeodesicId);
    if (geodesicId && isGeodesicLocked(runtimeObjectRegistry, geodesicId)) {
      syncDesktopPalette();
      return;
    }

    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: cannon.id,
      activeGeodesicId: geodesicId,
    } });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.dispatch({ kind: "enter-tool-mode", toolId: "geodesic-cannon-rotate" });
    syncDesktopPalette();
    void controls.requestPointerLock();
  }

  function startGeodesicCannonAim(cannonId: string, requestedGeodesicId?: string): void {
    const object = runtimeObjectRegistry.get(cannonId);
    const cannon = object?.kind === "geodesic-cannon" ? object : undefined;
    if (cannon?.kind !== "geodesic-cannon") {
      deps.dispatch({ kind: "close-menu" });
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(runtimeObjectRegistry, cannon, requestedGeodesicId, deps.session.get().cannonToolState.activeGeodesicId);
    if (geodesicId && isGeodesicLocked(runtimeObjectRegistry, geodesicId)) {
      syncDesktopPalette();
      return;
    }

    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: cannon.id,
      activeGeodesicId: geodesicId,
    } });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.dispatch({ kind: "enter-tool-mode", toolId: "geodesic-cannon-aim" });
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function startGeodesicCannonCarry(cannonId: string, requestedGeodesicId?: string): void {
    const cannon = prepareGeodesicCannonForLift(cannonId);
    if (cannon?.kind !== "geodesic-cannon") {
      deps.dispatch({ kind: "close-menu" });
      syncDesktopPalette();
      return;
    }

    const geodesicId = resolveCannonGeodesicId(runtimeObjectRegistry, cannon, requestedGeodesicId, deps.session.get().cannonToolState.activeGeodesicId);
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: cannon.id,
      activeGeodesicId: geodesicId,
    } });
    geodesicCannonRotationTargetLengthMeters = geodesicId
      ? getGeodesicTotalLengthMeters(geodesicId)
      : undefined;
    deps.dispatch({ kind: "enter-tool-mode", toolId: "geodesic-cannon-carry" });
    deps.dispatch({ kind: "begin-carry", objectId: cannon.id });
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

    startGeodesicCannonCarry(focused.object.id, deps.session.get().cannonToolState.activeGeodesicId);
    return true;
  }

  function finishGeodesicCannonCarry(): boolean {
    if (deps.session.get().menuState.selectedTool !== "geodesic-cannon-carry") {
      return false;
    }

    const cannonId = deps.session.get().carry?.objectId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;
    if (cannon?.kind === "geodesic-cannon") {
      // The emitter decides what stopping a carry means for its geodesics; the tool refreshes what it draws.
      const release = releaseCarriedEmitter({
        world: deps.getWorld(),
        registry: runtimeObjectRegistry,
        emitterId: cannon.id,
        activeGeodesicId: deps.session.get().cannonToolState.activeGeodesicId,
        rotationTargetLengthMeters: geodesicCannonRotationTargetLengthMeters,
      });
      refreshAfterEmitterRebuild(cannon.id, release);
      removeProtractorAnglesForMissingVertices(release.prunedIntersectionIds);
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }
    deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.dispatch({ kind: "end-carry" });
    deps.dispatch({ kind: "clear-selected-tool" });
    syncDesktopPalette();
    return true;
  }

  function deleteGeodesicFromCannon(cannonId: string, geodesicId: string): void {
    const cannon = runtimeObjectRegistry.get(cannonId);
    if (cannon?.kind !== "geodesic-cannon") {
      deps.dispatch({ kind: "close-menu" });
      syncDesktopPalette();
      return;
    }

    removeProtractorAnglesForGeodesic(geodesicId);
    removeMeasuredGeodesicLengthsForGeodesic(geodesicId);
    removeGeodesic(runtimeObjectRegistry, geodesicId);
    const refreshed = runtimeObjectRegistry.get(cannonId);
    const updatedCannon = refreshed?.kind === "geodesic-cannon" ? refreshed : cannon;
    const geodesicIds = getEmitterGeodesicIds(runtimeObjectRegistry, updatedCannon.id);
    const activeGeodesicId = resolveCannonGeodesicId(
      runtimeObjectRegistry,
      updatedCannon,
      undefined,
      deps.session.get().cannonToolState.activeGeodesicId,
    );
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: updatedCannon.id,
      activeGeodesicId,
    } });
    deps.dispatch({
      kind: "show-geodesic-cannon-actions",
      cannonId: updatedCannon.id,
      geodesicIds,
      geodesicLabelsById: getGeodesicLabelsById(geodesicIds),
      lockedGeodesicIds: getLockedGeodesicIds(geodesicIds),
      canTieAndDetach: canTieAndDetachGeodesicsFromCannon(updatedCannon.id),
    });
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
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: cannonId,
      tieAndDetachEndpointSelections: [],
    } });
    deps.dispatch({ kind: "enter-tool-mode", toolId: "geodesic-cannon-tie-detach" });
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function trySelectTieAndDetachGeodesicFromAim(ray?: RootAimRay): boolean {
    const cannonId = deps.session.get().cannonToolState.selectedCannonId;
    if (!ray || !cannonId) {
      return false;
    }

    const selectedEndpoint = resolveTieAndDetachEndpointFromAim(ray, cannonId);
    if (!selectedEndpoint) {
      return false;
    }

    const selected = deps.session.get().cannonToolState.tieAndDetachEndpointSelections ?? [];
    if (selected.some((selection) =>
      selection.geodesicId === selectedEndpoint.geodesicId && selection.role === selectedEndpoint.role
    )) {
      return true;
    }

    const nextSelections = [...selected, selectedEndpoint];
    if (nextSelections.length < 2) {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        ...deps.session.get().cannonToolState,
        tieAndDetachEndpointSelections: nextSelections,
      } });
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
      createPairId: () => `curve-shortening:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic")}`,
      createFreeEndId: () => `free-end:${Date.now()}:${takeObjectIdSerial(deps.session, "geodesic")}`,
    });
    if (!pair) {
      syncDesktopPalette();
      syncRuntimeObjectPortalInstances();
      return;
    }

    deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
    deps.dispatch({ kind: "close-menu" });
    deps.dispatch({ kind: "clear-selected-tool" });
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

  function updateCarriedGeodesicCannonPose(xrActive: boolean, activeAimRay: RootAimRay | undefined, deltaSeconds?: number): void {
    if (deps.session.get().menuState.selectedTool !== "geodesic-cannon-carry") {
      return;
    }

    const cannonId = deps.session.get().carry?.objectId;
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

    // The emitter is held at the hand, which may be on another face than the player or behind a wall. Where the hand is comes
    // from the carry contract; the emitter then glides toward it in displacement steps, and the contract decides how it reacts.
    const playerPose = deps.session.get().playerPose;
    const hand = locateCarrierTarget(deps.getWorld(), playerPose, anchor);
    if (!hand) {
      return;
    }
    const emitterBody = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(cannon));
    const advance = carryTowardTarget({
      world: deps.getWorld(),
      object: {
        cellId: cannon.cellId,
        position: cannon.localPose.translation,
        yawRadians: cannon.aimYawRadians,
        radiusMeters: emitterBody?.radius,
      },
      target: { cellId: hand.cellId, point: { x: hand.point.x, y: hand.point.y, z: 0 } },
      maxTravelMeters: deltaSeconds === undefined ? undefined : carryMaxSpeedMetersPerSecond * deltaSeconds,
      commit: (move) => {
        const placed = {
          ...cannon,
          cellId: move.placement.cellId,
          localPose: yawRigidTransform3(move.placement.yawRadians, move.placement.position),
        };
        const moved = moveEmitterAlongRoute({
          registry: runtimeObjectRegistry,
          emitterId: cannon.id,
          cellId: placed.cellId,
          localPose: placed.localPose,
          route: move.route,
        });
        if (!moved.moved) {
          // The move cannot be reconciled with the portal words of the emitter's geodesics, so the emitter stays where it was.
          console.warn(`Carried emitter "${cannon.id}" stays: no route to "${placed.cellId}" fits the portal word of ${moved.brokenGeodesicIds.join(", ")}.`);
        }
        return moved.moved;
      },
    });
    if (advance.steps > 0) {
      const rebuild = rebuildEmitterGeodesics({
        world: deps.getWorld(),
        registry: runtimeObjectRegistry,
        emitterId: cannon.id,
        activeGeodesicId: deps.session.get().cannonToolState.activeGeodesicId,
        rotationTargetLengthMeters: geodesicCannonRotationTargetLengthMeters,
        preserveGeodesicOnRebuildFailure: true,
      });
      refreshAfterEmitterRebuild(cannon.id, rebuild);
      syncRuntimeObjectPortalInstances();
      syncSelectableHitboxDebug();
    }
    // Whether the hand goes on holding the emitter is the hand's policy (a wall or a zone never ends a carry): it lets go of what is too far.
    // The leash is loose while the emitter still glides to the hand and tight once it has been at the hand (the first frame it is, the session is told).
    const arrived = deps.session.get().carry?.arrived === true || handCarryArrived(advance.remaining);
    if (arrived && deps.session.get().carry?.arrived === false) {
      deps.dispatch({ kind: "carry-arrived" });
    }
    const glidingLeashMeters = handCarryLeashMeters({
      pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(cannon),
      handReachMeters: xrActive ? 0 : carriedGeodesicEmitterDesktopDistanceMeters,
    });
    if (decideHandCarry(advance.remaining, arrived ? "held" : "gliding", glidingLeashMeters) === "release") {
      finishGeodesicCannonCarry();
    }
  }
  // Draws again what depends on the geodesics an emitter just rebuilt: measured lengths, protractor angles and, when the emitter's plain
  // active geodesic was regrown, the cannon tool's selection of it. What was rebuilt is the emitter's rule (geodesic/carryEnd.ts).
  function refreshAfterEmitterRebuild(
    cannonId: string,
    rebuild: { readonly rebuiltGeodesicIds: readonly string[]; readonly regrownActiveGeodesicId?: string },
  ): void {
    for (const geodesicId of rebuild.rebuiltGeodesicIds) {
      refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    }
    refreshProtractorAnglesForGeodesics(rebuild.rebuiltGeodesicIds);
    if (rebuild.regrownActiveGeodesicId) {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: cannonId,
        activeGeodesicId: rebuild.regrownActiveGeodesicId,
      } });
    }
  }

  function updateActiveGeodesicCannonRotation(yawDeltaRadians: number, finishRequested: boolean): void {
    const cannonId = deps.session.get().cannonToolState.selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;

    if (!cannon || cannon.kind !== "geodesic-cannon") {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
      deps.dispatch({ kind: "clear-selected-tool" });
      syncDesktopPalette();
      return;
    }

    if (yawDeltaRadians !== 0 && Number.isFinite(yawDeltaRadians)) {
      // Wrap to (-pi, pi]; the rebuild below launches the active geodesic along it.
      const nextYaw = Math.atan2(
        Math.sin(cannon.aimYawRadians + yawDeltaRadians),
        Math.cos(cannon.aimYawRadians + yawDeltaRadians),
      );
      const nextCannon = {
        ...cannon,
        aimYawRadians: nextYaw,
        localPose: yawRigidTransform3(nextYaw, cannon.localPose.translation),
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
      deps.dispatch({ kind: "clear-selected-tool" });
      syncDesktopPalette();
    }
  }

  function updateActiveGeodesicCannonAim(
    finishRequested: boolean,
    activeAimRay: RootAimRay | undefined,
  ): void {
    const cannonId = deps.session.get().cannonToolState.selectedCannonId;
    const cannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;

    if (!cannon || cannon.kind !== "geodesic-cannon") {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
      finishGeodesicCannonAimMode();
      return;
    }

    // The emitter may be in another cell than the player: it then appears at an image in the player's frame.
    const appearance = resolveCannonAppearanceFromPlayer(cannon);
    if (!appearance) {
      finishGeodesicCannonAimMode();
      return;
    }

    // Aim at the hit point if any, otherwise at the ray's intersection with the floor; yaw is derived from absolute (root-frame) points,
    // with the emitter's point taken in the same (player's) frame, and then turned into the emitter's own frame.
    const aimTarget = activeAimRay ? resolveCurrentAimTarget(activeAimRay) : undefined;
    const targetAbsolutePoint = aimTarget?.rootPoint
      ?? (activeAimRay ? intersectRootRayWithFloor(activeAimRay.origin, activeAimRay.direction) : undefined);
    const yawInPlayerFrame = resolveGeodesicCannonAimYawFromAbsolutePoints({
      source: transformPoint3(appearance.playerFrameFromCell, resolveGeodesicCannonAbsoluteEmitterPoint(cannon)),
      target: targetAbsolutePoint,
    });
    const nextYaw = yawInPlayerFrame === undefined
      ? undefined
      : yawInPlayerFrame - Math.atan2(appearance.playerFrameFromCell.rotation.m10, appearance.playerFrameFromCell.rotation.m00);
    if (nextYaw !== undefined) {
      const yawDelta = Math.atan2(
        Math.sin(nextYaw - cannon.aimYawRadians),
        Math.cos(nextYaw - cannon.aimYawRadians),
      );
      if (Math.abs(yawDelta) > 1e-6) {
        const nextCannon = {
          ...cannon,
          aimYawRadians: nextYaw,
          localPose: yawRigidTransform3(nextYaw, cannon.localPose.translation),
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

  // Where the cannon appears from the player, if within aiming range: the map from the cannon's cell frame to the player's frame
  // (the identity in the player's own cell; otherwise through the portals a straight line from the player to the cannon crosses, at most two).
  // Undefined when the cannon is out of range or no such line exists (a wall in between).
  function resolveCannonAppearanceFromPlayer(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ): { readonly playerFrameFromCell: RigidTransform3 } | undefined {
    const player = deps.session.get().playerPose;
    let playerFrameFromCell = identityRigidTransform3;
    if (player.cellId !== cannon.cellId) {
      const route = findNearestImageRoute(
        deps.getWorld(),
        { cellId: player.cellId, point: player.position },
        { cellId: cannon.cellId, point: cannon.localPose.translation },
        geodesicCannonAimMaxHops,
      );
      if (!route) {
        return undefined;
      }
      const cellFromPlayerFrame = route.hops.reduce((frame, hop) => composeRigidTransform3(hop.transformToTarget, frame), identityRigidTransform3);
      playerFrameFromCell = invertRigidTransform3(cellFromPlayerFrame);
    }

    const image = transformPoint3(playerFrameFromCell, cannon.localPose.translation);
    const withinRange = Math.hypot(player.position.x - image.x, player.position.y - image.y) <= getRuntimeObjectInteractionRangeMeters(cannon);
    return withinRange ? { playerFrameFromCell } : undefined;
  }

  function finishGeodesicCannonAimMode(): void {
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.dispatch({ kind: "clear-selected-tool" });
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
    const geodesicId = deps.session.get().cannonToolState.activeGeodesicId;
    if (!geodesicId) {
      return;
    }

    const totalLengthMeters = geodesicCannonRotationTargetLengthMeters ?? getGeodesicTotalLengthMeters(geodesicId);
    rebuildGeodesicToLength({
      world: deps.getWorld(),
      registry: runtimeObjectRegistry,
      cannon,
      geodesicId,
      launchYawRadians: cannon.aimYawRadians,
      totalLengthMeters,
      connectEmitters: options.connectEmitters,
      snapToEmitter: options.snapToEmitter,
      breakOnForbiddenZone: options.breakOnForbiddenZone,
      rebuildLocked: true,
    });
    refreshProtractorAnglesForGeodesic(geodesicId);
    refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: cannon.id,
      activeGeodesicId: geodesicId,
    } });
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
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getGeodesicTotalLengthMeters,
    getLockedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  };
}
