/**
 * `tests/world-objects/geodesic/beamRows.test.ts` unit tier.
 *
 * The rows of the Laser menu's beam list (design 017 section 8.5): a free beam reads "Beam 1 . 4.0 m . free" (one decimal), a beam between two lasers reads "Beam 2 . L1-L3 . linked" with the lasers' short ids, and a beam that is part of a string whose lasers cannot both be read reads "Beam 3 . string".
 * The text is built by the vocabulary's `beamRowLabel`; the registry side gathers the number, the length and the short ids.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { createGeodesicEmitterObject } from "../../../src/world-objects/geodesic/objects";
import { beamRowLabelsById } from "../../../src/world-objects/geodesic/beamRows";
import { actionWithKey, beamRowLabel, laserShortIdOfLabel } from "../../../src/world-objects/vocabulary";
import { createFixtureArc } from "../../support/arcs";
import { compileTorusLoopWorld } from "../../fixtures/world-objects/geodesic";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import { getGeodesicTotalLengthMeters } from "../../../src/world-objects/geodesic/segments";

describe("beam rows", () => {
  it("formats a free, a linked and a string beam in words", () => {
    expect(beamRowLabel(1, { kind: "free", lengthMeters: 4 })).toBe("Beam 1 · 4.0 m · free");
    expect(beamRowLabel(1, { kind: "free", lengthMeters: 12.349 })).toBe("Beam 1 · 12.3 m · free");
    expect(beamRowLabel(2, { kind: "linked", ends: ["L1", "L3"] })).toBe("Beam 2 · L1–L3 · linked");
    expect(beamRowLabel(3, { kind: "string" })).toBe("Beam 3 · string");
  });

  it("joins an action and its key with a dot, and finds a laser's short id", () => {
    expect(actionWithKey("Pick up", "G")).toBe("Pick up · G");
    expect(actionWithKey("Pick up")).toBe("Pick up");
    expect(laserShortIdOfLabel("Laser L3")).toBe("L3");
    expect(laserShortIdOfLabel(undefined)).toBe("Laser");
  });

  it("reads the rows of a laser's beams from the registry", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicEmitterObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -3, y: 0, z: 0 }), label: "Laser L1" }));
    registry.add(createGeodesicEmitterObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 3, y: 2, z: 0 }), label: "Laser L3" }));
    registry.add(createFixtureArc({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "torus-room" }));
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g1" });

    const rows = beamRowLabelsById(registry, ["g1"], ["g1"]);
    expect(rows.g1).toMatch(/^Beam \d+ · L1–L3 · linked$/);

    const free = beamRowLabelsById(registry, ["g1"], []);
    expect(free.g1).toBe(`Beam ${/\d+/.exec(rows.g1!)![0]} · ${getGeodesicTotalLengthMeters(registry, "g1").toFixed(1)} m · free`);
  });
});
