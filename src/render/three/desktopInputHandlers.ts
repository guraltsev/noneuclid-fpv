/**
 * Desktop and XR input of the shell: the desktop event handlers (context menu, right click, Escape and Tab keys, the wheel that switches tools), the
 * per-frame input frames, and the per-frame feed of the scene palette from XR controllers or the desktop pointer.
 *
 * The module owns the previous desktop palette placement (so the palette follows the camera smoothly) and the palette definition
 * cache. Menu state is read from the session. The shell adds and removes the DOM listeners, so dispose stays symmetric there; the
 * handlers here only react to an event. The palette, controls and hand-model handles are created and disposed by the shell.
 */
import * as THREE from "three";
import type { RuntimeInputFrame } from "../../interaction/inputFrame";
import type { AppConfig } from "../../glue/appConfig";
import type { ClientSession } from "../../runtime/clientSession";
import type { ToolsById } from "../../runtime/toolRegistry";
import { createPaletteDefinitionCache } from "../../ui/paletteDefinition";
import type { XrHeadWorldPose } from "./carriedGeodesicCannon";
import type { DesktopControls } from "./desktopControls";
import { reduceDesktopScenePaletteToggle, type DesktopScenePaletteInput } from "./desktopScenePaletteInput";
import { resolveDesktopScenePalettePlacement } from "./desktopScenePalettePlacement";
import type { RootAimRay } from "./rootAimRay";
import type { ScenePaletteController } from "./scenePaletteController";
import { resolveVrPalettePlacement } from "./vrPalettePlacement";
import type { Toast } from "../../ui/toastQueue";
import { toolBeltText } from "../../ui/vocabulary";
import type { XrControllerHandModels } from "./xrControllerHandModels";
import type { XrControls } from "./xrControls";
import type { XrScenePaletteInput } from "./xrScenePaletteInput";
import type { XrHandUi } from "./xrHandUi";
import type { ToolBeltDefinition } from "../../ui/toolBeltDefinition";

// One mouse wheel notch is 100 pixels; a step needs 40, and steps are at least this far apart so a trackpad's flick takes one tool.
const wheelStepPixels = 40;
const wheelStepIntervalMs = 120;

/** Dependencies of {@link createDesktopInputHandlers}. */
export interface DesktopInputHandlersDeps {
  readonly session: ClientSession;
  /** Builds the palette definition cache; the cache is owned by the handlers. */
  readonly appConfig: AppConfig;
  /** The shell's tool lookup; the wrist indicator shows the selected tool's descriptor. */
  readonly toolsById: ToolsById;
  readonly camera: THREE.PerspectiveCamera;
  /** The parts of the renderer the handlers read: its canvas and the XR state. */
  readonly renderer: {
    readonly domElement: object;
    readonly xr: {
      readonly isPresenting: boolean;
      getSession(): { readonly inputSources: Iterable<XRInputSource> } | null;
    };
  };
  readonly xrRig: { readonly root: { readonly matrixWorld: THREE.Matrix4 } };
  readonly controls: Pick<DesktopControls, "setLookMode" | "consumeFrame" | "isPointerLocked">;
  readonly xrControls: Pick<XrControls, "consumeFrame">;
  readonly scenePaletteController: Pick<ScenePaletteController, "update">;
  readonly desktopScenePaletteInput: Pick<DesktopScenePaletteInput, "update">;
  readonly xrScenePaletteInput: Pick<XrScenePaletteInput, "update">;
  readonly xrControllerHandModels: Pick<XrControllerHandModels, "update">;
  /** The toasts on screen now; the VR panel draws them. */
  visibleToasts?(): readonly Toast[];
  /** The VR hand UI: roles, the belt strap, the start card and where the toasts stand. */
  readonly xrHandUi: Pick<XrHandUi, "update">;
  /** The tool belt as it is now (for the VR strap). */
  beltDefinition(): ToolBeltDefinition;
  /** The aim ray of the desktop crosshair. */
  resolveActiveRootAimRay(xrActive: boolean): RootAimRay | undefined;
  /** Moves the focus to the next aim target under the ray; true when it moved. */
  cycleFocusedAimTarget(ray: RootAimRay | undefined): boolean;
  /** Opens the menu of the focused object, or applies the secondary click to an open menu; "nothing" when the aim has no menu to open. */
  openContextMenuFromAim(ray?: RootAimRay, options?: { readonly objectOnly?: boolean }): "closed" | "opened" | "nothing" | void;
  /** Shows a short message in front of the player (a toast). */
  showNotice(text: string): void;
  /** Takes the next (+1) or previous (-1) tool from the belt: the Hand and the enabled tools, wrapping around. */
  stepTool(direction: 1 | -1): void;
  /** Applies a desktop palette toggle (open, close, right action) to the menu. */
  applyDesktopScenePaletteToggle(action: "open" | "right-action" | "close" | "none"): void;
  /** Unpins the pinned help; true when there was one. */
  dismissHelpLensFocus(): boolean;
}

/** Handle to the input handlers created by {@link createDesktopInputHandlers}. */
export interface DesktopInputHandlers {
  /** Blocks the browser context menu on the canvas. */
  onDesktopContextMenu(event: MouseEvent): void;
  /** Right click on the canvas (or while the pointer is locked) opens the menu of the aimed object, closes an open menu, and says so when nothing is aimed. */
  onDesktopMouseDown(event: MouseEvent): void;
  /** Escape toggles the menu or dismisses a pinned help; Tab cycles the focused aim target. */
  onDesktopPaletteKeyDown(event: KeyboardEvent): void;
  /** The wheel takes the next or previous tool from the belt while no menu is open; cycling targets is Tab only. */
  onDesktopWheel(event: WheelEvent): void;
  /** Consumes accumulated keyboard and mouse input; the palette look mode is used while the menu is open. */
  getDesktopInputFrame(deltaSeconds: number): RuntimeInputFrame;
  /** Consumes controller input from the active session's input sources; an all-zero frame without a session. */
  getXrInputFrame(deltaSeconds: number): RuntimeInputFrame;
  /** Feeds the scene palette from XR controllers or the desktop pointer and places it; in XR also updates the hand models. */
  updateScenePalette(
    xrActive: boolean,
    xrFrame: XRFrame | undefined,
    xrReferenceSpace: XRReferenceSpace | null,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
    deltaSeconds: number,
    frame: RuntimeInputFrame,
  ): void;
}

/** Creates the desktop event handlers, the input-frame readers and the palette feed. */
export function createDesktopInputHandlers(deps: DesktopInputHandlersDeps): DesktopInputHandlers {
  const {
    session,
    camera,
    renderer,
    xrRig,
    controls,
    xrControls,
    scenePaletteController,
    desktopScenePaletteInput,
    xrScenePaletteInput,
    xrControllerHandModels,
    resolveActiveRootAimRay,
    cycleFocusedAimTarget,
    openContextMenuFromAim,
    applyDesktopScenePaletteToggle,
    dismissHelpLensFocus,
  } = deps;
  // The wheel: pixels accumulated toward the next step, and when the last step happened (a trackpad sends many small events).
  let wheelAccumulator = 0;
  let lastWheelStepMs = Number.NEGATIVE_INFINITY;
  const currentMenuState = () => session.get().menuState;
  const paletteDefinitionCache = createPaletteDefinitionCache(deps.appConfig);
  // Desktop fallbacks of updateScenePalette's head pose; overwritten before each use.
  const paletteHeadPositionScratch = new THREE.Vector3();
  const paletteHeadQuaternionScratch = new THREE.Quaternion();
  let previousDesktopPalettePlacement: ReturnType<typeof resolveDesktopScenePalettePlacement> | undefined;

  function paletteDefinitionFrame(inputMode: "xr" | "desktop") {
    const cached = paletteDefinitionCache.get(currentMenuState(), inputMode);
    return { definition: cached.definition, definitionVersion: cached.version };
  }

  function updateScenePalette(
    xrActive: boolean,
    xrFrame: XRFrame | undefined,
    xrReferenceSpace: XRReferenceSpace | null,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
    deltaSeconds: number,
    frame: RuntimeInputFrame,
  ): void {
    if (xrActive && xrFrame && xrReferenceSpace) {
      const poseFrame: XRFrame = xrFrame;
      const poseSpace: XRReferenceSpace = xrReferenceSpace;
      const inputSources = [...(renderer.xr.getSession()?.inputSources ?? [])];
      const headPosition = xrHeadWorldPose?.position ?? camera.getWorldPosition(paletteHeadPositionScratch);
      const headQuaternion = xrHeadWorldPose?.quaternion ?? camera.getWorldQuaternion(paletteHeadQuaternionScratch);
      // Hand roles: the belt, the start card and the toast panel follow the layout; only the pointer hand points at the palette.
      const handUi = deps.xrHandUi.update({
        inputSources,
        getPose: (space) => poseFrame.getPose(space, poseSpace) ?? undefined,
        referenceSpaceToWorldMatrix: xrRig.root.matrixWorld,
        head: { position: headPosition, quaternion: headQuaternion },
        definition: deps.beltDefinition(),
        menuOpen: currentMenuState().isOpen,
      });

      const placement = resolveVrPalettePlacement({
        head: {
          position: headPosition,
          quaternion: headQuaternion,
        },
      });
      scenePaletteController.update({
        input: xrScenePaletteInput.update({
          deltaSeconds,
          xrFrame,
          referenceSpace: xrReferenceSpace,
          referenceSpaceToWorldMatrix: xrRig.root.matrixWorld,
          inputSources: handUi.paletteSources as readonly XRInputSource[],
        }),
        ...paletteDefinitionFrame("xr"),
        placement,
      });
      xrControllerHandModels.update({
        inputSources,
        xrFrame,
        referenceSpace: xrReferenceSpace,
        referenceSpaceToWorldMatrix: xrRig.root.matrixWorld,
        tool: deps.toolsById.get(currentMenuState().selectedTool),
        placeFlagType: currentMenuState().placeFlagOptions.flagType,
        toasts: deps.visibleToasts?.(),
        toastAnchor: handUi.toastAnchor,
        pointerHandedness: handUi.pointerHandedness,
      });
      return;
    }

    const placement = resolveDesktopScenePalettePlacement({
      camera,
      previousPlacement: previousDesktopPalettePlacement,
    });
    previousDesktopPalettePlacement = placement;
    scenePaletteController.update({
      input: desktopScenePaletteInput.update({
        desktopFrame: {
          ...frame,
          palettePointerDeltaPixels: frame.palettePointerDeltaPixels ?? { x: 0, y: 0 },
          paletteSelectPressed: frame.paletteSelectPressed ?? false,
          paletteSelectRequested: frame.paletteSelectRequested ?? false,
        },
        deltaSeconds,
        camera,
        isOpen: currentMenuState().isOpen,
        placement,
      }),
      ...paletteDefinitionFrame("desktop"),
      placement,
    });
  }

  function onDesktopContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function onDesktopMouseDown(event: MouseEvent): void {
    if (event.button !== 2 || renderer.xr.isPresenting) {
      return;
    }

    if (event.target !== renderer.domElement && !controls.isPointerLocked()) {
      return;
    }

    event.preventDefault();
    if (openContextMenuFromAim(resolveActiveRootAimRay(false), { objectOnly: true }) === "nothing") {
      deps.showNotice(toolBeltText.aimToOpenMenu);
    }
  }

  function onDesktopPaletteKeyDown(event: KeyboardEvent): void {
    if (renderer.xr.isPresenting) {
      return;
    }

    if (event.code === "Escape") {
      const action = reduceDesktopScenePaletteToggle(currentMenuState().isOpen, "escape-key");
      if (action !== "none") {
        event.preventDefault();
        applyDesktopScenePaletteToggle(action);
      } else if (dismissHelpLensFocus()) {
        event.preventDefault();
      }
      return;
    }

    if (event.code === "Tab" && !currentMenuState().isOpen) {
      if (cycleFocusedAimTarget(resolveActiveRootAimRay(false))) {
        event.preventDefault();
      }
    }
  }

  function onDesktopWheel(event: WheelEvent): void {
    if (renderer.xr.isPresenting || currentMenuState().isOpen) {
      return;
    }

    if (event.target !== renderer.domElement && !controls.isPointerLocked()) {
      return;
    }

    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    if (pixels === 0 || Math.sign(pixels) !== Math.sign(wheelAccumulator)) {
      wheelAccumulator = 0;
    }
    wheelAccumulator += pixels;
    const now = event.timeStamp ?? performance.now();
    if (Math.abs(wheelAccumulator) < wheelStepPixels || now - lastWheelStepMs < wheelStepIntervalMs) {
      return;
    }
    deps.stepTool(wheelAccumulator > 0 ? 1 : -1);
    wheelAccumulator = 0;
    lastWheelStepMs = now;
  }

  function getDesktopInputFrame(deltaSeconds: number): RuntimeInputFrame {
    controls.setLookMode(currentMenuState().isOpen ? "palette" : "camera");
    const frame = controls.consumeFrame(deltaSeconds);

    return {
      ...frame,
      source: "desktop",
    };
  }

  function getXrInputFrame(deltaSeconds: number): RuntimeInputFrame {
    const xrSession = renderer.xr.getSession();

    if (!xrSession) {
      return {
        localDisplacement: { x: 0, y: 0, z: 0 },
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
        source: "xr",
      };
    }

    return {
      ...xrControls.consumeFrame(xrSession.inputSources, deltaSeconds),
    };
  }

  return {
    onDesktopContextMenu,
    onDesktopMouseDown,
    onDesktopPaletteKeyDown,
    onDesktopWheel,
    getDesktopInputFrame,
    getXrInputFrame,
    updateScenePalette,
  };
}
