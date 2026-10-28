/**
 * Renderer-side input contract for the in-scene palette, shared by the desktop and XR input paths.
 * Each frame an input module (desktopScenePaletteInput.ts or xrScenePaletteInput.ts) emits a ScenePaletteInputFrame of pointer sources;
 * scenePointers.ts turns them into ScenePalettePointerState with select start/end edges, and scenePaletteController.ts hit-tests the palette with them.
 * Poses are Three.js world-frame Object3Ds whose local -Z axis is the pointing ray; lengths are meters. Only types live here, no runtime code.
 */
import * as THREE from "three";

/**
 * Identifies which physical input produced a pointer source: the desktop mouse-driven aimer, an XR controller, or a tracked XR hand.
 * Note that the current XR input module only emits "xr-controller" sources; "xr-hand" is part of the contract but not produced.
 */
export type ScenePalettePointerKind = "desktop-aimer" | "xr-controller" | "xr-hand";

/**
 * One pointing device for a single frame: a world-space ray origin and direction plus its select (trigger/click) button level.
 * Produced fresh every frame by the input modules; the Object3D may be reused across frames and is owned by the producing module.
 */
export interface ScenePalettePointerSource {
  readonly id: string;
  readonly kind: ScenePalettePointerKind;
  /** Ray pose in the Three.js world frame; the pointing direction is the object's local -Z axis. Must have a current matrixWorld when consumed (consumers call updateMatrixWorld). */
  readonly object: THREE.Object3D;
  readonly selectPressed: boolean;
  /** Marks the preferred pointer when several are active (the right hand in XR); absent means false. */
  readonly dominant?: boolean;
  /** Whether the controller should draw a visible ray line for this pointer; absent means true. The desktop aimer sets false. */
  readonly visibleRay?: boolean;
}

/**
 * Everything the palette controller needs from input for one frame: elapsed time, the menu toggle level, and the current pointer sources.
 * Pointer sources absent from a frame are treated as disconnected by scenePointers.ts.
 */
export interface ScenePaletteInputFrame {
  /** Frame time in seconds; the controller converts it to milliseconds for adapter animation. */
  readonly deltaSeconds: number;
  /** Level (not edge) of the menu toggle button; the controller detects the rising edge itself. Both current input modules always report false. */
  readonly menuTogglePressed: boolean;
  readonly pointers: readonly ScenePalettePointerSource[];
}

/**
 * Per-pointer result of scenePointers.ts for one frame, including select edge flags derived by comparing with the previous frame.
 */
export interface ScenePalettePointerState {
  readonly id: string;
  readonly kind: ScenePalettePointerKind;
  /** Id of the object the pmndrs pointer currently hovers, if any. */
  readonly hoveredTargetId?: string;
  readonly selectPressed: boolean;
  /** True only on the first frame where selectPressed turned true. */
  readonly selectStarted: boolean;
  /** True only on the first frame where selectPressed turned false. */
  readonly selectEnded: boolean;
  readonly dominant: boolean;
}

/**
 * World-space pose of the palette panel in the Three.js frame (meters), as resolved by the desktop or VR placement helpers.
 */
export interface ScenePalettePlacement {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Uniform scale applied to the panel root; absent means 1. */
  readonly scale?: number;
  /** When true the pose was held from the previous frame rather than recomputed. */
  readonly freeze?: boolean;
}
