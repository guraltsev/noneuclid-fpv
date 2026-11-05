/**
 * Geodesic emitter (cannon) sub-modes of the shell: rotate, aim and carry. Placing an emitter and shooting, extending or deleting a geodesic are commands of `modules/geodesicEmitters`.
 *
 * All three ask the world first and change it only through it. A mode starts with `world/requestTool`; on `ok` the tool submits the relation it needs (`geodesicEmitters/beginEdit`, `carry/attach`), and on that `ok` the client enters the tool. A refusal at either step shows the world's sentence and leaves the tool and the world as they were. A press while any of this is in flight does nothing.
 * While a mode is active the tools are the world's input: each frame they write a control slot, the fast channel, and the `bodies` ticks act on it in the same frame, with no tick needed. Rotate and aim compute an absolute yaw from the turn input or the aim ray, so rays never reach the world; carry sends the hand. A mode ends with `geodesicEmitters/endEdit` or `carry/detach`, and the client leaves the tool on the answer; meanwhile the slot is left alone.
 * Poses and distances are cell-local (meters; x right, y forward, z up) with yaws in radians
 * counter-clockwise from +x; Three.js-space values only appear for aim rays.
 */
import { localParticipantId, readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import { participantAttachment, type CommandResult, type EngineCommandBase, type EngineEventBase, type ToolContext, type WorldRequestToolCommand } from "../../engine/moduleTypes";
import {
  carryAttachmentKind,
  carryOffsetSlot,
  type CarryAttachCommand,
  type CarryDetachCommand,
  type CarryDroppedEvent,
  type CarryMovedEvent,
  type CarryOffset,
} from "../../modules/carry/api";
import {
  geodesicEmitterEditAttachmentKind,
  geodesicEmitterYawSlot,
  type GeodesicEmitterBeginEditCommand,
  type GeodesicEmitterEndEditCommand,
} from "../../modules/geodesicEmitters/api";
import type { FocusedRuntimeObject } from "./rootAimRay";
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import type { RuntimeToolId } from "../../glue/toolIds";
import {
  type RigidTransform3,
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
} from "../../math/rigidTransform3";
import { type Vec3 } from "../../math/vec3";
import type { ClientSession } from "../../runtime/clientSession";
import type { EmitterModeToolId } from "../../runtime/coreTools";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import type { GeodesicCannonToolState } from "../../world-objects/geodesic/cannonToolState";
import { arcConnectsEmitters } from "../../world-objects/geodesic/lifecycle";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { AimTarget } from "../../interaction/aimTarget";
import { handCarryLeashMeters } from "../../interaction/handCarry";
import {
  carriedGeodesicEmitterDesktopDistanceMeters,
  resolveCannonGeodesicId,
  resolveDesktopCarriedGeodesicCannonAnchor,
  resolveGeodesicCannonAbsoluteEmitterPoint,
  resolveVrCarriedGeodesicCannonAnchor,
} from "./carriedGeodesicCannon";
import { createDesktopControls } from "./desktopControls";
import { resolveGeodesicCannonAimYawFromAbsolutePoints } from "./geodesicCannonAimTarget";
import {
  RootAimRay,
  getRuntimeObjectInteractionRangeMeters,
  intersectRootRayWithFloor,
} from "./rootAimRay";

export type { GeodesicCannonToolState };

// Most portals a straight line from the player to an emitter being aimed may cross (the same reach as the emitter labels).
const geodesicCannonAimMaxHops = 2;

const carryTool = "geodesicEmitters/carry";
const rotateTool = "geodesicEmitters/rotate";
const aimTool = "geodesicEmitters/aim";

type Emitter = Extract<RuntimeWorldObject, { readonly kind: "geodesicEmitters/emitter" }>;

/** A mode on its way in: what the person asked for, and which answer the tool waits for. */
interface ModeStart {
  readonly toolId: EmitterModeToolId;
  readonly emitterId: string;
  readonly arcId: string | undefined;
  /** The tool selected when the person asked; another one by the time of an answer means they went elsewhere. */
  readonly toolBefore: RuntimeToolId;
  readonly waitingFor: "gate" | "relation";
}

/**
 * Dependencies of the geodesic cannon tools, supplied by createThreeApp's shell.
 *
 * Plain-value fields are long-lived objects; `get*` members are getters because the shell reassigns the
 * underlying `let` variables (menu state, cannon tool state, world, player pose).
 */
export interface GeodesicCannonToolsDeps {
  /** Renderer; only `xr.isPresenting` is read, to skip pointer lock in XR. */
  readonly renderer: THREE.WebGLRenderer;
  /** Desktop controls, used to request pointer lock while rotating, aiming, or carrying. */
  readonly controls: ReturnType<typeof createDesktopControls>;
  /** Getter for the active compiled world. */
  getWorld(): CompiledCellComplex;
  /** The shell session; the menu state (selected tool, open menu) is read from it. */
  readonly session: ClientSession;
  /** The world engine: the objects and the player's pose are read from it, the control slots written to it. */
  readonly engine: WorldEngine;
  /** Runs a command through the shell's one command path (menu changes go through it, never by assignment). */
  dispatch(command: RuntimeCommand): void;
  /** The context a mode acts through: commands go through its `submit`, and their answers come back to `settleEmitterMode`. */
  toolContext(toolId: EmitterModeToolId): ToolContext;
  /** Resolves the single best aim target for a ray. */
  resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined;
  /** Finds the interactable runtime object under the (optional) ray, with its distance. */
  findFocusedRuntimeObject(ray?: RootAimRay): FocusedRuntimeObject | undefined;
  /** Re-syncs the desktop tool palette after tool or menu changes. */
  syncDesktopPalette(): void;
}

/**
 * Creates the geodesic cannon tool controller and returns its operations.
 *
 * Entry points: the mode starters `startGeodesicCannonRotation`/`Aim`/`Carry`, `settleEmitterMode` for the world's answers, the per-frame updaters
 * `updateActiveGeodesicCannonRotation`, `updateActiveGeodesicCannonAim`, and `updateCarriedGeodesicCannonPose`, and
 * `finishGeodesicCannonCarry`. Operations with missing or wrong-kind cannons close the menu and return without throwing.
 *
 * Lifecycle: the tools own no GPU resource (the highlight around a carried emitter is drawn by the runtime-object instance sync).
 * Closure state (the frozen XR head height, the mode in flight) lives for the factory's lifetime.
 */
export function createGeodesicCannonTools(deps: GeodesicCannonToolsDeps) {
  const {
    renderer,
    controls,
    engine,
    resolveCurrentAimTarget,
    findFocusedRuntimeObject,
    syncDesktopPalette,
  } = deps;
  const objects = engine.read.objects;
  let geodesicCannonRotationHeadHeightMeters: number | undefined;
  let modeStart: ModeStart | undefined;
  // The mode whose end the world has not answered yet.
  let modeEnding: EmitterModeToolId | undefined;

  const selectedTool = (): RuntimeToolId => deps.session.get().menuState.selectedTool;

  function emitterAt(id: string | undefined): Emitter | undefined {
    const object = id === undefined ? undefined : objects.get(id);
    return object?.kind === "geodesicEmitters/emitter" ? object : undefined;
  }

  function anyModeInFlight(): boolean {
    return deps.toolContext(carryTool).commandInFlight() || deps.toolContext(rotateTool).commandInFlight() || deps.toolContext(aimTool).commandInFlight();
  }

  /** Asks the world for the mode. Nothing changes until it has answered twice: the gate, then the relation. */
  function startEmitterMode(toolId: EmitterModeToolId, cannonId: string, requestedGeodesicId: string | undefined): void {
    const cannon = emitterAt(cannonId);
    if (cannon === undefined) {
      deps.dispatch({ kind: "close-menu" });
      syncDesktopPalette();
      return;
    }
    if (anyModeInFlight()) {
      return;
    }

    const arcId = resolveCannonGeodesicId(objects, cannon, requestedGeodesicId, deps.session.get().cannonToolState.activeGeodesicId);
    modeStart = { toolId, emitterId: cannon.id, arcId, toolBefore: selectedTool(), waitingFor: "gate" };
    const request: WorldRequestToolCommand = { kind: "world/requestTool", toolId };
    deps.toolContext(toolId).submit(request);
  }

  function startGeodesicCannonRotation(cannonId: string, requestedGeodesicId?: string): void {
    startEmitterMode(rotateTool, cannonId, requestedGeodesicId);
  }

  function startGeodesicCannonAim(cannonId: string, requestedGeodesicId?: string): void {
    startEmitterMode(aimTool, cannonId, requestedGeodesicId);
  }

  function startGeodesicCannonCarry(cannonId: string, requestedGeodesicId?: string): void {
    startEmitterMode(carryTool, cannonId, requestedGeodesicId);
  }

  function relationCommand(start: ModeStart): EngineCommandBase {
    if (start.toolId === carryTool) {
      const attach: CarryAttachCommand = { kind: "carry/attach", objectId: start.emitterId, ...(start.arcId === undefined ? {} : { activeGeodesicId: start.arcId }) };
      return attach;
    }
    const begin: GeodesicEmitterBeginEditCommand = { kind: "geodesicEmitters/beginEdit", emitterId: start.emitterId, ...(start.arcId === undefined ? {} : { arcId: start.arcId }) };
    return begin;
  }

  /** Asks the world to end the relation of a mode; the tool is left on the answer. */
  function endRelation(toolId: EmitterModeToolId): void {
    modeEnding = toolId;
    const end: CarryDetachCommand | GeodesicEmitterEndEditCommand = toolId === carryTool ? { kind: "carry/detach" } : { kind: "geodesicEmitters/endEdit" };
    deps.toolContext(toolId).submit(end);
  }

  function enterMode(start: ModeStart): void {
    // Carry has just lifted the plain geodesics, so the selection is resolved again.
    const emitter = emitterAt(start.emitterId);
    deps.dispatch({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: start.emitterId,
      activeGeodesicId: emitter === undefined ? undefined : resolveCannonGeodesicId(objects, emitter, start.arcId, undefined),
    } });
    deps.dispatch({ kind: "select-tool", toolId: start.toolId });
    syncDesktopPalette();
    if (!renderer.xr.isPresenting) {
      void controls.requestPointerLock();
    }
  }

  function leaveMode(toolId: EmitterModeToolId): void {
    if (toolId === carryTool && selectedTool() === carryTool) {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
    }
    deps.toolContext(toolId).endTool();
    syncDesktopPalette();
  }

  /** The world answered a command of a mode: goes on with the start, or leaves the tool after an end. */
  function settleEmitterMode(toolId: EmitterModeToolId, result: CommandResult): void {
    const tool = deps.toolContext(toolId);
    if (!result.ok) {
      tool.showMessage(result.refusal.message);
    }
    if (modeEnding === toolId) {
      modeEnding = undefined;
      leaveMode(toolId);
      return;
    }

    const start = modeStart;
    if (start === undefined || start.toolId !== toolId) {
      return;
    }
    modeStart = undefined;
    if (!result.ok) {
      return;
    }
    const wentElsewhere = selectedTool() !== start.toolBefore;
    if (start.waitingFor === "gate") {
      if (!wentElsewhere) {
        modeStart = { ...start, waitingFor: "relation" };
        tool.submit(relationCommand(start));
      }
      return;
    }
    if (wentElsewhere) {
      endRelation(toolId);
      return;
    }
    enterMode(start);
  }

  function tryStartFocusedGeodesicCannonCarry(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (!focused || focused.object.kind !== "geodesicEmitters/emitter") {
      return false;
    }

    if (focused.distance > getRuntimeObjectInteractionRangeMeters(focused.object)) {
      return false;
    }

    startGeodesicCannonCarry(focused.object.id, deps.session.get().cannonToolState.activeGeodesicId);
    return true;
  }

  function finishGeodesicCannonCarry(): boolean {
    if (selectedTool() !== carryTool) {
      return false;
    }

    // Putting down is a detach. The emitter decides what stopping a carry means for its geodesics: the world runs the final rebuild.
    if (!deps.toolContext(carryTool).commandInFlight()) {
      endRelation(carryTool);
    }
    return true;
  }

  /** A mode was left some other way (another tool, the menu, an emitter out of reach): the world is told. */
  function endRelationsOfLeftModes(): void {
    const participant = engine.read.participant(localParticipantId);
    const tool = selectedTool();
    if (tool !== carryTool && participantAttachment(participant, carryAttachmentKind) !== undefined && !deps.toolContext(carryTool).commandInFlight()) {
      endRelation(carryTool);
    }
    if (tool !== rotateTool && tool !== aimTool && participantAttachment(participant, geodesicEmitterEditAttachmentKind) !== undefined && !deps.toolContext(rotateTool).commandInFlight()) {
      endRelation(rotateTool);
    }
  }

  function updateCarriedGeodesicCannonPose(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    endRelationsOfLeftModes();
    if (selectedTool() !== carryTool || deps.toolContext(carryTool).commandInFlight()) {
      return;
    }

    const carry = participantAttachment(engine.read.participant(localParticipantId), carryAttachmentKind);
    const cannon = emitterAt(carry?.objectId);
    if (cannon === undefined) {
      return;
    }

    const anchor = xrActive
      ? resolveVrCarriedGeodesicCannonAnchor(cannon, activeAimRay)
      : resolveDesktopCarriedGeodesicCannonAnchor(cannon, activeAimRay);
    if (!anchor) {
      return;
    }

    // The emitter is held at the hand, which may be on another face than the player or behind a wall. The hand place goes to the world as a
    // control slot; the carry module moves the emitter toward it each frame. Whether the hand goes on holding the emitter is the hand policy
    // (handCarry.ts): the loose leash goes along, the world applies the policy and tells the tool when it lets go (carry/dropped).
    const offset: CarryOffset = {
      x: anchor.x,
      y: anchor.y,
      leashMeters: handCarryLeashMeters({
        pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(cannon),
        handReachMeters: xrActive ? 0 : carriedGeodesicEmitterDesktopDistanceMeters,
      }),
    };
    engine.setControl(localParticipantId, carryOffsetSlot, offset);
  }

  /**
   * Call once per frame, after the frame's last tick, also in a frame with no tick: reads what the world carry changed. A carry the world ended (the hand let go) leaves the carry tool.
   */
  function afterWorldStep(): void {
    engine.forEachEvent(handleCarryEvent);
  }

  function handleCarryEvent(event: EngineEventBase): void {
    switch (event.kind) {
      case "carry/moved": {
        const moved = event as CarryMovedEvent;
        if (moved.participantId !== localParticipantId) return;
        refreshAfterEmitterRebuild(moved.objectId, moved);
        return;
      }
      case "carry/dropped": {
        const dropped = event as CarryDroppedEvent;
        if (dropped.participantId !== localParticipantId) return;
        leaveMode(carryTool);
        return;
      }
      default:
        return;
    }
  }

  // Selects again the emitter's plain active geodesic when it was regrown. What was rebuilt is the emitter's rule (geodesic/carryEnd.ts).
  function refreshAfterEmitterRebuild(
    cannonId: string,
    rebuild: { readonly regrownActiveGeodesicId?: string },
  ): void {
    if (rebuild.regrownActiveGeodesicId) {
      deps.dispatch({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: cannonId,
        activeGeodesicId: rebuild.regrownActiveGeodesicId,
      } });
    }
  }

  // The emitter's selection is gone: the tool is left at once, and the world is told in the next frame.
  function leaveEditWithoutEmitter(): void {
    deps.dispatch({ kind: "set-cannon-tool-state", state: {} });
    deps.dispatch({ kind: "clear-selected-tool" });
    syncDesktopPalette();
  }

  function updateActiveGeodesicCannonRotation(yawDeltaRadians: number, finishRequested: boolean): void {
    // The end is in flight: the slot is left alone and a press does nothing.
    if (deps.toolContext(rotateTool).commandInFlight()) {
      return;
    }
    const cannon = emitterAt(deps.session.get().cannonToolState.selectedCannonId);
    if (cannon === undefined) {
      leaveEditWithoutEmitter();
      return;
    }

    if (yawDeltaRadians !== 0 && Number.isFinite(yawDeltaRadians)) {
      // Wrap to (-pi, pi]; the world launches the active geodesic along it in this frame's `applyControls`.
      const yaw = cannon.aimYawRadians + yawDeltaRadians;
      engine.setControl(localParticipantId, geodesicEmitterYawSlot, Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    }

    if (finishRequested) {
      endRelation(rotateTool);
    }
  }

  function updateActiveGeodesicCannonAim(
    finishRequested: boolean,
    activeAimRay: RootAimRay | undefined,
  ): void {
    if (deps.toolContext(aimTool).commandInFlight()) {
      return;
    }
    const cannon = emitterAt(deps.session.get().cannonToolState.selectedCannonId);
    if (cannon === undefined) {
      leaveEditWithoutEmitter();
      return;
    }

    // The emitter may be in another cell than the player: it then appears at an image in the player's frame.
    const appearance = resolveCannonAppearanceFromPlayer(cannon);
    if (!appearance) {
      deps.dispatch({ kind: "clear-selected-tool" });
      syncDesktopPalette();
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
        engine.setControl(localParticipantId, geodesicEmitterYawSlot, nextYaw);
      }
    }

    if (finishRequested) {
      endRelation(aimTool);
    }
  }

  // Where the cannon appears from the player, if within aiming range: the map from the cannon's cell frame to the player's frame
  // (the identity in the player's own cell; otherwise through the portals a straight line from the player to the cannon crosses, at most two).
  // Undefined when the cannon is out of range or no such line exists (a wall in between).
  function resolveCannonAppearanceFromPlayer(cannon: Emitter): { readonly playerFrameFromCell: RigidTransform3 } | undefined {
    const player = readLocalPlayerPose(engine);
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

  function getConnectedGeodesicIds(geodesicIds: readonly string[]): readonly string[] {
    return geodesicIds.filter((geodesicId) => arcConnectsEmitters(objects, geodesicId));
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

  /** Forgets the frozen head height once rotating has ended. */
  function resetGeodesicCannonRotationTracking(rotating: boolean): void {
    if (!rotating) {
      geodesicCannonRotationHeadHeightMeters = undefined;
    }
  }

  return {
    startGeodesicCannonRotation,
    startGeodesicCannonAim,
    startGeodesicCannonCarry,
    settleEmitterMode,
    tryStartFocusedGeodesicCannonCarry,
    finishGeodesicCannonCarry,
    updateCarriedGeodesicCannonPose,
    afterWorldStep,
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getConnectedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  };
}
