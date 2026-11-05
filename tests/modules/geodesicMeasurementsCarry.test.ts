/**
 * `tests/modules/geodesicMeasurementsCarry.test.ts` — unit tier.
 *
 * A protractor angle centred on a cannon follows the cannon when it is carried. Carrying one cannon within a cell rewrites the cannon and
 * the segments of its connected geodesics but not their arcs, so the angles tick must also wake on a cannon write. The stored angle is compared
 * with `refreshProtractorAngleObject` computed fresh, so any stale field fails the test.
 */
import { describe, expect, it } from "vitest";
import { carryModule } from "../../src/modules/carry";
import { carryOffsetSlot } from "../../src/modules/carry/api";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import {
  createProtractorAngleObject,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import { createMeasuredGeodesicLengthObject, refreshMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
import { createTestEngine, runDerivePass, runFrame } from "../support/engine";

/** Cannon P with two connected geodesics ending on cannons Q and R, and an angle between them centred on P. */
function connectedPairWithAngle() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  for (const [id, x, y] of [["P", 3, 2.5], ["Q", 5, 2.5], ["R", 3, 4]] as const) {
    registry.add(createGeodesicEmitterObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
  }
  const p = registry.get("P");
  if (p?.kind !== "geodesicEmitters/emitter") throw new Error("cannon P missing");
  shootGeodesic({ world, registry, cannon: p, geodesicId: "g-pq", maxLengthMeters: 2 });
  const afterFirst = registry.get("P");
  if (afterFirst?.kind !== "geodesicEmitters/emitter") throw new Error("cannon P missing");
  const turned = { ...afterFirst, aimYawRadians: Math.PI / 2, localPose: yawRigidTransform3(Math.PI / 2, afterFirst.localPose.translation) };
  registry.update(turned);
  shootGeodesic({ world, registry, cannon: turned, geodesicId: "g-pr", maxLengthMeters: 1.5 });

  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [geodesicModelModule(), geodesicMeasurementsModule(), carryModule()],
    playerPose: { ...createDefaultPlayerPose("a"), position: { x: 2.5, y: 2.5, z: 0 } },
  });
  runDerivePass(engine);
  const cannon = registry.get("P");
  if (cannon?.kind !== "geodesicEmitters/emitter") throw new Error("cannon P missing");
  const center = resolveProtractorCenterSelection(registry, cannon);
  const first = resolveProtractorEmitterGeodesicSelection({ center, emitter: cannon, registry, geodesicId: "g-pq" });
  const second = resolveProtractorEmitterGeodesicSelection({ center, emitter: cannon, registry, geodesicId: "g-pr" });
  if (!first || !second) throw new Error("angle selections missing");
  registry.add(createProtractorAngleObject({ id: "angle", center, first, second }));
  runDerivePass(engine);
  return { registry, engine };
}

describe("an angle centred on a carried cannon", () => {
  it("follows the cannon at every step of the carry", () => {
    const { registry, engine } = connectedPairWithAngle();
    const ticket = engine.submit("local", { kind: "carry/attach", objectId: "P" } as never);
    engine.step(0);
    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
    engine.endFrame();

    for (let step = 0; step < 4; step += 1) {
      engine.setControl("local", carryOffsetSlot, { x: 3, y: 3.2, leashMeters: 5 });
      runFrame(engine, 1 / 60);
      engine.endFrame();
      const stored = registry.get("angle");
      if (stored?.kind !== "geodesicMeasurements/angle") throw new Error("the angle was removed");
      expect(stored, `carry step ${step}`).toEqual(refreshProtractorAngleObject({ registry, angle: stored }));
    }
  });
});

/** Carries `objectId` toward `target` for four steps; after each step the stored angle (or, with `withLength`, the stored length) must equal a fresh refresh. */
function carryAndCompare(objectId: string, target: { x: number; y: number }, withLength: boolean): void {
  const { registry, engine } = connectedPairWithAngle();
  const playerPoint = { x: 2.5, y: 2.5, z: 0 };
  if (withLength) {
    const length = createMeasuredGeodesicLengthObject({ id: "length", registry, geodesicId: "g-pq", playerCellId: "a", playerPoint });
    if (!length) throw new Error("no length");
    registry.add(length);
    runDerivePass(engine);
  }
  const ticket = engine.submit("local", { kind: "carry/attach", objectId } as never);
  engine.step(0);
  expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
  engine.endFrame();
  for (let step = 0; step < 4; step += 1) {
    engine.setControl("local", carryOffsetSlot, { x: target.x, y: target.y, leashMeters: 5 });
    runFrame(engine, 1 / 60);
    engine.endFrame();
    const stored = registry.get("angle");
    if (stored?.kind !== "geodesicMeasurements/angle") throw new Error("the angle was removed");
    if (!withLength) expect(stored, `${objectId} carry step ${step}: angle`).toEqual(refreshProtractorAngleObject({ registry, angle: stored }));
    if (withLength) {
      const length = registry.get("length");
      if (length?.kind !== "geodesicMeasurements/length") throw new Error("the length was removed");
      expect(length, `${objectId} carry step ${step}: length`).toEqual(
        refreshMeasuredGeodesicLengthObject({ registry, world: compileLargePortalWorld(), measurement: length, playerCellId: "a", playerPoint }),
      );
    }
  }
}

describe("an angle at one end of a beam whose other end is carried", () => {
  it("follows when the far cannon Q of g-pq is carried", () => carryAndCompare("Q", { x: 3, y: 3.2 }, false));
  it("follows when the far cannon R of g-pr is carried", () => carryAndCompare("R", { x: 4, y: 4.2 }, false));
});

describe("a measured length of a beam whose far end is carried", () => {
  it("equals a fresh refresh when Q is carried", () => carryAndCompare("Q", { x: 3, y: 3.2 }, true));
  it("equals a fresh refresh when P is carried", () => carryAndCompare("P", { x: 3, y: 3.2 }, true));
});
