/**
 * `tests/modules/discoveries.test.ts` - unit tier.
 *
 * The discoveries module notices remarkable events without checking goals: each built-in detector is driven by scripted frames (a portal crossed, a beam piece that ends in a corner or at its own laser, a string that stopped straightening, a deformation committed), the authored detectors by a visit or an approach, and the tracker keeps a session record that Start over clears. The catalog applies the author's switches and the page lists found and teaser entries.
 */
import { describe, expect, it } from "vitest";
import { ChangeOp, createRuntimeObjectChangeJournal } from "../../src/world-objects/runtimeObjectChangeJournal";
import {
  beamEventsInChanges,
  createDiscoveryCatalog,
  createDiscoveryTracker,
  discoveryPageEntries,
  type DiscoveryCrossing,
  type DiscoveryFrame,
  type StringPhase,
} from "../../src/modules/discoveries";

function frame(overrides: Partial<DiscoveryFrame> = {}): DiscoveryFrame {
  return {
    cellId: "front",
    position: { x: 0, y: 0 },
    crossings: [],
    beamHitCorner: false,
    beamCameHome: false,
    stringPhase: "none",
    beamCount: 0,
    shapeChanged: false,
    ...overrides,
  };
}

function crossing(sourceCellId: string, portalId: string, targetCellId: string, targetPortalId: string): DiscoveryCrossing {
  return { sourceCellId, portalId, targetCellId, targetPortalId };
}

function trackerFor(homeCellId = "front") {
  return createDiscoveryTracker(createDiscoveryCatalog().definitions, homeCellId);
}

describe("across an edge", () => {
  it("is found by the first crossing of a portal and not by walking in one face", () => {
    const tracker = trackerFor();
    expect(tracker.observe(frame({ position: { x: 3, y: 4 } }))).toEqual([]);
    expect(tracker.observe(frame({ cellId: "right", crossings: [crossing("front", "side-1", "right", "side-3")] }))).toEqual(["across-an-edge"]);
    expect(tracker.observe(frame({ cellId: "front", crossings: [crossing("right", "side-3", "front", "side-1")] }))).toEqual([]);
    expect(tracker.isFound("across-an-edge")).toBe(true);
  });

  it("is found on a one-face world too", () => {
    const tracker = trackerFor("room");
    expect(tracker.observe(frame({ cellId: "room", crossings: [crossing("room", "side-0", "room", "side-2")] }))).toEqual(["across-an-edge"]);
  });
});

describe("back where you started", () => {
  it("is found on returning to the starting face by another edge than the one used to leave", () => {
    const tracker = trackerFor("front");
    tracker.observe(frame({ cellId: "right", crossings: [crossing("front", "side-1", "right", "side-3")] }));
    tracker.observe(frame({ cellId: "top", crossings: [crossing("right", "side-2", "top", "side-1")] }));
    const found = tracker.observe(frame({ cellId: "front", crossings: [crossing("top", "side-0", "front", "side-2")] }));
    expect(found).toEqual(["back-where-you-started"]);
  });

  it("is not found by walking back through the same edge", () => {
    const tracker = trackerFor("front");
    tracker.observe(frame({ cellId: "right", crossings: [crossing("front", "side-1", "right", "side-3")] }));
    const found = tracker.observe(frame({ cellId: "front", crossings: [crossing("right", "side-3", "front", "side-1")] }));
    expect(found).not.toContain("back-where-you-started");
  });

  it("is not found by crossing a face into itself", () => {
    const tracker = trackerFor("room");
    const found = tracker.observe(frame({ cellId: "room", crossings: [crossing("room", "side-0", "room", "side-2")] }));
    expect(found).not.toContain("back-where-you-started");
  });
});

describe("beam discoveries", () => {
  const beam = { id: "g1", kind: "geodesicModel/arc", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e1" } };
  const pieceOf = (terminal: unknown) => ({ id: "g1:segment:0", kind: "geodesicModel/segment", geodesicId: "g1", terminal });

  function eventsFor(writes: readonly { readonly op: ChangeOp; readonly object: { readonly id: string; readonly kind: string } }[]) {
    const journal = createRuntimeObjectChangeJournal<never>();
    for (const write of writes) journal.record(write.op, write.object as never);
    return beamEventsInChanges(journal as never, (id) => (id === "g1" ? (beam as never) : undefined));
  }

  it("a piece that ends in a corner's zone is a beam hitting a corner", () => {
    const events = eventsFor([{ op: ChangeOp.Added, object: pieceOf({ kind: "forbidden-zone-hit", junctionId: "front:vertex-0" }) }]);
    expect(events).toEqual({ beamHitCorner: true, beamCameHome: false });
    const tracker = trackerFor();
    expect(tracker.observe(frame({ beamHitCorner: events.beamHitCorner }))).toEqual(["beam-hits-corner"]);
  });

  it("a piece ending at its own laser is a beam coming home, one at another laser is not", () => {
    const home = eventsFor([{ op: ChangeOp.Updated, object: pieceOf({ kind: "emitter-hit", emitterId: "e1" }) }]);
    expect(home).toEqual({ beamHitCorner: false, beamCameHome: true });
    expect(trackerFor().observe(frame({ beamCameHome: home.beamCameHome }))).toEqual(["beam-came-home"]);

    const other = eventsFor([{ op: ChangeOp.Added, object: pieceOf({ kind: "emitter-hit", emitterId: "e2" }) }]);
    expect(other).toEqual({ beamHitCorner: false, beamCameHome: false });
  });

  it("pieces that were removed, that end at a wall or that are not pieces say nothing", () => {
    const events = eventsFor([
      { op: ChangeOp.Removed, object: pieceOf({ kind: "forbidden-zone-hit", junctionId: "j" }) },
      { op: ChangeOp.Added, object: pieceOf({ kind: "wall-hit", sideIndex: 0 }) },
      { op: ChangeOp.Added, object: { id: "x", kind: "placedFlags/flag" } },
    ]);
    expect(events).toEqual({ beamHitCorner: false, beamCameHome: false });
  });
});

describe("tight string", () => {
  function run(phases: readonly { readonly phase: StringPhase; readonly beams: number }[]): readonly string[] {
    const tracker = trackerFor();
    return phases.flatMap((step) => tracker.observe(frame({ stringPhase: step.phase, beamCount: step.beams })));
  }

  it("is found when a string that was straightening comes to rest", () => {
    expect(run([{ phase: "shortening", beams: 3 }, { phase: "shortening", beams: 3 }, { phase: "taut", beams: 3 }])).toEqual(["tight-string"]);
  });

  it("is found when the string becomes a single beam again", () => {
    expect(run([{ phase: "shortening", beams: 2 }, { phase: "none", beams: 1 }])).toEqual(["tight-string"]);
  });

  it("is not found when the string is simply deleted or was never moving", () => {
    expect(run([{ phase: "shortening", beams: 2 }, { phase: "none", beams: 0 }])).toEqual([]);
    expect(run([{ phase: "taut", beams: 2 }, { phase: "taut", beams: 2 }])).toEqual([]);
  });
});

describe("a new shape", () => {
  it("is found when the shape machine changed the world", () => {
    const tracker = trackerFor();
    expect(tracker.observe(frame())).toEqual([]);
    expect(tracker.observe(frame({ shapeChanged: true }))).toEqual(["new-shape"]);
    expect(tracker.observe(frame({ shapeChanged: true }))).toEqual([]);
  });
});

describe("authored detectors", () => {
  const catalog = createDiscoveryCatalog({
    disable: [],
    add: [
      { id: "snow", name: "Snow face", question: "Why is it cold?", teaser: "somewhere white", detector: { kind: "visitFace", cellId: "bottom" } },
      {
        id: "corner",
        name: "The corner",
        question: "How many squares meet?",
        teaser: "three squares",
        detector: { kind: "approach", cellId: "front", position: { x: 6, y: 6, z: 0 }, radius: 1 },
      },
    ],
    markers: [],
  });

  it("visitFace is found on the first visit to the face", () => {
    const tracker = createDiscoveryTracker(catalog.definitions, "front");
    expect(tracker.observe(frame())).toEqual([]);
    expect(tracker.observe(frame({ cellId: "bottom" }))).toEqual(["snow"]);
  });

  it("approach is found within the radius in the named face only", () => {
    const tracker = createDiscoveryTracker(catalog.definitions, "front");
    expect(tracker.observe(frame({ position: { x: 4, y: 6 } }))).toEqual([]);
    expect(tracker.observe(frame({ cellId: "bottom", position: { x: 6, y: 6 } }))).toEqual(["snow"]);
    expect(tracker.observe(frame({ position: { x: 5.4, y: 6.3 } }))).toEqual(["corner"]);
  });
});

describe("the session record", () => {
  it("lists what was found in order and forgets it on reset, keeping the home face", () => {
    const tracker = trackerFor("front");
    tracker.observe(frame({ cellId: "right", crossings: [crossing("front", "side-1", "right", "side-3")], shapeChanged: true }));
    expect(tracker.foundIds()).toEqual(["across-an-edge", "new-shape"]);

    tracker.reset();
    expect(tracker.foundIds()).toEqual([]);
    expect(tracker.isFound("across-an-edge")).toBe(false);

    tracker.observe(frame({ cellId: "right", crossings: [crossing("front", "side-1", "right", "side-3")] }));
    const found = tracker.observe(frame({ cellId: "front", crossings: [crossing("right", "side-2", "front", "side-0")] }));
    expect(found).toEqual(["back-where-you-started"]);
  });
});

describe("the catalog", () => {
  it("lists the six built-in discoveries when the world says nothing", () => {
    const { definitions, problems } = createDiscoveryCatalog();
    expect(definitions.map((definition) => definition.id)).toEqual([
      "across-an-edge",
      "back-where-you-started",
      "beam-came-home",
      "beam-hits-corner",
      "tight-string",
      "new-shape",
    ]);
    expect(problems).toEqual([]);
  });

  it("leaves out disabled ones, ignores unknown ids and adds the author's own with a marker", () => {
    const marker = { cellId: "front", position: { x: 1, y: 2, z: 0 } };
    const { definitions, problems } = createDiscoveryCatalog({
      disable: ["beam-hits-corner", "around-a-corner"],
      add: [{ id: "mine", name: "Mine", question: "Q?", teaser: "T", detector: { kind: "visitFace", cellId: "front" }, marker }],
      markers: [{ discovery: "new-shape", cellId: "front", position: { x: 3, y: 4, z: 0 } }],
    });
    expect(definitions.map((definition) => definition.id)).toEqual(["across-an-edge", "back-where-you-started", "beam-came-home", "tight-string", "new-shape", "mine"]);
    expect(definitions.find((definition) => definition.id === "mine")?.marker).toEqual(marker);
    expect(definitions.find((definition) => definition.id === "new-shape")?.marker?.position).toEqual({ x: 3, y: 4, z: 0 });
    expect(problems).toEqual([]);
  });

  it("names a clash of ids and a marker for nothing, and carries on", () => {
    const { definitions, problems } = createDiscoveryCatalog({
      disable: [],
      add: [{ id: "new-shape", name: "Again", question: "Q?", teaser: "T", detector: { kind: "visitFace", cellId: "front" } }],
      markers: [{ discovery: "nothing", cellId: "front", position: { x: 0, y: 0, z: 0 } }],
    });
    expect(definitions.filter((definition) => definition.id === "new-shape")).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });
});

describe("the Discoveries page", () => {
  it("shows name and question when found, a teaser otherwise, and Show edges under an edge", () => {
    const { definitions } = createDiscoveryCatalog();
    const entries = discoveryPageEntries(definitions, (id) => id === "across-an-edge");
    expect(entries[0]).toEqual({
      id: "across-an-edge",
      found: true,
      title: "Across an edge",
      text: "Which face did you land on? Was it the one you expected?",
      action: "show-edges",
    });
    const hidden = entries.find((entry) => entry.id === "beam-hits-corner");
    expect(hidden).toEqual({ id: "beam-hits-corner", found: false, title: "??? - something happens when a beam reaches a corner", text: "" });
  });
});
