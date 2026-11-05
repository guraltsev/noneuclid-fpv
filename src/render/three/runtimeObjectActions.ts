/**
 * Actions the player performs on runtime objects through the aim: placing and editing signs, measuring a geodesic,
 * the protractor, the primary interaction and context menu of the focused object, going home, resetting the world, and the
 * debug pose helpers.
 *
 * It owns no state: menu and tool state are read from the session, the pose from the engine and changed by commands through `dispatch`;
 * the registry and the tool-object runtimes are mutated directly. Poses are cell-local meters; yaws are radians about +z
 * (the debug helpers take degrees). Ids of new objects come from the engine.
 */
import type { ObjectActionEntry } from "../../engine/moduleTypes";
import { publishLocalPlayerPose, readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { isRuntimeToolEnabled, type AppConfig } from "../../glue/appConfig";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import type { PlayerPose } from "../../movement/playerPose";
import type { AimTarget } from "../../interaction/aimTarget";
import type { ClientSession } from "../../runtime/clientSession";
import { getEmitterGeodesicIds } from "../../world-objects/geodesic/endpoints";
import type { RuntimeCommand, ShowGeometryComputerActionsPayload } from "../../runtime/runtimeCommands";
import { createMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import { placeFlagAtFloorPoint, updatePlacedFlagMessage } from "../../world-objects/placedFlags";
import {
  createProtractorAngleObject,
  protractorSelectionsUseDifferentGeodesics,
  resolveProtractorCenterSelection,
  type ProtractorCenterSelection,
} from "../../world-objects/protractorTool";
import type {
  MeasuredGeodesicLengthObject,
  PlacedFlagObject,
  ProtractorAngleObject,
  ProtractorDirectedGeodesic,
} from "../../world-objects/toolObjects";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
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
  /** The world engine: the player's pose, the object ids and the pose writes of reset and teleport. */
  readonly engine: WorldEngine;
  /** Runs a command through the shell's one command path. */
  dispatch(command: RuntimeCommand): void;
  /** Registry of runtime objects; mutated directly. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
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
  /** Extends the focused geodesic from the aim; true when something was extended. */
  tryExtendFocusedGeodesicFromAim(ray?: RootAimRay): boolean;
  /** Display name ("G1", ...) of a geodesic. */
  getGeodesicDisplayName(geodesicId: string): string;
  /** Maps geodesic ids to their display names for menus. */
  getGeodesicLabelsById(geodesicIds: readonly string[]): Readonly<Record<string, string>>;
  /** Ids among the given geodesics that are locked. */
  getLockedGeodesicIds(geodesicIds: readonly string[]): readonly string[];
  /** The actions the tools contribute to the menu page of an object (design 013 section 8.3), with their availability now. */
  objectActionsFor(objectKind: string, objectId: string): readonly ObjectActionEntry[];
  /** Menu options of the geometry computer object with this id. */
  createGeometryComputerMenuOptions(objectId: string): ShowGeometryComputerActionsPayload;
  /** Builds or refreshes the drawn copy of a sign. */
  syncPlacedFlagRuntime(flag: PlacedFlagObject): void;
  /** Drops the drawn copy of a sign. */
  removePlacedFlagRuntime(flagId: string): void;
  /** Builds or refreshes the drawn copy of a length measurement. */
  syncMeasuredGeodesicLengthRuntime(measurement: MeasuredGeodesicLengthObject): void;
  /** Drops the drawn copy of a length measurement. */
  removeMeasuredGeodesicLengthRuntime(measurementId: string): void;
  /** Builds or refreshes the drawn copy of a protractor angle. */
  syncProtractorAngleRuntime(angle: ProtractorAngleObject): void;
  /** Drops the drawn copy of a protractor angle. */
  removeProtractorAngleRuntime(angleId: string): void;
  /** Drops every drawn sign and its registry object (world reset). */
  removePlacedFlags(): void;
  /** Drops every length measurement (world reset). */
  removeMeasuredGeodesicLengths(): void;
  /** Drops every protractor angle (world reset). */
  removeProtractorAngles(): void;
  /** Drops every geodesic object and clears the cannon tool state (world reset). */
  removeGeodesicRuntimeObjects(): void;
  /** Requests a sync of the portal instances of runtime objects after registry changes; the frame performs it. */
  syncRuntimeObjectPortalInstances(): void;
  /** Requests a refresh of the selectable-hitbox debug wireframes after registry changes; the frame performs it. */
  syncSelectableHitboxDebug(): void;
  /** Re-syncs the desktop tool palette after tool or menu changes. */
  syncDesktopPalette(): void;
  /** Hides the protractor tool's feedback drawing. */
  clearProtractorToolFeedback(): void;
  /** Reads a protractor side (directed geodesic) off an aim target for the given centre. */
  resolveProtractorDirectedSelectionFromAimTarget(
    target: AimTarget | undefined,
    center: ProtractorCenterSelection,
  ): ProtractorDirectedGeodesic | undefined;
}

/** What the shell calls: the aim actions, the sign editing keys, going home and resetting, and the debug helpers. */
export interface RuntimeObjectActions {
  /** Appends a character to the sign being edited (A-Z, 0-9, space, newline; anything else is ignored). */
  appendEditingSignCharacter(character: string): void;
  /** Removes the last character of the sign being edited. */
  backspaceEditingSignMessage(): void;
  /** Deletes the sign being edited and closes the menu. */
  deleteEditingSign(): void;
  /** Places a sign where the aim ray meets the floor, when the aim target is a floor. */
  tryPlaceFlagFromAim(ray?: RootAimRay): void;
  /** Measures the aimed geodesic (replacing an earlier measurement of it). */
  tryUseMeasureLengthToolFromAim(ray?: RootAimRay): void;
  /** Takes the next protractor step (vertex, first side, second side) from the aim. */
  tryUseProtractorToolFromAim(ray?: RootAimRay): void;
  /** Primary action on the focused object (help, extend, remove a label); true when it did something. */
  tryUseFocusedObjectPrimaryInteraction(ray?: RootAimRay): boolean;
  /** Secondary action: closes an open menu, else opens the focused object's menu, else the main menu. */
  openContextMenuFromAim(ray?: RootAimRay): void;
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
    tryExtendFocusedGeodesicFromAim,
    getGeodesicDisplayName,
    getGeodesicLabelsById,
    getLockedGeodesicIds,
    objectActionsFor,
    createGeometryComputerMenuOptions,
    syncPlacedFlagRuntime,
    removePlacedFlagRuntime,
    syncMeasuredGeodesicLengthRuntime,
    removeMeasuredGeodesicLengthRuntime,
    syncProtractorAngleRuntime,
    removeProtractorAngleRuntime,
    removePlacedFlags,
    removeMeasuredGeodesicLengths,
    removeProtractorAngles,
    removeGeodesicRuntimeObjects,
    syncDesktopPalette,
    clearProtractorToolFeedback,
    resolveProtractorDirectedSelectionFromAimTarget,
  } = deps;
  const dispatchRuntimeCommand = deps.dispatch;
  const requestRuntimeObjectInstanceSync = deps.syncRuntimeObjectPortalInstances;
  const requestSelectableHitboxDebugSync = deps.syncSelectableHitboxDebug;
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

    const flag = runtimeObjectRegistry.get(editState.flagId);
    if (flag?.kind === "placed-flag") {
      runtimeObjectRegistry.remove(editState.flagId);
      removePlacedFlagRuntime(editState.flagId);
      requestRuntimeObjectInstanceSync();
    }
    dispatchRuntimeCommand({ kind: "close-menu" });
  }

  function setEditingSignMessage(flagId: string, message: string): void {
    const flag = runtimeObjectRegistry.get(flagId);
    if (flag?.kind !== "placed-flag") {
      dispatchRuntimeCommand({ kind: "close-menu" });
      return;
    }

    const nextFlag = updatePlacedFlagMessage(flag, message);
    runtimeObjectRegistry.update(nextFlag);
    syncPlacedFlagRuntime(nextFlag);
    dispatchRuntimeCommand({ kind: "set-editing-sign-message", message: nextFlag.message });
  }

  function tryPlaceFlagFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    if (target?.kind !== "floor") {
      return;
    }

    const result = placeFlagAtFloorPoint({
      world: activeWorld(),
      registry: runtimeObjectRegistry,
      cellId: target.cellId,
      eyePosition: target.localEyePosition,
      floorPoint: target.localPoint,
      flagType: currentMenuState().placeFlagOptions.flagType,
      id: engine.ids.next("placed-flag"),
    });

    if (result.placed && result.object) {
      syncPlacedFlagRuntime(result.object);
      dispatchRuntimeCommand({ kind: "clear-selected-tool" });
      requestSelectableHitboxDebugSync();
    }
  }

  function tryUseMeasureLengthToolFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    logVerboseAimClick(target);
    if (!targetIsWithinInteractionRange(target) || target?.object?.kind !== "geodesicModel/segment") {
      return;
    }

    const geodesicId = target.object.geodesicId;
    const existing = runtimeObjectRegistry.getAll().find((object) =>
      object.kind === "geodesicMeasurements/length" && object.geodesicId === geodesicId
    );
    const measurement = createMeasuredGeodesicLengthObject({
      id: existing?.id ?? engine.ids.next("measured-geodesic-length"),
      registry: runtimeObjectRegistry,
      world: activeWorld(),
      geodesicId,
      playerCellId: readLocalPlayerPose(engine).cellId,
      playerPoint: readLocalPlayerPose(engine).position,
      label: getGeodesicDisplayName(geodesicId),
      fallbackSegment: target.object,
    });
    if (!measurement) {
      return;
    }

    if (existing) {
      runtimeObjectRegistry.update(measurement);
    } else {
      runtimeObjectRegistry.add(measurement);
    }
    syncMeasuredGeodesicLengthRuntime(measurement);
    dispatchRuntimeCommand({ kind: "clear-selected-tool" });
    requestSelectableHitboxDebugSync();
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
    removePlacedFlags();
    removeGeodesicRuntimeObjects();
    removeMeasuredGeodesicLengths();
    removeProtractorAngles();
  }

  function tryUseProtractorToolFromAim(ray?: RootAimRay): void {
    const protractor = session.get().protractorToolState;
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    logVerboseAimClick(target);
    if (!targetIsWithinInteractionRange(target)) {
      return;
    }

    if (!protractor.center) {
      if (target?.object?.kind !== "geodesic-cannon" && target?.object?.kind !== "geodesicModel/crossing") {
        return;
      }

      dispatchRuntimeCommand({ kind: "set-protractor-tool-state", state: {
        center: resolveProtractorCenterSelection(runtimeObjectRegistry, target.object),
      } });
      syncDesktopPalette();
      return;
    }

    const selected = resolveProtractorDirectedSelectionFromAimTarget(target, protractor.center);
    if (!selected) {
      return;
    }

    if (!protractor.first) {
      dispatchRuntimeCommand({ kind: "set-protractor-tool-state", state: {
        center: protractor.center,
        first: selected,
      } });
      syncDesktopPalette();
      return;
    }

    if (!protractorSelectionsUseDifferentGeodesics(protractor.first, selected)) {
      return;
    }

    const angle = createProtractorAngleObject({
      id: engine.ids.next("protractor-angle"),
      center: protractor.center,
      first: protractor.first,
      second: selected,
    });
    runtimeObjectRegistry.add(angle);
    syncProtractorAngleRuntime(angle);
    dispatchRuntimeCommand({ kind: "set-protractor-tool-state", state: {} });
    clearProtractorToolFeedback();
    dispatchRuntimeCommand({ kind: "clear-selected-tool" });
    requestSelectableHitboxDebugSync();
  }

  function tryRemoveFocusedProtractorAngle(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (focused?.object.kind !== "geodesicMeasurements/angle") {
      return false;
    }

    runtimeObjectRegistry.remove(focused.object.id);
    removeProtractorAngleRuntime(focused.object.id);
    requestRuntimeObjectInstanceSync();
    requestSelectableHitboxDebugSync();
    return true;
  }

  function tryRemoveFocusedMeasuredGeodesicLength(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (focused?.object.kind !== "geodesicMeasurements/length") {
      return false;
    }

    runtimeObjectRegistry.remove(focused.object.id);
    removeMeasuredGeodesicLengthRuntime(focused.object.id);
    requestRuntimeObjectInstanceSync();
    requestSelectableHitboxDebugSync();
    return true;
  }

  function tryUseFocusedObjectPrimaryInteraction(ray?: RootAimRay): boolean {
    if (!ray) {
      return false;
    }

    const target = resolveCurrentAimTarget(ray);
    if (!targetIsWithinInteractionRange(target)) {
      return false;
    }

    switch (target?.object?.kind) {
      case "asset":
        return tryOpenFocusedQuestionHelp(target.object);
      case "geodesicModel/segment":
        return tryExtendFocusedGeodesicFromAim(ray);
      case "geodesicMeasurements/length":
        return tryRemoveFocusedMeasuredGeodesicLength(ray);
      case "geodesicMeasurements/angle":
        return tryRemoveFocusedProtractorAngle(ray);
      default:
        return false;
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

  function openContextMenuFromAim(ray?: RootAimRay): void {
    if (currentMenuState().isOpen) {
      applyDesktopScenePaletteToggle(reduceDesktopScenePaletteToggle(true, "secondary-click"));
      return;
    }

    if (tryOpenFocusedObjectMenu(ray)) {
      return;
    }

    dispatchRuntimeCommand({ kind: "open-menu" });
  }

  function tryOpenFocusedObjectMenu(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (!focused) {
      return false;
    }

    if (
      focused.object.kind === "placed-flag" &&
      focused.object.interactable?.action === "edit-flag" &&
      isRuntimeToolEnabled(appConfig, "place-flag")
    ) {
      dispatchRuntimeCommand({ kind: "show-edit-sign", flagId: focused.object.id, message: focused.object.message });
      return true;
    }

    if (focused.object.kind === "geodesic-cannon" && isRuntimeToolEnabled(appConfig, "geodesic-cannon")) {
      dispatchRuntimeCommand({ kind: "set-cannon-tool-state", state: {
        selectedCannonId: focused.object.id,
        activeGeodesicId: resolveCannonGeodesicId(
          runtimeObjectRegistry,
          focused.object,
          undefined,
          session.get().cannonToolState.activeGeodesicId,
        ),
      } });
      const geodesicIds = getEmitterGeodesicIds(runtimeObjectRegistry, focused.object.id);
      dispatchRuntimeCommand({
        kind: "show-geodesic-cannon-actions",
        cannonId: focused.object.id,
        geodesicIds,
        geodesicLabelsById: getGeodesicLabelsById(geodesicIds),
        lockedGeodesicIds: getLockedGeodesicIds(geodesicIds),
        objectActions: objectActionsFor("geodesic-cannon", focused.object.id),
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
    tryPlaceFlagFromAim,
    tryUseMeasureLengthToolFromAim,
    tryUseProtractorToolFromAim,
    tryUseFocusedObjectPrimaryInteraction,
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
