/**
 * `tests/world-objects/geodesic/geodesicTracingKernel.test.ts` — unit tier.
 *
 * Geodesics are traced on the shared segment-walk kernel (`walkDevelopedSegment`,
 * `_docs/MATHEMATICAL_MODEL.md` §4, §6): a geodesic's piece lengths always sum to the requested length and its
 * drawn polyline length matches, a long multi-wrap rebuild lands back on its target emitter, and every compiled
 * world's portal junctions have a forbidden zone at both ends of every portal side. The open-disk rule
 * (`_docs/MATHEMATICAL_MODEL.md` §7) stops a geodesic at the edge of a forbidden zone it starts on or enters, from
 * either side. When the walk's vertex tie rule decides an exit and the vertex has no forbidden zone of its own (a
 * plain wall corner), the terminal is still reported as a forbidden-zone-hit rather than a wall-hit through the
 * shared corner — these tests check that through `shootGeodesic`, the one public entry point that reaches this
 * mapping, rather than the pure (but test-only-exported) conversion function directly.
 */
import { createFixtureArc as createGeodesicArcObject } from "../../support/arcs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../../src/cell-complex/compileCellComplex";
import { invertRigidTransform3, transformPoint3, yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import {
  createGeodesicEmitterObject,
  geodesicRayBeamHeightMeters,
  getGeodesicSegmentEnd,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { traceGeodesicSegment } from "../../../src/world-objects/geodesic/trace";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { rebuildConnectedGeodesicBetweenEmitters, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { exampleWorldSpecs } from "../../support/arbitraries";

const torusSpec = exampleWorldSpecs.find(([name]) => name === "torusModuli")![1];
const torusWorld = compileCellComplex(torusSpec);
const torusCell = "torus-room";

describe("geodesic tracing on the kernel", () => {
  it("sums piece lengths to the requested length, ending at the developed end point", () => {
    let checked = 0;
    fc.assert(
      fc.property(
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 15, max: 3000, noNaN: true }),
        (x, y, yaw, length) => {
          const registry = createRuntimeObjectRegistry();
          const cannon = createGeodesicEmitterObject({
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

  it("rebuilds a connected interval whose end anchor is 1e-5 m from a portal side after 10 wraps", () => {
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicEmitterObject({ id: "cannon-a", cellId: torusCell, localPose: yawRigidTransform3(0, { x: -3, y: 2, z: 0 }) }));
    registry.add(createGeodesicEmitterObject({
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
    registry.add(createGeodesicArcObject({
      id: "g-wrap",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: torusCell,
      portalWord: word,
    }));

    const segments = rebuildConnectedGeodesicBetweenEmitters({ world: torusWorld, registry, geodesicId: "g-wrap" });

    expect(segments.filter((segment) => segment.terminal.kind === "portal-hit")).toHaveLength(10);
    expect(collectGeodesicPortalWord(registry, "g-wrap")).toEqual(word);
    const last = segments[segments.length - 1];
    const end = getGeodesicSegmentEnd(last);
    expect(Math.hypot(end.x - (7.5 - 1e-5), end.y - 2.3)).toBeLessThan(1e-8);
  });

  it("draws a polyline whose length equals the measured (summed) length", () => {
    // Pick the first yaw whose 120 m chord avoids the corner zones.
    let segments: readonly GeodesicSegmentObject[] = [];
    for (const yaw of [0.3, 0.45, 0.61, 0.9, 1.1]) {
      const registry = createRuntimeObjectRegistry();
      const cannon = createGeodesicEmitterObject({ id: "cannon", cellId: torusCell, localPose: yawRigidTransform3(yaw, { x: 1, y: 2, z: 0 }) });
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

  it("reports a forbidden-zone-hit at a plain wall corner via the walk's vertex tie rule", () => {
    // A square room with no portals: the corner at (1, 1) has no forbidden zone of its own (prismCells only adds
    // one at a portal-side endpoint), but a geodesic aimed exactly at it ties between the two walls that meet
    // there, and the kernel still reports the corner itself, not an arbitrary choice of one wall.
    const world = compileCellComplex({
      cells: [
        {
          id: "room",
          heightMeters: 2,
          baseVertices: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
          ],
          portals: [],
        },
      ],
    });
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicEmitterObject({
      id: "cannon",
      cellId: "room",
      localPose: yawRigidTransform3(Math.atan2(1, 1), { x: 0, y: 0, z: 0 }),
    });
    registry.add(cannon);

    shootGeodesic({ world, registry, cannon, geodesicId: "g", maxLengthMeters: 2, connectEmitters: false });

    expect(getGeodesicSegments(registry, "g").at(-1)?.terminal).toEqual({
      kind: "forbidden-zone-hit",
      junctionId: "room:vertex-2",
    });
  });
});
