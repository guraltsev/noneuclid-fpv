/**
 * Actions the player performs on runtime objects through the aim: editing signs, the primary interaction and
 * context menu of the focused object, going home, resetting the world, and the debug pose helpers.
 *
 * It owns no state: menu and tool state are read from the session, the pose from the engine and changed by commands through `dispatch`;
 * the world is read here and changed by engine commands. Poses are cell-local meters; yaws are radians about +z
 * (the debug helpers take degrees).
 */
import type { ObjectActionEntry } from "../../engine/moduleTypes";
import { localParticipantId, publishLocalPlayerPose, readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { isRuntimeToolEnabled, type AppConfig } from "../../glue/appConfig";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import type { PlayerPose } from "../../movement/playerPose";
import type { AimTarget } from "../../interaction/aimTarget";
import type { ClientSession } from "../../runtime/clientSession";
import { getEmitterGeodesicIds } from "../../world-objects/geodesic/endpoints";
import type { RuntimeCommand, ShowGeometryComputerActionsPayload } from "../../runtime/runtimeCommands";
import { sanitizePlacedFlagMessage } from "../../world-objects/placedFlags";
import { geodesicMeasurementsModuleId, type GeodesicMeasurementsRemoveAngleCommand, type GeodesicMeasurementsRemoveLengthCommand } from "../../modules/geodesicMeasurements/api";
import type { PlacedFlagsRemoveCommand } from "../../modules/placedFlags/api";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import type { PlainWorldObject } from "../../world-objects/worldObjectOwner";
import type { PlayerPoseDebugDump } from "./appDebugHelpers";
import type { GeodesicMarmotRuntime } from "./creatures/geodesicMarmotView";
import type { SimpleGeoCreatureRuntime } from "./creatures/simpleGeoCreatureView";
import { resolveCannonGeodesicId } from "./carriedGeodesicCannon";
import { reduceDesktopScenePaletteToggle } from "./desktopScenePaletteInput";
import type { FocusedRuntimeObject, RootAimRay } from "./rootAimRay";
import type * as THREE from "three";

/** Dependencies of the runtime-object actions, supplied by createThreeApp's shell. */
export interface RuntimeObjectActionsDeps {
  /** The shell session; menu, tool, serial and pose state are read from it. */
  readonly session: ClientSession;
  /** The world engine: the player's pose, the pose writes of reset and teleport, and the removals of a world reset. */
  readonly engine: WorldEngine;
  /** Runs a command through the shell's one command path. */
  dispatch(command: RuntimeCommand): void;
  /** Registry of runtime objects, read only. */
  readonly runtimeObjectRegistry: RuntimeObjectReader;
  /** The active compiled world; read on every call because geometry commits replace it. */
  getWorld(): CompiledCellComplex;
  /** Feature toggles; decide which tools may open an object's menu. */
  readonly appConfig: AppConfig;
  /** The player pose the app started with; the home pose when the world has no starting position. */
  readonly initialPlayerPose: PlayerPose;
  /** Rig whose head offset is cleared when the player goes home. */
  readonly xrRig: { reset(): void };
  /** Host of the authored world objects; `placeAt` serves the debug placement helper. */
  readonly objectHost: { placeAt(id: string, cellId: string, pose: ReturnType<typeof yawRigidTransform3>): boolean };
  /** Creature runtimes reset by a world reset (the array is read each call). */
  readonly dynamicObjectRuntimes: readonly (GeodesicMarmotRuntime | SimpleGeoCreatureRuntime)[];
  /** Cell roots the creature runtimes are re-parented to on reset. */
  readonly cellMeshes: Map<string, THREE.Object3D>;
  /** Owners of authored static assets, reset by a world reset. */
  readonly staticAssetOwners: readonly PlainWorldObject[];
  /** Resolves the single best aim target for a ray. */
  resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined;
  /** True when the target is close enough to interact with. */
  targetIsWithinInteractionRange(target: AimTarget | undefined): boolean;
  /** Logs the clicked target when verbose debugging is on. */
  logVerboseAimClick(target: AimTarget | undefined): void;
  /** Finds the interactable runtime object under the (optional) ray. */
  findFocusedRuntimeObject(ray?: RootAimRay): FocusedRuntimeObject | undefined;
  /** Asks the world to lengthen a free geodesic; false, asking nothing, when a click on it means nothing. */
  extendGeodesic(arcId: string): boolean;
  /** Maps geodesic ids to their rows in the Laser menu ("Beam 1 · 4.0 m · free"). */
  getGeodesicLabelsById(geodesicIds: readonly string[]): Readonly<Record<string, string>>;
  /** Ids among the given geodesics that are connected. */
  getConnectedGeodesicIds(geodesicIds: readonly string[]): readonly string[];
  /** The actions the tools contribute to the menu page of an object (design 013 section 8.3), with their availability now. */
  objectActionsFor(objectKind: string, objectId: string): readonly ObjectActionEntry[];
  /** Menu options of the geometry computer object with this id. */
  createGeometryComputerMenuOptions(objectId: string): ShowGeometryComputerActionsPayload;
  /** Asks the world to change the message of a sign. */
  setFlagMessage(flagId: string, message: string): void;
  /** Asks the world to remove a sign. */
  removeFlag(flagId: string): void;
  /** Asks the world to remove a length, from its menu's Delete button. */
  removeLength(lengthId: string): void;
  /** Asks the world to remove an angle, from its menu's Delete button. */
  removeAngle(angleId: string): void;
  /** Drops every geodesic object and clears the cannon tool state (world reset). */
  removeGeodesicRuntimeObjects(): void;
  /** Hides the protractor tool's feedback drawing. */
  clearProtractorToolFeedback(): void;
}

/** What the shell calls: the aim actions, the sign editing keys, going home and resetting, and the debug helpers. */
export interface RuntimeObjectActions {
  /** Shows an emitter's menu page, with its current geodesics; closes the menu for an id that is no emitter. */
  showObjectPage(objectId: string): void;
  /** Appends a character to the sign being edited (A-Z, 0-9, space, newline; anything else is ignored). */
  appendEditingSignCharacter(character: string): void;
  /** Removes the last character of the sign being edited. */
  backspaceEditingSignMessage(): void;
  /** Deletes the sign being edited and closes the menu. */
  deleteEditingSign(): void;
  /** Deletes a measurement from its menu's Delete button, and closes the menu. */
  deleteMeasurement(measurementKind: "length" | "angle", measurementId: string): void;
  /** Primary action on the focused object (help, extend; or the menu of what has no main action); true when it did something. */
  tryUseFocusedObjectPrimaryInteraction(ray?: RootAimRay): boolean;
  /**
   * Secondary action: closes (goes back in) an open menu, else opens the focused object's menu. With nothing to open, the VR path opens the main menu; with `objectOnly` (desktop) nothing opens and the result is "nothing", so the caller can say so.
   */
  openContextMenuFromAim(ray?: RootAimRay, options?: { readonly objectOnly?: boolean }): "closed" | "opened" | "nothing";
  /** Applies a desktop palette toggle (open, close, right action) to the menu. */
  applyDesktopScenePaletteToggle(action: "open" | "right-action" | "close" | "none"): void;
  /** Puts the player at the world's starting position and clears the rig. */
  resetPlayerToHome(): void;
  /** Cancels any open menu or tool, then goes home. */
  teleportPlayerHome(): void;
  /** Resets creatures and static assets and removes every object the player created. */
  resetRuntimeWorld(): void;
  /** Debug API: the player's pose in degrees. */
  debugPlayerPose(): PlayerPoseDebugDump;
  /** Debug API: puts the player at a pose (degrees); throws for an unknown cell or non-finite numbers. */
  debugSetPlayerPose(cellId: string, x: number, y: number, yawDegrees: number, pitchDegrees?: number): PlayerPoseDebugDump;
  /** Debug API: places a registered world object; false when it is unknown or cannot go there. */
  debugPlaceObjectAt(id: string, cellId: string, x: number, y: number, yawDegrees: number): boolean;
}

/** Creates the runtime-object actions over the shell's session, registry and tool-object runtimes. */
export function createRuntimeObjectActions(deps: RuntimeObjectActionsDeps): RuntimeObjectActions {
  const {
    session,
    engine,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    appConfig,
    objectHost,
    xrRig,
    dynamicObjectRuntimes,
    cellMeshes,
    staticAssetOwners,
    resolveCurrentAimTarget,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    extendGeodesic,
    getGeodesicLabelsById,
    getConnectedGeodesicIds,
    objectActionsFor,
    createGeometryComputerMenuOptions,
    removeGeodesicRuntimeObjects,
    clearProtractorToolFeedback,
  } = deps;
  const dispatchRuntimeCommand = deps.dispatch;
  const currentMenuState = () => session.get().menuState;

  function appendEditingSignCharacter(character: string): void {
    if (!/^[A-Z0-9]$/.test(character) && character !== "\n" && character !== " ") {
      return;
    }

    const editState = currentMenuState().editSignOptions;
    if (!editState) {
      return;
    }

    setEditingSignMessage(editState.flagId, `${editState.message}${character}`);
  }

  function backspaceEditingSignMessage(): void {
    const editState = currentMenuState().editSignOptions;
    if (!editState) {
      return;
    }

    setEditingSignMessage(editState.flagId, [...editState.message].slice(0, -1).join(""));
  }

  function deleteEditingSign(): void {
    const editState = currentMenuState().editSignOptions;
    if (!editState) {
      return;
    }

    if (runtimeObjectRegistry.get(editState.flagId)?.kind === "placedFlags/flag") {
      deps.removeFlag(editState.flagId);
    }
    dispatchRuntimeCommand({ kind: "close-menu" });
  }

  function setEditingSignMessage(flagId: string, message: string): void {
    if (runtimeObjectRegistry.get(flagId)?.kind !== "placedFlags/flag") {
      dispatchRuntimeCommand({ kind: "close-menu" });
      return;
    }

    // The page holds the text, so the next key builds on this one before the world has answered.
    const sanitized = sanitizePlacedFlagMessage(message);
    deps.setFlagMessage(flagId, sanitized);
    dispatchRuntimeCommand({ kind: "set-editing-sign-message", message: sanitized });
  }

  function resetPlayerToHome(): void {
    const startingPosition = activeWorld().startingPosition;
    const fallbackCell = activeWorld().cells[0];
    const homePose: PlayerPose = startingPosition
      ? {
          cellId: startingPosition.cellId,
          position: startingPosition.position,
          yawRadians: startingPosition.yawRadians ?? 0,
          pitchRadians: startingPosition.pitchRadians ?? 0,
        }
      : {
          ...deps.initialPlayerPose,
          cellId: fallbackCell?.id ?? deps.initialPlayerPose.cellId,
        };
    publishLocalPlayerPose(engine, homePose);
    xrRig.reset();
  }

  function teleportPlayerHome(): void {
    closeMenusForHomeTeleport();
    resetPlayerToHome();
  }

  function closeMenusForHomeTeleport(): void {
    if (currentMenuState().isOpen || currentMenuState().selectedTool !== "none") {
      dispatchRuntimeCommand({ kind: "cancel-menu-and-tool" });
    }
  }

  function debugPlayerPose(): PlayerPoseDebugDump {
    const pose = readLocalPlayerPose(engine);
    const round = (value: number): number => Math.round(value * 1e6) / 1e6;
    return {
      cellId: pose.cellId,
      position: { x: round(pose.position.x), y: round(pose.position.y), z: round(pose.position.z) },
      yawDegrees: round((pose.yawRadians * 180) / Math.PI),
      pitchDegrees: round((pose.pitchRadians * 180) / Math.PI),
    };
  }

  function debugSetPlayerPose(cellId: string, x: number, y: number, yawDegrees: number, pitchDegrees?: number): PlayerPoseDebugDump {
    if (!activeWorld().cellsById.has(cellId)) {
      throw new Error(`no cell "${cellId}" in the active world`);
    }
    if (![x, y, yawDegrees, pitchDegrees ?? 0].every(Number.isFinite)) {
      throw new Error("setPlayerPose needs finite numbers");
    }
    const current = readLocalPlayerPose(engine);
    publishLocalPlayerPose(engine, {
      cellId,
      position: { x, y, z: 0 },
      yawRadians: (yawDegrees * Math.PI) / 180,
      pitchRadians: pitchDegrees === undefined ? current.pitchRadians : (pitchDegrees * Math.PI) / 180,
    });
    return debugPlayerPose();
  }

  function debugPlaceObjectAt(id: string, cellId: string, x: number, y: number, yawDegrees: number): boolean {
    const placed = objectHost.placeAt(id, cellId, yawRigidTransform3((yawDegrees * Math.PI) / 180, { x, y, z: 0 }));
    console.log(`placeObjectAt(${id}): ${placed}`);
    return placed;
  }

  function resetRuntimeWorld(): void {
    for (const runtime of dynamicObjectRuntimes) {
      runtime.reset(cellMeshes);
    }
    for (const owner of staticAssetOwners) {
      owner.reset();
    }
    removeGeodesicRuntimeObjects();
    // The reset's frame runs a step, which applies these.
    for (const flag of runtimeObjectRegistry.getObjectsOfKind("placedFlags/flag")) {
      const removal: PlacedFlagsRemoveCommand = { kind: "placedFlags/remove", flagId: flag.id };
      engine.submit(localParticipantId, removal);
    }
    for (const length of runtimeObjectRegistry.getObjectsOfKind("geodesicMeasurements/length")) {
      const removal: GeodesicMeasurementsRemoveLengthCommand = { kind: "geodesicMeasurements/removeLength", lengthId: length.id };
      engine.submit(localParticipantId, removal);
    }
    for (const angle of runtimeObjectRegistry.getObjectsOfKind("geodesicMeasurements/angle")) {
      const removal: GeodesicMeasurementsRemoveAngleCommand = { kind: "geodesicMeasurements/removeAngle", angleId: angle.id };
      engine.submit(localParticipantId, removal);
    }
    dispatchRuntimeCommand({ kind: "set-module-tool-state", moduleId: geodesicMeasurementsModuleId, state: undefined });
    clearProtractorToolFeedback();
  }

  function deleteMeasurement(measurementKind: "length" | "angle", measurementId: string): void {
    if (measurementKind === "length") deps.removeLength(measurementId);
    else deps.removeAngle(measurementId);
    dispatchRuntimeCommand({ kind: "close-menu" });
  }

  function tryUseFocusedObjectPrimaryInteraction(ray?: RootAimRay): boolean {
    if (!ray) {
      return false;
    }

    const target = resolveCurrentAimTarget(ray);
    if (!targetIsWithinInteractionRange(target)) {
      return false;
    }

    // An object with no main action of its own opens its menu (design 017 section 7.1: Use with the Hand reaches every menu).
    switch (target?.object?.kind) {
      case "asset":
        return tryOpenFocusedQuestionHelp(target.object) || tryOpenFocusedObjectMenu(ray);
      case "geodesicModel/segment":
        logVerboseAimClick(target);
        return extendGeodesic(target.object.geodesicId);
      default:
        return tryOpenFocusedObjectMenu(ray);
    }
  }

  function applyDesktopScenePaletteToggle(action: "open" | "right-action" | "close" | "none"): void {
    if (action === "open" && !currentMenuState().isOpen) {
      dispatchRuntimeCommand({ kind: "open-menu" });
    } else if (action === "right-action" && currentMenuState().isOpen) {
      dispatchRuntimeCommand({ kind: "menu-right-action" });
    } else if (action === "close" && currentMenuState().isOpen) {
      dispatchRuntimeCommand({ kind: "cancel-menu-and-tool" });
    }
  }

  function openContextMenuFromAim(ray?: RootAimRay, options?: { readonly objectOnly?: boolean }): "closed" | "opened" | "nothing" {
    if (currentMenuState().isOpen) {
      applyDesktopScenePaletteToggle(reduceDesktopScenePaletteToggle(true, "secondary-click"));
      return "closed";
    }

    if (tryOpenFocusedObjectMenu(ray)) {
      return "opened";
    }

    if (options?.objectOnly === true) {
      return "nothing";
    }

    dispatchRuntimeCommand({ kind: "open-menu" });
    return "opened";
  }

  // The menu page of an emitter, with its current geodesics; the active geodesic stays if it is still on the emitter. The one object page a tool can ask for: with no such emitter the page it showed is stale, so the menu closes.
  function showObjectPage(objectId: string): void {
    const object = runtimeObjectRegistry.get(objectId);
    if (object?.kind !== "geodesicEmitters/emitter") {
      dispatchRuntimeCommand({ kind: "close-menu" });
      return;
    }
    dispatchRuntimeCommand({ kind: "set-cannon-tool-state", state: {
      selectedCannonId: object.id,
      activeGeodesicId: resolveCannonGeodesicId(
        runtimeObjectRegistry,
        object,
        undefined,
        session.get().cannonToolState.activeGeodesicId,
      ),
    } });
    const geodesicIds = getEmitterGeodesicIds(runtimeObjectRegistry, object.id);
    dispatchRuntimeCommand({
      kind: "show-geodesic-cannon-actions",
      cannonId: object.id,
      geodesicIds,
      geodesicLabelsById: getGeodesicLabelsById(geodesicIds),
      connectedGeodesicIds: getConnectedGeodesicIds(geodesicIds),
      objectActions: objectActionsFor("geodesicEmitters/emitter", object.id),
    });
  }

  function tryOpenFocusedObjectMenu(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (!focused) {
      return false;
    }

    if (
      focused.object.kind === "placedFlags/flag" &&
      focused.object.interactable?.action === "edit-flag" &&
      isRuntimeToolEnabled(appConfig, "placedFlags/flag")
    ) {
      dispatchRuntimeCommand({ kind: "show-edit-sign", flagId: focused.object.id, message: focused.object.message });
      return true;
    }

    if (focused.object.kind === "geodesicEmitters/emitter" && isRuntimeToolEnabled(appConfig, "geodesicEmitters/emitter")) {
      showObjectPage(focused.object.id);
      return true;
    }

    if (focused.object.kind === "geodesicMeasurements/length" || focused.object.kind === "geodesicMeasurements/angle") {
      dispatchRuntimeCommand({
        kind: "show-measurement-actions",
        measurementId: focused.object.id,
        measurementKind: focused.object.kind === "geodesicMeasurements/length" ? "length" : "angle",
      });
      return true;
    }

    if (focused.object.kind === "asset" && focused.object.interactable?.action === "open-geometry-computer") {
      dispatchRuntimeCommand({
        kind: "show-geometry-computer-actions",
        ...createGeometryComputerMenuOptions(focused.object.id),
      });
      return true;
    }

    if (focused.object.kind === "asset" && tryOpenFocusedQuestionHelp(focused.object)) {
      return true;
    }

    return false;
  }

  function tryOpenFocusedQuestionHelp(object: RuntimeWorldObject): boolean {
    if (object.kind !== "asset" || object.interactable?.action !== "open-tutorial") {
      return false;
    }

    const tutorialPages = object.tutorialPages ?? [];
    const goalPages = object.goalPages ?? [];
    if (tutorialPages.length === 0 && goalPages.length === 0) {
      return false;
    }

    dispatchRuntimeCommand({ kind: "show-question-help", objectId: object.id, tutorialPages, goalPages });
    return true;
  }

  return {
    appendEditingSignCharacter,
    backspaceEditingSignMessage,
    deleteEditingSign,
    deleteMeasurement,
    tryUseFocusedObjectPrimaryInteraction,
    showObjectPage,
    openContextMenuFromAim,
    applyDesktopScenePaletteToggle,
    resetPlayerToHome,
    teleportPlayerHome,
    resetRuntimeWorld,
    debugPlayerPose,
    debugSetPlayerPose,
    debugPlaceObjectAt,
  };
}
