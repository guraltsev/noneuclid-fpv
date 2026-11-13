/**
 * The shell's side of the discoveries (design 017 section 9.4): it owns the world's catalog and the tracker, is shown what happened once per frame, and announces each discovery with two toasts, "Discovery! <name>" and then its question.
 * The shell tells it what the player did (the face, the portals crossed, the writes of the frame) and when the shape machine changed the world; the string state of joined beams is read through the functions it is given. It never blocks or orders play.
 * Found discoveries are a session record: `reset` (Start over) forgets them. The Discoveries page and the curiosity markers read the record from here.
 */
import { discoveryText } from "../../world-objects/vocabulary";
import {
  beamEventsInChanges,
  createDiscoveryCatalog,
  createDiscoveryTracker,
  discoveryPageEntries,
  type BeamChangeReader,
  type DiscoveryCrossing,
  type DiscoveryDefinition,
  type DiscoveryPageEntry,
  type StringPhase,
  type WorldDiscoveriesSpec,
} from "../../modules/discoveries";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";

/** How long the "Discovery!" toast stays, in milliseconds. */
export const discoveryToastDurationMs = 5000;
/** How long the toast with the question that follows it stays, in milliseconds. */
export const discoveryQuestionDurationMs = 9000;

/** What the controller needs from the shell. */
export interface DiscoveryControllerDeps {
  /** The authored discoveries of the world, if it has a section for them. */
  readonly spec: WorldDiscoveriesSpec | undefined;
  /** The face the player starts in. */
  readonly homeCellId: string | undefined;
  /** Shows a toast for `durationMs`. */
  pushToast(text: string, durationMs: number): void;
  /** Reads a record of the registry by id. */
  getObject(id: string): RuntimeWorldObject | undefined;
  /** How many vertices of joined beams there are (zero when no beams are joined). */
  tiedVertexCount(): number;
  /** True when every joined vertex is at rest. */
  curvesAtRest(): boolean;
  /** How many beams there are. */
  beamCount(): number;
  /** Logs a mistake in the authored part (the shell sends it to the console). */
  warn?(message: string): void;
}

/** What the player and the world did in one frame. */
export interface DiscoveryObservation {
  readonly cellId: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly crossings: readonly DiscoveryCrossing[];
  /** The world's writes of the frame, or undefined when there were none. */
  readonly changes?: BeamChangeReader;
}

/** Handle to the controller. */
export interface DiscoveryController {
  /** Shows the controller one frame; announces what was found and returns the ids. */
  observe(observation: DiscoveryObservation): readonly string[];
  /** The shape machine changed the world: "A new shape" is noticed in the next observation. */
  noteShapeChanged(): void;
  /** Forgets everything found (Start over). */
  reset(homeCellId?: string): void;
  /** The discoveries of this world, in the order of the page. */
  definitions(): readonly DiscoveryDefinition[];
  /** True once the discovery was found this session. */
  isFound(id: string): boolean;
  /** The entries of the Discoveries page now. */
  pageEntries(): readonly DiscoveryPageEntry[];
}

/** Creates the controller for a world. */
export function createDiscoveryController(deps: DiscoveryControllerDeps): DiscoveryController {
  const catalog = createDiscoveryCatalog(deps.spec);
  for (const problem of catalog.problems) deps.warn?.(problem);
  const tracker = createDiscoveryTracker(catalog.definitions, deps.homeCellId);
  const definitionsById = new Map(catalog.definitions.map((definition) => [definition.id, definition] as const));
  let shapeChanged = false;

  function stringPhase(): StringPhase {
    if (deps.tiedVertexCount() === 0) return "none";
    return deps.curvesAtRest() ? "taut" : "shortening";
  }

  return {
    observe(observation) {
      const changes = observation.changes;
      const beamEvents = changes !== undefined && changes.length > 0 ? beamEventsInChanges(changes, deps.getObject) : { beamHitCorner: false, beamCameHome: false };
      const found = tracker.observe({
        cellId: observation.cellId,
        position: observation.position,
        crossings: observation.crossings,
        beamHitCorner: beamEvents.beamHitCorner,
        beamCameHome: beamEvents.beamCameHome,
        stringPhase: stringPhase(),
        beamCount: deps.beamCount(),
        shapeChanged,
      });
      shapeChanged = false;
      for (const id of found) {
        const definition = definitionsById.get(id);
        if (definition === undefined) continue;
        deps.pushToast(discoveryText.toast(definition.name), discoveryToastDurationMs);
        deps.pushToast(definition.question, discoveryQuestionDurationMs);
      }
      return found;
    },
    noteShapeChanged() {
      shapeChanged = true;
    },
    reset(homeCellId) {
      tracker.reset(homeCellId);
      shapeChanged = false;
    },
    definitions: () => catalog.definitions,
    isFound: (id) => tracker.isFound(id),
    pageEntries: () => discoveryPageEntries(catalog.definitions, (id) => tracker.isFound(id)),
  };
}
