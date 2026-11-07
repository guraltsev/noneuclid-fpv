/**
 * `tests/world-objects/geodesic/cutAtEmitter.test.ts` — unit tier.
 *
 * `cutArcsPassingEmitter` on a tied curve: an emitter set down on a curve that the curve shortening flow is straightening pins it there,
 * and the two parts then straighten on their own, both ending at the emitter. Free and connected arcs are covered through the carry in
 * `tests/modules/carry.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { cutArcsPassingEmitter } from "../../../src/world-objects/geodesic/cutAtEmitter";
import { arcConnectsEmitters } from "../../../src/world-objects/geodesic/lifecycle";
import { getEmitterGeodesicIds, isTied } from "../../../src/world-objects/geodesic/endpoints";
import { createGeodesicEmitterObject, type GeodesicArcObject, type GeodesicEmitterObject } from "../../../src/world-objects/geodesic/objects";
import { createFlowTestEngine, createTorusTiedPairScenario, runCurveShorteningUntilAtRest } from "../../fixtures/world-objects/geodesic";

describe("setting an emitter down on a tied curve", () => {
  // The tied pair: e1 at (-3, 0), the vertex "free" at (3, 2); g1 runs e1 -> free straight, g2 runs free -> e1 once round the torus to the right.
  // The pin goes on g1 at (0, 1), halfway along it.
  function pinnedScene() {
    const { world, registry } = createTorusTiedPairScenario();
    const pin: GeodesicEmitterObject = createGeodesicEmitterObject({ id: "pin", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 0, y: 1, z: 0 }) });
    registry.add(pin);
    let next = 0;
    const leaving = cutArcsPassingEmitter({ world, registry, emitter: pin, createArcId: () => `cut-${next++}` });
    return { world, registry, leaving };
  }

  it("splits the tied arc at the emitter, the part beyond it still tied", () => {
    const { registry, leaving } = pinnedScene();

    expect(leaving).toEqual(["cut-0"]);
    expect(registry.get("g1")).toMatchObject({ start: { anchorObjectId: "e1" }, end: { anchorObjectId: "pin" } });
    expect(registry.get("cut-0")).toMatchObject({ start: { anchorObjectId: "pin" }, end: { anchorObjectId: "free" } });
    expect(arcConnectsEmitters(registry, "g1")).toBe(true);
    expect(isTied(registry, "cut-0")).toBe(true);
    expect(isTied(registry, "g2")).toBe(true);
  });

  it("keeps the curve on the emitter while the flow straightens the part beyond it", () => {
    const { world, registry } = pinnedScene();
    const engine = createFlowTestEngine(world, registry);

    runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g1", "cut-0", "g2"], deltaSeconds: 1 / 30, maxTicks: 5000 });

    // The vertex has straightened away and its two arcs merged: what is left is e1 -> pin and one arc from the pin round the torus to e1.
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toEqual([]);
    const onPin = getEmitterGeodesicIds(registry, "pin");
    expect(onPin).toHaveLength(2);
    for (const arcId of onPin) {
      expect(arcConnectsEmitters(registry, arcId)).toBe(true);
    }
    const around = onPin.map((arcId) => registry.get(arcId) as GeodesicArcObject).find((arc) => arc.portalWord.length > 0);
    // Still once round to the right from the pin: read from the pin it crosses right-left, read from e1 (the merge may keep either direction) left-right.
    expect(around?.portalWord.map((step) => step.sourcePortalId)).toEqual([around?.start.anchorObjectId === "pin" ? "right-left" : "left-right"]);
    expect(registry.get("pin")?.localPose.translation).toMatchObject({ x: 0, y: 1 });
  });
});
