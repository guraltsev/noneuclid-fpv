/**
 * The fields every object in the runtime object registry shares, and the projection of such an object onto the movement/collision state.
 * A leaf of the world-object modules: the concrete record types (static assets, flags, geodesic objects, measurements) extend `RuntimeWorldObjectBase`, and the registry unions them, so none of them may import the registry for these.
 */
import type { RigidTransform3 } from "../math/rigidTransform3";
import type { DynamicObjectState, SimpleCollisionCylinder } from "../movement/dynamicObject";
import type { TutorialPageSpec } from "../cell-complex/specs";

/**
 * Describes the primary interaction a player can trigger on an object when aiming at it.
 * Used by aim/interaction code to show a prompt and dispatch the action named by `action`.
 */
export interface RuntimeObjectInteraction {
  /** Prompt text shown to the player (for example "Rename sign"). */
  readonly label: string;
  readonly action: "edit-flag" | "select-geodesic-cannon" | "open-geometry-computer" | "open-tutorial" | "take-tool";
  /** For "take-tool": the id of the tool an item of a tool stand stands for. */
  readonly toolId?: string;
  /** Maximum aimer-to-object distance, in meters, within which the interaction is offered; callers fall back to a default (2.5 m in rootAimRay) when absent. */
  readonly rangeMeters?: number;
}

/**
 * Hover/aim tooltip metadata for a runtime object.
 * Shown when the object is aimed at within `rangeMeters`; the desktop and XR prompts are optional per-platform overrides of the interaction hint.
 */
export interface RuntimeObjectTooltip {
  /** Tooltip headline text. */
  readonly label: string;
  /** Maximum distance in meters at which the tooltip is shown. */
  readonly rangeMeters?: number;
  /** Optional interaction hint specific to desktop (keyboard/mouse) input. */
  readonly desktopPrompt?: string;
  /** Optional interaction hint specific to XR controllers. */
  readonly xrPrompt?: string;
}

/**
 * Fields shared by every object stored in the runtime registry.
 * The pose is expressed in the local frame of `cellId` (meters, radians; x right, y forward, z up), so moving an object across a portal means changing both `cellId` and `localPose` (see `moveToCell`). Concrete object types add a unique `kind` discriminant.
 */
export interface RuntimeWorldObjectBase {
  /** Registry-unique identifier. */
  readonly id: string;
  /** Id of the cell whose local frame `localPose` is expressed in. */
  readonly cellId: string;
  /** Pose of the object in its cell's local frame; translation in meters, rotation is normally a yaw about +z. */
  readonly localPose: RigidTransform3;
  /** Collision cylinder (radius/height in meters, offset relative to `localPose`); objects without it are not collidable. */
  readonly collision?: SimpleCollisionCylinder;
  /** Free-form collision class (for example "tree" or "user") matched against other objects' `do_not_collide_with`. */
  readonly class?: string;
  /** Collision classes that ignore this object; listing the user class makes the object non-blocking for the player. */
  readonly do_not_collide_with?: readonly string[];
  /** If set, aiming at this object snaps the reported target point to this cell-local point (meters) instead of the raw ray hit. */
  readonly aimStickyTarget?: {
    readonly localPoint: RigidTransform3["translation"];
  };
  /** Whether the object is also drawn when its cell is seen through a portal (portal-view rendering). */
  readonly portalRenderable: boolean;
  /** Tooltip shown when the object is aimed at. */
  readonly tooltip?: RuntimeObjectTooltip;
  /** Primary interaction offered on the object, if any. */
  readonly interactable?: RuntimeObjectInteraction;
  /** Concise help text shown by the help lens when the object is focused. */
  readonly displayHelpMessage?: string;
  /** If set, the help message is shown automatically while the player is within this many meters. */
  readonly autoDisplayHelpRangeMeters?: number;
  /** Pages for an object-specific tutorial menu. */
  readonly tutorialPages?: readonly TutorialPageSpec[];
  /** Pages for a scenario goal menu. */
  readonly goalPages?: readonly TutorialPageSpec[];
}

/**
 * Registry record for an autonomous creature (geodesic marmot, mouse or butterfly).
 * The `kind` literal "geodesci-marmot" is spelled that way throughout the codebase (including the spec type); it is a persistent identifier, not a typo local to this file.
 */
export interface RuntimeCreatureObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesci-marmot" | "geo-mouse" | "geo-butterfly";
  /** The creature's icon on the world map, from its spec. */
  readonly mapIconPath?: string;
}

/**
 * Projects a runtime object onto the minimal movement/collision state (cell id, cell-local pose, collision cylinder).
 * The result shares the pose and collision references with the object; it is a view, not a copy.
 */
export function runtimeObjectToDynamicObjectState(object: RuntimeWorldObjectBase): DynamicObjectState {
  return {
    cellId: object.cellId,
    localPose: object.localPose,
    collision: object.collision,
  };
}
