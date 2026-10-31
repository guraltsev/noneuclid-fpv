import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  clipDirectionSector,
  clipPlanesToNdcPolygon,
  clipSectorByPortal,
  funnelClipPlanes,
  writeAlwaysInsideClipPlanes,
  type DirectionSector,
} from "../../src/render/three/portalFunnel";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { mulberry32 } from "../support/portalWordWitness";

const s2 = Math.SQRT1_2;

function expectDirection(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

function planeValue(planes: Float64Array, plane: number, world: { x: number; y: number; z: number }): number {
  const point = worldPointToThree(world);

  return planes[plane * 4] * point.x + planes[plane * 4 + 1] * point.y + planes[plane * 4 + 2] * point.z + planes[plane * 4 + 3];
}

describe("clipSectorByPortal", () => {
  const portal = { left: { x: -1, y: 1 }, right: { x: 1, y: 1 }, apertureTopMeters: 3 };

  it("turns the full sector into the wedge through the portal", () => {
    const sector = clipSectorByPortal({ full: true }, portal, { x: 0, y: 0 });

    expect(sector).toBeDefined();
    expect(sector!.full).toBe(false);
    if (!sector!.full) {
      expectDirection(sector!.right, { x: s2, y: s2 });
      expectDirection(sector!.left, { x: -s2, y: s2 });
    }
  });

  it("gives a half-plane for an eye in the doorway and clips it by a vertical constraint", () => {
    const sector = clipSectorByPortal({ full: true }, portal, { x: 0, y: 1 });

    expect(sector!.full).toBe(false);
    if (!sector!.full) {
      expectDirection(sector!.right, { x: 1, y: 0 });
      expectDirection(sector!.left, { x: -1, y: 0 });

      const clipped = clipDirectionSector(sector!, { x: 1, y: 0 });

      expect(clipped!.full).toBe(false);
      if (!clipped!.full) {
        expectDirection(clipped!.right, { x: 1, y: 0 });
        expectDirection(clipped!.left, { x: 0, y: 1 });
      }
    }
  });

  it("is empty when the second portal lies outside the first sector", () => {
    const first = clipSectorByPortal({ full: true }, portal, { x: 0, y: 0 })!;
    const second = clipSectorByPortal(first, { left: { x: 4, y: 3 }, right: { x: 5, y: 3 }, apertureTopMeters: 3 }, { x: 0, y: 0 });

    expect(second).toBeUndefined();
  });
});

describe("funnelClipPlanes", () => {
  const portal = { left: { x: -1, y: 1 }, right: { x: 1, y: 1 }, apertureTopMeters: 3 };
  const eye = { x: 0, y: 0, z: 1 };
  const planes = funnelClipPlanes({ x: s2, y: s2 }, { x: -s2, y: s2 }, portal, eye);

  it("matches the hand-computed planes", () => {
    // Values of n . X + d are frame independent; compare world points mapped to Three axes.
    expect(planeValue(planes, 0, { x: 0, y: 2, z: 1 })).toBeCloseTo(s2 * 2, 9);
    expect(planeValue(planes, 1, { x: 0, y: 2, z: 1 })).toBeCloseTo(s2 * 2, 9);
    // top: n = (0,2,-1)/sqrt5, d = 1/sqrt5; bottom: n = (0,1,1)/sqrt2, d = -1/sqrt2.
    expect(planeValue(planes, 2, { x: 0, y: 2, z: 1 })).toBeCloseTo((4 - 1 + 1) / Math.sqrt(5), 9);
    expect(planeValue(planes, 3, { x: 0, y: 2, z: 1 })).toBeCloseTo((2 + 1 - 1) / Math.sqrt(2), 9);
  });

  it("classifies sample points", () => {
    expect(planeValue(planes, 0, { x: 2, y: 1.5, z: 1 })).toBeLessThan(0);
    expect(planeValue(planes, 2, { x: 0, y: 2, z: 5.5 })).toBeLessThan(0);
    expect(planeValue(planes, 3, { x: 0, y: 2, z: -1.5 })).toBeLessThan(0);

    for (let plane = 0; plane < 4; plane += 1) {
      expect(planeValue(planes, plane, { x: 0, y: 2, z: 1 })).toBeGreaterThan(0);
    }

    expect(planeValue(planes, 2, { x: 0, y: 2, z: 5 })).toBeCloseTo(0, 9);
    expect(planeValue(planes, 3, { x: 0, y: 2, z: -1 })).toBeCloseTo(0, 9);
  });

  it("makes top and bottom always inside when the eye is in the portal plane", () => {
    const inDoorway = funnelClipPlanes({ x: 1, y: 0 }, { x: -1, y: 0 }, portal, { x: 0, y: 1, z: 1.4 });

    expect(Array.from(inDoorway.slice(8))).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe("clipPlanesToNdcPolygon", () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);

  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  function polygonArea(out: Float64Array, count: number): number {
    let twice = 0;

    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;

      twice += out[index * 2] * out[next * 2 + 1] - out[next * 2] * out[index * 2 + 1];
    }

    return Math.abs(twice) / 2;
  }

  it("clips the square to the right half for a plane with camera normal (1,0,0)", () => {
    const planes = new Float64Array(16);
    const out = new Float64Array(18);

    writeAlwaysInsideClipPlanes(planes, 0);
    planes.set([1, 0, 0, 0], 0);

    const count = clipPlanesToNdcPolygon(planes, camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, out);

    expect(count).toBeGreaterThanOrEqual(3);
    expect(polygonArea(out, count)).toBeCloseTo(2, 9);
    for (let index = 0; index < count; index += 1) {
      expect(out[index * 2]).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("is empty for a plane that only keeps rays behind the camera", () => {
    const planes = new Float64Array(16);
    const out = new Float64Array(18);

    writeAlwaysInsideClipPlanes(planes, 0);
    planes.set([0, 0, 1, 0], 0);

    expect(clipPlanesToNdcPolygon(planes, camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, out)).toBe(0);
  });

  it("returns the full square when all planes are always inside", () => {
    const planes = new Float64Array(16);
    const out = new Float64Array(18);

    writeAlwaysInsideClipPlanes(planes, 0);

    const count = clipPlanesToNdcPolygon(planes, camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, out);

    expect(count).toBe(4);
    expect(polygonArea(out, count)).toBeCloseTo(4, 9);
  });
});

describe("clipDirectionSector properties", () => {
  it("returns a subset of the input that satisfies the constraint", () => {
    const random = mulberry32(12345);
    const unit = (): { x: number; y: number } => {
      const angle = random() * 2 * Math.PI;

      return { x: Math.cos(angle), y: Math.sin(angle) };
    };
    let clippedCount = 0;

    for (let trial = 0; trial < 500; trial += 1) {
      const start = unit();
      const width = random() * Math.PI;
      const end = { x: Math.cos(Math.atan2(start.y, start.x) + width), y: Math.sin(Math.atan2(start.y, start.x) + width) };
      const input: DirectionSector = trial % 7 === 0 ? { full: true } : { full: false, right: start, left: end };
      const g = unit();
      const result = clipDirectionSector(input, g);

      if (!result) {
        continue;
      }

      clippedCount += 1;
      expect(result.full).toBe(false);
      if (result.full) {
        continue;
      }

      for (const boundary of [result.right, result.left]) {
        expect(boundary.x * g.x + boundary.y * g.y).toBeGreaterThanOrEqual(-1e-9);

        if (!input.full) {
          // Inside the input sector: cross(input.right, d) >= 0 and cross(d, input.left) >= 0 (angles below pi).
          const crossFromRight = input.right.x * boundary.y - input.right.y * boundary.x;
          const crossToLeft = boundary.x * input.left.y - boundary.y * input.left.x;

          if (width < Math.PI - 1e-6) {
            expect(crossFromRight).toBeGreaterThanOrEqual(-1e-9);
            expect(crossToLeft).toBeGreaterThanOrEqual(-1e-9);
          }
        }
      }
    }

    expect(clippedCount).toBeGreaterThan(100);
  });
});
