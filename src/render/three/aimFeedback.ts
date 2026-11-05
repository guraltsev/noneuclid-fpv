/**
 * Per-frame feedback on what the player aims at: the floating object tooltip, the help lens, the aim cross marker with the
 * XR controller ray, and the protractor tool's preview drawing.
 *
 * The module owns the controller ray line (added to `scene`), the protractor feedback group (parented into a cell root),
 * the id of the object whose help the player pinned and whether the player pinned the selected tool's help. Menu, tool and protractor selection state are read from the session.
 * The tooltip, cross marker and help lens handles are created and disposed by the shell. Everything is hidden while a menu is open.
 */
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import * as THREE from "three";
import type { AimTarget } from "../../interaction/aimTarget";
import type { ClientSession } from "../../runtime/clientSession";
import type { ToolsById } from "../../runtime/toolRegistry";
import { createHelpLensDefinition } from "../../ui/helpLensDefinition";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import {
  protractorSelectionsUseDifferentGeodesics,
  resolveProtractorCenterSelection,
  resolveProtractorDirectedGeodesicSelection,
  resolveProtractorEmitterGeodesicSelection,
  type ProtractorCenterSelection,
} from "../../world-objects/protractorTool";
import type { ProtractorDirectedGeodesic } from "../../world-objects/toolObjects";
import type { FloatingObjectTooltip } from "../dom/floatingObjectTooltip";
import type { AimCrossMarker } from "./aimCrossMarker";
import type { HelpLensRenderer } from "./helpLensRenderer";
import { createProtractorToolFeedback, protractorToolFeedbackSignature } from "./protractorToolFeedback";
import type { XrHeadWorldPose } from "./carriedGeodesicCannon";
import type { FocusedRuntimeObject, RootAimRay } from "./rootAimRay";
import { disposeObject3D } from "./runtimeSceneUtils";

/** Dependencies of the aim feedback, supplied by createThreeApp's shell. */
export interface AimFeedbackDeps {
  /** Scene that receives the controller ray line. */
  readonly scene: THREE.Scene;
  /** Main camera; the help lens panel is placed from it. */
  readonly camera: THREE.Camera;
  /** The shell session; menu, tool and protractor state are read from it. */
  readonly session: ClientSession;
  /** The shell's tool lookup (read at use, so the shell may build it after this module); the aim cross and the help lens follow the selected tool's descriptor. */
  readonly toolsById: () => ToolsById;
  /** The world engine; the player's pose is read from it. */
  readonly engine: WorldEngine;
  /** Registry of runtime objects; read to find the nearest auto-help object and to read emitters. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Cell root groups; the protractor drawing is parented into the root of its cell. */
  readonly cellMeshes: ReadonlyMap<string, THREE.Object3D>;
  /** DOM tooltip for the desktop view. */
  readonly floatingObjectTooltip: FloatingObjectTooltip;
  /** Cross drawn at the aim target. */
  readonly aimCrossMarker: AimCrossMarker;
  /** Help panel (DOM on the desktop, a texture panel in XR). */
  readonly helpLensRenderer: HelpLensRenderer;
  /** Shows the XR tooltip for a label at an anchor, or hides it when passed `undefined`. */
  updateXrObjectTooltip(options: {
    readonly text: string;
    readonly anchor: { readonly x: number; readonly y: number; readonly z: number };
    readonly headWorldPosition?: THREE.Vector3;
  } | undefined): void;
  /** Resolves the single best aim target for a ray. */
  resolveCurrentAimTarget(ray: RootAimRay): AimTarget | undefined;
  /** True when the target is close enough to interact with. */
  targetIsWithinInteractionRange(target: AimTarget | undefined): boolean;
  /** Finds the interactable runtime object under the (optional) ray. */
  findFocusedRuntimeObject(ray?: RootAimRay): FocusedRuntimeObject | undefined;
  /** Viewport pixel where the desktop tooltip is anchored. */
  resolveDesktopTooltipScreenPosition(): { readonly x: number; readonly y: number };
  /** Tooltip text of an object for the input mode, if it has one. */
  getRuntimeObjectTooltipText(object: RuntimeWorldObject, inputMode: "desktop" | "xr"): string | undefined;
  /** Focus message of an object, from which its help is built. */
  getWorldFocusMessageDefinition(object: RuntimeWorldObject): Parameters<typeof createHelpLensDefinition>[0]["focus"] | undefined;
  /** Display name ("G1", ...) of a geodesic. */
  getGeodesicDisplayName(geodesicId: string): string;
}

/** Handle to the aim feedback created by {@link createAimFeedback}. */
export interface AimFeedback {
  /** Updates the floating tooltip (desktop or XR) and the help lens; both are hidden while a menu is open. */
  updateTooltips(xrActive: boolean, activeAimRay: RootAimRay | undefined, xrHeadWorldPose: XrHeadWorldPose | undefined): void;
  /** Updates the aim cross, the XR controller ray and the protractor drawing. */
  updateAim(xrActive: boolean, activeAimRay: RootAimRay | undefined): void;
  /** Pins the help of the focused object, or with nothing focused the help of the selected tool (the explore text with no tool); unpins a help that is already pinned. */
  requestHelpLensForFocusedObject(activeAimRay: RootAimRay | undefined): void;
  /** Unpins the pinned help; true when there was one. */
  dismissHelpLensFocus(): boolean;
  /** Hides the protractor tool's drawing. */
  clearProtractorToolFeedback(): void;
  /** Reads a protractor side (directed geodesic) off an aim target for the given centre. */
  resolveProtractorDirectedSelectionFromAimTarget(
    target: AimTarget | undefined,
    center: ProtractorCenterSelection,
  ): ProtractorDirectedGeodesic | undefined;
  /** Removes the controller ray and the protractor drawing and frees them. */
  dispose(): void;
}

/** Creates the aim feedback and adds its controller ray (hidden) to the scene. */
export function createAimFeedback(deps: AimFeedbackDeps): AimFeedback {
  const { scene, camera, session, engine, runtimeObjectRegistry, cellMeshes, floatingObjectTooltip, aimCrossMarker, helpLensRenderer } = deps;

  const aimControllerRayPositions = new Float32Array(6);
  const aimControllerRayGeometry = new THREE.BufferGeometry();
  aimControllerRayGeometry.setAttribute("position", new THREE.BufferAttribute(aimControllerRayPositions, 3));
  const aimControllerRayMaterial = new THREE.LineBasicMaterial({
    color: 0xef1b1b,
    transparent: true,
    opacity: 0.74,
    depthTest: false,
    depthWrite: false,
  });
  const aimControllerRay = new THREE.Line(aimControllerRayGeometry, aimControllerRayMaterial);
  aimControllerRay.name = "aim-controller-ray";
  aimControllerRay.renderOrder = 49;
  aimControllerRay.frustumCulled = false;
  aimControllerRay.visible = false;
  scene.add(aimControllerRay);

  let protractorToolFeedback: {
    readonly signature: string;
    readonly cellId: string;
    readonly root: THREE.Group;
  } | undefined;
  let helpLensFocusedObjectId: string | undefined;
  let toolHelpPinned = false;

  function currentMenuState() {
    return session.get().menuState;
  }

  function updateTooltips(
    xrActive: boolean,
    activeAimRay: RootAimRay | undefined,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
  ): void {
    updateFloatingObjectTooltip(xrActive, activeAimRay, xrHeadWorldPose);
    updateHelpLens(xrActive, activeAimRay);
  }

  function updateAim(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    updateAimCrossMarker(xrActive, activeAimRay);
    updateProtractorToolFeedback(activeAimRay);
  }

  function updateFloatingObjectTooltip(
    xrActive: boolean,
    activeAimRay: RootAimRay | undefined,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
  ): void {
    if (currentMenuState().isOpen) {
      floatingObjectTooltip.update({ visible: false });
      deps.updateXrObjectTooltip(undefined);
      return;
    }

    const focused = deps.findFocusedRuntimeObject(activeAimRay);
    const text = focused ? deps.getRuntimeObjectTooltipText(focused.object, xrActive ? "xr" : "desktop") : undefined;
    if (xrActive) {
      floatingObjectTooltip.update({ visible: false });
      deps.updateXrObjectTooltip(text && focused ? {
        text,
        anchor: focused.tooltipAnchor,
        headWorldPosition: xrHeadWorldPose?.position,
      } : undefined);
      return;
    }

    deps.updateXrObjectTooltip(undefined);
    const screenPosition = focused ? deps.resolveDesktopTooltipScreenPosition() : undefined;

    floatingObjectTooltip.update({
      visible: Boolean(text && screenPosition),
      text,
      xPixels: screenPosition?.x,
      yPixels: screenPosition?.y,
    });
  }

  function updateAimCrossMarker(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    // "none" and "aim" have no descriptor and show the cross.
    const selectedTool = deps.toolsById().get(currentMenuState().selectedTool);
    if ((selectedTool !== undefined && !selectedTool.showsAimCross) || currentMenuState().isOpen) {
      aimCrossMarker.update(undefined);
      updateAimControllerRay(false);
      return;
    }

    const target = activeAimRay ? deps.resolveCurrentAimTarget(activeAimRay) : undefined;
    aimCrossMarker.update(target, activeAimRay);
    updateAimControllerRay(xrActive && Boolean(target), activeAimRay, aimCrossMarker.root.position);
  }

  function updateAimControllerRay(
    visible: boolean,
    activeAimRay?: RootAimRay,
    targetPosition?: THREE.Vector3,
  ): void {
    if (!visible || !activeAimRay || !targetPosition) {
      aimControllerRay.visible = false;
      return;
    }

    aimControllerRayPositions[0] = activeAimRay.origin.x;
    aimControllerRayPositions[1] = activeAimRay.origin.y;
    aimControllerRayPositions[2] = activeAimRay.origin.z;
    aimControllerRayPositions[3] = targetPosition.x;
    aimControllerRayPositions[4] = targetPosition.y;
    aimControllerRayPositions[5] = targetPosition.z;
    aimControllerRayGeometry.attributes.position.needsUpdate = true;
    aimControllerRay.visible = true;
  }

  function updateProtractorToolFeedback(activeAimRay: RootAimRay | undefined): void {
    const protractor = session.get().protractorToolState;
    if (currentMenuState().selectedTool !== "protractor" || currentMenuState().isOpen) {
      clearProtractorToolFeedback();
      return;
    }

    const target = activeAimRay ? deps.resolveCurrentAimTarget(activeAimRay) : undefined;
    const usableTarget = deps.targetIsWithinInteractionRange(target) ? target : undefined;
    const center = protractor.center ??
      (usableTarget?.object?.kind === "geodesic-cannon" || usableTarget?.object?.kind === "geodesicModel/crossing"
        ? resolveProtractorCenterSelection(runtimeObjectRegistry, usableTarget.object)
        : undefined);
    if (!center) {
      clearProtractorToolFeedback();
      return;
    }

    const hoverSelection = protractor.center
      ? resolveProtractorDirectedSelectionFromAimTarget(usableTarget, protractor.center)
      : undefined;
    const validHoverSelection = hoverSelection && protractor.first &&
        !protractorSelectionsUseDifferentGeodesics(protractor.first, hoverSelection)
      ? undefined
      : hoverSelection;
    const feedbackOptions = {
      center,
      centerLocked: Boolean(protractor.center),
      first: protractor.first,
      hover: validHoverSelection,
    };
    if (protractorToolFeedback?.signature === protractorToolFeedbackSignature(feedbackOptions)) {
      return;
    }
    const feedback = createProtractorToolFeedback(feedbackOptions);
    if (!feedback) {
      clearProtractorToolFeedback();
      return;
    }

    syncProtractorToolFeedback(feedback);
  }

  function resolveProtractorDirectedSelectionFromAimTarget(
    target: AimTarget | undefined,
    center: ProtractorCenterSelection,
  ): ProtractorDirectedGeodesic | undefined {
    if (target?.object?.kind === "geodesicModel/segment") {
      const selected = resolveProtractorDirectedGeodesicSelection({
        center,
        segment: target.object,
        hitPoint: target.localPoint,
      });
      return selected ? withProtractorGeodesicLabel(selected) : undefined;
    }

    if (target?.object?.kind === "geodesic-cannon") {
      const selected = resolveProtractorEmitterGeodesicSelection({
        center,
        emitter: target.object,
        registry: runtimeObjectRegistry,
        geodesicId: target.geodesicEmitterGeodesicId,
      });
      return selected ? withProtractorGeodesicLabel(selected) : undefined;
    }

    return undefined;
  }

  function withProtractorGeodesicLabel(selection: ProtractorDirectedGeodesic): ProtractorDirectedGeodesic {
    return {
      ...selection,
      label: deps.getGeodesicDisplayName(selection.geodesicId),
    };
  }

  function syncProtractorToolFeedback(feedback: {
    readonly signature: string;
    readonly cellId: string;
    readonly root: THREE.Group;
  }): void {
    clearProtractorToolFeedback();
    const cellRoot = cellMeshes.get(feedback.cellId);
    if (!cellRoot) {
      disposeObject3D(feedback.root);
      return;
    }

    cellRoot.add(feedback.root);
    protractorToolFeedback = feedback;
  }

  function clearProtractorToolFeedback(): void {
    if (!protractorToolFeedback) {
      return;
    }

    protractorToolFeedback.root.removeFromParent();
    disposeObject3D(protractorToolFeedback.root);
    protractorToolFeedback = undefined;
  }

  function updateHelpLens(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    if (currentMenuState().isOpen) {
      helpLensRenderer.update({ visible: false, xrActive, camera });
      return;
    }

    const focused = deps.findFocusedRuntimeObject(activeAimRay);
    if (helpLensFocusedObjectId) {
      if (focused?.object.id !== helpLensFocusedObjectId) {
        helpLensFocusedObjectId = undefined;
      } else {
        const definition = createHelpDefinitionForObject(focused.object, xrActive);
        helpLensRenderer.update({ visible: definition !== undefined, xrActive, camera, definition });
        return;
      }
    }

    // The tool's help stays pinned until the aim finds an object, as an object's stays until the aim leaves it.
    toolHelpPinned &&= focused === undefined;
    if (toolHelpPinned) {
      helpLensRenderer.update({ visible: true, xrActive, camera, definition: createHelpDefinition(undefined, xrActive) });
      return;
    }

    const automaticObject = findAutomaticHelpObject();
    const definition = automaticObject ? createHelpDefinitionForObject(automaticObject, xrActive) : undefined;
    helpLensRenderer.update({
      visible: definition !== undefined,
      xrActive,
      camera,
      definition,
    });
  }

  function requestHelpLensForFocusedObject(activeAimRay: RootAimRay | undefined): void {
    const focused = deps.findFocusedRuntimeObject(activeAimRay);
    const focusedObjectId = focused?.object.id;
    toolHelpPinned = focusedObjectId === undefined && !toolHelpPinned;
    helpLensFocusedObjectId = focusedObjectId === helpLensFocusedObjectId ? undefined : focusedObjectId;
  }

  function dismissHelpLensFocus(): boolean {
    if (!helpLensFocusedObjectId && !toolHelpPinned) {
      return false;
    }
    helpLensFocusedObjectId = undefined;
    toolHelpPinned = false;
    return true;
  }

  function createHelpDefinitionForObject(
    object: RuntimeWorldObject,
    xrActive: boolean,
  ): ReturnType<typeof createHelpLensDefinition> | undefined {
    const focus = deps.getWorldFocusMessageDefinition(object);
    return focus ? createHelpDefinition(focus, xrActive) : undefined;
  }

  function createHelpDefinition(
    focus: Parameters<typeof createHelpLensDefinition>[0]["focus"],
    xrActive: boolean,
  ): ReturnType<typeof createHelpLensDefinition> {
    return createHelpLensDefinition({
      focus,
      selectedTool: currentMenuState().selectedTool,
      inputMode: xrActive ? "xr" : "desktop",
      toolsById: deps.toolsById(),
    });
  }

  function findAutomaticHelpObject(): RuntimeWorldObject | undefined {
    let best: { readonly object: RuntimeWorldObject; readonly distanceSquared: number } | undefined;
    for (const object of runtimeObjectRegistry.getObjectsInCell(readLocalPlayerPose(engine).cellId)) {
      const rangeMeters = object.autoDisplayHelpRangeMeters;
      if (!object.displayHelpMessage || rangeMeters === undefined) {
        continue;
      }

      const dx = object.localPose.translation.x - readLocalPlayerPose(engine).position.x;
      const dy = object.localPose.translation.y - readLocalPlayerPose(engine).position.y;
      const dz = object.localPose.translation.z - readLocalPlayerPose(engine).position.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared > rangeMeters * rangeMeters) {
        continue;
      }

      if (!best || distanceSquared < best.distanceSquared) {
        best = { object, distanceSquared };
      }
    }

    return best?.object;
  }

  return {
    updateTooltips,
    updateAim,
    requestHelpLensForFocusedObject,
    dismissHelpLensFocus,
    clearProtractorToolFeedback,
    resolveProtractorDirectedSelectionFromAimTarget,
    dispose() {
      clearProtractorToolFeedback();
      aimControllerRay.removeFromParent();
      aimControllerRayGeometry.dispose();
      aimControllerRayMaterial.dispose();
    },
  };
}
