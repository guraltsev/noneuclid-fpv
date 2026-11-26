/**
 * Mesh of the generated landmarks of one cell (design 018 sections 8 and 9), in the cell mesh's Three.js axes (cell-local (x, y, height) is Three (x, height, -y)).
 *
 * One merged non-indexed mesh with vertex colours and a stock `MeshLambertMaterial`, so the portal clip patch applies and the cell archetype pipeline can
 * instance it over portal copies. It draws exactly the triangles `world-assets/landmarkParts.ts` makes of each placement's parts, placed by the
 * placement's position, turn and scale. The scene has no directional light, so the light of the cell (`shadowAzimuthRadians`) is baked into the
 * colours: every triangle is darkened by how far its normal turns from the light; glowing parts keep their full colour.
 */
import * as THREE from "three";
import type { LandmarkPlacement } from "../../world-assets/landmarkLayout";
import { tessellateParts } from "../../world-assets/landmarkParts";
import { createSeededRandom } from "../../world-assets/seededNoise";

/** Elevation of the baked light above the horizon, radians (40 degrees). */
export const landmarkLightElevationRadians = (40 * Math.PI) / 180;
/** Brightness of a face turned away from the light. */
export const landmarkShadeFloor = 0.62;
/** Brightness added to the floor by a face turned straight to the light. */
export const landmarkShadeRange = 0.38;
/** Red multiplier of a face turned away from the light (shade reads cool). */
export const landmarkShadeRed = 0.94;
/** Blue multiplier of a face turned away from the light. */
export const landmarkShadeBlue = 1.06;
/** Brightness multiplier of an underside (normal pointing down). */
export const landmarkUndersideFactor = 0.85;
/** A face whose normal height component is below this counts as an underside. */
export const landmarkUndersideNormalZ = -0.5;
/** Per-triangle brightness jitter, as a total fraction (plus or minus half of it), so flat facets do not look uniform. */
export const landmarkFacetJitter = 0.1;

const colorCache = new Map<string, THREE.Color>();

// THREE.Color converts the sRGB hex into the linear working space the vertex colours hold.
function colorOf(hex: string): THREE.Color {
  let color = colorCache.get(hex);

  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }

  return color;
}

/** Unit vector from a surface toward the light, in cell-local axes: horizontally opposite to the shadow direction, raised by the light elevation. */
export function landmarkToLight(shadowAzimuthRadians: number): THREE.Vector3 {
  const horizontal = Math.cos(landmarkLightElevationRadians);
  return new THREE.Vector3(-Math.cos(shadowAzimuthRadians) * horizontal, -Math.sin(shadowAzimuthRadians) * horizontal, Math.sin(landmarkLightElevationRadians));
}

/**
 * Multiplies `color` by the baked light of a face with the unit normal `normal` (cell-local axes): `0.62 + 0.38 * max(0, n . toLight)`, a cool tint
 * on faces turned away, and 0.85 on undersides. Returns the colour.
 */
export function bakeLandmarkLight(color: THREE.Color, normal: THREE.Vector3, toLight: THREE.Vector3): THREE.Color {
  const along = normal.dot(toLight);
  color.multiplyScalar(landmarkShadeFloor + landmarkShadeRange * Math.max(0, along));

  if (along <= 0) {
    color.r *= landmarkShadeRed;
    color.b *= landmarkShadeBlue;
  }

  if (normal.z < landmarkUndersideNormalZ) {
    color.multiplyScalar(landmarkUndersideFactor);
  }

  return color;
}

/**
 * Builds the landmark mesh of a cell (`name = "landmarks:<cellId>"`, `userData.kind = "landmark"`), or undefined when the cell has no landmarks.
 */
export function buildCellLandmarksMesh(
  cellId: string,
  placements: readonly LandmarkPlacement[],
  shadowAzimuthRadians: number,
): THREE.Mesh | undefined {
  if (placements.length === 0) {
    return undefined;
  }

  const total = placements.reduce((sum, placement) => sum + placement.triangles, 0);
  const positions = new Float32Array(total * 9);
  const normals = new Float32Array(total * 9);
  const colors = new Float32Array(total * 9);
  const toLight = landmarkToLight(shadowAzimuthRadians);
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const inside = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const shaded = new THREE.Color();
  let cursor = 0;

  for (const placement of placements) {
    const matrix = new THREE.Matrix4()
      .makeTranslation(placement.x, placement.y, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(placement.yawRadians))
      .multiply(new THREE.Matrix4().makeScale(placement.scale, placement.scale, placement.scale));
    const random = createSeededRandom((placement.seed ^ 0x1a2b3c4d) >>> 0);
    const triangles = tessellateParts(placement.parts);

    if (triangles.length !== placement.triangles) {
      throw new Error(`landmark ${placement.kind} made ${triangles.length} triangles, its placement says ${placement.triangles}`);
    }

    for (const triangle of triangles) {
      corners[0].set(...triangle.a).applyMatrix4(matrix);
      corners[1].set(...triangle.b).applyMatrix4(matrix);
      corners[2].set(...triangle.c).applyMatrix4(matrix);
      inside.set(...triangle.inside).applyMatrix4(matrix);
      e1.subVectors(corners[1], corners[0]);
      e2.subVectors(corners[2], corners[0]);
      normal.crossVectors(e1, e2);
      const length = normal.length();
      normal.set(...(length < 1e-12 ? ([0, 0, 1] as const) : ([normal.x / length, normal.y / length, normal.z / length] as const)));
      centre.copy(corners[0]).add(corners[1]).add(corners[2]).multiplyScalar(1 / 3).sub(inside);

      if (normal.dot(centre) < 0) {
        normal.negate();
        const swap = corners[1].clone();
        corners[1].copy(corners[2]);
        corners[2].copy(swap);
      }

      shaded.copy(colorOf(triangle.color));

      if (!triangle.glow) {
        bakeLandmarkLight(shaded, normal, toLight);
        shaded.multiplyScalar(1 + (random() - 0.5) * landmarkFacetJitter);
      }

      for (let vertex = 0; vertex < 3; vertex += 1) {
        const offset = cursor + vertex * 3;
        // Cell-local (x, y, height) to Three (x, height, -y).
        positions[offset] = corners[vertex].x;
        positions[offset + 1] = corners[vertex].z;
        positions[offset + 2] = -corners[vertex].y;
        normals[offset] = normal.x;
        normals[offset + 1] = normal.z;
        normals[offset + 2] = -normal.y;
        colors[offset] = shaded.r;
        colors[offset + 1] = shaded.g;
        colors[offset + 2] = shaded.b;
      }

      cursor += 9;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = `landmarks:${cellId}`;
  mesh.userData = { kind: "landmark", cellId };
  return mesh;
}
