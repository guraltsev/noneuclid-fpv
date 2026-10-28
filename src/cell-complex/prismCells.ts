/**
 * Compiled runtime representation of a single prism cell and its sides.
 * Given a validated PrismCellSpec this module computes, in the cell's local frame (meters), each side's endpoints, length and unit inward normal (for a counterclockwise polygon, the normal is the side direction rotated +90 degrees about +z, i.e. pointing into the cell), the portal-junction vertices and their forbidden cylinders, and resolved floor visuals. Portals are attached in a second step because deriving a portal's transform needs the geometry of its target cell.
 */
import type { AuthoredPortalSpec, CellObjectSpec, CompiledPortal, FloorMaterialSpec, PrismCellSpec } from "./specs";
import {
  forbiddenPortalJunctionHeightMeters,
  forbiddenPortalJunctionRadiusMeters,
  type ForbiddenZone,
  type PortalJunction,
  type SingularityCollisionCylinder,
} from "./forbiddenZones";

/**
 * Portal-free compiled cell geometry: sides, junctions, forbidden zones and visuals, all in the cell's local frame.
 * `isConvex` is always true; the engine only supports convex cells.
 */
export interface CompiledPrismCellGeometry {
  readonly id: string;
  readonly heightMeters: number;
  readonly isConvex: true;
  readonly sideCount: number;
  readonly baseVertices: readonly { readonly x: number; readonly y: number }[];
  /**
   * One entry per base edge; `sides[i]` runs from `baseVertices[i]` to `baseVertices[(i + 1) % n]`.
   */
  readonly sides: readonly CompiledPrismSide[];
  readonly portalJunctions: readonly PortalJunction[];
  /**
   * The collision cylinders of the forbidden zones, one per portal junction (same data as `forbiddenZones[i].collision`).
   */
  readonly singularityColumns: readonly SingularityCollisionCylinder[];
  readonly forbiddenZones: readonly ForbiddenZone[];
  readonly floorColor: string;
  readonly floorMaterial: FloorMaterialSpec;
  readonly objects: readonly CellObjectSpec[];
}

/**
 * A compiled cell with portals attached and indexed by portal id and by side index.
 */
export interface CompiledPrismCell extends CompiledPrismCellGeometry {
  readonly portals: readonly CompiledPortal[];
  readonly portalsById: ReadonlyMap<string, CompiledPortal>;
  /**
   * Portal lookup by side index; if several portals were authored on one side only the last survives here.
   */
  readonly portalBySideIndex: ReadonlyMap<number, CompiledPortal>;
}

/**
 * One vertical face of a prism cell, described by its base edge in cell-local x/y meters.
 * `inwardNormal` is the unit horizontal normal pointing into the cell; the signed distance of a point to the side plane, positive inside, is dot(point - start, inwardNormal).
 */
export interface CompiledPrismSide {
  readonly sideIndex: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly inwardNormal: { readonly x: number; readonly y: number };
  readonly lengthMeters: number;
  /**
   * The portal glued to this side, present only on cells produced by {@link linkCompiledPrismCellPortals}.
   */
  readonly portal?: CompiledPortal;
}

/**
 * Compiles side geometry, junction cylinders and resolved floor visuals for one authored cell.
 * Assumes a valid convex counterclockwise base (no zero-length sides); with a degenerate side the normal would be NaN.
 */
export function compilePrismCellGeometry(spec: PrismCellSpec): CompiledPrismCellGeometry {
  const sides = spec.baseVertices.map((start, sideIndex): CompiledPrismSide => {
    const end = spec.baseVertices[(sideIndex + 1) % spec.baseVertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthMeters = Math.hypot(dx, dy);

    return {
      sideIndex,
      start,
      end,
      inwardNormal: {
        x: -dy / lengthMeters,
        y: dx / lengthMeters,
      },
      lengthMeters,
    };
  });
  const portalJunctions = compilePortalJunctions(spec);
  const singularityColumns = portalJunctions.map((junction) => ({
      kind: "invisible-cylinder" as const,
      junctionId: junction.id,
      center: {
        x: junction.position.x,
        y: junction.position.y,
        z: spec.heightMeters / 2,
      },
      radius: forbiddenPortalJunctionRadiusMeters,
      height: forbiddenPortalJunctionHeightMeters,
  }));
  const forbiddenZones = singularityColumns.map((column) => ({
    junctionId: column.junctionId,
    collision: column,
  }));

  return {
    id: spec.id,
    heightMeters: spec.heightMeters,
    isConvex: true,
    sideCount: spec.baseVertices.length,
    baseVertices: spec.baseVertices,
    sides,
    portalJunctions,
    singularityColumns,
    forbiddenZones,
    floorColor: spec.visuals?.floorColor ?? "#3f6f7a",
    floorMaterial: spec.visuals?.floorMaterial ?? {
      kind: "floor-color",
      floorColor: spec.visuals?.floorColor ?? "#3f6f7a",
    },
    objects: spec.visuals?.objects ?? [],
  };
}

/**
 * Attaches compiled portals to a cell's geometry, building the id and side-index indexes and setting `side.portal` on each portal side.
 */
export function linkCompiledPrismCellPortals(
  geometry: CompiledPrismCellGeometry,
  portals: readonly CompiledPortal[],
): CompiledPrismCell {
  const portalsById = new Map(portals.map((portal) => [portal.id, portal]));
  const portalBySideIndex = new Map(portals.map((portal) => [portal.sideIndex, portal]));

  return {
    ...geometry,
    portals,
    portalsById,
    portalBySideIndex,
    sides: geometry.sides.map((side) => ({
      ...side,
      portal: portalBySideIndex.get(side.sideIndex),
    })),
  };
}

/**
 * Collects, for every base vertex that ends a portal side, the portals touching it. Side i touches vertices i and i + 1.
 */
function compilePortalJunctions(spec: PrismCellSpec): readonly PortalJunction[] {
  const portalIdsByVertexIndex = new Map<number, string[]>();

  for (const portal of spec.portals) {
    addPortalJunctionSide(portalIdsByVertexIndex, portal.sideIndex, portal.id);
    addPortalJunctionSide(portalIdsByVertexIndex, (portal.sideIndex + 1) % spec.baseVertices.length, portal.id);
  }

  return [...portalIdsByVertexIndex.entries()]
    .filter(([, portalIds]) => portalIds.length > 0)
    .map(([vertexIndex, portalIds]) => {
      const vertex = spec.baseVertices[vertexIndex];

      return {
        id: `${spec.id}:vertex-${vertexIndex}`,
        position: vertex,
        adjacentPortalIds: [...new Set(portalIds)].sort(),
      };
    });
}

function addPortalJunctionSide(
  portalIdsByVertexIndex: Map<number, string[]>,
  vertexIndex: number,
  portalId: AuthoredPortalSpec["id"],
): void {
  const portalIds = portalIdsByVertexIndex.get(vertexIndex);

  if (portalIds) {
    portalIds.push(portalId);
    return;
  }

  portalIdsByVertexIndex.set(vertexIndex, [portalId]);
}
