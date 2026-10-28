/**
 * Builds the instanced-mesh archetypes for the static geometry of every cell, one archetype per drawable mesh part.
 *
 * For each cell, `buildCellMesh` is run once; every classified mesh (floor, solid wall, portal frame, static
 * object, debug wireframe; ceilings and floor outlines are intentionally skipped) has its world matrix baked into a
 * cloned geometry in the cell's local frame and becomes an `InstancedMesh` whose instances are the visible
 * portal paths ending in that cell (`renderPortalInstances`). Instance capacity per cell is the largest number of
 * statically kept paths ending at that cell over all roots (optionally capped by the visible-path budget, at least 1).
 * Materials are cloned and, when a `PortalClipMaterialState` is given, patched for per-instance clipping.
 * Archetypes are built once at load time and disposed with `disposeCellRenderArchetypes`.
 */

import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import {
  buildStaticallyCulledPortalPathTables,
  type StaticPortalPathCullResult,
} from "../../cell-complex/staticPortalPathCull";
import type { DebugLevelId } from "../../glue/debugLevels";
import type { PortalPanelModeId } from "../../glue/portalPanelMode";
import { buildCellMesh } from "./buildCellMesh";
import { patchPortalClipMaterial, type PortalClipMaterialState } from "./portalClipMaterial";
import type { PreparedWorldAssets } from "./preloadWorldAssets";
import { disposeMaterial, disposeObject3D } from "./runtimeSceneUtils";

/** Category of a cell mesh part; "ceiling" and floor-outline meshes have no kind and are not instanced. */
export type CellRenderArchetypeKind =
  | "floor"
  | "solid-wall"
  | "portal-frame"
  | "static-object"
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
  /** Per-instance portal path id (float), read by the clip shader. */
  readonly portalPathIdAttribute: THREE.InstancedBufferAttribute;
  /** Per-instance clip-texture row, -2 for unclipped, -1 for no slot. */
  readonly portalClipIndexAttribute: THREE.InstancedBufferAttribute;
  /** Maximum instances per frame. */
  readonly capacity: number;
  /** Name of the source Three.js mesh, if it had one. */
  readonly sourceObjectName?: string;
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

  for (const cell of world.cells) {
    const sources = collectCellArchetypeSources(cell, options);

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
      archetypes.push({
        cellId: source.cellId,
        archetypeId: source.archetypeId,
        kind: source.kind,
        mesh,
        portalPathIdAttribute,
        portalClipIndexAttribute,
        capacity: source.capacity,
        sourceObjectName: source.sourceObjectName,
      });
    }
  }

  return archetypes;
}

/** Lists the archetypes `buildCellRenderArchetypes` would create (ids, kinds, capacities). Note that it constructs (and discards) full cell meshes, so it is not free. */
export function planCellRenderArchetypes(
  world: CompiledCellComplex,
  options: BuildCellRenderArchetypesOptions,
): readonly CellRenderArchetypePlanEntry[] {
  return world.cells.flatMap((cell) =>
    collectCellArchetypeSources(cell, options).map((source) => ({
      cellId: source.cellId,
      archetypeId: source.archetypeId,
      kind: source.kind,
      capacity: source.capacity,
      sourceObjectName: source.sourceObjectName,
    })),
  );
}

/**
 * Computes per-cell instance capacities from statically culled path tables.
 *
 * Capacity of a cell = max over all root cells of the number of kept paths whose destination is that cell, clamped
 * to `maxVisiblePaths` when given, and at least 1.
 */
export function deriveCellRenderArchetypeCapacities(
  world: CompiledCellComplex,
  staticCull: StaticPortalPathCullResult,
  maxVisiblePaths?: number,
): ReadonlyMap<string, number> {
  const capacities = new Map(world.cells.map((cell) => [cell.id, 0]));

  for (const table of staticCull.tables.tablesByRootCellId.values()) {
    for (const [cellId, paths] of table.pathsByDestinationCellId) {
      capacities.set(cellId, Math.max(capacities.get(cellId) ?? 0, paths.length));
    }
  }

  for (const cell of world.cells) {
    const capacity = capacities.get(cell.id) ?? 0;
    const clampedCapacity =
      maxVisiblePaths === undefined ? capacity : Math.min(capacity, Math.max(0, maxVisiblePaths));
    capacities.set(cell.id, Math.max(1, clampedCapacity));
  }

  return capacities;
}

/** Builds the static path tables (depth `maxDepth`, immediate reversals skipped, 1e-6 m tolerance, 50 000 path cap per root) and derives per-cell capacities. This can be expensive for large worlds. */
export function buildDefaultCellRenderArchetypeCapacities(
  world: CompiledCellComplex,
  maxDepth: number,
  maxVisiblePaths?: number,
): ReadonlyMap<string, number> {
  const staticCull = buildStaticallyCulledPortalPathTables(world, {
    maxDepth,
    skipImmediateReverse: true,
    toleranceMeters: 1e-6,
    maxKeptPathsPerRoot: 50_000,
  });

  return deriveCellRenderArchetypeCapacities(world, staticCull, maxVisiblePaths);
}

/** Disposes the geometry and materials of the given archetypes. */
export function disposeCellRenderArchetypes(archetypes: readonly CellRenderArchetype[]): void {
  for (const archetype of archetypes) {
    archetype.mesh.geometry.dispose();
    disposeMaterial(archetype.mesh.material);
  }
}

interface CellArchetypeSource {
  readonly cellId: string;
  readonly archetypeId: string;
  readonly kind: CellRenderArchetypeKind;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  readonly capacity: number;
  readonly sourceObjectName?: string;
}

// Bakes each mesh's world matrix (relative to the cell mesh root) into its geometry so instance matrices only need rootFromDestination.
function collectCellArchetypeSources(
  cell: CompiledPrismCell,
  options: BuildCellRenderArchetypesOptions,
): readonly CellArchetypeSource[] {
  const sourceRoot = buildCellMesh(cell, {
    debugLevel: options.debugLevel,
    portalPanelMode: options.portalPanelMode,
    eyeHeightMeters: options.eyeHeightMeters,
    assets: options.assets,
    showForbiddenZoneWireframes: options.showForbiddenZoneWireframes,
  });
  sourceRoot.updateMatrixWorld(true);

  const capacity = options.capacitiesByCellId.get(cell.id) ?? 1;
  const sources: CellArchetypeSource[] = [];

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
    const material = cloneMaterial(object.material, options.portalClipMaterialState);
    const archetypeIndex = sources.length;
    sources.push({
      cellId: cell.id,
      archetypeId: `${cell.id}:${kind}:${archetypeIndex}`,
      kind,
      geometry,
      material,
      capacity,
      sourceObjectName: object.name || undefined,
    });
  });

  disposeObject3D(sourceRoot);
  return sources;
}

function classifyObjectKind(object: THREE.Mesh): CellRenderArchetypeKind | undefined {
  if (object.name.startsWith("floor:")) {
    return "floor";
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

  if (hasAncestorNamed(object, "decoration:") || hasAncestorNamed(object, "asset:")) {
    return "static-object";
  }

  return undefined;
}

function hasAncestorNamed(object: THREE.Object3D, prefix: string): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (current.name.startsWith(prefix)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function cloneMaterial(
  material: THREE.Material | THREE.Material[],
  portalClipMaterialState: PortalClipMaterialState | undefined,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    const cloned = material.map((entry) => entry.clone());
    return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
  }

  const cloned = material.clone();
  return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
}
