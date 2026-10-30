import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import {
  createPortalClipData,
  portalClipEpsilonMeters,
  portalClipPlaneTextureWidth,
  portalClipPlaneTexelIndex,
  type PortalClipData,
} from "../../src/render/three/portalClipData";
import {
  transformClipPlanes,
  transformVisiblePortalResultToRenderFrame,
} from "../../src/render/three/portalEyeFrameTransforms";
import { computeVisiblePortalPaths, type VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";
import { worldPointToThree } from "../../src/render/three/worldAxes";

describe("transformClipPlanes", () => {
  it("translates and rotates planes with the render frame", () => {
    const out = new Float64Array(4);

    transformClipPlanes(new Float64Array([1, 0, 0, 0]), new THREE.Matrix4().makeTranslation(1, 0, 0), out);
    expect(Array.from(out)).toEqual([1, 0, 0, -1]);

    transformClipPlanes(new Float64Array([1, 0, 0, 0]), new THREE.Matrix4().makeRotationY(Math.PI / 2), out);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(-1, 12);
    expect(out[3]).toBeCloseTo(0, 12);
  });

  it("maps always-inside and always-outside rows to themselves", () => {
    const matrix = new THREE.Matrix4().makeRotationY(0.7).setPosition(3, -2, 5);
    const inside = new Float64Array([0, 0, 0, 1]);
    const outside = new Float64Array([0, 0, 0, -1]);

    transformClipPlanes(inside, matrix, inside);
    transformClipPlanes(outside, matrix, outside);
    expect(Array.from(inside)).toEqual([0, 0, 0, 1]);
    expect(Array.from(outside)).toEqual([0, 0, 0, -1]);
  });

  it("keeps n.X + d invariant under rigid maps", () => {
    const random = lcg(12345);

    for (let trial = 0; trial < 100; trial += 1) {
      const matrix = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(random() * 6, random() * 6, random() * 6),
      );

      matrix.setPosition(random() * 10 - 5, random() * 10 - 5, random() * 10 - 5);
      const normal = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      const plane = new Float64Array([normal.x, normal.y, normal.z, random() * 4 - 2]);
      const mapped = new Float64Array(4);
      const point = new THREE.Vector3(random() * 8 - 4, random() * 8 - 4, random() * 8 - 4);
      const before = normal.dot(point) + plane[3];
      const moved = point.clone().applyMatrix4(matrix);

      transformClipPlanes(plane, matrix, mapped);
      expect(mapped[0] * moved.x + mapped[1] * moved.y + mapped[2] * moved.z + mapped[3]).toBeCloseTo(before, 9);
    }
  });

  it("maps the planes of every path in transformVisiblePortalResultToRenderFrame", () => {
    const { result } = cubeScene(cubeCamera(-0.04, 0, 0.3));
    const renderFromRoot = new THREE.Matrix4().makeRotationY(0.4).setPosition(1, 2, 3);
    const mapped = transformVisiblePortalResultToRenderFrame(result, renderFromRoot);
    const path = result.paths.find((entry) => entry.depth > 0)!;
    const mappedPath = mapped.visiblePathById.get(path.pathId)!;
    const point = new THREE.Vector3(0.3, -0.2, 0.9);
    const moved = point.clone().applyMatrix4(renderFromRoot);

    for (let plane = 0; plane < 4; plane += 1) {
      const o = plane * 4;
      const before = path.clipPlanes[o] * point.x + path.clipPlanes[o + 1] * point.y + path.clipPlanes[o + 2] * point.z + path.clipPlanes[o + 3];
      const after =
        mappedPath.clipPlanes[o] * moved.x + mappedPath.clipPlanes[o + 1] * moved.y + mappedPath.clipPlanes[o + 2] * moved.z + mappedPath.clipPlanes[o + 3];

      expect(after).toBeCloseTo(before, 9);
    }
  });
});

describe("CPU emulation of the clip shader", () => {
  it("passes world points inside the visible region, rejects points outside, and never clips -2", () => {
    const { result, clipData } = cubeScene(cubeCamera(-0.04, 0, 0.3));
    const data = clipData.texture.image.data as unknown as Float32Array;
    const paths = result.paths.filter((path) => path.depth > 0);
    let insideChecked = 0;
    let outsideChecked = 0;

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const slot = clipData.clipIndexByPathId.get(path.pathId)!;

      for (const [ndcX, ndcY] of gridNdc(30)) {
        const distance = signedDistancePixels(path, ndcX, ndcY);

        if (distance === undefined) {
          continue;
        }

        for (const depth of [0.5, 1, 4]) {
          const point = pointAtDepth(result.camera, ndcX, ndcY, depth);
          const distances = clipDistancesForVertex(data, slot, 0, clipData.maxClipTextureEyes, point, slot);
          const inside = distances.every((value) => value >= 0);

          if (distance > 2) {
            expect(inside).toBe(true);
            insideChecked += 1;
          } else if (distance < -2) {
            expect(inside).toBe(false);
            outsideChecked += 1;
          }
        }
      }
    }

    expect(insideChecked).toBeGreaterThan(0);
    expect(outsideChecked).toBeGreaterThan(0);
    expect(clipDistancesForVertex(data, 0, 0, 2, new THREE.Vector3(1e6, -1e6, 3), -2)).toEqual([1, 1, 1, 1]);
    expect(clipDistancesForVertex(data, 0, 0, 2, new THREE.Vector3(0, 0, 0), -1)).toEqual([-1, -1, -1, -1]);
  });

  it("agrees with the screen polygon to within one pixel for 20000 random pixels", () => {
    const { result, clipData } = cubeScene(cubeCamera(-0.04, 0, 0.3));
    const data = clipData.texture.image.data as unknown as Float32Array;
    const random = lcg(777);
    const paths = result.paths.filter((path) => path.depth > 0);

    expect(paths.length).toBeGreaterThan(0);

    for (let sample = 0; sample < 20000; sample += 1) {
      const path = paths[sample % paths.length];
      const slot = clipData.clipIndexByPathId.get(path.pathId)!;
      const ndcX = random() * 2 - 1;
      const ndcY = random() * 2 - 1;
      const distance = signedDistancePixels(path, ndcX, ndcY);

      if (distance === undefined) {
        continue;
      }

      const point = pointAtDepth(result.camera, ndcX, ndcY, 1);
      const inside = clipDistancesForVertex(data, slot, 0, clipData.maxClipTextureEyes, point, slot).every((value) => value >= 0);

      if (inside) {
        expect(distance).toBeGreaterThanOrEqual(-1);
      }
      if (distance >= 1) {
        expect(inside).toBe(true);
      }
    }
  });

  it("stays within one pixel over a sweep of cameras, including polygons with an edge under 2 px", () => {
    let sawShortEdge = false;
    let comparedPixels = 0;

    for (let yawStep = 0; yawStep < 72; yawStep += 1) {
      for (const [x, y] of [[-0.04, 0], [0.7, -0.3], [-0.2, 0.6]]) {
        const { result, clipData } = cubeScene(cubeCamera(x, y, (yawStep * Math.PI * 2) / 72));
        const data = clipData.texture.image.data as unknown as Float32Array;
        const random = lcg(yawStep * 7 + 1);

        for (const path of result.paths) {
          if (path.depth === 0) {
            continue;
          }
          if (hasShortEdge(path, 2)) {
            sawShortEdge = true;
          }

          const slot = clipData.clipIndexByPathId.get(path.pathId)!;

          for (let sample = 0; sample < 60; sample += 1) {
            const ndcX = random() * 2 - 1;
            const ndcY = random() * 2 - 1;
            const distance = signedDistancePixels(path, ndcX, ndcY);

            if (distance === undefined) {
              continue;
            }

            const point = pointAtDepth(result.camera, ndcX, ndcY, 1);
            const inside = clipDistancesForVertex(data, slot, 0, clipData.maxClipTextureEyes, point, slot).every((value) => value >= 0);

            comparedPixels += 1;
            if (inside) {
              expect(distance).toBeGreaterThanOrEqual(-1);
            }
            if (distance >= 1) {
              expect(inside).toBe(true);
            }
          }
        }
      }
    }

    expect(comparedPixels).toBeGreaterThan(1000);
    expect(sawShortEdge).toBe(true);
  });
});

const viewport = { width: 800, height: 600 };

function cubeCamera(x: number, y: number, yaw: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, viewport.width / viewport.height, 0.03, 250);

  camera.position.copy(worldPointToThree({ x, y, z: 1.6 }));
  camera.up.set(0, 1, 0);
  camera.lookAt(worldPointToThree({ x: x + Math.cos(yaw), y: y + Math.sin(yaw), z: 1.6 }));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}

function cubeScene(camera: THREE.PerspectiveCamera): {
  readonly result: ReturnType<typeof computeVisiblePortalPaths> & { readonly camera: THREE.PerspectiveCamera };
  readonly clipData: PortalClipData;
} {
  const world = compileCellComplex(cube);
  const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
  const result = computeVisiblePortalPaths({
    world,
    rootCellId: "front",
    pathTable: table,
    camera,
    viewportPixels: viewport,
    options: {
      maxDepth: 2,
      maxVisiblePaths: 100,
      minPortalScreenAreaPixels: 0,
      includeRootCell: true,
      sortMode: "depth-then-area",
    },
  });
  const clipData = createPortalClipData({ maxVisiblePaths: 100 });

  clipData.update(result.paths);

  return { result: { ...result, camera }, clipData };
}

// Mirrors the vertex shader: reads the 4 planes of (slot, eye) from the texture data and evaluates them.
function clipDistancesForVertex(
  data: Float32Array,
  slot: number,
  eye: number,
  eyeCount: number,
  renderPosition: THREE.Vector3,
  clipIndex: number,
): number[] {
  if (clipIndex < -1.5) {
    return [1, 1, 1, 1];
  }
  if (clipIndex < -0.5) {
    return [-1, -1, -1, -1];
  }

  const distances: number[] = [];

  for (let plane = 0; plane < 4; plane += 1) {
    const texel = portalClipPlaneTexelIndex(slot, eye, plane, eyeCount);
    const offset = ((Math.floor(texel / portalClipPlaneTextureWidth)) * portalClipPlaneTextureWidth + (texel % portalClipPlaneTextureWidth)) * 4;

    distances.push(
      data[offset] * renderPosition.x +
        data[offset + 1] * renderPosition.y +
        data[offset + 2] * renderPosition.z +
        data[offset + 3] +
        portalClipEpsilonMeters,
    );
  }

  return distances;
}

// The point at camera-space depth `depth` metres along the ray through NDC (x, y), in the root Three frame.
function pointAtDepth(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, depth: number): THREE.Vector3 {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  return new THREE.Vector3(ndcX * tanHalf * camera.aspect * depth, ndcY * tanHalf * depth, -depth).applyMatrix4(
    camera.matrixWorld,
  );
}

// Signed distance in pixels from NDC point to the path's screen polygon: positive inside, negative outside;
// undefined for a degenerate polygon.
function signedDistancePixels(path: VisiblePortalPath, ndcX: number, ndcY: number): number | undefined {
  const polygon = path.clipPolygonNdc.map((vertex) => ({ x: vertex.x * viewport.width / 2, y: vertex.y * viewport.height / 2 }));

  if (polygon.length < 3) {
    return undefined;
  }

  const px = ndcX * viewport.width / 2;
  const py = ndcY * viewport.height / 2;
  let twiceArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];

    twiceArea += a.x * b.y - b.x * a.y;
  }

  if (Math.abs(twiceArea) < 1e-9) {
    return undefined;
  }

  const sign = twiceArea < 0 ? -1 : 1;
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);

    if (length < 1e-9) {
      continue;
    }

    minimum = Math.min(minimum, (sign * ((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x))) / length);
  }

  return Number.isFinite(minimum) ? minimum : undefined;
}

function hasShortEdge(path: VisiblePortalPath, pixels: number): boolean {
  const polygon = path.clipPolygonNdc;

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const length = Math.hypot((b.x - a.x) * viewport.width / 2, (b.y - a.y) * viewport.height / 2);

    if (length > 1e-6 && length < pixels) {
      return true;
    }
  }

  return false;
}

function gridNdc(steps: number): [number, number][] {
  const points: [number, number][] = [];

  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      points.push([-0.98 + (1.96 * i) / (steps - 1), -0.98 + (1.96 * j) / (steps - 1)]);
    }
  }

  return points;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
