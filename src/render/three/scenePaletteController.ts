/**
 * Controller that owns the in-scene palette's scene graph and routes pointer input to palette actions, for both desktop and XR.
 * Each frame the shell calls update() with a ScenePaletteInputFrame, the renderer-neutral PaletteDefinition (src/ui/paletteDefinition.ts) and the panel placement;
 * the controller rebuilds the library adapter (vrPaletteLibraryAdapter.ts) when the definition version changes (never by comparing content), ray-casts the active pointer against the panel, shows a hit marker and hover tooltip,
 * and invokes the hit item's action on the select-pressed edge reported by scenePointers.ts. Actions are mapped to the ScenePaletteControllerOptions callbacks.
 * All scene objects live in the Three.js world frame, in meters. The controller adds objects to options.scene and removes them in dispose().
 */
import * as THREE from "three";
import type { PortalPanelModeId } from "../../glue/portalPanelMode";
import type {
  RuntimeDebugOverlayItemId,
  RuntimeMenuConsoleLogLevelId,
  RuntimeToolId,
} from "../../runtime/runtimeMenuState";
import type { PaletteDefinition } from "../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../world-objects/placedFlags";
import { resolvePaletteTooltipLabel } from "../../ui/paletteTooltips";
import { roundRect } from "./canvasDrawing";
import { disposeObject3DWithTextures } from "./runtimeSceneUtils";
import { createScenePaletteLibraryAdapter } from "./scenePaletteLibraryAdapter";
import type {
  ScenePaletteInputFrame,
  ScenePalettePlacement,
  ScenePalettePointerSource,
} from "./scenePaletteInput";
import { chooseActiveScenePointer, createScenePointers } from "./scenePointers";

/**
 * Dependencies for createScenePaletteController, supplied by createThreeApp#shell.
 * Callbacks are plain functions mutating the runtime menu state or dispatching runtime commands; the controller never inspects their results.
 */
export interface ScenePaletteControllerOptions {
  /** Scene that receives the palette panel, hit marker, tooltip and pointer rays. */
  readonly scene: THREE.Scene;
  /** Getter (not a value) for the active camera, since the shell swaps cameras between desktop and XR; used for pointer event origin by scenePointers.ts. */
  readonly getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** Getter for the runtime menu open state (menuState.isOpen); read every frame so visibility and hit testing follow it. */
  readonly getIsOpen: () => boolean;
  /** Called on the rising edge of the menu toggle while the palette is closed. */
  readonly onOpenRequested: () => void;
  /** Called on the menu toggle rising edge while open, and by the header close action. */
  readonly onCloseRequested: () => void;
  /** Header left action "settings". */
  readonly onShowSettingsRequested: () => void;
  /** Header action "back"; the shell decides which parent page to return to. */
  readonly onShowMainRequested: () => void;
  /** A world id was chosen in the world list; the shell restarts the app with it. */
  readonly onWorldSelected: (worldId: string) => void;
  /** An app config name was chosen; the shell restarts the app with it. */
  readonly onConfigSelected: (configName: string) => void;
  /** Reload action (the shell may ask for confirmation). */
  readonly onReloadRequested: () => void;
  /** Go-home action. */
  readonly onHomeRequested: () => void;
  /** Debug master switch toggled. */
  readonly onDebugEnabledChanged: (enabled: boolean) => void;
  /** Navigate to the debug settings page. */
  readonly onDebugSettingsRequested: () => void;
  /** Console log verbosity chosen. */
  readonly onConsoleLogLevelSelected: (level: RuntimeMenuConsoleLogLevelId) => void;
  /** Debug overlay master toggle. */
  readonly onDebugOverlayToggled: (enabled: boolean) => void;
  /** One debug overlay item toggled. */
  readonly onDebugOverlayItemToggled: (itemId: RuntimeDebugOverlayItemId, enabled: boolean) => void;
  /** Comfort (anti-nausea) mode toggled. */
  readonly onAntiNauseaModeToggled: (enabled: boolean) => void;
  /** Portal panel rendering mode chosen. */
  readonly onPortalPanelModeSelected: (mode: PortalPanelModeId) => void;
  /** Portal inspection toggled. */
  readonly onPortalInspectionToggled: (enabled: boolean) => void;
  /** Collision wireframes toggled. */
  readonly onCollisionGeometryWireframesToggled: (enabled: boolean) => void;
  /** Aim collision outlines toggled. */
  readonly onAimCollisionOutlinesToggled: (enabled: boolean) => void;
  /** Optional copy-URL-with-options action; the shell always passes a forwarder to its own optional host callback. */
  readonly onCopyUrlWithOptionsRequested?: () => void;
  /** A tool was picked; the shell closes the menu and selects it if enabled. */
  readonly onToolSelected: (toolId: RuntimeToolId) => void;
  /** Open the place-flag options page. */
  readonly onPlaceFlagOptionsRequested: () => void;
  /** A flag type was chosen; the shell selects the place-flag tool and closes the menu. */
  readonly onPlaceFlagTypeSelected: (flagType: PlacedFlagType) => void;
  /** Geodesic cannon action callbacks take the cannon id (and geodesic id where relevant); geodesicId is optional for rotate and aim. */
  readonly onGeodesicCannonAddRequested: (cannonId: string) => void;
  readonly onGeodesicCannonCarryRequested: (cannonId: string) => void;
  readonly onGeodesicCannonTieAndDetachRequested: (cannonId: string) => void;
  readonly onGeodesicCannonRotateRequested: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonAimRequested: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonDeleteRequested: (cannonId: string, geodesicId: string) => void;
  /** Geometry computer callbacks take the computer id; targets and deltas are in meters (aMeters/bMeters are the two target coordinates). */
  readonly onGeometryComputerStepTargetRequested: (computerId: string, axis: "a" | "b", deltaMeters: number) => void;
  readonly onGeometryComputerGoRequested: (computerId: string) => void;
  /** Help hub navigation (tutorial and goal pages) and the paging callbacks that follow. */
  readonly onQuestionHelpTutorialRequested: () => void;
  readonly onQuestionHelpGoalRequested: () => void;
  readonly onTutorialPreviousRequested: () => void;
  readonly onTutorialNextRequested: () => void;
  readonly onGoalPreviousRequested: () => void;
  readonly onGoalNextRequested: () => void;
  /** Sign editing keyboard events: append a character, backspace, delete the sign. */
  readonly onSignKeyboardCharacter: (character: string) => void;
  readonly onSignKeyboardBackspace: () => void;
  readonly onSignDeleteRequested: () => void;
}

/**
 * Per-frame data handed to ScenePaletteController.update.
 */
export interface ScenePaletteControllerUpdate {
  /** Input for this frame from the desktop or XR input module. */
  readonly input: ScenePaletteInputFrame;
  /** Current palette content; compared by `definitionVersion`, not by content. */
  readonly definition: PaletteDefinition;
  /** Changes whenever `definition` changes (see `createPaletteDefinitionCache`); the panel is rebuilt only on a new value. */
  readonly definitionVersion: number;
  /** World-space panel pose for this frame, in meters (Three.js frame). */
  readonly placement: ScenePalettePlacement;
}

/**
 * Handle to the live in-scene palette; the creator must call dispose().
 */
export interface ScenePaletteController {
  /**
   * Runs one frame: sync content, handle the menu toggle edge, place the panel, update rays, hit marker and tooltip, and fire the hit action on select start.
   * Call every frame, including while closed (the panel is then hidden and no hit testing happens).
   */
  update(frame: ScenePaletteControllerUpdate): void;
  /** Shows or hides the panel and hides the marker, tooltip and all rays; the next update() restores visibility from getIsOpen. */
  setVisible(visible: boolean): void;
  /** Removes all palette objects from the scene and frees their geometries and materials including the tooltip label texture. */
  dispose(): void;
}

// Module-level scratch objects reused each frame; update is not reentrant.
const forwardAxis = new THREE.Vector3(0, 0, -1);
const worldQuaternion = new THREE.Quaternion();
const worldScale = new THREE.Vector3();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointerRay = new THREE.Ray();
const menuSurfaceNormal = new THREE.Vector3();
const palettePlane = new THREE.Plane();
const palettePlanePoint = new THREE.Vector3();
const palettePlaneIntersection = new THREE.Vector3();

// Result of ray-casting a pointer against the palette panel.
interface PaletteHit {
  /** First intersection point in world space, meters. */
  readonly point: THREE.Vector3;
  /** Action of the first intersected ancestor that declares one; may come from a different hit than point. */
  readonly action?: () => void;
  readonly itemId?: string;
  readonly tooltipLabel?: string;
}

/**
 * Creates the in-scene palette and adds its objects to options.scene.
 * The panel adapter root is rotated half a turn about Y so its front faces the viewer given placements whose local -Z points at the viewer.
 * The caller owns the result and must call dispose().
 */
export function createScenePaletteController(options: ScenePaletteControllerOptions): ScenePaletteController {
  // Pointer ray lines by pointer id; owned by this controller and cleared by its dispose().
  const sceneRayObjects = new Map<string, THREE.Line>();
  const paletteRoot = new THREE.Group();
  paletteRoot.name = "scene-palette-root";
  const adapter = createScenePaletteLibraryAdapter({
    onLeftAction(actionId) {
      if (actionId === "settings") {
        options.onShowSettingsRequested();
      }
    },
    onRightAction(actionId) {
      if (actionId === "close") {
        options.onCloseRequested();
      } else if (actionId === "back") {
        options.onShowMainRequested();
      }
    },
    onWorldSelected: options.onWorldSelected,
    onConfigSelected: options.onConfigSelected,
    onReloadRequested: options.onReloadRequested,
    onHomeRequested: options.onHomeRequested,
    onDebugEnabledChanged: options.onDebugEnabledChanged,
    onDebugSettingsRequested: options.onDebugSettingsRequested,
    onConsoleLogLevelSelected: options.onConsoleLogLevelSelected,
    onDebugOverlayToggled: options.onDebugOverlayToggled,
    onDebugOverlayItemToggled: options.onDebugOverlayItemToggled,
    onAntiNauseaModeToggled: options.onAntiNauseaModeToggled,
    onPortalPanelModeSelected: options.onPortalPanelModeSelected,
    onPortalInspectionToggled: options.onPortalInspectionToggled,
    onCollisionGeometryWireframesToggled: options.onCollisionGeometryWireframesToggled,
    onAimCollisionOutlinesToggled: options.onAimCollisionOutlinesToggled,
    onCopyUrlWithOptionsRequested: options.onCopyUrlWithOptionsRequested,
    onToolSelected: options.onToolSelected,
    onPlaceFlagOptionsRequested: options.onPlaceFlagOptionsRequested,
    onPlaceFlagTypeSelected: options.onPlaceFlagTypeSelected,
    onGeodesicCannonAddRequested: options.onGeodesicCannonAddRequested,
    onGeodesicCannonCarryRequested: options.onGeodesicCannonCarryRequested,
    onGeodesicCannonTieAndDetachRequested: options.onGeodesicCannonTieAndDetachRequested,
    onGeodesicCannonRotateRequested: options.onGeodesicCannonRotateRequested,
    onGeodesicCannonAimRequested: options.onGeodesicCannonAimRequested,
    onGeodesicCannonDeleteRequested: options.onGeodesicCannonDeleteRequested,
    onGeometryComputerStepTargetRequested: options.onGeometryComputerStepTargetRequested,
    onGeometryComputerGoRequested: options.onGeometryComputerGoRequested,
    onQuestionHelpTutorialRequested: options.onQuestionHelpTutorialRequested,
    onQuestionHelpGoalRequested: options.onQuestionHelpGoalRequested,
    onTutorialPreviousRequested: options.onTutorialPreviousRequested,
    onTutorialNextRequested: options.onTutorialNextRequested,
    onGoalPreviousRequested: options.onGoalPreviousRequested,
    onGoalNextRequested: options.onGoalNextRequested,
    onSignKeyboardCharacter: options.onSignKeyboardCharacter,
    onSignKeyboardBackspace: options.onSignKeyboardBackspace,
    onSignDeleteRequested: options.onSignDeleteRequested,
  });
  adapter.root.rotation.y = Math.PI;
  paletteRoot.add(adapter.root);
  options.scene.add(paletteRoot);
  const paletteHitMarker = createPaletteHitMarker();
  options.scene.add(paletteHitMarker);
  const paletteTooltip = createPaletteTooltip();
  options.scene.add(paletteTooltip.root);
  const scenePointers = createScenePointers(options.getCamera);
  let currentDefinitionVersion = -1;
  let previousMenuTogglePressed = false;

  return {
    update(frame) {
      // Rebuild panel content only when the definition version changed.
      if (frame.definitionVersion !== currentDefinitionVersion) {
        currentDefinitionVersion = frame.definitionVersion;
        adapter.setDefinition(frame.definition);
      }

      // Rising edge of the menu toggle opens or closes the palette.
      if (frame.input.menuTogglePressed && !previousMenuTogglePressed) {
        if (options.getIsOpen()) {
          options.onCloseRequested();
        } else {
          options.onOpenRequested();
        }
      }
      previousMenuTogglePressed = frame.input.menuTogglePressed;

      // Apply the placement and refresh matrices so ray casting uses the current pose.
      paletteRoot.position.copy(frame.placement.position);
      paletteRoot.quaternion.copy(frame.placement.quaternion);
      paletteRoot.scale.setScalar(frame.placement.scale ?? 1);
      paletteRoot.updateMatrixWorld(true);
      adapter.setVisible(options.getIsOpen());
      // The adapter animates in milliseconds.
      adapter.update(frame.input.deltaSeconds * 1000);
      syncSceneRays(sceneRayObjects, options.scene, frame.input.pointers, options.getIsOpen());

      // Compute select edges, choose the active pointer, and hit-test it; desktop pointers fall back to the panel plane so the cursor marker still shows off-widget.
      const pointerStates = scenePointers.update(options.scene, frame.input.pointers);
      const activePointer = chooseActiveScenePointer(pointerStates);
      const pointerSourcesById = new Map(frame.input.pointers.map((source) => [source.id, source] as const));
      const activePointerSource = activePointer ? pointerSourcesById.get(activePointer.id) : undefined;
      const paletteHit = options.getIsOpen() && activePointerSource
        ? resolvePaletteHit(adapter.root, activePointerSource.object)
        : undefined;
      const cursorPoint = paletteHit?.point
        ?? (activePointerSource?.kind === "desktop-aimer"
          ? resolvePalettePlanePoint(adapter.root, activePointerSource.object)
          : undefined);
      updatePaletteHitMarker(paletteHitMarker, adapter.root, cursorPoint);
      updatePaletteTooltip(paletteTooltip, adapter.root, paletteHit?.point, paletteHit?.tooltipLabel);
      // Activate on the press edge, not the release.
      if (paletteHit?.action && activePointer?.selectStarted) {
        paletteHit.action();
      }
    },
    setVisible(visible) {
      adapter.setVisible(visible);
      paletteHitMarker.visible = false;
      paletteTooltip.root.visible = false;
      hideSceneRays(sceneRayObjects);
    },
    dispose() {
      scenePointers.dispose();
      adapter.dispose();
      paletteRoot.removeFromParent();
      paletteHitMarker.removeFromParent();
      paletteHitMarker.geometry.dispose();
      paletteHitMarker.material.dispose();
      paletteTooltip.dispose();
      disposeSceneRays(sceneRayObjects);
    },
  };
}

// Mirror each pointer source's pose onto a ray line; rays of vanished pointers are hidden but kept for reuse.
function syncSceneRays(
  sceneRayObjects: Map<string, THREE.Line>,
  scene: THREE.Scene,
  sources: readonly ScenePalettePointerSource[],
  visible: boolean,
): void {
  const seenIds = new Set<string>();

  for (const source of sources) {
    seenIds.add(source.id);
    const ray = getOrCreateSceneRay(sceneRayObjects, scene, source.id);
    ray.visible = visible && source.visibleRay !== false;
    ray.position.copy(source.object.position);
    ray.quaternion.copy(source.object.quaternion);
    ray.updateMatrixWorld(true);
  }

  for (const [id, ray] of sceneRayObjects) {
    if (!seenIds.has(id)) {
      ray.visible = false;
    }
  }
}

// Lazily create a 2.5 m ray line along local -Z for pointer id.
function getOrCreateSceneRay(sceneRayObjects: Map<string, THREE.Line>, scene: THREE.Scene, id: string): THREE.Line {
  const existing = sceneRayObjects.get(id);
  if (existing) {
    return existing;
  }

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -2.5),
  ]);
  const rayMaterial = new THREE.LineBasicMaterial({
    color: 0x93c5fd,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
    depthWrite: false,
  });
  const ray = new THREE.Line(rayGeometry, rayMaterial);
  ray.name = `scene-palette-ray-${id}`;
  ray.renderOrder = 1002;
  ray.visible = false;
  sceneRayObjects.set(id, ray);
  scene.add(ray);
  return ray;
}

// Hide every ray without disposing it.
function hideSceneRays(sceneRayObjects: Map<string, THREE.Line>): void {
  for (const ray of sceneRayObjects.values()) {
    ray.visible = false;
  }
}

// Remove all ray lines from the scene and free their GPU resources.
function disposeSceneRays(sceneRayObjects: Map<string, THREE.Line>): void {
  for (const ray of sceneRayObjects.values()) {
    ray.removeFromParent();
    ray.geometry.dispose();
    disposeMaterial(ray.material);
  }
  sceneRayObjects.clear();
}

// Dispose a single material or an array of materials.
function disposeMaterial(material: THREE.Material | readonly THREE.Material[]): void {
  if ("dispose" in material) {
    material.dispose();
  } else {
    for (const item of material) {
      item.dispose();
    }
  }
}

// Small white disc (radius 0.018 m) drawn on top of the panel at the pointer hit.
function createPaletteHitMarker(): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> {
  const marker = new THREE.Mesh(
    new THREE.CircleGeometry(0.018, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marker.name = "scene-palette-hit-marker";
  marker.renderOrder = 1004;
  marker.visible = false;
  return marker;
}

// Place the marker on the panel surface, offset 2 mm along the panel normal; hide it when there is no point.
function updatePaletteHitMarker(
  marker: THREE.Mesh,
  paletteSurface: THREE.Object3D,
  point: THREE.Vector3 | undefined,
): void {
  if (!point) {
    marker.visible = false;
    return;
  }

  paletteSurface.getWorldQuaternion(marker.quaternion);
  menuSurfaceNormal.set(0, 0, 1).applyQuaternion(marker.quaternion).normalize();
  marker.position.copy(point).addScaledVector(menuSurfaceNormal, 0.002);
  marker.visible = true;
  marker.updateMatrixWorld(true);
}

// Cast the source's -Z ray (0.01 to 4 m) against the panel. The point is the nearest hit; action and item id are the first ones found walking up userData from any hit, nearest first.
function resolvePaletteHit(
  root: THREE.Object3D,
  sourceObject: THREE.Object3D,
): PaletteHit | undefined {
  sourceObject.updateMatrixWorld(true);
  sourceObject.matrixWorld.decompose(rayOrigin, worldQuaternion, worldScale);
  rayDirection.copy(forwardAxis).applyQuaternion(worldQuaternion).normalize();
  raycaster.ray.origin.copy(rayOrigin);
  raycaster.ray.direction.copy(rayDirection);
  raycaster.near = 0.01;
  raycaster.far = 4;

  const intersections = raycaster.intersectObject(root, true);
  const firstIntersection = intersections[0];
  if (!firstIntersection) {
    return undefined;
  }

  let action: (() => void) | undefined;
  let itemId: string | undefined;
  for (const intersection of intersections) {
    action ??= findPaletteAction(intersection.object);
    itemId ??= findPaletteItemId(intersection.object);
    if (action && itemId) {
      break;
    }
  }

  return {
    point: firstIntersection.point.clone(),
    action,
    itemId,
    tooltipLabel: resolvePaletteTooltipLabel(itemId),
  };
}

// Intersect the source ray with the infinite panel plane; used by the desktop cursor marker.
function resolvePalettePlanePoint(
  paletteSurface: THREE.Object3D,
  sourceObject: THREE.Object3D,
): THREE.Vector3 | undefined {
  sourceObject.updateMatrixWorld(true);
  sourceObject.matrixWorld.decompose(rayOrigin, worldQuaternion, worldScale);
  rayDirection.copy(forwardAxis).applyQuaternion(worldQuaternion).normalize();

  paletteSurface.updateMatrixWorld(true);
  paletteSurface.getWorldPosition(palettePlanePoint);
  paletteSurface.getWorldQuaternion(worldQuaternion);
  menuSurfaceNormal.set(0, 0, 1).applyQuaternion(worldQuaternion).normalize();
  palettePlane.setFromNormalAndCoplanarPoint(menuSurfaceNormal, palettePlanePoint);

  pointerRay.origin.copy(rayOrigin);
  pointerRay.direction.copy(rayDirection);
  return pointerRay.intersectPlane(palettePlane, palettePlaneIntersection) ?? undefined;
}

// Walk up the parent chain for a userData action (scenePaletteAction).
function findPaletteAction(object: THREE.Object3D | null): (() => void) | undefined {
  let current: THREE.Object3D | null = object;

  while (current) {
    const action = current.userData.scenePaletteAction;
    if (typeof action === "function") {
      return action as () => void;
    }
    current = current.parent;
  }

  return undefined;
}

// Walk up the parent chain for a userData item id (scenePaletteItemId).
function findPaletteItemId(object: THREE.Object3D | null): string | undefined {
  let current: THREE.Object3D | null = object;

  while (current) {
    const itemId = current.userData.scenePaletteItemId;
    if (typeof itemId === "string") {
      return itemId;
    }
    current = current.parent;
  }

  return undefined;
}

// Hover tooltip object: update(label) rebuilds the label mesh only when the text changes.
interface PaletteTooltip {
  readonly root: THREE.Object3D;
  update(label: string): void;
  dispose(): void;
}

function createPaletteTooltip(): PaletteTooltip {
  const root = new THREE.Group();
  root.name = "scene-palette-hover-tooltip";
  root.visible = false;
  let currentLabel = "";

  return {
    root,
    update(label) {
      if (label === currentLabel) {
        return;
      }

      currentLabel = label;
      for (const child of [...root.children]) {
        disposeObject3DWithTextures(child);
      }
      root.clear();
      root.add(createPaletteTooltipMesh(label));
    },
    dispose() {
      root.removeFromParent();
      disposeObject3DWithTextures(root);
    },
  };
}

// Show the tooltip near the hit point, offset 6 mm off the panel and 4 cm up and right; hide it without a point or label.
function updatePaletteTooltip(
  tooltip: PaletteTooltip,
  paletteSurface: THREE.Object3D,
  point: THREE.Vector3 | undefined,
  label: string | undefined,
): void {
  if (!point || !label) {
    tooltip.root.visible = false;
    return;
  }

  tooltip.update(label);
  paletteSurface.getWorldQuaternion(tooltip.root.quaternion);
  menuSurfaceNormal.set(0, 0, 1).applyQuaternion(tooltip.root.quaternion).normalize();
  tooltip.root.position.copy(point)
    .addScaledVector(menuSurfaceNormal, 0.006)
    .add(new THREE.Vector3(0.04, 0.04, 0).applyQuaternion(tooltip.root.quaternion));
  tooltip.root.visible = true;
  tooltip.root.updateMatrixWorld(true);
}

// Draw the wrapped label into a canvas texture and put it on a 0.4 m wide plane; falls back to an empty Object3D without a 2D context.
function createPaletteTooltipMesh(label: string): THREE.Object3D {
  const lines = wrapPaletteTooltipLabel(label);
  const canvas = document.createElement("canvas");
  canvas.width = 560;
  canvas.height = 120 + Math.max(0, lines.length - 1) * 46;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.Object3D();
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(context, 28, 22, 504, canvas.height - 44, 18);
  context.fillStyle = "rgba(15, 23, 42, 0.95)";
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(186, 230, 253, 0.9)";
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.font = "bold 32px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const firstLineY = canvas.height / 2 - ((lines.length - 1) * 23);
  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index] ?? "", canvas.width / 2, firstLineY + index * 46, 452);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const planeWidth = 0.4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(planeWidth, planeWidth * (canvas.height / canvas.width)),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.name = "scene-palette-hover-tooltip:label";
  mesh.renderOrder = 1008;
  return mesh;
}

/**
 * Greedy word-wraps a tooltip label into lines of at most maxLineLength characters (default 38).
 * Whitespace is collapsed; an empty label yields [""]; a single word longer than the limit stays on its own over-long line.
 */
export function wrapPaletteTooltipLabel(label: string, maxLineLength = 38): readonly string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length > maxLineLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
