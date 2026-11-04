/**
 * `tests/world-objects/geodesic/segments.test.ts` unit tier.
 *
 * The display state of the derived segments of an arc (`connectionState`): `"connected"` when both ends of the arc are on
 * emitters, `"open"` otherwise. An arc tied at a vertex is drawn open: there is no separate state for a tied arc.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicArcObject,
  createGeodesicCannonObject,
  createGeodesicVertexObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
import { isTied } from "../../../src/world-objects/geodesic/endpoints";
import { rebuildDerivedGeodesicSegments } from "../../../src/world-objects/geodesic/intervals";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { compileLargeWorld } from "../../fixtures/world-objects/geodesic";

function addEmitter(registry: ReturnType<typeof createRuntimeObjectRegistry>, id: string, x: number, y: number): void {
  registry.add(createGeodesicCannonObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
}

function addArc(registry: ReturnType<typeof createRuntimeObjectRegistry>, id: string, start: string, end: string): void {
  registry.add(createGeodesicArcObject({ id, startAnchorObjectId: start, endAnchorObjectId: end, startCellId: "a" }));
}

describe("derived segment display state", () => {
  it("draws the segments of a tied arc open", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    addEmitter(registry, "e1", -2, -1);
    addEmitter(registry, "e2", 2, -1);
    registry.add(createGeodesicVertexObject({ id: "v", cellId: "a", point: { x: 0, y: 1, z: geodesicRayBeamHeightMeters } }));
    addArc(registry, "g0", "e1", "v");
    addArc(registry, "g1", "v", "e2");
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g0" })).toBeTruthy();
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" })).toBeTruthy();

    expect(isTied(registry, "g0")).toBe(true);
    const segments = getGeodesicSegments(registry, "g0");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.connectionState === "open")).toBe(true);
  });

  it("marks the segments of an arc with an emitter at each end connected", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    addEmitter(registry, "e1", -2, 0);
    addEmitter(registry, "e2", 2, 0);
    addArc(registry, "g0", "e1", "e2");
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g0" })).toBeTruthy();

    const segments = getGeodesicSegments(registry, "g0");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.connectionState === "connected")).toBe(true);
  });
});
