/**
 * Red cross decal drawn on the surface point that the aim ray currently hits.
 * The marker is a single Three.js group added to the scene root; it is positioned in root (Three.js) coordinates converted from the target's world-frame rootPoint/rootNormal via worldAxes. Lengths are meters. It is hidden whenever there is no aim target.
 * The cross is oriented so its plane is tangent to the surface and its right axis follows the camera/controller right axis projected onto that plane.
 */
import * as THREE from "three";
import type { AimTarget } from "./aimTarget";
import { worldPointToThree } from "./worldAxes";

/**
 * Handle to the aim cross decal created by {@link createAimCrossMarker}.
 * Owned by the caller, who must call dispose() once to release GPU resources.
 */
export interface AimCrossMarker {
  /** Scene-graph group holding the cross lines; invisible until update() receives a target. */
  readonly root: THREE.Group;
  /**
   * Shows the cross at the target hit (lifted slightly off the surface) or hides it when target is undefined.
   * orientation, when given, supplies a quaternion in Three.js frame whose right/up axes define the cross roll.
   */
  update(target: AimTarget | undefined, orientation?: AimCrossMarkerOrientation): void;
  /** Detaches the group from its parent and frees the geometry and material. */
  dispose(): void;
}

/** Roll reference for the cross decal, typically the aim camera or controller orientation. */
export interface AimCrossMarkerOrientation {
  /** World-orientation quaternion in the Three.js frame; its local +x/+y axes are projected onto the surface plane. */
  readonly quaternion: THREE.Quaternion;
}

// Half-length of each cross arm, meters.
const crossRadiusMeters = 0.16;
// Offset along the surface normal, meters, so the decal does not z-fight the surface.
const surfaceLiftMeters = 0.01;
const fallbackMarkerRight = new THREE.Vector3(1, 0, 0);
const fallbackMarkerUp = new THREE.Vector3(0, 1, 0);

/**
 * Creates the aim cross marker, adds it (hidden) to the given scene, and returns its handle.
 * The lines are depth-tested but do not write depth, with a high renderOrder so they draw over the surface they mark.
 * Lifecycle: the caller must invoke dispose() on the returned handle.
 */
export function createAimCrossMarker(scene: THREE.Scene): AimCrossMarker {
  const root = new THREE.Group();
  root.name = "aim-cross-marker";
  root.visible = false;
  root.renderOrder = 50;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([
      -crossRadiusMeters, 0, 0,
      crossRadiusMeters, 0, 0,
      0, -crossRadiusMeters, 0,
      0, crossRadiusMeters, 0,
    ]), 3),
  );
  const material = new THREE.LineBasicMaterial({
    color: 0xef1b1b,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "aim-cross-marker-lines";
  root.add(lines);
  scene.add(root);

  return {
    root,
    update(target, orientation) {
      if (!target) {
        root.visible = false;
        return;
      }

      // rootNormal is a world-frame (z-up) vector; convert to the Three.js frame before using it as a surface normal.
      const normal = worldPointToThree(target.rootNormal).normalize();
      const position = worldPointToThree(target.rootPoint).addScaledVector(normal, surfaceLiftMeters);
      root.visible = true;
      root.position.copy(position);
      root.quaternion.copy(resolveAimCrossMarkerQuaternion(normal, orientation?.quaternion));
      root.updateMatrixWorld();
    },
    dispose() {
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Builds the orientation (Three.js frame) that lays the cross flat on a surface with the given normal.
 * The local +z axis maps to the normal; local +x is the source quaternion's right axis projected into the surface plane. Falls back to the source up axis crossed with the normal, then to the fixed +x axis, when the projection is degenerate (axis parallel to the normal). surfaceNormal need not be unit length but must be nonzero.
 */
export function resolveAimCrossMarkerQuaternion(
  surfaceNormal: THREE.Vector3,
  sourceQuaternion?: THREE.Quaternion,
): THREE.Quaternion {
  const normal = surfaceNormal.clone().normalize();
  const sourceRight = fallbackMarkerRight.clone();
  const sourceUp = fallbackMarkerUp.clone();
  if (sourceQuaternion) {
    sourceRight.applyQuaternion(sourceQuaternion);
    sourceUp.applyQuaternion(sourceQuaternion);
  }

  // Pick the first non-degenerate in-plane right axis.
  const right = projectDirectionOntoPlane(sourceRight, normal)
    ?? projectDirectionOntoPlane(sourceUp.cross(normal), normal)
    ?? projectDirectionOntoPlane(fallbackMarkerRight, normal)
    ?? new THREE.Vector3(1, 0, 0);
  const up = normal.clone().cross(right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, normal);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

// Returns the unit projection of direction onto the plane with the given unit normal, or undefined if it is (nearly) parallel to the normal.
function projectDirectionOntoPlane(direction: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | undefined {
  const projected = direction.clone().addScaledVector(normal, -direction.dot(normal));
  return projected.lengthSq() > 1e-8 ? projected.normalize() : undefined;
}
