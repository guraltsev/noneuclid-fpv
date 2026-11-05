/**
 * `tests/modules/geodesicMeasurementsCarry.test.ts` — unit tier.
 *
 * A protractor angle centred on a cannon follows the cannon when it is carried. Carrying one cannon within a cell rewrites the cannon and
 * the segments of its locked geodesics but not their arcs, so the angles tick must also wake on a cannon write. The stored angle is compared
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
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import {
  createProtractorAngleObject,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
import { createTestEngine, runDerivePass } from "../support/engine";

/** Cannon P with two locked geodesics ending on cannons Q and R, and an angle between them centred on P. */
function lockedPairWithAngle() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  for (const [id, x, y] of [["P", 3, 2.5], ["Q", 5, 2.5], ["R", 3, 4]] as const) {
    registry.add(createGeodesicCannonObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
  }
  const p = registry.get("P");
  if (p?.kind !== "geodesic-cannon") throw new Error("cannon P missing");
  shootGeodesic({ world, registry, cannon: p, geodesicId: "g-pq", maxLengthMeters: 2 });
  const afterFirst = registry.get("P");
  if (afterFirst?.kind !== "geodesic-cannon") throw new Error("cannon P missing");
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
  if (cannon?.kind !== "geodesic-cannon") throw new Error("cannon P missing");
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
    const { registry, engine } = lockedPairWithAngle();
    const ticket = engine.submit("local", { kind: "carry/attach", objectId: "P" } as never);
    engine.step(0);
    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
    engine.endFrame();

    for (let step = 0; step < 4; step += 1) {
      engine.setControl("local", carryOffsetSlot, { x: 3, y: 3.2, leashMeters: 5 });
      engine.step(1 / 60);
      engine.endFrame();
      const stored = registry.get("angle");
      if (stored?.kind !== "geodesicMeasurements/angle") throw new Error("the angle was removed");
      expect(stored, `carry step ${step}`).toEqual(refreshProtractorAngleObject({ registry, angle: stored }));
    }
  });
});
