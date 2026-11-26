/**
 * Builds the instanced-mesh archetypes for the static geometry of every cell, one archetype per drawable mesh part.
 *
 * For each cell, `buildCellMesh` is run once; every classified mesh (floor, scenery, solid wall, portal frame, static
 * object, debug wireframe; ceilings and floor outlines are intentionally skipped) has its world matrix baked into a
 * cloned geometry in the cell's local frame and becomes an `InstancedMesh` whose instances are the visible
 * portal paths ending in that cell (`renderPortalInstances`). Instance capacity per cell is the largest number of
 * statically kept paths ending at that cell over all roots (optionally capped by the visible-path budget, at least 1).
 * Materials are cloned and, when a `PortalClipMaterialState` is given, patched for per-instance clipping. Each
 * archetype also owns a hidden plain `rootMesh` (shared geometry, unpatched material clone) that draws the unclipped
 * root path with early depth rejection.
 * Archetypes are built once at load time and disposed with `disposeCellRenderArchetypes`.
 */

import type { FloorLatticeUvFrame } from "../../cell-complex/floorUv";
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import type { StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import type { DebugLevelId } from "../../diagnostics/debugLevels";
import type { PortalPanelModeId } from "../../glue/portalPanelMode";
import { buildCellMesh, type FloorStripBlend } from "./buildCellMesh";
import { computeGroundTint, type GroundTint } from "../../world-assets/groundTint";
import { landmarkMaxDrawDistanceMeters, patchDistanceFadeMaterial, sceneryFadeEndMeters, sceneryFadeStartMeters } from "./distanceFade";
import { groundPaletteMultiplier, groundRecolorStrength } from "../../world-assets/facePalettes";
import { landmarkShadowCasters } from "../../world-assets/landmarkLayout";
import { computeWorldDressing, type WorldDressing } from "../../world-assets/worldDressing";
import { patchFloorPatchMaterial } from "./floorPatchMaterial";
import { patchGroundBlendMaterial, type GroundBlendOptions } from "./groundBlendMaterial";
import { createGroundTintTexture, patchGroundTintMaterial } from "./groundTintMaterial";
import { patchPortalClipMaterial, type PortalClipMaterialState } from "./portalClipMaterial";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
import { disposeMaterial, disposeObject3D } from "./runtimeSceneUtils";

/** Category of a cell mesh part; "ceiling" and floor-outline meshes have no kind and are not instanced. */
export type CellRenderArchetypeKind =
  | "floor"
  | "scenery"
  | "landmark"
  | "solid-wall"
  | "portal-frame"
  | "debug-wireframe";

/** An instanced mesh of one cell part with its per-instance portal attributes. */
export interface CellRenderArchetype {
  /** Cell whose geometry this archetype holds. */
  readonly cellId: string;
  /** Unique id `<cellId>:<kind>:<index>`. */
  readonly archetypeId: string;
  readonly kind: CellRenderArchetypeKind;
  /** Instanced mesh; `mesh.count` is the number of instances drawn this frame. */
  readonly mesh: THREE.InstancedMesh;
  /**
   * Plain mesh of the same geometry with an unpatched material, used to draw the unclipped depth-0 (root) path so it
   * keeps early depth rejection; hidden unless `updateCellRenderArchetypeInstances` is asked to `separateRoot` it.
   */
  readonly rootMesh: THREE.Mesh;
  /** Per-instance portal path id (float), read by the clip shader. */
  readonly portalPathIdAttribute: THREE.InstancedBufferAttribute;
  /** Per-instance clip-texture row, -2 for unclipped, -1 for no slot. */
  readonly portalClipIndexAttribute: THREE.InstancedBufferAttribute;
  /** Maximum instances per frame. */
  readonly capacity: number;
  /** Name of the source Three.js mesh, if it had one. */
  readonly sourceObjectName?: string;
  /** Textures created for this archetype's materials (the ground tint); `disposeCellRenderArchetypes` disposes them. */
  readonly ownedTextures?: readonly THREE.Texture[];
  /**
   * Farthest distance from the eye, meters, at which this archetype is drawn (see `distanceFade.ts`): a path whose copy of `bounds` is
   * entirely farther from every eye is skipped. Undefined means it is drawn at every distance.
   */
  readonly maxDrawDistanceMeters?: number;
  /** Bounding sphere of the geometry in the cell's frame; set together with `maxDrawDistanceMeters`. */
  readonly bounds?: THREE.Sphere;
}

/** Farthest distance from the eye at which an archetype of this kind is drawn, meters; undefined for every distance. */
export function maxDrawDistanceMetersFor(kind: CellRenderArchetypeKind): number | undefined {
  return kind === "scenery" ? sceneryFadeEndMeters : kind === "landmark" ? landmarkMaxDrawDistanceMeters : undefined;
}

/** Options controlling how cell meshes are built and instanced. */
export interface BuildCellRenderArchetypesOptions {
  readonly debugLevel: DebugLevelId;
  readonly portalPanelMode: PortalPanelModeId;
  readonly eyeHeightMeters: number;
  readonly assets: PreparedWorldAssets;
  /** Instance capacity per cell id (missing cells default to 1). */
  readonly capacitiesByCellId: ReadonlyMap<string, number>;
  /** If provided, materials are patched for portal clipping; otherwise instances are drawn unclipped. */
  readonly portalClipMaterialState?: PortalClipMaterialState;
  readonly showForbiddenZoneWireframes?: boolean;
  /** Per cell id, the lattice frame for floor UVs; cells not in the map use metric UVs. */
  readonly floorUvFramesByCellId?: ReadonlyMap<string, FloorLatticeUvFrame>;
  /** Generated dressing of the world (light direction, landmarks). Computed from the world when absent, except for worlds with lattice floors, which get none. */
  readonly dressing?: WorldDressing;
}

/** Description of an archetype that would be built, for diagnostics and tests, without creating GPU resources. */
export interface CellRenderArchetypePlanEntry {
  readonly cellId: string;
  readonly archetypeId: string;
  readonly kind: CellRenderArchetypeKind;
  readonly capacity: number;
  readonly sourceObjectName?: string;
}

/** Builds every cell's archetypes, with `count = 0` and frustum culling disabled (instance bounds are not tracked). */
export function buildCellRenderArchetypes(
  world: CompiledCellComplex,
  options: BuildCellRenderArchetypesOptions,
): readonly CellRenderArchetype[] {
  const archetypes: CellRenderArchetype[] = [];
  const context = createWorldContext(world, options);

  for (const cell of world.cells) {
    const sources = collectCellArchetypeSources(world, cell, options, context);

    for (const source of sources) {
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, source.capacity);
      const portalPathIdAttribute = new THREE.InstancedBufferAttribute(new Float32Array(source.capacity), 1);
      const portalClipIndexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(source.capacity), 1);
      mesh.name = source.archetypeId;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      portalPathIdAttribute.setUsage(THREE.DynamicDrawUsage);
      portalClipIndexAttribute.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute("portalPathId", portalPathIdAttribute);
      mesh.geometry.setAttribute("portalClipIndex", portalClipIndexAttribute);
      mesh.userData = {
        kind: "cell-render-archetype",
        cellId: source.cellId,
        archetypeId: source.archetypeId,
        archetypeKind: source.kind,
        sourceObjectName: source.sourceObjectName,
      };
      const rootMesh = new THREE.Mesh(source.geometry, source.rootMaterial);
      rootMesh.name = `${source.archetypeId}:root`;
      rootMesh.matrixAutoUpdate = false;
      rootMesh.visible = false;
      rootMesh.frustumCulled = false;
      rootMesh.userData = { kind: "cell-render-archetype-root", cellId: source.cellId, archetypeId: source.archetypeId };
      archetypes.push({
        cellId: source.cellId,
        archetypeId: source.archetypeId,
        kind: source.kind,
        mesh,
        rootMesh,
        portalPathIdAttribute,
        portalClipIndexAttribute,
        capacity: source.capacity,
        sourceObjectName: source.sourceObjectName,
        ownedTextures: source.ownedTextures,
        ...distanceLimitFor(source),
      });
    }
  }

  return archetypes;
}

function distanceLimitFor(source: CellArchetypeSource): { maxDrawDistanceMeters?: number; bounds?: THREE.Sphere } {
  const maxDrawDistanceMeters = maxDrawDistanceMetersFor(source.kind);

  if (maxDrawDistanceMeters === undefined) {
    return {};
  }

  source.geometry.computeBoundingSphere();
  return { maxDrawDistanceMeters, bounds: source.geometry.boundingSphere!.clone() };
}

/** Lists the archetypes `buildCellRenderArchetypes` would create (ids, kinds, capacities). Note that it constructs (and discards) full cell meshes, so it is not free. */
export function planCellRenderArchetypes(
  world: CompiledCellComplex,
  options: BuildCellRenderArchetypesOptions,
): readonly CellRenderArchetypePlanEntry[] {
  const context = createWorldContext(world, options);
  const entries = world.cells.flatMap((cell) =>
    collectCellArchetypeSources(world, cell, options, context).map((source) => ({
      cellId: source.cellId,
      archetypeId: source.archetypeId,
      kind: source.kind,
      capacity: source.capacity,
      sourceObjectName: source.sourceObjectName,
    })),
  );

  // A plan keeps nothing: release the tint textures the sources would have handed to archetypes.
  for (const { texture } of context.groundTints.values()) {
    texture.dispose();
  }

  return entries;
}

/**
 * Computes per-cell instance capacities from statically culled path tables.
 *
 * Capacity of a cell = the sum of the `eyes` largest per-root counts of kept paths whose destination is that cell
 * (`eyes = 1`: the maximum over roots; `eyes = 2`: two eyes rooted in different cells, or in one cell at different
 * frames, see issue 59), clamped to `maxVisiblePaths` when given, and at least 1.
 */
export function deriveCellRenderArchetypeCapacities(
  world: CompiledCellComplex,
  staticCull: StaticPortalPathCullResult,
  maxVisiblePaths?: number,
  eyes = 1,
): ReadonlyMap<string, number> {
  const countsByCell = new Map<string, number[]>(world.cells.map((cell) => [cell.id, []]));
  const eyeCount = Math.max(1, Math.floor(eyes));

  for (const table of staticCull.tables.tablesByRootCellId.values()) {
    for (const [cellId, paths] of table.pathsByDestinationCellId) {
      const counts = countsByCell.get(cellId);

      if (counts) {
        counts.push(paths.length);
      } else {
        countsByCell.set(cellId, [paths.length]);
      }
    }
  }

  const capacities = new Map<string, number>();

  for (const [cellId, counts] of countsByCell) {
    const capacity = counts
      .sort((left, right) => right - left)
      .slice(0, eyeCount)
      .reduce((sum, count) => sum + count, 0);
    const clampedCapacity =
      maxVisiblePaths === undefined ? capacity : Math.min(capacity, Math.max(0, maxVisiblePaths));

    capacities.set(cellId, Math.max(1, clampedCapacity));
  }

  return capacities;
}

/** Disposes the geometry and materials of the given archetypes. */
export function disposeCellRenderArchetypes(archetypes: readonly CellRenderArchetype[]): void {
  for (const archetype of archetypes) {
    archetype.mesh.geometry.dispose();
    disposeMaterial(archetype.mesh.material);
    disposeMaterial(archetype.rootMesh.material);
    for (const texture of archetype.ownedTextures ?? []) {
      texture.dispose();
    }
  }
}

interface CellArchetypeSource {
  readonly cellId: string;
  readonly archetypeId: string;
  readonly kind: CellRenderArchetypeKind;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  /** Unpatched clone of the source material, for `CellRenderArchetype.rootMesh`. */
  readonly rootMaterial: THREE.Material | THREE.Material[];
  readonly capacity: number;
  readonly sourceObjectName?: string;
  readonly ownedTextures?: readonly THREE.Texture[];
}

// Worlds with lattice floors (the torus family) are continuous by design and get no generated dressing.
function worldDressingFor(world: CompiledCellComplex, options: BuildCellRenderArchetypesOptions): WorldDressing | undefined {
  if (options.dressing) {
    return options.dressing;
  }

  return options.floorUvFramesByCellId && options.floorUvFramesByCellId.size > 0 ? undefined : computeWorldDressing(world);
}

/** A cell's ground tint image and the texture made from it. */
interface CellGroundTint {
  readonly tint: GroundTint;
  readonly texture: THREE.DataTexture;
}

// What every cell of one build shares: the dressing, and the tint of every metric textured cell (a strip samples its neighbour's tint).
interface WorldBuildContext {
  readonly dressing: WorldDressing | undefined;
  readonly groundTints: ReadonlyMap<string, CellGroundTint>;
}

// Only metric textured floors are tinted and blended; lattice floors are continuous across cells by design.
function createWorldContext(world: CompiledCellComplex, options: BuildCellRenderArchetypesOptions): WorldBuildContext {
  const dressing = worldDressingFor(world, options);
  const groundTints = new Map<string, CellGroundTint>();

  for (const cell of world.cells) {
    if (cell.floorMaterial.kind !== "floor-texture" || options.floorUvFramesByCellId?.get(cell.id)) {
      continue;
    }

    const look = dressing?.lookByCellId.get(cell.id);
    const tint = computeGroundTint(cell, {
      shadowAzimuthRadians: dressing?.shadowAzimuthByCellId.get(cell.id),
      casters: landmarkShadowCasters(dressing?.landmarksByCellId.get(cell.id) ?? []),
      colorMultiplier: look ? groundPaletteMultiplier(look.palette) : undefined,
      recolorStrength: look ? groundRecolorStrength : 0,
    });
    groundTints.set(cell.id, { tint, texture: createGroundTintTexture(tint) });
  }

  return { dressing, groundTints };
}

// Bakes each mesh's world matrix (relative to the cell mesh root) into its geometry so instance matrices only need rootFromDestination.
function collectCellArchetypeSources(
  world: CompiledCellComplex,
  cell: CompiledPrismCell,
  options: BuildCellRenderArchetypesOptions,
  context: WorldBuildContext,
): readonly CellArchetypeSource[] {
  const sourceRoot = buildCellMesh(cell, {
    debugLevel: options.debugLevel,
    portalPanelMode: options.portalPanelMode,
    eyeHeightMeters: options.eyeHeightMeters,
    assets: options.assets,
    showForbiddenZoneWireframes: options.showForbiddenZoneWireframes,
    floorUvFrame: options.floorUvFramesByCellId?.get(cell.id),
    world,
    dressing: context.dressing,
  });
  sourceRoot.updateMatrixWorld(true);

  const capacity = options.capacitiesByCellId.get(cell.id) ?? 1;
  const sources: CellArchetypeSource[] = [];
  const ownTint = context.groundTints.get(cell.id);
  // The cell's own tint texture is disposed once, with the first floor archetype of the cell; strips of other cells only read it.
  let tintOwned = false;

  sourceRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const kind = classifyObjectKind(object);

    if (!kind) {
      return;
    }

    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const floorPatches: FloorMaterialPatches | undefined = kind === "floor" && ownTint ? floorPatchesFor(object, ownTint, context.groundTints) : undefined;
    const fade = kind === "scenery";
    const material = cloneMaterial(object.material, options.portalClipMaterialState, floorPatches, fade);
    const rootMaterial = cloneMaterial(object.material, undefined, floorPatches, fade);
    const archetypeIndex = sources.length;
    const ownsTint = floorPatches !== undefined && !tintOwned;
    tintOwned ||= ownsTint;
    sources.push({
      cellId: cell.id,
      archetypeId: `${cell.id}:${kind}:${archetypeIndex}`,
      kind,
      geometry,
      material,
      rootMaterial,
      capacity,
      sourceObjectName: object.name || undefined,
      ownedTextures: ownsTint ? [ownTint!.texture] : undefined,
    });
  });

  disposeObject3D(sourceRoot);
  return sources;
}

// The ground patches of one floor mesh: a strip blends with its neighbour's ground, the inner polygon only tints. A neighbour without a tint image does not blend.
function floorPatchesFor(object: THREE.Mesh, ownTint: CellGroundTint, groundTints: ReadonlyMap<string, CellGroundTint>): FloorMaterialPatches {
  const strip = object.userData.groundBlend as FloorStripBlend | undefined;

  if (!strip) {
    return { tint: ownTint };
  }

  const neighbourTint = groundTints.get(strip.neighbourCellId);
  return {
    tint: ownTint,
    blend: {
      ownTint,
      neighbourMap: strip.neighbourMap,
      neighbourColor: strip.neighbourColor,
      neighbourTint: neighbourTint ?? ownTint,
      halfWidthMeters: strip.halfWidthMeters,
      noiseAmplitudeMeters: strip.noiseAmplitudeMeters,
      cornerSlopes: strip.cornerSlopes,
      seed: strip.seed,
      enabled: strip.enabled && neighbourTint !== undefined,
    },
  };
}

function classifyObjectKind(object: THREE.Mesh): CellRenderArchetypeKind | undefined {
  if (object.name.startsWith("floor:")) {
    return "floor";
  }

  if (object.userData.kind === "landmark") {
    return "landmark";
  }

  if (object.userData.kind === "scenery") {
    return "scenery";
  }

  if (object.name.startsWith("ceiling:")) {
    // The ceiling is a sky-colored collision cap. Rendering it through
    // portal clip polygons makes aperture edges visible against the sky.
    return undefined;
  }

  if (object.userData.kind === "solid-wall") {
    return "solid-wall";
  }

  if (object.userData.kind === "portal-wall-mesh") {
    return "portal-frame";
  }

  if (object.name.startsWith("portal-debug-panel:") || object.name.startsWith("portal-debug-label:")) {
    return "portal-frame";
  }

  if (object.name.startsWith("floor-outline:")) {
    return undefined;
  }

  if (object.userData.kind === "debug-wireframe") {
    return "debug-wireframe";
  }

  return undefined;
}

/** The ground patches a floor mesh's material gets: the tint, or the blend with the neighbour (which includes the tint). */
interface FloorMaterialPatches {
  readonly tint: CellGroundTint;
  readonly blend?: GroundBlendOptions;
}

// Clone -> floor patch -> ground tint or ground blend -> portal clip: the clip patch chains the earlier hooks and must stay last.
function cloneMaterial(
  material: THREE.Material | THREE.Material[],
  portalClipMaterialState: PortalClipMaterialState | undefined,
  floorPatches: FloorMaterialPatches | undefined,
  distanceFade = false,
): THREE.Material | THREE.Material[] {
  const prepare = (entry: THREE.Material): THREE.Material => {
    const floorPatched = patchFloorPatchMaterial(entry.clone());
    const patched = distanceFade
      ? patchDistanceFadeMaterial(floorPatched, { startMeters: sceneryFadeStartMeters, endMeters: sceneryFadeEndMeters })
      : floorPatched;

    if (!floorPatches) {
      return patched;
    }

    return floorPatches.blend
      ? patchGroundBlendMaterial(patched, floorPatches.blend)
      : patchGroundTintMaterial(patched, floorPatches.tint.texture, floorPatches.tint.tint);
  };

  if (Array.isArray(material)) {
    const cloned = material.map(prepare);
    return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
  }

  const cloned = prepare(material);
  return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
}
