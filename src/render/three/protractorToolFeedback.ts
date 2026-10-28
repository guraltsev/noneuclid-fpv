/**
 * In-scene feedback shown while the protractor tool is half-way through a measurement.
 *
 * Builds Three.js groups (center ring and dot, one or two direction rays, a translucent angle sector with an
 * arc outline) from cell-local points (meters; x right, y forward, z up) and yaw angles (radians, counter-clockwise
 * from +x in the cell xy plane), converting through `worldPointToThree`. Geometry and materials are freshly
 * allocated per call and not cached, so the owner of the returned root must dispose it (e.g. `disposeObject3D`).
 */
import * as THREE from "three";
import { type Vec3 } from "../../math/vec3";
import {
  type ProtractorCenterSelection,
  type ProtractorDirectedGeodesic,
} from "../../world-objects/protractorTool";
import { worldPointToThree } from "./worldAxes";

/**
 * Builds the feedback group for the protractor tool's current selection state.
 *
 * `center` is the chosen vertex (its cell-local point and cell id place the group); `centerLocked` selects the
 * "selected" versus "hover" marker style; `first` is the already-picked direction and `hover` the candidate
 * direction under the cursor. The angle sector is drawn only when both directions exist, sweeping
 * counter-clockwise from `first` to `hover`. The returned `signature` string encodes every input that affects the
 * drawing so callers can skip rebuilding when it is unchanged; `cellId` is the cell the root must be parented to.
 * The caller owns and must dispose the returned root.
 */
export function createProtractorToolFeedback(options: {
  /** Vertex the angle is measured at; supplies the cell id, object id, and cell-local point. */
  readonly center: ProtractorCenterSelection;
  /** True once the center is committed (yellow marker) rather than just hovered (cyan marker). */
  readonly centerLocked: boolean;
  /** Direction already chosen as the first leg of the angle. */
  readonly first?: ProtractorDirectedGeodesic;
  /** Direction currently hovered as the candidate second leg. */
  readonly hover?: ProtractorDirectedGeodesic;
}): { readonly signature: string; readonly cellId: string; readonly root: THREE.Group } | undefined {
  const center = options.center;
  const point = center.point;
  const signature = [
    center.cellId,
    center.objectId,
    options.centerLocked ? "locked" : "hover",
    formatFeedbackNumber(options.first?.yawRadians),
    options.first?.geodesicId ?? "",
    formatFeedbackNumber(options.hover?.yawRadians),
    options.hover?.geodesicId ?? "",
  ].join(":");
  const root = new THREE.Group();
  root.name = "protractor-tool-feedback";

  root.add(createFeedbackCenterMarker(point, options.centerLocked));
  if (options.first) {
    root.add(createFeedbackRay(point, options.first.yawRadians, 0xffffff, 0.92, 0.52));
  }
  if (options.hover) {
    root.add(createFeedbackRay(point, options.hover.yawRadians, 0xffd166, 0.98, 0.56));
  }
  if (options.first && options.hover) {
    root.add(createFeedbackAngleSector(point, options.first.yawRadians, options.hover.yawRadians));
  }

  return {
    signature,
    cellId: center.cellId,
    root,
  };
}

/**
 * Creates a ring-and-dot marker group centered on a cell-local point (meters).
 *
 * Locked markers are yellow and more opaque; hover markers are cyan. The ring is rotated to lie flat in the cell's
 * floor plane. The caller disposes the geometry and materials.
 */
export function createFeedbackCenterMarker(point: Vec3, locked: boolean): THREE.Object3D {
  const group = new THREE.Group();
  group.name = locked ? "protractor-feedback-center:selected" : "protractor-feedback-center:hover";
  const color = locked ? 0xffd166 : 0x38f2ff;
  const ringGeometry = new THREE.TorusGeometry(0.16, 0.01, 8, 36);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: locked ? 0.96 : 0.7,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 70;
  ring.name = "protractor-feedback-center-ring";

  const dotGeometry = new THREE.SphereGeometry(0.035, 12, 8);
  const dotMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const dot = new THREE.Mesh(dotGeometry, dotMaterial);
  dot.renderOrder = 71;
  dot.name = "protractor-feedback-center-dot";

  group.position.copy(worldPointToThree(point));
  group.add(ring, dot);
  return group;
}

/**
 * Creates a thin cylinder from a cell-local point along the direction `yawRadians` (counter-clockwise from +x) for `lengthMeters`.
 *
 * The ray stays horizontal at the point's z. `color` is a 0xRRGGBB hex value and `opacity` is in [0, 1]. The caller disposes the mesh.
 */
export function createFeedbackRay(point: Vec3, yawRadians: number, color: number, opacity: number, lengthMeters: number): THREE.Mesh {
  return createFeedbackCylinderBetween(
    point,
    {
      x: point.x + Math.cos(yawRadians) * lengthMeters,
      y: point.y + Math.sin(yawRadians) * lengthMeters,
      z: point.z,
    },
    0.012,
    color,
    opacity,
    "protractor-feedback-ray",
  );
}

/**
 * Creates a translucent pie-slice fill with a yellow arc outline for the angle swept counter-clockwise from the first yaw to the second.
 *
 * Yaws are in radians; the sweep is normalized to [0, 2*pi), so the result is the counter-clockwise angle even when
 * it exceeds pi. Radius is 0.34 m and the sector is lifted 4 mm above the point's z to avoid z-fighting with the floor.
 * Arc resolution is about 6 degrees per segment, with at least 8 segments. The caller disposes the group.
 */
export function createFeedbackAngleSector(point: Vec3, firstYawRadians: number, secondYawRadians: number): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "protractor-feedback-angle-preview";
  const radiusMeters = 0.34;
  const angleRadians = normalizePositiveFeedbackRadians(secondYawRadians - firstYawRadians);
  const segmentCount = Math.max(8, Math.ceil(angleRadians / (Math.PI / 30)));
  const centerThree = worldPointToThree({ ...point, z: point.z + 0.004 });
  const positions: number[] = [centerThree.x, centerThree.y, centerThree.z];
  const indices: number[] = [];
  const arcPoints: Vec3[] = [];
  for (let index = 0; index <= segmentCount; index += 1) {
    const yawRadians = firstYawRadians + angleRadians * index / segmentCount;
    const arcPoint = {
      x: point.x + Math.cos(yawRadians) * radiusMeters,
      y: point.y + Math.sin(yawRadians) * radiusMeters,
      z: point.z + 0.004,
    };
    arcPoints.push(arcPoint);
    const threePoint = worldPointToThree(arcPoint);
    positions.push(threePoint.x, threePoint.y, threePoint.z);
    if (index > 0) {
      indices.push(0, index, index + 1);
    }
  }

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  fillGeometry.setIndex(indices);
  fillGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
    color: 0x38f2ff,
    opacity: 0.24,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  fill.name = "protractor-feedback-angle-fill";
  fill.renderOrder = 68;
  group.add(fill);

  for (let index = 1; index < arcPoints.length; index += 1) {
    group.add(createFeedbackCylinderBetween(
      arcPoints[index - 1],
      arcPoints[index],
      0.007,
      0xffd166,
      0.96,
      "protractor-feedback-angle-arc",
    ));
  }

  return group;
}

/**
 * Creates a mesh spanning two cell-local points: a cylinder of the given radius (meters), or a sphere at `start` if the points are within 1e-6 m.
 *
 * The cylinder's axis is rotated from Three.js +Y onto the start-to-end direction. `color` is a 0xRRGGBB hex value.
 * The caller disposes the geometry and material.
 */
export function createFeedbackCylinderBetween(
  start: Vec3,
  end: Vec3,
  radiusMeters: number,
  color: number,
  opacity: number,
  name: string,
): THREE.Mesh {
  const startThree = worldPointToThree(start);
  const endThree = worldPointToThree(end);
  const delta = endThree.clone().sub(startThree);
  const length = delta.length();
  if (length <= 1e-6) {
    const geometry = new THREE.SphereGeometry(radiusMeters, 8, 6);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(startThree);
    mesh.renderOrder = 69;
    return mesh;
  }

  const geometry = new THREE.CylinderGeometry(radiusMeters, radiusMeters, length, 8);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(startThree).add(endThree).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.renderOrder = 69;
  return mesh;
}

/** Wraps an angle in radians into the half-open range [0, 2*pi). */
export function normalizePositiveFeedbackRadians(radians: number): number {
  const twoPi = Math.PI * 2;
  return ((radians % twoPi) + twoPi) % twoPi;
}

/** Formats a number with four decimals for the feedback signature, or an empty string when undefined. */
export function formatFeedbackNumber(value: number | undefined): string {
  return value === undefined ? "" : value.toFixed(4);
}
