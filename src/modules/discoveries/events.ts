/**
 * What the world's writes of one frame say about beams (design 017 section 9.4): a beam that stopped at a corner, and a beam that came home to its own laser.
 * Both are read from the pieces of a beam the geodesic model writes: a piece (`geodesicModel/segment`) records why it ends. A piece that ends in a corner's forbidden zone is the "beam hits a corner" event. A piece that ends at an emitter which is also the emitter its beam leaves from (the beam's own laser, within the laser's hit radius) is the "beam came home" event.
 * Pure: it reads the frame's writes and asks the registry only for the beam of a piece.
 */
import { ChangeOp } from "../../world-objects/runtimeObjectChangeJournal";
import type { RuntimeObjectChangeReader } from "../../world-objects/runtimeObjectChangeJournal";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";

/** What a frame's writes say about beams. */
export interface BeamDiscoveryEvents {
  readonly beamHitCorner: boolean;
  readonly beamCameHome: boolean;
}

/** The part of the journal's reader these functions use. */
export type BeamChangeReader = Pick<RuntimeObjectChangeReader<RuntimeWorldObject>, "length" | "opAt" | "kindAt" | "objectAt">;

/** The beam events in the writes of one frame. `get` reads a record of the registry by id. */
export function beamEventsInChanges(changes: BeamChangeReader, get: (id: string) => RuntimeWorldObject | undefined): BeamDiscoveryEvents {
  let beamHitCorner = false;
  let beamCameHome = false;
  for (let index = 0; index < changes.length; index += 1) {
    const op = changes.opAt(index);
    if (op === ChangeOp.Removed || changes.kindAt(index) !== "geodesicModel/segment") continue;
    const piece = changes.objectAt(index);
    if (piece.kind !== "geodesicModel/segment") continue;
    if (piece.terminal.kind === "forbidden-zone-hit") {
      beamHitCorner = true;
    } else if (piece.terminal.kind === "emitter-hit") {
      const beam = get(piece.geodesicId);
      if (beam?.kind === "geodesicModel/arc" && beam.start.anchorObjectId === piece.terminal.emitterId) beamCameHome = true;
    }
  }
  return { beamHitCorner, beamCameHome };
}
