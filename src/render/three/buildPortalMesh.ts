/**
 * Builds the visible wall panel of a portal side (the textured "doorway" surface) in a cell's local frame.
 *
 * The panel is a rectangle spanning the side's two base endpoints and the cell height, positioned in Three.js
 * axes (world (x, y, z) -> (x, z, -y)) and offset 1 cm along the inward normal. It only exists for debugging
 * the portal location: the actual see-through effect comes from rendering the destination cell clipped to the
 * portal aperture (`visiblePortalPaths`, `portalClipMaterial`). Meshes are tagged `userData.kind = "portal-wall-mesh"`
 * so `cellRenderArchetypes` instances them as "portal-frame" parts.
 */

import * as THREE from "three";
import { createPortalWallMaterial } from "./portalWallTexture";
import type { PreparedWorldAssets } from "./preloadWorldAssets";

/** Geometry and options for one portal wall: side endpoints (cell-local xy, meters), height and assets. */
export interface PortalWallMeshSpec {
  readonly portalId: string;
  readonly sideIndex: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly heightMeters: number;
  readonly assets: PreparedWorldAssets;
  /** When false the group is created empty (portal is invisible apart from the clipped view). */
  readonly showWall: boolean;
}

/** Builds a `portal:<id>` group, containing the wall mesh when `showWall` is set; texture repeat is one tile per 8 m (at least 1). */
export function buildPortalMesh(spec: PortalWallMeshSpec): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `portal:${spec.portalId}`;
  const edgeLength = Math.hypot(spec.end.x - spec.start.x, spec.end.y - spec.start.y);
  const material = createPortalWallMaterial(
    Math.max(1, edgeLength / 8),
    Math.max(1, spec.heightMeters / 8),
    spec.assets,
  );
  group.userData = {
    kind: "portal-wall",
    portalId: spec.portalId,
    sideIndex: spec.sideIndex,
    textureUrl: material.userData.textureUrl,
  };

  if (spec.showWall) {
    const mesh = buildWallMesh(spec, material);
    mesh.name = `portal-wall:${spec.portalId}`;
    group.add(mesh);
  }

  return group;
}

function buildWallMesh(spec: PortalWallMeshSpec, material: THREE.MeshStandardMaterial): THREE.Mesh {
  const start = new THREE.Vector3(spec.start.x, 0, -spec.start.y);
  const end = new THREE.Vector3(spec.end.x, 0, -spec.end.y);
  const edgeLength = new THREE.Vector3().subVectors(end, start).length();
  const inward = new THREE.Vector3(-(spec.end.y - spec.start.y), 0, -(spec.end.x - spec.start.x)).normalize();
  const position = new THREE.Vector3(
    (spec.start.x + spec.end.x) / 2,
    spec.heightMeters / 2,
    -((spec.start.y + spec.end.y) / 2),
  );

  const geometry = new THREE.PlaneGeometry(edgeLength, spec.heightMeters);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position).addScaledVector(inward, 0.01);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward);
  mesh.userData = {
    kind: "portal-wall-mesh",
    portalId: spec.portalId,
    sideIndex: spec.sideIndex,
  };
  return mesh;
}
