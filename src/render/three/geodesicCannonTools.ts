/**
 * Geodesic emitter (cannon) tools: place, rotate, aim, carry, and delete geodesics.
 *
 * This module is the interaction layer between the aim/menu systems and the geodesic world-object logic in
 * `world-objects/geodesic/`. It mutates the runtime object registry (cannons, geodesic segments/intervals) and
 * the shell-owned cannon tool state and menu state through getter/setter dependencies, then triggers the
 * follow-up syncs (palette, portal instances, hitbox debug, dependent measurements and protractor angles).
 * Poses and distances are cell-local (meters; x right, y forward, z up) with yaws in radians
 * counter-clockwise from +x; Three.js-space values only appear for aim rays.
 * Ids of new cannons and geodesics come from the engine.
 */
import { localParticipantId, readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import { participantAttachment, type CommandTicket, type EngineEventBase } from "../../engine/moduleTypes";
import {
  carryAttachmentKind,
  carryOffsetSlot,
  type CarryAttachCommand,
  type CarryDetachCommand,
  type CarryDroppedEvent,
  type CarryMovedEvent,
  type CarryOffset,
  type CarryReleasedEvent,
} from "../../modules/carry/api";
import type { ObjectActionEntry } from "../../engine/moduleTypes";
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
import type { ClientSession } from "../../runtime/clientSession";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import type { GeodesicCannonToolState } from "../../world-objects/geodesic/cannonToolState";
import { pruneMissingGeodesicIntersectionObjects } from "../../world-objects/geodesic/intersections";
import { getEmitterGeodesicIds } from "../../world-objects/geodesic/endpoints";
import { getGeodesicSegments } from "../../world-objects/geodesic/segments";
import {
  arcConnectsEmitters,
  removeGeodesic,
  removeUnlockedGeodesicsFromCannon,
} from "../../world-objects/geodesic/lifecycle";
import {
  extendGeodesic,
  placeGeodesicCannonAtFloorPoint,
  placeGeodesicCannonAtGeodesicVertex,
  placeGeodesicCannonOnGeodesic,
  rebuildGeodesicToLength,
  shootGeodesic,
} from "../../world-objects/geodesic/cannon";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { AimTarget } from "../../interaction/aimTarget";
import { handCarryLeashMeters } from "../../interaction/handCarry";
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
  readonly session: ClientSession;
  /** The world engine: the player's pose and the ids of new objects. */
  readonly engine: WorldEngine;
  /** Runs a command through the shell's one command path (menu changes go through it, never by assignment). */
  dispatch(command: RuntimeCommand): void;
  /** Resolves the single best aim target for a ray. */
  resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined;
  /** True when the target is close enough to interact with. */
  targetIsWithinInteractionRange(target: AimTarget | undefined): boolean;
  /** Logs the clicked target when verbose debugging is on. */
  logVerboseAimClick(target: AimTarget | undefined): void;
  /** Finds the interactable runtime object under the (optional) ray, with its distance. */
  findFocusedRuntimeObject(ray?: RootAimRay): FocusedRuntimeObject | undefined;
  /** Maps geodesic ids to their display names ("G1", ...) for menus. */
  getGeodesicLabelsById(geodesicIds: readonly string[]): Readonly<Record<string, string>>;
  /** The actions the tools contribute to the menu page of an object (design 013 section 8.3), with their availability now. */
  objectActionsFor(objectKind: string, objectId: string): readonly ObjectActionEntry[];
  /** Re-syncs the desktop tool palette after tool or menu changes. */
  syncDesktopPalette(): void;
  /** Requests a sync of the instanced copies of runtime objects seen through portals after registry changes; the frame performs it. */
  /** Requests a refresh of the selectable-hitbox debug wireframes after registry changes; the frame performs it. */
  syncSelectableHitboxDebug(): void;
  /** Deletes measured lengths attached to a geodesic. */
  removeMeasuredGeodesicLengthsForGeodesic(geodesicId: string): void;
  /** Deletes protractor angles that use a geodesic as a leg. */
  removeProtractorAnglesForGeodesic(geodesicId: string): void;
  /** Deletes protractor angles centered on intersection vertices that no longer exist. */
  removeProtractorAnglesForMissingVertices(vertexIds: readonly string[]): void;
}

/**
 * Creates the geodesic cannon tool controller and returns its operations.
 *
 * Entry points: `tryUseGeodesicCannonToolFromAim` (place a cannon, or add a geodesic to one, from an aim ray),
 * `tryExtendFocusedGeodesicFromAim`, `addGeodesicToCannon`, `deleteGeodesicFromCannon`, the mode starters
 * `startGeodesicCannonRotation`/`Aim`/`Carry`, the per-frame updaters
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
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    getGeodesicLabelsById,
    syncDesktopPalette,
    syncSelectableHitboxDebug,
    removeMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
  } = deps;
  let geodesicCannonRotationHeadHeightMeters: number | undefined;
  let geodesicCannonRotationTargetLengthMeters: number | undefined;
  // The ticket of the pickup the tool submitted and the world has not answered yet.
  let pendingAttachTicket: CommandTicket | undefined;

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
    if (target?.object?.kind === "geodesicModel/crossing") {
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
        id: deps.engine.ids.next("geodesic-cannon"),
        createContinuationGeodesicId: () => deps.engine.ids.next("geodesic"),
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
      syncSelectableHitboxDebug();
      return;
    }

    // Aiming at an existing geodesic segment places a cannon on it at the hit distance along the segment.
    if (target?.object?.kind === "geodesicModel/segment") {
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
        id: deps.engine.ids.next("geodesic-cannon"),
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
      id: deps.engine.ids.next("geodesic-cannon"),
    });
    if (!result.placed || !result.object) {
      return;
    }

    const geodesicId = deps.engine.ids.next("geodesic");
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

    if (target?.object?.kind !== "geodesicModel/segment") {
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

    const geodesicId = deps.engine.ids.next("geodesic");
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
          objectActions: deps.objectActionsFor("geodesic-cannon", updatedCannon.id),
        });
      }
    }

    if (segment) {
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
    if (geodesicId && arcConnectsEmitters(runtimeObjectRegistry, geodesicId)) {
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
    if (geodesicId && arcConnectsEmitters(runtimeObjectRegistry, geodesicId)) {
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
    // The pickup is the world's to accept: the tool waits for the answer (afterWorldStep) and leaves the carry tool when it is refused.
    const attach: CarryAttachCommand = {
      kind: "carry/attach",
      objectId: cannon.id,
      ...(geodesicId === undefined ? {} : { activeGeodesicId: geodesicId }),
      ...(geodesicCannonRotationTargetLengthMeters === undefined ? {} : { rotationTargetLengthMeters: geodesicCannonRotationTargetLengthMeters }),
    };
    pendingAttachTicket = deps.engine.submit(localParticipantId, attach);
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

    // Putting down is a detach. The emitter decides what stopping a carry means for its geodesics (the world runs the final rebuild in its next
    // step) and the tool then refreshes what it draws (afterWorldStep).
    const detach: CarryDetachCommand = { kind: "carry/detach" };
    deps.engine.submit(localParticipantId, detach);
    leaveCarryTool();
    return true;
  }

  // The tool's own end of a carry: its state, the selection and the palette. Nothing of the world.
  function leaveCarryTool(): void {
    pendingAttachTicket = undefined;
    deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
    geodesicCannonRotationTargetLengthMeters = undefined;
    deps.dispatch({ kind: "clear-selected-tool" });
    syncDesktopPalette();
  }

  function localCarry() {
    return participantAttachment(deps.engine.read.participant(localParticipantId), carryAttachmentKind);
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
      objectActions: deps.objectActionsFor("geodesic-cannon", updatedCannon.id),
    });
    syncDesktopPalette();
    syncSelectableHitboxDebug();
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
      syncSelectableHitboxDebug();
    }

    const cannon = runtimeObjectRegistry.get(cannonId);
    return cannon?.kind === "geodesic-cannon" ? cannon : undefined;
  }

  function updateCarriedGeodesicCannonPose(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    const carry = localCarry();
    if (deps.session.get().menuState.selectedTool !== "geodesic-cannon-carry") {
      // The carry tool was left some other way (another tool, the menu): the world is told the object is put down.
      if (carry !== undefined) {
        const detach: CarryDetachCommand = { kind: "carry/detach" };
        deps.engine.submit(localParticipantId, detach);
      }
      return;
    }

    const cannon = carry ? runtimeObjectRegistry.get(carry.objectId) : undefined;
    if (cannon?.kind !== "geodesic-cannon") {
      return;
    }

    const anchor = xrActive
      ? resolveVrCarriedGeodesicCannonAnchor(cannon, activeAimRay)
      : resolveDesktopCarriedGeodesicCannonAnchor(cannon, activeAimRay);
    if (!anchor) {
      return;
    }

    // The emitter is held at the hand, which may be on another face than the player or behind a wall. The hand place goes to the world as a
    // control slot; the carry module moves the emitter toward it each step. Whether the hand goes on holding the emitter is the hand policy
    // (handCarry.ts): the loose leash goes along, the world applies the policy and tells the tool when it lets go (carry/dropped).
    const offset: CarryOffset = {
      x: anchor.x,
      y: anchor.y,
      leashMeters: handCarryLeashMeters({
        pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(cannon),
        handReachMeters: xrActive ? 0 : carriedGeodesicEmitterDesktopDistanceMeters,
      }),
    };
    deps.engine.setControl(localParticipantId, carryOffsetSlot, offset);
  }

  /**
   * Call after every world step: settles the pickup the tool asked for and draws again what the world carry changed. A refused pickup, or a carry the world ended
   * (the hand let go), leaves the carry tool.
   */
  function afterWorldStep(): void {
    if (pendingAttachTicket !== undefined) {
      const result = deps.engine.resultOf(pendingAttachTicket);
      if (result !== undefined) {
        pendingAttachTicket = undefined;
        if (!result.ok) {
          console.info(`[noneuclid] ${result.refusal.message}`);
          if (deps.session.get().menuState.selectedTool === "geodesic-cannon-carry") {
            leaveCarryTool();
          }
        }
      }
    }
    deps.engine.forEachEvent(handleCarryEvent);
  }

  function handleCarryEvent(event: EngineEventBase): void {
    switch (event.kind) {
      case "carry/moved": {
        const moved = event as CarryMovedEvent;
        if (moved.participantId !== localParticipantId) return;
        refreshAfterEmitterRebuild(moved.objectId, moved);
        syncSelectableHitboxDebug();
        return;
      }
      case "carry/released": {
        const released = event as CarryReleasedEvent;
        if (released.participantId !== localParticipantId) return;
        // The tool has left (or is leaving) the carry tool, so the regrown active geodesic is not selected again.
        removeProtractorAnglesForMissingVertices(released.prunedIntersectionIds);
        syncSelectableHitboxDebug();
        return;
      }
      case "carry/dropped": {
        const dropped = event as CarryDroppedEvent;
        if (dropped.participantId !== localParticipantId) return;
        if (deps.session.get().menuState.selectedTool === "geodesic-cannon-carry") {
          leaveCarryTool();
        }
        return;
      }
      default:
        return;
    }
  }

  // Selects again the emitter's plain active geodesic when it was regrown. What was rebuilt is the emitter's rule (geodesic/carryEnd.ts).
  function refreshAfterEmitterRebuild(
    cannonId: string,
    rebuild: { readonly rebuiltGeodesicIds: readonly string[]; readonly regrownActiveGeodesicId?: string },
  ): void {
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
    const player = readLocalPlayerPose(deps.engine);
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
    syncSelectableHitboxDebug();
  }

  function rebuildActiveGeodesicFromCannon(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    options: {
      readonly connectEmitters?: boolean;
      readonly snapToEmitter?: boolean;
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
      rebuildLocked: true,
    });
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
    return geodesicIds.filter((geodesicId) => arcConnectsEmitters(runtimeObjectRegistry, geodesicId));
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
    updateCarriedGeodesicCannonPose,
    afterWorldStep,
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getGeodesicTotalLengthMeters,
    getLockedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  };
}
