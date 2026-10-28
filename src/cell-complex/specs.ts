/**
 * Authoring-level data model for a cell complex: the plain-data spec that world files produce and the compiler consumes.
 * A world is a list of prism cells (each a convex counterclockwise polygon in the cell's local x/y plane extruded from z = 0 up to heightMeters), plus portals that glue one vertical side of a cell to a vertical side of another (or the same) cell, plus decoration and object descriptions. All positions are in meters in the owning cell's local frame (x right/east, y forward, z up); angles are radians with yaw measured counterclockwise about +z. Side i of a cell runs from base vertex i to base vertex i + 1 (wrapping). Only CompiledPortal carries derived data; every other type here is hand-authored input.
 */
import type { RigidTransform3 } from "../math/rigidTransform3";

/**
 * Complete authored world: its cells and an optional starting pose.
 */
export interface CellComplexSpec {
  readonly cells: readonly PrismCellSpec[];
  readonly startingPosition?: StartingPositionSpec;
}

/**
 * Where the player starts: a cell, a cell-local position in meters, and optional yaw and pitch in radians.
 */
export interface StartingPositionSpec {
  readonly cellId: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yawRadians?: number;
  readonly pitchRadians?: number;
}

/**
 * One authored prism cell: convex counterclockwise base polygon, height, portals on its sides and optional visuals.
 * Base vertices are cell-local x/y meters; the cell occupies z in [0, heightMeters].
 */
export interface PrismCellSpec {
  readonly id: string;
  readonly heightMeters: number;
  /**
   * Base polygon corners, counterclockwise viewed from +z; the compiler requires 3 to 8 strictly convex vertices.
   */
  readonly baseVertices: readonly { readonly x: number; readonly y: number }[];
  readonly portals: readonly AuthoredPortalSpec[];
  readonly visuals?: PrismCellVisualSpec;
}

/**
 * A hand-authored portal: a side of this cell glued to a side of another cell's portal.
 * Portals must be reciprocal: the target portal must name this portal back (checked by validateCellComplexSpec).
 */
export interface AuthoredPortalSpec {
  /**
   * Portal id, unique within its cell (not globally).
   */
  readonly id: string;
  /**
   * Index of the cell side carrying the portal; side i runs from base vertex i to vertex i + 1.
   */
  readonly sideIndex: number;
  /**
   * Id of the cell on the other side of the portal.
   */
  readonly targetCellId: string;
  /**
   * Id of the reciprocal portal inside the target cell.
   */
  readonly targetPortalId: string;
}

/**
 * An authored portal plus its derived gluing data.
 * `transformToTarget` is the rigid map from this cell's local frame to the target cell's local frame.
 */
export interface CompiledPortal extends AuthoredPortalSpec {
  /**
   * Orientation-preserving rigid transform taking points in the source cell's frame to the target cell's frame, so that the source side is mapped onto the target side (midpoints coincide, outward direction becomes inward direction).
   */
  readonly transformToTarget: RigidTransform3;
  /**
   * Id of the portal in the target cell that glues back to this one; equals targetPortalId.
   */
  readonly reciprocalPortalId: string;
}

/**
 * Optional presentation data for a cell: floor color or material and the objects placed inside it.
 */
export interface PrismCellVisualSpec {
  readonly floorColor?: string;
  readonly floorMaterial?: FloorMaterialSpec;
  readonly objects?: readonly CellObjectSpec[];
}

/**
 * Floor appearance: either a flat color or a tiled texture.
 */
export type FloorMaterialSpec = FloorColorMaterialSpec | FloorTextureMaterialSpec;

/**
 * Flat-color floor material.
 */
export interface FloorColorMaterialSpec {
  readonly kind: "floor-color";
  readonly floorColor: string;
}

/**
 * Tiled-texture floor material; `floorColor` is the fallback/tint color.
 */
export interface FloorTextureMaterialSpec {
  readonly kind: "floor-texture";
  readonly name: string;
  readonly floorColor: string;
  /**
   * Edge length in meters of one texture tile on the floor.
   */
  readonly tileSizeMeters: number;
  readonly colorTexturePath?: string;
  readonly normalTexturePath?: string;
  readonly bumpTexturePath?: string;
  readonly roughnessTexturePath?: string;
}

/**
 * Fields shared by every authored object placed in a cell: pose, scale, model adjustments, help text and collision exemptions.
 * Position is cell-local meters; angles are radians.
 */
export interface PositionedCellObjectSpec {
  readonly id: string;
  /**
   * Object anchor in the owning cell's local frame, meters.
   */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Uniform model scale factor.
   */
  readonly scale?: number;
  /**
   * Per-axis model scale (x, y, z); when present the renderer uses it instead of `scale`.
   */
  readonly scaleXYZ?: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Offset of the visual model relative to the anchor, meters (visual only; does not move the collision cylinder).
   */
  readonly modelOffset?: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Visual-only tilt of the model about its lateral axis, radians.
   */
  readonly forwardTiltRadians?: number;
  /**
   * Visual-only tilt of the model about its forward axis, radians.
   */
  readonly sideTiltRadians?: number;
  /**
   * Heading about +z in radians; takes precedence over `yawRadians` when both are set.
   */
  readonly turnRadians?: number;
  /**
   * Heading about +z in radians (counterclockwise from above); used when `turnRadians` is absent.
   */
  readonly yawRadians?: number;
  /**
   * Free-form category tag (e.g. "creature") used to group objects.
   */
  readonly class?: string;
  /**
   * Class names (see `class`) of objects this object should not collide with.
   */
  readonly do_not_collide_with?: readonly string[];
  /**
   * Help text shown when the object is focused.
   */
  readonly displayHelpMessage?: string;
  /**
   * If set, the help message is shown automatically when the player is within this distance in meters.
   */
  readonly autoDisplayHelpRangeMeters?: number;
  readonly tutorialPages?: readonly TutorialPageSpec[];
  readonly goalPages?: readonly TutorialPageSpec[];
}

/**
 * Static decoration loaded from an asset file, with an optional collision cylinder.
 */
export interface AssetObjectSpec extends PositionedCellObjectSpec {
  readonly kind: "asset";
  readonly assetPath: string;
  readonly collision?: SimpleCollisionCylinderSpec;
}

/**
 * One page of tutorial or goal text; the desktop and XR bodies override `body` for that input mode.
 */
export interface TutorialPageSpec {
  readonly title: string;
  readonly body: string;
  readonly desktopBody?: string;
  readonly xrBody?: string;
}

/**
 * Vertical collision cylinder: radius and height in meters, with an optional offset from the object's anchor.
 */
export interface SimpleCollisionCylinderSpec {
  readonly radius: number;
  readonly height: number;
  readonly offset?: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Autonomous marmot that moves along locally straight paths with a given velocity.
 * `velocity` is the cell-local horizontal velocity in meters per second.
 */
export interface GeodesicMarmotObjectSpec extends PositionedCellObjectSpec {
  /** Historical spelling; this string is the stable id used by authored worlds, so it is not corrected. */
  readonly kind: "geodesci-marmot";
  readonly assetPath: string;
  readonly velocity: { readonly x: number; readonly y: number };
  readonly collision: SimpleCollisionCylinderSpec;
  readonly animationClipName?: string;
}

/**
 * Autonomous creature (mouse or butterfly) moving at constant speed with an oscillation added.
 */
export interface SimpleGeoCreatureObjectSpec extends PositionedCellObjectSpec {
  readonly kind: "geo-mouse" | "geo-butterfly";
  readonly assetPath: string;
  readonly speedMetersPerSecond: number;
  readonly oscillationRateHz: number;
  /**
   * Amplitude of the sideways or vertical oscillation, meters.
   */
  readonly oscillationMagnitudeMeters: number;
  readonly collision: SimpleCollisionCylinderSpec;
}

/**
 * Union of all object kinds that may appear in a cell's `visuals.objects`, discriminated by `kind`.
 */
export type CellObjectSpec = AssetObjectSpec | GeodesicMarmotObjectSpec | SimpleGeoCreatureObjectSpec;
