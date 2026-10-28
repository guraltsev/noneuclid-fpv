/**
 * Renderer for the protractor tool's measured-angle marker.
 *
 * A marker consists of a translucent filled circular sector, a thin arc tube, two radial boundary rods and a floating
 * two-sided angle badge at the sector's bisector. Geometry is built in the anchor pose's local Three.js frame (meters,
 * y up, sector lying in the x-z plane): angle theta is swept from +x towards -z, which is counter-clockwise when viewed
 * from above (+y) and corresponds to world +y. The anchor pose is a cell-local rigid transform (world axes) applied with
 * `applyWorldRigidTransform`. Each sync rebuilds the whole group and disposes the old resources; the caller attaches
 * `root` to the owning cell's scene node.
 */
import * as THREE from "three";
import {
  formatProtractorAngleLabel,
  protractorAngleLabelBadgeHeightMeters,
  protractorAngleLabelBadgeWidthMeters,
  protractorAngleLabelVerticalOffsetMeters,
  type ProtractorAngleObject,
} from "../../world-objects/protractorTool";
import { applyWorldRigidTransform } from "./worldAxes";
import { createWorldResultBadge } from "./worldResultBadge";
import { disposeObject3DWithTextures } from "./runtimeSceneUtils";

/** Lifecycle handle for one protractor angle marker in the scene. */
export interface ProtractorAngleRuntime {
  /** Current marker group; its identity changes after each `syncFromObject`, so re-read it rather than caching. */
  readonly root: THREE.Object3D;
  readonly objectId: string;
  /** Id of the cell whose local frame contains the marker (tracks the latest synced object). */
  readonly cellId: string;
  /** Rebuilds the marker from `object` in place under the same parent; throws if the object id differs from this runtime's. */
  syncFromObject(object: ProtractorAngleObject): void;
  /** Detaches the marker and frees its geometries, materials and textures. */
  dispose(): void;
}

// Marker colours as 0xRRGGBB.
const arcColor = 0xffd166;
const fillColor = 0x38f2ff;
const boundaryColor = 0xffffff;
// Radius of the arc tube cross-section, meters.
const arcTubeRadiusMeters = 0.008;

/**
 * Creates the runtime that renders the angle described by `object` (sector radius `radiusMeters`, angle `angleRadians`).
 *
 * The group is created detached; the caller must add `root` to the scene. A sync swaps the new group into
 * the old group's parent.
 */
export function createProtractorAngleRuntime(object: ProtractorAngleObject): ProtractorAngleRuntime {
  let root = createProtractorAngleRoot(object);
  let cellId = object.cellId;

  return {
    get root() {
      return root;
    },
    objectId: object.id,
    get cellId() {
      return cellId;
    },
    syncFromObject(nextObject) {
      if (nextObject.id !== object.id) {
        throw new Error(`Cannot sync protractor angle runtime "${object.id}" from "${nextObject.id}".`);
      }

      const parent = root.parent;
      const nextRoot = createProtractorAngleRoot(nextObject);
      if (parent) {
        parent.remove(root);
        parent.add(nextRoot);
      }
      disposeObject3DWithTextures(root);
      root = nextRoot;
      cellId = nextObject.cellId;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3DWithTextures(root);
    },
  };
}

function createProtractorAngleRoot(object: ProtractorAngleObject): THREE.Group {
  const root = new THREE.Group();
  root.name = `protractor-angle:${object.id}`;
  root.add(
    createAngleFill(object),
    createArcLine(object),
    createBoundaryLine("first", object.radiusMeters),
    createBoundaryLine("second", object.radiusMeters, object.angleRadians),
    createAngleLabel(object),
  );
  applyWorldRigidTransform(root, object.localPose);
  return root;
}

function createAngleFill(object: ProtractorAngleObject): THREE.Mesh {
  const segments = resolveSegmentCount(object.angleRadians);
  // Triangle fan: vertex 0 is the sector apex (lifted 2 mm above the anchor plane to avoid z-fighting), then arc samples.
  const positions: number[] = [0, 0.002, 0];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    // Arc sample at angle theta from +x towards -z (Three.js frame).
    const theta = object.angleRadians * index / segments;
    positions.push(
      Math.cos(theta) * object.radiusMeters,
      0.002,
      -Math.sin(theta) * object.radiusMeters,
    );
    if (index > 0) {
      // Fan triangle (apex, arc[index-1], arc[index]); positions are offset by one for the apex.
      indices.push(0, index, index + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Normals are not used by the unlit material but keep the geometry well-formed.
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: fillColor,
    opacity: 0.18,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "protractor-angle-fill";
  mesh.renderOrder = 50;
  return mesh;
}

function createArcLine(object: ProtractorAngleObject): THREE.Mesh {
  // Tube follows the arc at 1 cm height, sampled with the same segment count as the fill.
  const curve = new THREE.CurvePath<THREE.Vector3>();
  curve.add(new AngleArcCurve(object.radiusMeters, object.angleRadians));
  const geometry = new THREE.TubeGeometry(curve, resolveSegmentCount(object.angleRadians), arcTubeRadiusMeters, 8, false);
  const material = new THREE.MeshBasicMaterial({
    color: arcColor,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "protractor-angle-arc";
  mesh.renderOrder = 51;
  return mesh;
}

function createBoundaryLine(name: string, radiusMeters: number, yawRadians = 0): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.006, 0.006, radiusMeters, 8);
  const material = new THREE.MeshBasicMaterial({
    color: boundaryColor,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `protractor-angle-boundary:${name}`;
  mesh.position.set(
    Math.cos(yawRadians) * radiusMeters / 2,
    0.006,
    -Math.sin(yawRadians) * radiusMeters / 2,
  );
  // Cylinders extend along y; lay it along x, then yaw about y to point along the sector edge (centred at half radius).
  mesh.rotation.z = Math.PI / 2;
  mesh.rotation.y = yawRadians;
  mesh.renderOrder = 52;
  return mesh;
}

function createAngleLabel(object: ProtractorAngleObject): THREE.Object3D {
  const label = formatProtractorAngleLabel(object.first, object.second, object.angleDegrees);
  const badge = createWorldResultBadge({
    text: label,
    variant: "angle",
    widthMeters: protractorAngleLabelBadgeWidthMeters,
    heightMeters: protractorAngleLabelBadgeHeightMeters,
    pointer: "down",
    doubleFaced: true,
    renderOrder: 57,
  });
  badge.name = "protractor-angle-floating-tooltip";
  badge.children[0].name = "protractor-angle-floating-tooltip:front";
  badge.children[1].name = "protractor-angle-floating-tooltip:back";
  positionAngleLabelBadge(badge, object);
  badge.renderOrder = 57;
  return badge;
}

// Places the badge above the arc midpoint (bisector) and rotates it about y by (bisector angle + pi/2) so it is oriented relative to the bisector direction.
function positionAngleLabelBadge(badge: THREE.Object3D, object: ProtractorAngleObject): void {
  const labelAngle = object.angleRadians / 2;
  badge.position.set(
    Math.cos(labelAngle) * object.radiusMeters,
    protractorAngleLabelVerticalOffsetMeters,
    -Math.sin(labelAngle) * object.radiusMeters,
  );
  badge.rotation.y = labelAngle + Math.PI / 2;
}

// Parametric circular arc, t in [0, 1] mapping to angle [0, angleRadians], lying 1 cm above the anchor plane.
class AngleArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radiusMeters: number,
    private readonly angleRadians: number,
  ) {
    super();
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const theta = this.angleRadians * t;
    return optionalTarget.set(
      Math.cos(theta) * this.radiusMeters,
      0.01,
      -Math.sin(theta) * this.radiusMeters,
    );
  }
}

// About one segment per 5 degrees, with a minimum of 8.
function resolveSegmentCount(angleRadians: number): number {
  return Math.max(8, Math.ceil(angleRadians / (Math.PI / 36)));
}
