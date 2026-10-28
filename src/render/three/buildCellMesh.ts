/**
 * Builds the Three.js geometry of one prism cell in the cell's own local frame (which the portal pipeline later places).
 *
 * A cell is a convex polygon base (`baseVertices`, meters, counter-clockwise in the world xy plane) extruded to
 * `heightMeters`. The returned group is authored directly in Three.js axes (world (x, y, z) becomes (x, z, -y), see
 * `worldAxes`): a textured floor at y = 0, a ceiling at y = height, one wall per side (a solid wall, or a portal
 * wall via `buildPortalMesh` for sides with a portal), optional portal debug panels, optional forbidden-zone
 * wireframes and one decoration per static object spec. Meshes carry names (`floor:`, `ceiling:`, `wall:`) and
 * `userData.kind` tags that `cellRenderArchetypes` uses to classify them for instancing. Walls are nudged 1 cm
 * toward the cell interior along the inward normal to avoid z-fighting with coplanar surfaces. Creature object specs are skipped here
 * because they are runtime objects. Called once per cell at load time; not a per-frame path.
 */

import * as THREE from "three";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import type { DebugLevelId } from "../../glue/debugLevels";
import {
  shouldRenderPortalPlacard,
  shouldRenderPortalText,
  shouldRenderPortalWall,
  type PortalPanelModeId,
} from "../../glue/portalPanelMode";
import { buildDecorationMesh } from "./buildDecorationMesh";
import { buildPortalMesh } from "./buildPortalMesh";
import { isGeodesicMarmotObjectSpec } from "../../world-objects/geodesicMarmot";
import { isSimpleGeoCreatureObjectSpec } from "../../world-objects/simpleGeoCreature";
import type { PreparedWorldAssets } from "./preloadWorldAssets";
import { SCENE_BACKGROUND_COLOR } from "./sceneColors";
import { buildForbiddenZoneWireframe } from "./debugCollisionWireframes";

/** Options controlling which debug and decoration content a cell mesh includes. */
export interface BuildCellMeshOptions {
  /** Debug level; "off" suppresses portal debug panels, portal walls and wireframes. */
  readonly debugLevel: DebugLevelId;
  /** Which portal wall / placard / text elements to show. */
  readonly portalPanelMode: PortalPanelModeId;
  /** Height in meters at which portal debug panels are placed. */
  readonly eyeHeightMeters: number;
  /** Preloaded textures and models; a missing required asset throws. */
  readonly assets: PreparedWorldAssets;
  /** Whether to add wireframes of the cell's forbidden (non-walkable) zones when debugging. */
  readonly showForbiddenZoneWireframes?: boolean;
}

/** Builds the full Three.js group for a cell, named `cell:<id>` and tagged with its portal sides in `userData`. */
export function buildCellMesh(cell: CompiledPrismCell, options: BuildCellMeshOptions): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `cell:${cell.id}`;
  group.userData = {
    kind: "cell",
    cellId: cell.id,
    portalSides: cell.portals.map((portal) => ({
      portalId: portal.id,
      sideIndex: portal.sideIndex,
      targetCellId: portal.targetCellId,
      targetPortalId: portal.targetPortalId,
    })),
  };

  group.add(buildFloorMesh(cell, options.assets));
  group.add(buildCeilingMesh(cell));
  group.add(buildSideWalls(cell, options.assets, options.debugLevel, options.portalPanelMode));

  if (options.debugLevel !== "off" && shouldRenderPortalText(options.portalPanelMode)) {
    group.add(buildPortalDebugPanels(cell, options));
  }

  if (options.debugLevel !== "off" && options.showForbiddenZoneWireframes) {
    group.add(buildForbiddenZoneWireframes(cell));
  }

  for (const objectSpec of cell.objects) {
    if (isGeodesicMarmotObjectSpec(objectSpec) || isSimpleGeoCreatureObjectSpec(objectSpec)) {
      continue;
    }

    group.add(buildDecorationMesh(cell.id, objectSpec, options.assets));
  }

  return group;
}

function buildForbiddenZoneWireframes(cell: CompiledPrismCell): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `forbidden-zone-wireframes:${cell.id}`;

  for (const zone of cell.forbiddenZones) {
    group.add(buildForbiddenZoneWireframe(cell.id, zone.collision, cell.heightMeters));
  }

  return group;
}

// ShapeGeometry lives in the xy plane; rotateX(-pi/2) sends (x, y, 0) to (x, 0, -y), i.e. world y becomes Three -z.
function buildFloorMesh(cell: CompiledPrismCell, assets: PreparedWorldAssets): THREE.Object3D {
  const shape = new THREE.Shape();
  const first = cell.baseVertices[0];

  shape.moveTo(first.x, first.y);

  for (const vertex of cell.baseVertices.slice(1)) {
    shape.lineTo(vertex.x, vertex.y);
  }

  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cell.floorColor),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.userData.floorMaterialKind = cell.floorMaterial.kind;
  material.normalScale = new THREE.Vector2(0.8, 0.8);

  if (cell.floorMaterial.kind === "floor-texture" && cell.floorMaterial.colorTexturePath) {
    const repeat = floorTextureRepeat(cell.baseVertices, cell.floorMaterial.tileSizeMeters);
    const texture = assets.getConfiguredTexture({
      assetPath: cell.floorMaterial.colorTexturePath,
      colorSpace: THREE.SRGBColorSpace,
      repeatX: repeat,
      repeatY: repeat,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      userData: {
        textureUrl: cell.floorMaterial.colorTexturePath,
        repeatX: repeat,
        repeatY: repeat,
      },
    });

    if (texture) {
      material.map = texture;
      material.userData.textureUrl = cell.floorMaterial.colorTexturePath;
    } else {
      material.userData.missingTextureUrl = cell.floorMaterial.colorTexturePath;
    }
  }

  material.needsUpdate = true;

  const floor = new THREE.Mesh(geometry, material);
  floor.name = `floor:${cell.id}`;
  return floor;
}

// Number of texture tiles across the larger bounding-box extent; floored at 0.01 and 1 for non-positive tile sizes.
function floorTextureRepeat(
  vertices: readonly { readonly x: number; readonly y: number }[],
  tileSizeMeters: number,
): number {
  if (tileSizeMeters <= 0) {
    return 1;
  }

  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.max(span / tileSizeMeters, 0.01);
}

function buildCeilingMesh(cell: CompiledPrismCell): THREE.Object3D {
  const shape = new THREE.Shape();
  const first = cell.baseVertices[0];

  shape.moveTo(first.x, first.y);

  for (const vertex of cell.baseVertices.slice(1)) {
    shape.lineTo(vertex.x, vertex.y);
  }

  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);

  const ceiling = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: SCENE_BACKGROUND_COLOR,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  ceiling.name = `ceiling:${cell.id}`;
  ceiling.position.y = cell.heightMeters;
  return ceiling;
}

function buildSideWalls(
  cell: CompiledPrismCell,
  assets: PreparedWorldAssets,
  debugLevel: DebugLevelId,
  portalPanelMode: PortalPanelModeId,
): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `walls:${cell.id}`;
  const showPortalWall = debugLevel !== "off" && shouldRenderPortalWall(portalPanelMode);

  for (const side of cell.sides) {
    const start = side.start;
    const end = side.end;

    if (side.portal) {
      group.add(
        buildPortalMesh({
          portalId: side.portal.id,
          sideIndex: side.sideIndex,
          start,
          end,
          heightMeters: cell.heightMeters,
          assets,
          showWall: showPortalWall,
        }),
      );
      continue;
    }

    const wall = buildSolidWallMesh(cell.id, side.sideIndex, start, end, cell.heightMeters);
    group.add(wall);
  }

  return group;
}

// Inward normal in Three axes for side start->end of a CCW polygon: world (-dy, dx) maps to Three (-dy, 0, -dx).
function buildPortalDebugPanels(cell: CompiledPrismCell, options: BuildCellMeshOptions): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `portal-debug:${cell.id}`;

  for (const portal of cell.portals) {
    const start = cell.baseVertices[portal.sideIndex];
    const end = cell.baseVertices[(portal.sideIndex + 1) % cell.baseVertices.length];

    if (!start || !end) {
      continue;
    }

    const edge = new THREE.Vector3(end.x - start.x, 0, -(end.y - start.y));
    const edgeLength = edge.length();
    const inward = new THREE.Vector3(-(end.y - start.y), 0, -(end.x - start.x)).normalize();
    const position = new THREE.Vector3((start.x + end.x) / 2, options.eyeHeightMeters, -((start.y + end.y) / 2));
    position.addScaledVector(inward, 0.04);

    const panelWidth = Math.min(edgeLength * 0.75, 6);
    const panelHeight = 1.1;
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward);

    if (shouldRenderPortalPlacard(options.portalPanelMode)) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(panelWidth, panelHeight),
        new THREE.MeshBasicMaterial({
          color: 0x101820,
          opacity: 0.78,
          transparent: true,
          side: THREE.DoubleSide,
        }),
      );
      panel.position.copy(position);
      panel.quaternion.copy(rotation);
      panel.name = `portal-debug-panel:${cell.id}:${portal.id}`;
      group.add(panel);
    }

    const label = buildTextPlane(
      `${portal.sideIndex} -> ${portal.targetCellId}, ${formatSideLabel(portal.targetPortalId)}`,
      panelWidth * 0.9,
      panelHeight * 0.72,
    );
    label.position.copy(position);
    label.position.addScaledVector(inward, shouldRenderPortalPlacard(options.portalPanelMode) ? 0.02 : 0.01);
    label.quaternion.copy(rotation);
    label.name = `portal-debug-label:${cell.id}:${portal.id}`;
    group.add(label);
  }

  return group;
}

function buildTextPlane(text: string, widthMeters: number, heightMeters: number): THREE.Object3D {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create text canvas context.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "bold 96px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const lines = text.split("\n");
  const lineHeight = 116;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;

  for (const [index, line] of lines.entries()) {
    context.fillText(line, canvas.width / 2, startY + index * lineHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthMeters, heightMeters), material);
  return mesh;
}

// A PlaneGeometry faces +z; the quaternion rotates +z onto the inward normal, so the wall's front side faces into the cell.
function buildSolidWallMesh(
  cellId: string,
  sideIndex: number,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  heightMeters: number,
): THREE.Mesh {
  const edgeLength = Math.hypot(end.x - start.x, end.y - start.y);
  const inward = new THREE.Vector3(-(end.y - start.y), 0, -(end.x - start.x)).normalize();
  const position = new THREE.Vector3((start.x + end.x) / 2, heightMeters / 2, -((start.y + end.y) / 2));
  const geometry = new THREE.PlaneGeometry(edgeLength, heightMeters);
  const material = new THREE.MeshStandardMaterial({
    color: 0x6d7f86,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(position).addScaledVector(inward, 0.01);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward);
  mesh.name = `wall:${cellId}:${sideIndex}`;
  mesh.userData = {
    kind: "solid-wall",
    cellId,
    sideIndex,
  };
  return mesh;
}

function formatSideLabel(portalId: string): string {
  const match = /side-(\d+)$/.exec(portalId);

  if (!match) {
    return portalId;
  }

  return match[1];
}
