/**
 * Placed flags (signs): player-placed wooden signs carrying a short text label.
 * A flag is a RuntimeWorldObject with a collision cylinder and an "edit-flag" interaction, standing on the floor (z = 0) of a cell in that cell's local frame (meters; x right, y forward, z up). Placement validates against both the cell's walls/forbidden zones and other collidable runtime objects, so a flag is never created overlapping geometry.
 * Messages are sanitized (whitespace-collapsed, at most 20 characters) and font colors are restricted to a fixed palette.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { testCellCollision, getDynamicObjectCollisionBounds, simpleCylinderIntersectsSimpleCylinder } from "../movement/collision";
import type { DynamicObjectState, SimpleCollisionCylinder } from "../movement/dynamicObject";
import { yawRigidTransform3, type RigidTransform3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";
import type { RuntimeObjectInteraction, RuntimeWorldObjectBase, RuntimeObjectRegistry } from "./runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "./runtimeObjectRegistry";

/**
 * The available sign models, which also determine the default message prefix ("A" for WoodenSign1, "B" for WoodenSign2).
 */
export const placedFlagTypes = ["WoodenSign1", "WoodenSign2"] as const;
/**
 * Union of the sign model names in `placedFlagTypes`.
 */
export type PlacedFlagType = typeof placedFlagTypes[number];

/**
 * Maps each sign type to its glTF asset path under the assets directory.
 */
export const placedFlagAssetPaths: Record<PlacedFlagType, string> = {
  WoodenSign1: "WoodenSign1/WoodenSign1.glb",
  WoodenSign2: "WoodenSign2/WoodenSign2.glb",
};

/**
 * Default sign text color (CSS hex).
 */
export const defaultPlacedFlagFontColor = "#f8fafc";
/**
 * The allowed sign text colors (CSS hex); the first entry is the default.
 */
export const placedFlagFontColors = [defaultPlacedFlagFontColor, "#111827", "#ef4444", "#2563eb", "#16a34a"] as const;
/**
 * Maximum number of characters (code points) in a sign message.
 */
export const placedFlagMaxMessageLength = 20;

/**
 * Registry record for a placed sign: its type, sanitized message and font color.
 */
export interface PlacedFlagObject extends RuntimeWorldObjectBase {
  readonly kind: "placed-flag";
  readonly flagType: PlacedFlagType;
  readonly message: string;
  readonly fontColor: string;
}

/**
 * Inputs for createPlacedFlagObject.
 * `localPose` is the cell-local pose (meters, yaw about +z); `collision` overrides the default 0.475 m radius by 1.15 m cylinder.
 */
export interface CreatePlacedFlagOptions {
  readonly id: string;
  readonly cellId: string;
  readonly localPose: RigidTransform3;
  readonly flagType: PlacedFlagType;
  readonly message?: string;
  readonly fontColor?: string;
  readonly collision?: SimpleCollisionCylinder;
}

/**
 * Request to place a flag where the player's view ray hits the floor.
 * `eyePosition` and `forward` (unit view direction) are in the local frame of `cellId`, with the floor at z = 0.
 */
export interface PlaceFlagFromAimRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cellId: string;
  readonly eyePosition: Vec3;
  readonly forward: Vec3;
  readonly flagType: PlacedFlagType;
  readonly id: string;
}

/**
 * Request to place a flag at a known floor point.
 * `floorPoint` and `eyePosition` are in `cellId`'s local frame; the flag is turned to face `eyePosition`.
 */
export interface PlaceFlagAtFloorPointRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cellId: string;
  readonly eyePosition: Vec3;
  readonly floorPoint: Vec3;
  readonly flagType: PlacedFlagType;
  readonly id: string;
}

/**
 * Outcome of a placement attempt: on success `placed` is true and `object` is the new (already registered) flag.
 */
export interface PlaceFlagResult {
  readonly placed: boolean;
  readonly object?: PlacedFlagObject;
  /** Failure cause: ray misses the floor within range, unknown cell, blocked by cell walls/forbidden zones, or overlapping another runtime object. */
  readonly reason?: "no-floor-hit" | "missing-cell" | "cell-collision" | "runtime-object-collision";
}

const defaultFlagCollision: SimpleCollisionCylinder = {
  radius: 0.475,
  height: 1.15,
  offset: { x: 0, y: 0, z: 0.575 },
};

const defaultFlagInteraction: RuntimeObjectInteraction = {
  label: "Edit sign",
  action: "edit-flag",
  rangeMeters: 2.5,
};

/**
 * Type guard: true when the string names a known sign type.
 */
export function isPlacedFlagType(value: string): value is PlacedFlagType {
  return (placedFlagTypes as readonly string[]).includes(value);
}

/**
 * Normalizes a sign message: CRLF/CR become LF, runs of non-newline whitespace become a single space, and the result is truncated to `placedFlagMaxMessageLength` code points.
 */
export function sanitizePlacedFlagMessage(message: string): string {
  return [...message.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ")]
    .slice(0, placedFlagMaxMessageLength)
    .join("");
}

/**
 * Returns the color if it is in the allowed palette, otherwise the default color.
 */
export function sanitizePlacedFlagFontColor(color: string): string {
  return (placedFlagFontColors as readonly string[]).includes(color) ? color : defaultPlacedFlagFontColor;
}

/**
 * Chooses the next default sign text for a flag type: the type's prefix ("A" or "B") followed by one more than the largest existing number among `existingObjects` whose message is exactly prefix+digits.
 * Only the message text is inspected, so renamed signs do not reserve numbers.
 */
export function defaultPlacedFlagMessage(
  flagType: PlacedFlagType,
  existingObjects: readonly PlacedFlagObject[] = [],
): string {
  const prefix = flagType === "WoodenSign1" ? "A" : "B";
  let maxNumber = 0;

  for (const object of existingObjects) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(object.message);
    if (match) {
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  }

  return `${prefix}${maxNumber + 1}`;
}

/**
 * Creates a flag record with default collision, tooltip and edit interaction.
 * Message and color are sanitized; with no message the default for the type is used (numbered "1" since no existing flags are considered here).
 */
export function createPlacedFlagObject(options: CreatePlacedFlagOptions): PlacedFlagObject {
  return {
    id: options.id,
    kind: "placed-flag",
    cellId: options.cellId,
    localPose: options.localPose,
    collision: options.collision ?? defaultFlagCollision,
    portalRenderable: true,
    displayHelpMessage: "A placed note. Open its menu to edit the text, change its color, or delete it.",
    tooltip: {
      label: "Sign",
      rangeMeters: 2.5,
    },
    interactable: defaultFlagInteraction,
    flagType: options.flagType,
    message: sanitizePlacedFlagMessage(options.message ?? defaultPlacedFlagMessage(options.flagType)),
    fontColor: sanitizePlacedFlagFontColor(options.fontColor ?? defaultPlacedFlagFontColor),
  };
}

/**
 * Returns a copy of the flag with a sanitized message.
 */
export function updatePlacedFlagMessage(object: PlacedFlagObject, message: string): PlacedFlagObject {
  return {
    ...object,
    message: sanitizePlacedFlagMessage(message),
  };
}

/**
 * Returns a copy of the flag with a font color restricted to the allowed palette.
 */
export function updatePlacedFlagFontColor(object: PlacedFlagObject, fontColor: string): PlacedFlagObject {
  return {
    ...object,
    fontColor: sanitizePlacedFlagFontColor(fontColor),
  };
}

/**
 * Returns the flag's cell id, pose and collision as a DynamicObjectState for collision queries.
 */
export function placedFlagToDynamicObjectState(object: PlacedFlagObject): DynamicObjectState {
  return runtimeObjectToDynamicObjectState(object);
}

/**
 * Places a flag where the view ray meets the floor plane z = 0 of the given cell.
 * Fails with "no-floor-hit" if the ray is not pointing downward by more than 0.02 (forward.z >= -0.02) or the hit is farther than 8 m; otherwise delegates to placeFlagAtFloorPoint. The ray is intersected only within this cell, without following portals.
 */
export function placeFlagFromAim(request: PlaceFlagFromAimRequest): PlaceFlagResult {
  const cell = request.world.cellsById.get(request.cellId);
  if (!cell) {
    return { placed: false, reason: "missing-cell" };
  }

  if (request.forward.z >= -0.02) {
    return { placed: false, reason: "no-floor-hit" };
  }

  // Ray/plane intersection with the floor z = 0: eye.z + t * forward.z = 0.
  const distance = -request.eyePosition.z / request.forward.z;
  if (!Number.isFinite(distance) || distance <= 0 || distance > 8) {
    return { placed: false, reason: "no-floor-hit" };
  }

  const floorPoint = {
    x: request.eyePosition.x + request.forward.x * distance,
    y: request.eyePosition.y + request.forward.y * distance,
    z: 0,
  };
  return placeFlagAtFloorPoint({
    world: request.world,
    registry: request.registry,
    cellId: request.cellId,
    eyePosition: request.eyePosition,
    floorPoint,
    flagType: request.flagType,
    id: request.id,
  });
}

/**
 * Places a flag at a floor point, registering it on success.
 * The flag's yaw is atan2(-(eye.x - p.x), eye.y - p.y): its front (local +y, where the renderer puts the front text plane) points from the floor point towards the eye. Placement is rejected with "cell-collision" if the candidate cylinder hits the cell's walls or forbidden zones, or "runtime-object-collision" if it overlaps any collidable object already in the cell; the default message is numbered after existing flags.
 */
export function placeFlagAtFloorPoint(request: PlaceFlagAtFloorPointRequest): PlaceFlagResult {
  const cell = request.world.cellsById.get(request.cellId);
  if (!cell) {
    return { placed: false, reason: "missing-cell" };
  }

  const floorPoint = {
    x: request.floorPoint.x,
    y: request.floorPoint.y,
    z: 0,
  };
  // A yaw of psi turns the flag's front (local +y) towards (-sin psi, cos psi), hence the negated x component.
  const yawRadians = Math.atan2(floorPoint.x - request.eyePosition.x, request.eyePosition.y - floorPoint.y);
  const candidate = createPlacedFlagObject({
    id: request.id,
    cellId: request.cellId,
    localPose: yawRigidTransform3(yawRadians, floorPoint),
    flagType: request.flagType,
    message: defaultPlacedFlagMessage(
      request.flagType,
      request.registry.getAll().filter((object): object is PlacedFlagObject => object.kind === "placed-flag"),
    ),
  });
  const candidateState = placedFlagToDynamicObjectState(candidate);
  const collision = testCellCollision({ cell, object: candidateState });
  if (collision.blocked) {
    return { placed: false, reason: "cell-collision" };
  }

  const candidateBounds = getDynamicObjectCollisionBounds(candidateState);
  if (candidateBounds) {
    for (const object of request.registry.getCollidableObjectsInCell(request.cellId)) {
      const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
      if (bounds && simpleCylinderIntersectsSimpleCylinder(candidateBounds, bounds)) {
        return { placed: false, reason: "runtime-object-collision" };
      }
    }
  }

  request.registry.add(candidate);
  return { placed: true, object: candidate };
}
