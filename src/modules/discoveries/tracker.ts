/**
 * The discovery tracker (design 017 section 9.4): the session's record of what was found, and the detectors that find it.
 * Each frame the shell shows it what happened (`DiscoveryFrame`); it answers with the ids found for the first time. A detector is a pure function of that frame and a little memory of its own, and no detector blocks or orders play: the tracker only notices.
 * Found discoveries are a session record: `reset` (Start over) forgets them and the memory of the detectors, and nothing is saved across a reload.
 * The built-in detectors are the cheap ones of the design's table: `across-an-edge` (the first portal crossed), `back-where-you-started` (back in the starting face through another edge than the one used to leave), `beam-came-home`, `beam-hits-corner`, `tight-string` (a string of joined beams finished straightening) and `new-shape` (the shape machine changed the world). `meeting-twice` and `around-a-corner` are not built yet.
 */
import type { DiscoveryDefinition, DiscoveryFrame } from "./api";

/** Handle to a tracker. */
export interface DiscoveryTracker {
  /** Shows the tracker what happened in one frame; returns the ids found for the first time, in catalog order. */
  observe(frame: DiscoveryFrame): readonly string[];
  /** True once `id` has been found this session. */
  isFound(id: string): boolean;
  /** The ids found so far, in the order they were found. */
  foundIds(): readonly string[];
  /** Forgets everything found and the detectors' memory (Start over); `homeCellId` is the face the player starts in again. */
  reset(homeCellId?: string): void;
}

/** What a built-in detector remembers between frames. */
interface DetectorMemory {
  /** The face the player starts in. */
  homeCellId: string | undefined;
  /** The side of the starting face the player last left through, or undefined while at home. */
  leftHomeThrough: string | undefined;
  /** True once a string of joined beams was seen straightening. */
  stringWasShortening: boolean;
  /** Faces visited, for `visitFace`. */
  visited: Set<string>;
}

function freshMemory(homeCellId: string | undefined): DetectorMemory {
  return { homeCellId, leftHomeThrough: undefined, stringWasShortening: false, visited: new Set() };
}

// The built-in detectors, by id. Each is shown the frame and its memory; it answers whether the discovery happened in this frame.
const builtinDetectors: Readonly<Record<string, (frame: DiscoveryFrame, memory: DetectorMemory) => boolean>> = {
  "across-an-edge": (frame) => frame.crossings.length > 0,
  "back-where-you-started": backWhereYouStarted,
  "beam-came-home": (frame) => frame.beamCameHome,
  "beam-hits-corner": (frame) => frame.beamHitCorner,
  "tight-string": tightString,
  "new-shape": (frame) => frame.shapeChanged,
};

// Leaving the starting face through a side remembers that side; coming back into the starting face through any other side finds it. Coming back through the same side is only going back, and a crossing from a face into itself (a one-face world) is neither leaving nor returning.
function backWhereYouStarted(frame: DiscoveryFrame, memory: DetectorMemory): boolean {
  const home = memory.homeCellId;
  if (home === undefined) return false;
  let found = false;
  for (const crossing of frame.crossings) {
    if (crossing.sourceCellId === crossing.targetCellId) continue;
    if (crossing.sourceCellId === home) {
      memory.leftHomeThrough = crossing.portalId;
    } else if (crossing.targetCellId === home && memory.leftHomeThrough !== undefined) {
      if (crossing.targetPortalId !== memory.leftHomeThrough) found = true;
      memory.leftHomeThrough = undefined;
    }
  }
  return found;
}

// A string that was straightening and is now taut, or gone with beams left over, has become a beam again.
function tightString(frame: DiscoveryFrame, memory: DetectorMemory): boolean {
  if (frame.stringPhase === "shortening") {
    memory.stringWasShortening = true;
    return false;
  }
  const finished = memory.stringWasShortening && (frame.stringPhase === "taut" || frame.beamCount > 0);
  memory.stringWasShortening = false;
  return finished;
}

function authoredDetector(definition: DiscoveryDefinition, frame: DiscoveryFrame, memory: DetectorMemory): boolean {
  const detector = definition.detector;
  if (detector.kind === "visitFace") return frame.cellId === detector.cellId && !memory.visited.has(detector.cellId);
  if (detector.kind === "approach") {
    return frame.cellId === detector.cellId && Math.hypot(frame.position.x - detector.position.x, frame.position.y - detector.position.y) <= detector.radius;
  }
  return false;
}

/** Creates a tracker for the discoveries of a world; `homeCellId` is the face the player starts in. */
export function createDiscoveryTracker(definitions: readonly DiscoveryDefinition[], homeCellId?: string): DiscoveryTracker {
  const found: string[] = [];
  const foundSet = new Set<string>();
  let memory = freshMemory(homeCellId);

  return {
    observe(frame) {
      const justFound: string[] = [];
      // Every built-in detector sees every frame, found or not, so its memory stays right; a found discovery is simply not reported again.
      const builtinAnswers = new Map<string, boolean>();
      for (const definition of definitions) {
        if (definition.detector.kind !== "builtin") continue;
        const detect = builtinDetectors[definition.id];
        if (detect !== undefined) builtinAnswers.set(definition.id, detect(frame, memory));
      }
      for (const definition of definitions) {
        if (foundSet.has(definition.id)) continue;
        const happened = definition.detector.kind === "builtin" ? builtinAnswers.get(definition.id) === true : authoredDetector(definition, frame, memory);
        if (!happened) continue;
        foundSet.add(definition.id);
        found.push(definition.id);
        justFound.push(definition.id);
      }
      memory.visited.add(frame.cellId);
      return justFound;
    },
    isFound: (id) => foundSet.has(id),
    foundIds: () => found,
    reset(nextHomeCellId = memory.homeCellId) {
      found.length = 0;
      foundSet.clear();
      memory = freshMemory(nextHomeCellId);
    },
  };
}
