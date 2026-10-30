import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { developPortalSegment, type OrientedPortalSegment } from "../../src/cell-complex/orientedPortal";
import {
  clipLineConeByPortal,
  lineConeForTwoPortals,
  lineConeMeasure,
  portalConstraintVectors,
  type LineCone,
} from "../../src/cell-complex/staticLineCone";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { crossVec3, dotVec3, lengthVec3, scaleVec3, type Vec3 } from "../../src/math/vec3";
import { mulberry32 } from "../support/portalWordWitness";

function portal(left: [number, number], right: [number, number], apertureTopMeters = 3): OrientedPortalSegment {
  return { left: { x: left[0], y: left[1] }, right: { x: right[0], y: right[1] }, apertureTopMeters };
}

/** Brute-force extreme rays of {l : h . l >= 0 for all h}: every pair of constraint planes, both signs, kept if feasible. */
function bruteForceRays(hs: readonly Vec3[]): Vec3[] {
  const rays: Vec3[] = [];

  for (let i = 0; i < hs.length; i += 1) {
    for (let j = i + 1; j < hs.length; j += 1) {
      const c = crossVec3(hs[i], hs[j]);
      const length = lengthVec3(c);

      if (length < 1e-12) {
        continue;
      }

      for (const sign of [1, -1]) {
        const r = scaleVec3(c, sign / length);

        if (hs.every((h) => dotVec3(h, r) >= -1e-12 * lengthVec3(h)) && !rays.some((o) => lengthVec3(diff(o, r)) < 1e-9)) {
          rays.push(r);
        }
      }
    }
  }

  return rays;
}

function diff(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function sameRaySet(a: LineCone, b: LineCone): boolean {
  return (
    a.length === b.length &&
    a.every((r) => b.some((o) => lengthVec3(diff(r, o)) < 1e-9)) &&
    b.every((r) => a.some((o) => lengthVec3(diff(r, o)) < 1e-9))
  );
}

function hasRayUpToScale(cone: LineCone, expected: Vec3): boolean {
  const unit = scaleVec3(expected, 1 / lengthVec3(expected));

  return cone.some((r) => lengthVec3(diff(r, unit)) < 1e-9);
}

describe("developPortalSegment", () => {
  it("develops side 1 of a square room with left/right as seen when leaving it", () => {
    const squareBase = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const world = compileCellComplex({
      cells: [
        { id: "room-a", heightMeters: 3, baseVertices: squareBase, portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }] },
        { id: "room-b", heightMeters: 3, baseVertices: squareBase, portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }] },
      ],
    });
    const segment = developPortalSegment(world, "room-a", 1, identityRigidTransform3);
    const side = world.cellsById.get("room-a")!.sides[1];
    const mid = { x: (segment.left.x + segment.right.x) / 2, y: (segment.left.y + segment.right.y) / 2 };

    expect(segment.right).toEqual({ x: 1, y: -1 });
    expect(segment.left).toEqual({ x: 1, y: 1 });
    expect(segment.apertureTopMeters).toBe(3);
    // cross(-inwardNormal, left - mid) > 0: left is on the left when facing out of the cell.
    const out = { x: -side.inwardNormal.x, y: -side.inwardNormal.y };

    expect(out.x * (segment.left.y - mid.y) - out.y * (segment.left.x - mid.x)).toBeGreaterThan(0);
  });

  it("throws for a missing cell or side", () => {
    const world = compileCellComplex({
      cells: [{ id: "a", heightMeters: 3, baseVertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], portals: [] }],
    });

    expect(() => developPortalSegment(world, "nope", 0, identityRigidTransform3)).toThrow();
    expect(() => developPortalSegment(world, "a", 9, identityRigidTransform3)).toThrow();
  });
});

describe("static line cone", () => {
  const p1 = portal([-1, 0], [1, 0]);
  const p2 = portal([-1, 2], [1, 2]);

  it("builds the crossed-strings cone of two parallel segments", () => {
    const cone = lineConeForTwoPortals(p1, p2, 0);

    expect(cone).toHaveLength(4);
    expect(hasRayUpToScale(cone, { x: -1, y: 0, z: -1 })).toBe(true);
    expect(hasRayUpToScale(cone, { x: -1, y: 0, z: 1 })).toBe(true);
    expect(hasRayUpToScale(cone, { x: -1, y: 1, z: -1 })).toBe(true);
    expect(hasRayUpToScale(cone, { x: -1, y: -1, z: 1 })).toBe(true);
    expect(lineConeMeasure(cone)).toBeCloseTo(4 * Math.sqrt(2) - 4, 9);
  });

  it("handles segments sharing an endpoint (adjacent sides of one square)", () => {
    const cone = lineConeForTwoPortals(portal([0, 0], [1, 0]), portal([1, 1], [1, 0]), 0);

    expect(cone).toHaveLength(3);
    expect(lineConeMeasure(cone)).toBeCloseTo(2 - Math.sqrt(2), 9);
  });

  it("returns an empty cone for an impossible word", () => {
    expect(lineConeForTwoPortals(p1, portal([1, -2], [-1, -2]), 0)).toHaveLength(0);
    expect(lineConeForTwoPortals(p1, portal([1, -2], [-1, -2]), 1e-6)).toHaveLength(0);
  });

  it("clips without losing lines that pass the middle segment", () => {
    const cone = clipLineConeByPortal(lineConeForTwoPortals(p1, p2, 0), portal([-1, 4], [1, 4]), 0);

    expect(lineConeMeasure(cone)).toBeCloseTo(4 * Math.sqrt(5) - 8, 9);
    expect(sameRaySet(cone, lineConeForTwoPortals(p1, portal([-1, 4], [1, 4]), 0))).toBe(true);
  });

  it("clips to nothing when the third segment is out of reach", () => {
    const cone = clipLineConeByPortal(lineConeForTwoPortals(p1, p2, 0), portal([3.5, 4], [5, 4]), 0);

    expect(lineConeMeasure(cone)).toBeLessThan(1e-9);
  });

  it("widening only enlarges the cone", () => {
    const tight = lineConeMeasure(lineConeForTwoPortals(p1, p2, 0));
    const wide = lineConeMeasure(lineConeForTwoPortals(p1, p2, 1e-3));

    expect(wide).toBeGreaterThan(tight);
    const [hL, hR] = portalConstraintVectors(p1, 0);

    expect([hL.x, hL.y, hL.z]).toEqual([-1, 0, 1]);
    expect([hR.x + 0, hR.y + 0, hR.z]).toEqual([-1, 0, -1]);
  });

  it("clipping equals brute-force vertex enumeration and never increases the measure", () => {
    const rng = mulberry32(12345);
    const base = lineConeForTwoPortals(p1, p2, 0);
    const baseHs = [...portalConstraintVectors(p1, 0), ...portalConstraintVectors(p2, 0)];
    let checked = 0;

    for (let sample = 0; sample < 200; sample += 1) {
      const x0 = -4 + 6 * rng();
      const width = 0.2 + 2.8 * rng();
      const y3 = 2.5 + 3.5 * rng();
      const p3 = portal([x0, y3], [x0 + width, y3]);
      const clipped = clipLineConeByPortal(base, p3, 0);

      if (clipped.length === 0) {
        continue;
      }

      checked += 1;
      expect(lineConeMeasure(clipped)).toBeLessThanOrEqual(lineConeMeasure(base) + 1e-12);
      expect(sameRaySet(clipped, bruteForceRays([...baseHs, ...portalConstraintVectors(p3, 0)]))).toBe(true);
    }

    expect(checked).toBeGreaterThan(20);
  });

  it("matches a numeric integral of the offset interval over normal angles", () => {
    const rng = mulberry32(777);
    let checked = 0;

    for (let sample = 0; sample < 50; sample += 1) {
      const x0 = -4 + 6 * rng();
      const width = 0.2 + 2.8 * rng();
      const y3 = 2.5 + 3.5 * rng();
      const p3 = portal([x0, y3], [x0 + width, y3]);
      const cone = clipLineConeByPortal(lineConeForTwoPortals(p1, p2, 0), p3, 0);

      if (cone.length < 3) {
        continue;
      }

      checked += 1;

      const portals = [p1, p2, p3];
      const samples = 20_000;
      let integral = 0;

      for (let k = 0; k < samples; k += 1) {
        const theta = ((k + 0.5) / samples) * 2 * Math.PI;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const minLeft = Math.min(...portals.map((p) => c * p.left.x + s * p.left.y));
        const maxRight = Math.max(...portals.map((p) => c * p.right.x + s * p.right.y));

        integral += Math.max(0, minLeft - maxRight);
      }

      integral *= (2 * Math.PI) / samples;
      expect(Math.abs(lineConeMeasure(cone) - integral)).toBeLessThanOrEqual(1e-4 * Math.max(integral, 1e-3));
    }

    expect(checked).toBeGreaterThan(10);
  });
});
