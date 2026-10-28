/**
 * Static asset authoring helper: converts author-facing parameters for a glTF decoration into an AssetObjectSpec.
 * Authoring triples use [x, height, y] ordering (meters) and are reordered into cell-local (x, y, z) with z up; tilt and turn arrive in degrees and are stored in radians. Library wrappers (library.ts) supply asset-specific defaults before calling this.
 */
import type { AssetObjectSpec, SimpleCollisionCylinderSpec, TutorialPageSpec } from "../cell-complex/specs";

/**
 * Author-facing parameters shared by all static library objects.
 * Tilt and turn are in degrees (turn rotates about the vertical axis; the same value fills both `turnRadians` and `yawRadians`).
 */
export interface StaticObjectAuthoringParams {
  /**
   * Position in authored [x, z, y] axes. The middle coordinate is height above the floor.
   */
  readonly position: readonly [x: number, y: number, z: number];
  /** Multiplies the library object's base size and collision area. */
  readonly scale?: number;
  /** Advanced override for non-uniform visual scale in authored [x, y, z] axes. */
  readonly scaleXYZ?: readonly [x: number, y: number, z: number];
  /** Advanced override for visual model offset in authored [x, y, z] axes. */
  readonly modelOffset?: readonly [x: number, y: number, z: number];
  /** Advanced override for the library's default collision cylinder. */
  readonly collision?: SimpleCollisionCylinderSpec;
  /** Override the object's collision class, for example "tree" or "sign". */
  readonly class?: string;
  /** Objects in these classes ignore this object's collision, for example ["user"]. */
  readonly do_not_collide_with?: readonly string[];
  /** Camel-case alias accepted for TypeScript callers. Serialized specs use do_not_collide_with. */
  readonly doNotCollideWith?: readonly string[];
  /** Concise object help shown by the help lens when the object is focused. */
  readonly displayHelpMessage?: string;
  /** If set, shows the help lens automatically while the player is within this range. */
  readonly autoDisplayHelpRangeMeters?: number;
  /** Optional pages shown by object-specific tutorial menus. */
  readonly tutorialPages?: readonly TutorialPageSpec[];
  /** Optional pages shown by scenario-specific goal menus. */
  readonly goalPages?: readonly TutorialPageSpec[];
  /** Tilt about the object's lateral axis, in degrees. */
  readonly forwardTilt?: number;
  /** Tilt about the object's forward axis, in degrees. */
  readonly sideTilt?: number;
  /** Yaw about the vertical axis, in degrees. */
  readonly turn?: number;
}

/**
 * Builds an AssetObjectSpec from authoring parameters.
 * Reorders `position` and `modelOffset` from [x, height, y] to {x, y, z=height}; `scaleXYZ` is passed through component-wise unreordered. Does no validation or defaulting of scale or collision.
 */
export function createStaticAssetObject(
  id: string,
  assetPath: string,
  params: StaticObjectAuthoringParams,
): AssetObjectSpec {
  return {
    id,
    kind: "asset",
    assetPath,
    position: {
      x: params.position[0],
      y: params.position[2],
      z: params.position[1],
    },
    scale: params.scale,
    scaleXYZ: params.scaleXYZ
      ? {
          x: params.scaleXYZ[0],
          y: params.scaleXYZ[1],
          z: params.scaleXYZ[2],
        }
      : undefined,
    modelOffset: params.modelOffset
      ? {
          x: params.modelOffset[0],
          y: params.modelOffset[2],
          z: params.modelOffset[1],
        }
      : undefined,
    forwardTiltRadians: degreesToRadians(params.forwardTilt ?? 0),
    sideTiltRadians: degreesToRadians(params.sideTilt ?? 0),
    turnRadians: degreesToRadians(params.turn ?? 0),
    yawRadians: degreesToRadians(params.turn ?? 0),
    collision: params.collision,
    class: params.class,
    do_not_collide_with: params.do_not_collide_with ?? params.doNotCollideWith,
    displayHelpMessage: params.displayHelpMessage,
    autoDisplayHelpRangeMeters: params.autoDisplayHelpRangeMeters,
    tutorialPages: params.tutorialPages,
    goalPages: params.goalPages,
  };
}

/**
 * Converts degrees to radians.
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
