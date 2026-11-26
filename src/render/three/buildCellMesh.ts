/**
 * Builds the Three.js geometry of one prism cell in the cell's own local frame (which the portal pipeline later places).
 *
 * A cell is a convex polygon base (`baseVertices`, meters, counter-clockwise in the world xy plane) extruded to
 * `heightMeters`. The returned group is authored directly in Three.js axes (world (x, y, z) becomes (x, z, -y), see
 * `worldAxes`): a textured floor at y = 0, its scenery props (one merged mesh, `buildCellScenery`), a ceiling at y = height, one wall per side (a solid wall, or a portal
 * wall via `buildPortalMesh` for sides with a portal), optional portal debug panels, optional forbidden-zone
 * wireframes. Objects are not part of a cell mesh: creatures and static assets are runtime objects drawn from the registry. Floor UVs are metric (one texture tile = `tileSizeMeters`) or lattice UVs when a `floorUvFrame` is given (see `floorUv`); a lattice frame also gives a textured floor its rigid floor patches (`userData.floorPatchField`). Meshes carry names (`floor:`, `scenery:`, `ceiling:`, `wall:`) and
 * `userData.kind` tags that `cellRenderArchetypes` uses to classify them for instancing. Walls are nudged 1 cm
 * toward the cell interior along the inward normal to avoid z-fighting with coplanar surfaces. Called once per cell at load time; not a per-frame path.
 */

import * as THREE from "three";
import { floorLatticeUv, floorMetricUv, floorPatchField, type FloorLatticeUvFrame } from "../../cell-complex/floorUv";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import type { DebugLevelId } from "../../diagnostics/debugLevels";
import {
  shouldRenderPortalPlacard,
  shouldRenderPortalText,
  shouldRenderPortalWall,
  type PortalPanelModeId,
} from "../../glue/portalPanelMode";
import { sceneryBiomeForFloor, type SceneryLayoutOptions } from "../../world-assets/sceneryLayout";
import { buildCellSceneryMesh } from "./buildCellScenery";
import { blendStripWidthMeters, buildFloorBlendGeometry, groundBlendTransition } from "./groundBlendGeometry";
import { landmarkKeepOutDiscs } from "../../world-assets/landmarkLayout";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { WorldDressing } from "../../world-assets/worldDressing";
import { buildCellLandmarksMesh } from "./buildCellLandmarks";
import { buildPortalMesh } from "./buildPortalMesh";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
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
  /** Lattice frame for floor UVs (deformable families); when absent the floor uses metric UVs with the material's tile size. */
  readonly floorUvFrame?: FloorLatticeUvFrame;
  /** The world this cell belongs to: the floor needs the neighbouring cells to blend into them, and the generated dressing is looked up by world. */
  readonly world?: CompiledCellComplex;
  /** Generated dressing of the world (light direction, landmarks); cells of worlds without it get no landmarks. */
  readonly dressing?: WorldDressing;
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

  for (const floorMesh of buildFloorMeshes(cell, options)) {
    group.add(floorMesh);
  }
  // Lattice floors (the torus family) are continuous across cells by design, so they get no per-cell scenery.
  const landmarkPlacements = options.dressing?.landmarksByCellId.get(cell.id) ?? [];
  const scenery = options.floorUvFrame
    ? undefined
    : buildCellSceneryMesh(cell, { ...sceneryNeighbourOptions(cell, options.world), keepOutDiscs: landmarkKeepOutDiscs(landmarkPlacements) });
  if (scenery) {
    group.add(scenery);
  }
  const landmarks = options.floorUvFrame
    ? undefined
    : buildCellLandmarksMesh(cell.id, landmarkPlacements, options.dressing?.shadowAzimuthByCellId.get(cell.id) ?? 0);
  if (landmarks) {
    group.add(landmarks);
  }
  group.add(buildCeilingMesh(cell));
  group.add(buildSideWalls(cell, options.assets, options.debugLevel, options.portalPanelMode));

  if (options.debugLevel !== "off" && shouldRenderPortalText(options.portalPanelMode)) {
    group.add(buildPortalDebugPanels(cell, options));
  }

  if (options.debugLevel !== "off" && options.showForbiddenZoneWireframes) {
    group.add(buildForbiddenZoneWireframes(cell));
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
/** The tiling color texture of a cell's floor, or undefined if it has none or it failed to load. Shared, do not dispose. */
export function floorColorTexture(cell: CompiledPrismCell, assets: Pick<PreparedWorldAssets, "getConfiguredTexture">): THREE.Texture | undefined {
  if (cell.floorMaterial.kind !== "floor-texture" || !cell.floorMaterial.colorTexturePath) {
    return undefined;
  }

  return assets.getConfiguredTexture({
    assetPath: cell.floorMaterial.colorTexturePath,
    colorSpace: THREE.SRGBColorSpace,
    repeatX: 1,
    repeatY: 1,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    userData: {
      textureUrl: cell.floorMaterial.colorTexturePath,
      repeatX: 1,
      repeatY: 1,
    },
  });
}

/** What a floor strip's material needs to blend into the neighbour; stored in the strip mesh's `userData.groundBlend`, never in a material (clones JSON-copy `userData`). */
export interface FloorStripBlend {
  /** The cell whose ground the strip blends into (the cell itself on a side that does not blend). */
  readonly neighbourCellId: string;
  /** Colour texture of the neighbour's floor; shared, never disposed by the strip. */
  readonly neighbourMap: THREE.Texture;
  /** The neighbour's `floorColor`. */
  readonly neighbourColor: THREE.Color;
  /** Noise seed, equal for both cells of the portal. */
  readonly seed: number;
  /** Half-width of the transition, meters. */
  readonly halfWidthMeters: number;
  /** Amplitude of the border noise, meters. */
  readonly noiseAmplitudeMeters: number;
  /** False on a side that does not blend (solid wall): the neighbour's share is forced to 0. */
  readonly enabled: boolean;
}

// The cells a biome can blend with: the glued neighbour of each side, when it exists and is a textured floor.
function sceneryNeighbourOptions(cell: CompiledPrismCell, world: CompiledCellComplex | undefined): SceneryLayoutOptions {
  if (!world) {
    return {};
  }

  const biomes = new Map<number, ReturnType<typeof sceneryBiomeForFloor>>();
  let width = blendStripWidthMeters(cell);

  for (const portal of cell.portals) {
    const neighbour = world.cellsById.get(portal.targetCellId);

    if (neighbour?.floorMaterial.kind === "floor-texture") {
      biomes.set(portal.sideIndex, sceneryBiomeForFloor(neighbour.floorMaterial.name));
      width = Math.min(width, blendStripWidthMeters(neighbour));
    }
  }

  return { neighbourBiomeBySideIndex: biomes, neighbourBlendHalfWidthMeters: groundBlendTransition(width, width).halfWidthMeters };
}

function createFloorMaterial(cell: CompiledPrismCell, assets: PreparedWorldAssets, floorUvFrame?: FloorLatticeUvFrame): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cell.floorColor),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.userData.floorMaterialKind = cell.floorMaterial.kind;
  material.normalScale = new THREE.Vector2(0.8, 0.8);

  if (cell.floorMaterial.kind === "floor-texture" && cell.floorMaterial.colorTexturePath) {
    const texture = floorColorTexture(cell, assets);

    if (texture) {
      material.map = texture;
      if (floorUvFrame) {
        material.userData.floorPatchField = floorPatchField(floorUvFrame);
      }
      material.userData.textureUrl = cell.floorMaterial.colorTexturePath;
    } else {
      material.userData.missingTextureUrl = cell.floorMaterial.colorTexturePath;
    }
  }

  material.needsUpdate = true;
  return material;
}

// A metric textured floor in a world is an inner polygon plus one blend strip per side (design 018 section 8.3); every other floor is one mesh.
function buildFloorMeshes(cell: CompiledPrismCell, options: BuildCellMeshOptions): readonly THREE.Mesh[] {
  const ownTexture = !options.floorUvFrame && options.world ? floorColorTexture(cell, options.assets) : undefined;

  if (!options.world || !ownTexture) {
    return [buildFloorMesh(cell, options.assets, options.floorUvFrame)];
  }

  const neighbours = new Map<number, CompiledPrismCell>();
  const neighbourTextures = new Map<number, THREE.Texture>();

  for (const portal of cell.portals) {
    const neighbour = options.world.cellsById.get(portal.targetCellId);
    const texture = neighbour ? floorColorTexture(neighbour, options.assets) : undefined;

    if (neighbour && texture) {
      neighbours.set(portal.sideIndex, neighbour);
      neighbourTextures.set(portal.sideIndex, texture);
    }
  }

  const geometry = buildFloorBlendGeometry(cell, neighbours);
  const inner = new THREE.Mesh(geometry.inner, createFloorMaterial(cell, options.assets));
  inner.name = `floor:${cell.id}`;
  const meshes: THREE.Mesh[] = [inner];

  for (const strip of geometry.strips) {
    const mesh = new THREE.Mesh(strip.geometry, createFloorMaterial(cell, options.assets));
    mesh.name = `floor:${cell.id}:side-${strip.sideIndex}`;
    const blends = strip.neighbourCellId !== undefined;
    const neighbour = blends ? neighbours.get(strip.sideIndex) : undefined;
    const blend: FloorStripBlend = {
      neighbourCellId: strip.neighbourCellId ?? cell.id,
      neighbourMap: (blends ? neighbourTextures.get(strip.sideIndex) : undefined) ?? ownTexture,
      neighbourColor: new THREE.Color((neighbour ?? cell).floorColor),
      seed: strip.seed,
      halfWidthMeters: strip.halfWidthMeters,
      noiseAmplitudeMeters: strip.noiseAmplitudeMeters,
      enabled: blends,
    };
    mesh.userData = { kind: "floor-strip", cellId: cell.id, sideIndex: strip.sideIndex, groundBlend: blend };
    meshes.push(mesh);
  }

  return meshes;
}

function buildFloorMesh(cell: CompiledPrismCell, assets: PreparedWorldAssets, floorUvFrame?: FloorLatticeUvFrame): THREE.Mesh {
  const shape = new THREE.Shape();
  const first = cell.baseVertices[0];

  shape.moveTo(first.x, first.y);

  for (const vertex of cell.baseVertices.slice(1)) {
    shape.lineTo(vertex.x, vertex.y);
  }

  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  // Overwrite the UVs while the positions are still cell-local (x, y).
  const tileSizeMeters = cell.floorMaterial.kind === "floor-texture" ? cell.floorMaterial.tileSizeMeters : 1;
  const positions = geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    const point = { x: positions.getX(index), y: positions.getY(index) };
    const [s, t] = floorUvFrame ? floorLatticeUv(floorUvFrame, point) : floorMetricUv(point, tileSizeMeters);
    uvs[index * 2] = s;
    uvs[index * 2 + 1] = t;
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.rotateX(-Math.PI / 2);

  const floor = new THREE.Mesh(geometry, createFloorMaterial(cell, assets, floorUvFrame));
  floor.name = `floor:${cell.id}`;
  return floor;
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
