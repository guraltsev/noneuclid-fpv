import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../../src/cell-complex/compileCellComplex";
import type { SegmentWalkPiece } from "../../../src/cell-complex/segmentWalk";
import { identityRigidTransform3, invertRigidTransform3, transformPoint3, yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import {
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
  getGeodesicSegmentEnd,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { geodesicTerminalFromWalkPiece, traceGeodesicSegment } from "../../../src/world-objects/geodesic/trace";
import { updateGeodesicIntersectionObjects } from "../../../src/world-objects/geodesic/intersections";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { rebuildConnectedGeodesicBetweenEmitters, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { exampleWorldSpecs } from "../../support/arbitraries";

const torusSpec = exampleWorldSpecs.find(([name]) => name === "torusModuli")![1];
const torusWorld = compileCellComplex(torusSpec);
const torusCell = "torus-room";

function createSegment(overrides: Partial<GeodesicSegmentObject>): GeodesicSegmentObject {
  return {
    id: "g-a:segment:0",
    kind: "geodesic-segment",
    cellId: "a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: geodesicRayBeamHeightMeters }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}

describe("geodesic tracing on the kernel (job 15)", () => {
  it("sums piece lengths to the requested length and ends at the developed end point (up to 200 crossings)", () => {
    let checked = 0;
    fc.assert(
      fc.property(
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 15, max: 3000, noNaN: true }),
        (x, y, yaw, length) => {
          const registry = createRuntimeObjectRegistry();
          const cannon = createGeodesicCannonObject({
            id: "cannon",
            cellId: torusCell,
            localPose: yawRigidTransform3(yaw, { x, y, z: 0 }),
          });
          registry.add(cannon);
          let segments: readonly GeodesicSegmentObject[];
          try {
            shootGeodesic({ world: torusWorld, registry, cannon, geodesicId: "g", maxLengthMeters: length, connectEmitters: false });
            segments = getGeodesicSegments(registry, "g");
          } catch {
            fc.pre(false);
            return;
          }
          fc.pre(segments.every((segment) => segment.terminal.kind === "open" || segment.terminal.kind === "portal-hit"));

          const total = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
          expect(Math.abs(total - length)).toBeLessThan(1e-9);

          // Pull the last end point back through the inverse transforms of the crossed portals.
          let point = getGeodesicSegmentEnd(segments[segments.length - 1]);
          for (let index = segments.length - 2; index >= 0; index -= 1) {
            const terminal = segments[index].terminal;
            if (terminal.kind !== "portal-hit") {
              continue; // the registry also splits a piece into two halves; only portal hits change cell
            }
            const portal = torusWorld.cellsById.get(segments[index].cellId)!.portalsById.get(terminal.portalId)!;
            point = transformPoint3(invertRigidTransform3(portal.transformToTarget), point);
          }
          const first = segments[0];
          const expectedX = first.start.x + Math.cos(yaw) * length;
          const expectedY = first.start.y + Math.sin(yaw) * length;
          expect(Math.hypot(point.x - expectedX, point.y - expectedY)).toBeLessThan(1e-8);
          checked += 1;
        },
      ),
      { numRuns: 50 },
    );
    expect(checked).toBeGreaterThan(10);
  });

  it("rebuilds a locked interval whose end anchor is 1e-5 m from a portal side after ten wraps", () => {
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: torusCell, localPose: yawRigidTransform3(0, { x: -3, y: 2, z: 0 }) }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b",
      cellId: torusCell,
      localPose: yawRigidTransform3(0, { x: 7.5 - 1e-5, y: 2.3, z: 0 }),
    }));
    const portal = torusWorld.cellsById.get(torusCell)!.portals.find((candidate) => candidate.sideIndex === 1)!;
    const traversal = {
      sourceCellId: torusCell,
      sourcePortalId: portal.id,
      targetCellId: portal.targetCellId,
      targetPortalId: portal.targetPortalId,
    };
    const word = Array.from({ length: 10 }, () => traversal);
    registry.add(createGeodesicIntervalObject({
      id: "g-wrap",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: torusCell,
      portalWord: word,
    }));

    const segments = rebuildConnectedGeodesicBetweenEmitters({ world: torusWorld, registry, geodesicId: "g-wrap" });

    expect(segments.filter((segment) => segment.terminal.kind === "portal-hit")).toHaveLength(10);
    expect(collectGeodesicPortalWord(torusWorld, registry, "g-wrap")).toEqual(word);
    const last = segments[segments.length - 1];
    const end = getGeodesicSegmentEnd(last);
    expect(Math.hypot(end.x - (7.5 - 1e-5), end.y - 2.3)).toBeLessThan(1e-8);
  });

  it("draws a polyline whose length equals the measured (summed) length", () => {
    // Pick the first yaw whose 120 m chord avoids the corner zones.
    let segments: readonly GeodesicSegmentObject[] = [];
    for (const yaw of [0.3, 0.45, 0.61, 0.9, 1.1]) {
      const registry = createRuntimeObjectRegistry();
      const cannon = createGeodesicCannonObject({ id: "cannon", cellId: torusCell, localPose: yawRigidTransform3(yaw, { x: 1, y: 2, z: 0 }) });
      registry.add(cannon);
      shootGeodesic({ world: torusWorld, registry, cannon, geodesicId: "g", maxLengthMeters: 120, connectEmitters: false });
      segments = getGeodesicSegments(registry, "g");
      if (segments.every((segment) => segment.terminal.kind === "open" || segment.terminal.kind === "portal-hit")) {
        break;
      }
    }

    const summedLengths = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
    const polylineLength = segments.reduce((sum, segment) => {
      const end = getGeodesicSegmentEnd(segment);
      return sum + Math.hypot(end.x - segment.start.x, end.y - segment.start.y);
    }, 0);

    expect(segments.filter((segment) => segment.terminal.kind === "portal-hit").length).toBeGreaterThan(5);
    expect(Math.abs(summedLengths - 120)).toBeLessThan(1e-9);
    expect(Math.abs(polylineLength - summedLengths)).toBeLessThan(1e-9);
  });

  describe("open-disk rule", () => {
    const zone = torusWorld.cellsById.get(torusCell)!.forbiddenZones[0];
    const centre = zone.collision.center;
    const radius = zone.collision.radius;
    const s = Math.SQRT1_2;
    const onCircle = { x: centre.x + radius * s, y: centre.y + radius * s, z: geodesicRayBeamHeightMeters };

    it("hits at t = 0 from a start on the circle aimed inward, and not aimed outward", () => {
      const inward = traceGeodesicSegment({ world: torusWorld, cellId: torusCell, start: onCircle, direction: { x: -s, y: -s, z: 0 }, maxLengthMeters: 1 });
      const outward = traceGeodesicSegment({ world: torusWorld, cellId: torusCell, start: onCircle, direction: { x: s, y: s, z: 0 }, maxLengthMeters: 1 });

      expect(inward.terminal.kind).toBe("forbidden-zone-hit");
      expect(inward.lengthMeters).toBe(0);
      expect(outward.terminal.kind).toBe("open");
      expect(outward.lengthMeters).toBe(1);
    });

    it("gives the same answer for the reversed role orientation", () => {
      const outside = { x: onCircle.x + s, y: onCircle.y + s, z: onCircle.z };
      const toward = traceGeodesicSegment({ world: torusWorld, cellId: torusCell, start: outside, direction: { x: -s, y: -s, z: 0 }, maxLengthMeters: 1 });

      expect(toward.terminal.kind).toBe("forbidden-zone-hit");
      expect(toward.lengthMeters).toBeCloseTo(1, 9);
    });

    it("hits at t = 0 from a start strictly inside", () => {
      const inside = { x: centre.x + 0.5 * radius * s, y: centre.y + 0.5 * radius * s, z: onCircle.z };
      const trace = traceGeodesicSegment({ world: torusWorld, cellId: torusCell, start: inside, direction: { x: s, y: s, z: 0 }, maxLengthMeters: 1 });

      expect(trace.terminal.kind).toBe("forbidden-zone-hit");
      expect(trace.lengthMeters).toBe(0);
    });
  });

  describe("intersections", () => {
    it("reports a crossing between two segments of one geodesic that are two apart", () => {
      const registry = createRuntimeObjectRegistry([
        createSegment({ id: "g-a:segment:0", segmentIndex: 0, start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 2 }),
        createSegment({ id: "g-a:segment:1", segmentIndex: 1, start: { x: 2, y: 1, z: geodesicRayBeamHeightMeters }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 1 }),
        createSegment({ id: "g-a:segment:2", segmentIndex: 2, start: { x: 2, y: 2, z: geodesicRayBeamHeightMeters }, direction: { x: -1, y: 0, z: 0 }, lengthMeters: 1.5 }),
        createSegment({ id: "g-a:segment:3", segmentIndex: 3, start: { x: 0.5, y: 2, z: geodesicRayBeamHeightMeters }, direction: { x: 0, y: -1, z: 0 }, lengthMeters: 2 }),
      ]);

      const vertices = updateGeodesicIntersectionObjects(registry);

      expect(vertices).toHaveLength(1);
      expect(vertices[0].geodesicIds).toEqual(["g-a", "g-a"]);
      expect(vertices[0].segmentIds).toEqual(["g-a:segment:0", "g-a:segment:3"]);
    });

    it("reports a crossing of two geodesics 0.2 m from an unrelated emitter", () => {
      const registry = createRuntimeObjectRegistry([
        createGeodesicCannonObject({ id: "other", cellId: "a", localPose: yawRigidTransform3(0, { x: 1.2, y: 1, z: 0 }) }),
        createSegment({ id: "g-a:segment:0", start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 2 }),
        createSegment({ id: "g-b:segment:0", geodesicId: "g-b", start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 2 }),
      ]);

      expect(updateGeodesicIntersectionObjects(registry)).toHaveLength(1);
    });

    it("does not report geodesics that meet at the shared start anchor", () => {
      const registry = createRuntimeObjectRegistry([
        createSegment({ id: "g-a:segment:0", start: { x: 1, y: 1, z: geodesicRayBeamHeightMeters }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 1 }),
        createSegment({ id: "g-b:segment:0", geodesicId: "g-b", start: { x: 1, y: 1, z: geodesicRayBeamHeightMeters }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 1 }),
      ]);

      expect(updateGeodesicIntersectionObjects(registry)).toEqual([]);
    });
  });

  it("has a junction at both ends of every portal side in every example world", () => {
    for (const [name, spec] of exampleWorldSpecs) {
      const world = compileCellComplex(spec);

      for (const cell of world.cells) {
        const junctionIds = new Set(cell.forbiddenZones.map((zone) => zone.junctionId));

        for (const portal of cell.portals) {
          const count = cell.sides.length;
          expect(junctionIds.has(`${cell.id}:vertex-${portal.sideIndex}`), `${name} ${cell.id} ${portal.id} start`).toBe(true);
          expect(junctionIds.has(`${cell.id}:vertex-${(portal.sideIndex + 1) % count}`), `${name} ${cell.id} ${portal.id} end`).toBe(true);
        }
      }
    }
  });

  it("maps a walk piece that exits through a vertex to a forbidden-zone-hit at that vertex", () => {
    const piece: SegmentWalkPiece = {
      cellId: "c",
      cellFromStart: identityRigidTransform3,
      tEnter: 0,
      tExit: 1,
      exit: { kind: "wall", sideIndex: 3, throughVertexIndex: 2 },
    };

    expect(geodesicTerminalFromWalkPiece(piece)).toEqual({ kind: "forbidden-zone-hit", junctionId: "c:vertex-2" });
    expect(geodesicTerminalFromWalkPiece({ ...piece, exit: { kind: "wall", sideIndex: 3 } })).toEqual({ kind: "wall-hit", sideIndex: 3 });
    expect(geodesicTerminalFromWalkPiece({ ...piece, exit: { kind: "end" } })).toEqual({ kind: "open" });
  });
});
