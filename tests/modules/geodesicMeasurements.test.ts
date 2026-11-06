/**
 * `tests/modules/geodesicMeasurements.test.ts` — unit tier.
 *
 * The derive ticks of design 013 section 6.4, driven through the world engine with the geodesic model and the geodesic measurements modules: `geodesicModel/crossings`, `geodesicMeasurements/lengths`
 * and `geodesicMeasurements/angles`. Each wakes on a write of a kind it subscribes to (the lengths tick also when the local player moved), stays asleep otherwise, reads each change once,
 * and writes a record only when it changed. An angle whose centre marker was removed is removed. The pure refreshers they call are tested in `tests/world-objects/measureLengthTool.test.ts`
 * and `tests/world-objects/protractorTool.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { publishLocalPlayerPose } from "../../src/engine/worldEngine";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { geodesicRayBeamHeightMeters } from "../../src/world-objects/geodesic/objects";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorDirectedGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargeWorld, createSegment } from "../fixtures/world-objects/geodesic";
import { createDerivingTestEngine, runDerivePass } from "../support/engine";

const beam = geodesicRayBeamHeightMeters;

/** Two segments crossing at the origin of cell "a": g-a runs east along y = 0 from x = -1, g-b runs north along x = 0 from y = -1. The player stands at (-2, -2). */
function setup() {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry([
    createSegment({ id: "g-a:segment:0", geodesicId: "g-a", start: { x: -1, y: 0, z: beam }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 2 }),
    createSegment({ id: "g-b:segment:0", geodesicId: "g-b", start: { x: 0, y: -1, z: beam }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 2 }),
  ]);
  const engine = createDerivingTestEngine(registry, { getWorld: () => world, playerPose: { ...createDefaultPlayerPose("a"), position: { x: -2, y: -2, z: 0 } } });
  return { world, registry, engine };
}

function moveSegmentB(registry: RuntimeObjectRegistry, x: number): void {
  registry.update(createSegment({ id: "g-b:segment:0", geodesicId: "g-b", start: { x, y: -1, z: beam }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 2 }));
}

function addLength(registry: RuntimeObjectRegistry): void {
  const length = createMeasuredGeodesicLengthObject({ id: "length-a", registry, geodesicId: "g-a", playerCellId: "a", playerPoint: { x: -2, y: -2, z: 0 } });
  if (!length) throw new Error("Expected a length label.");
  registry.add(length);
}

function addAngle(registry: RuntimeObjectRegistry): void {
  const vertex = registry.getObjectsOfKind("geodesicModel/crossing")[0];
  const first = registry.get("g-a:segment:0");
  const second = registry.get("g-b:segment:0");
  if (!vertex || first?.kind !== "geodesicModel/segment" || second?.kind !== "geodesicModel/segment") throw new Error("Expected the crossing and its segments.");
  const center = resolveProtractorCenterSelection(registry, vertex);
  const a = resolveProtractorDirectedGeodesicSelection({ center, segment: first, hitPoint: { x: 0.5, y: 0, z: beam } });
  const b = resolveProtractorDirectedGeodesicSelection({ center, segment: second, hitPoint: { x: 0, y: 0.5, z: beam } });
  if (!a || !b) throw new Error("Expected the angle selections.");
  registry.add(createProtractorAngleObject({ id: "angle-a", center, first: a, second: b }));
}

function labelPointX(registry: RuntimeObjectRegistry, id: string): number {
  const object = registry.get(id);
  if (object?.kind !== "geodesicMeasurements/length") throw new Error("Expected a length label.");
  return object.labelPoint.x;
}

describe("the crossings tick", () => {
  it("wakes on a segment write, stays asleep otherwise and reads each change once", () => {
    const { registry, engine } = setup();
    runDerivePass(engine);
    expect(registry.getObjectsOfKind("geodesicModel/crossing")).toHaveLength(1);

    const head = registry.changes.ring.headSeq;
    runDerivePass(engine);
    expect(registry.changes.ring.headSeq).toBe(head);

    registry.add({ id: "flag", kind: "placedFlags/flag", cellId: "a", localPose: createSegment().localPose, portalRenderable: true, flagType: "WoodenSign1", message: "" });
    runDerivePass(engine);
    expect(registry.changes.ring.headSeq).toBe(head + 1);

    moveSegmentB(registry, 4);
    runDerivePass(engine);
    expect(registry.getObjectsOfKind("geodesicModel/crossing")).toHaveLength(0);
  });
});

describe("the lengths tick", () => {
  it("follows its geodesic, writes only what changed, and deletes a vanished geodesic label", () => {
    const { registry, engine } = setup();
    runDerivePass(engine);
    addLength(registry);
    runDerivePass(engine);

    const head = registry.changes.ring.headSeq;
    runDerivePass(engine);
    expect(registry.changes.ring.headSeq).toBe(head);

    registry.update(createSegment({ id: "g-a:segment:0", geodesicId: "g-a", start: { x: -1, y: 0, z: beam }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 3 }));
    runDerivePass(engine);
    expect(registry.get("length-a")).toMatchObject({ lengthMeters: 3 });

    registry.remove("g-a:segment:0");
    runDerivePass(engine);
    expect(registry.get("length-a")).toBeUndefined();
  });

  it("wakes when the local player moved, without any geodesic change", () => {
    const { registry, engine } = setup();
    runDerivePass(engine);
    addLength(registry);
    runDerivePass(engine);
    const before = labelPointX(registry, "length-a");

    publishLocalPlayerPose(engine, { ...createDefaultPlayerPose("a"), position: { x: 0.5, y: -2, z: 0 } });
    runDerivePass(engine);

    expect(labelPointX(registry, "length-a")).not.toBe(before);
  });

  it("stays asleep while the player stands still and no arc or segment is written", () => {
    const { registry, engine } = setup();
    runDerivePass(engine);
    addLength(registry);
    runDerivePass(engine);
    const length = registry.get("length-a");
    if (length?.kind !== "geodesicMeasurements/length") throw new Error("Expected the label.");
    // A hand-edited label is not recomputed by a pass that gives the tick no reason to wake.
    registry.update({ ...length, lengthMeters: 99 });
    runDerivePass(engine);
    expect(registry.get("length-a")).toMatchObject({ lengthMeters: 99 });
  });
});

describe("the angles tick", () => {
  it("refreshes a moved angle, writes only what changed, and drops it with its centre", () => {
    const { registry, engine } = setup();
    runDerivePass(engine);
    addAngle(registry);
    runDerivePass(engine);
    expect(registry.get("angle-a")).toMatchObject({ centerPoint: { x: 0, y: 0 } });

    const head = registry.changes.ring.headSeq;
    runDerivePass(engine);
    expect(registry.changes.ring.headSeq).toBe(head);

    moveSegmentB(registry, 0.25);
    runDerivePass(engine);
    expect(registry.get("angle-a")).toMatchObject({ centerPoint: { x: 0.25, y: 0 } });

    moveSegmentB(registry, 4);
    runDerivePass(engine);
    expect(registry.getObjectsOfKind("geodesicModel/crossing")).toHaveLength(0);
    expect(registry.get("angle-a")).toBeUndefined();
  });
});
