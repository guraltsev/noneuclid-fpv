/**
 * Per-source ray pointers that drive hover and select events on the XR scene palette (and desktop pointer sources).
 * Each pointer source (a controller or desktop ray object) gets a `@pmndrs/pointer-events` ray pointer, created lazily and removed once the source disappears.
 * Select events are derived from the source's `selectPressed` flag: a rising edge fires pointer-down and a falling edge pointer-up on whatever the ray hovers;
 * the per-frame `selectStarted`/`selectEnded` flags report the same edges to the caller.
 * Hovered targets are identified by `userData.scenePaletteItemId` (or `xrPaletteItemId`) on the intersected object.
 */
import * as THREE from "three";
import { createRayPointer, type Pointer } from "@pmndrs/pointer-events";
import type { ScenePalettePointerSource, ScenePalettePointerState } from "./scenePaletteInput";

/**
 * Pointer manager returned by `createScenePointers`.
 */
export interface ScenePointers {
  /**
   * Moves every source's ray through `scene`, dispatches down/up on select edges, and returns one state per source (in input order).
   * Sources absent from this call are sent a pointer exit and forgotten. Each source's object has its world matrix updated first, so its transform defines the ray.
   * Call once per frame.
   */
  update(scene: THREE.Object3D, sources: readonly ScenePalettePointerSource[]): readonly ScenePalettePointerState[];
  /** Sends an exit event to every live pointer and forgets them; the owner (scenePaletteController) must call it at teardown. */
  dispose(): void;
}

/**
 * Creates the pointer manager. `getCamera` is read lazily by each ray pointer (createThreeApp#shell's scene palette controller passes `() => camera`);
 * it is needed by the pointer-events library, not to define the ray direction.
 */
export function createScenePointers(
  getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera,
): ScenePointers {
  const entries = new Map<string, PointerEntry>();

  return {
    update(scene, sources) {
      const seenIds = new Set<string>();
      const states: ScenePalettePointerState[] = [];

      for (const source of sources) {
        seenIds.add(source.id);
        const entry = getOrCreatePointerEntry(entries, source, getCamera);
        source.object.updateMatrixWorld(true);
        entry.pointer.move(scene, createPointerEvent(source.id));

        const previousPressed = entry.selectPressed;
        if (!previousPressed && source.selectPressed) {
          entry.pointer.down(createPointerButtonEvent(source.id));
        } else if (previousPressed && !source.selectPressed) {
          entry.pointer.up(createPointerButtonEvent(source.id));
        }
        entry.selectPressed = source.selectPressed;

        states.push({
          id: source.id,
          kind: source.kind,
          hoveredTargetId: readHoveredTargetId(entry.pointer),
          selectPressed: source.selectPressed,
          selectStarted: !previousPressed && source.selectPressed,
          selectEnded: previousPressed && !source.selectPressed,
          dominant: source.dominant ?? false,
        });
      }

      // Drop pointers whose source vanished (controller disconnected).
      for (const [id, entry] of entries) {
        if (seenIds.has(id)) {
          continue;
        }

        entry.pointer.exit(createPointerEvent(id));
        entries.delete(id);
      }

      return states;
    },
    dispose() {
      for (const [id, entry] of entries) {
        entry.pointer.exit(createPointerEvent(id));
      }
      entries.clear();
    },
  };
}

/**
 * Picks the single pointer that should drive palette UI: first a pressed one, then a hovering dominant one, then any hovering one, then any dominant one, then the first.
 * Returns `undefined` for an empty list.
 */
export function chooseActiveScenePointer(
  states: readonly ScenePalettePointerState[],
): ScenePalettePointerState | undefined {
  return states.find((state) => state.selectPressed)
    ?? states.find((state) => state.hoveredTargetId && state.dominant)
    ?? states.find((state) => state.hoveredTargetId)
    ?? states.find((state) => state.dominant)
    ?? states[0];
}

interface PointerEntry {
  readonly pointer: Pointer;
  selectPressed: boolean;
}

function getOrCreatePointerEntry(
  entries: Map<string, PointerEntry>,
  source: ScenePalettePointerSource,
  getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera,
): PointerEntry {
  const existing = entries.get(source.id);
  if (existing) {
    return existing;
  }

  const pointer = createRayPointer(getCamera, { current: source.object }, { sourceId: source.id }, undefined, "ray");
  const created: PointerEntry = {
    pointer,
    selectPressed: false,
  };
  entries.set(source.id, created);
  return created;
}

// The library only reads a few fields of the event, so a minimal fake is used; every source shares pointerId 1 and is distinguished by sourceId.
function createPointerEvent(sourceId: string): PointerEvent {
  return {
    pointerId: 1,
    pointerType: "ray",
    buttons: 0,
    sourceId,
  } as unknown as PointerEvent;
}

function createPointerButtonEvent(sourceId: string): PointerEvent & { readonly button: number } {
  return {
    ...createPointerEvent(sourceId),
    button: 0,
    buttons: 1,
  } as unknown as PointerEvent & { readonly button: number };
}

function readHoveredTargetId(pointer: Pointer): string | undefined {
  const object = pointer.getIntersection()?.object;
  return typeof object?.userData?.scenePaletteItemId === "string"
    ? object.userData.scenePaletteItemId
    : typeof object?.userData?.xrPaletteItemId === "string"
      ? object.userData.xrPaletteItemId
      : undefined;
}
