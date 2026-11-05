/**
 * The carry module's public face (design 013 sections 7 and 12.1): the names of its commands, events and control slot, and their plain-data shapes.
 * What is carried is moved through the emitters' `api`, on the fast channel; the carry owns the relation and the hand, and writes no object.
 * Other modules and clients import this file and nothing else of the module's directory.
 */
import type { EngineCommandBase, EngineEventBase } from "../../engine/moduleTypes";

/** The kind of the attachment a carry holds on a participant. */
export const carryAttachmentKind = "carry";

/** The control slot a carrier sets each frame: where the hand is and how far the carried object may fall behind it. Opened by `carry/attach`, closed by the end of the carry. */
export const carryOffsetSlot = "carry/offset";

/** Value of the `carry/offset` slot, plain data. */
export type CarryOffset = {
  /** The hand, in the frame of the cell the carrier's body is in (meters). */
  readonly x: number;
  readonly y: number;
  /** The loose leash of the hand policy (`src/interaction/handCarry.ts`): how far the object may be from the hand while it still glides to it, in meters. */
  readonly leashMeters: number;
};

/** Picks an object up. On success, and only then, the emitter leaves the floor: its plain shot geodesics are deleted. Refused with `carry/alreadyCarried`, `carry/notCarriable`, `carry/outOfReach` or `geodesicEmitters/alreadyEdited`. */
export interface CarryAttachCommand extends EngineCommandBase {
  readonly kind: "carry/attach";
  readonly objectId: string;
  /** The geodesic the carrier works on, rebuilt first when the carried emitter has no connected geodesic (the emitter's own rule, `world-objects/geodesic/carryEnd.ts`). */
  readonly activeGeodesicId?: string;
}

/** Puts down what the issuing participant carries (a detach only, design 012 P4); the final rebuild of the emitter's geodesics runs. Does nothing when nothing is carried. */
export interface CarryDetachCommand extends EngineCommandBase {
  readonly kind: "carry/detach";
}

/** Module-only: the carry ends by the carry rules themselves (the hand's leash). Emits `carry/dropped` and then does what a detach does. */
export interface CarryDropCommand extends EngineCommandBase {
  readonly kind: "carry/drop";
  readonly participantId: string;
  readonly reason: CarryDropReason;
}

/** Every command of the module. */
export type CarryCommand = CarryAttachCommand | CarryDetachCommand | CarryDropCommand;

/** Why the world ended a carry: the hand's leash released the object (too far, or unreachable), or the object no longer exists. */
export type CarryDropReason = "leash" | "missing";

/** The carried object moved this frame; the geodesics it anchors were rebuilt, so what depends on them needs a refresh. */
export interface CarryMovedEvent extends EngineEventBase {
  readonly kind: "carry/moved";
  readonly participantId: string;
  readonly objectId: string;
  /** Set when the emitter's plain active geodesic was regrown: that geodesic is now the carrier's active one. */
  readonly regrownActiveGeodesicId?: string;
}

/** A carry ended, however it ended (detach or drop): the final rebuild ran. */
export interface CarryReleasedEvent extends EngineEventBase {
  readonly kind: "carry/released";
  readonly participantId: string;
  readonly objectId: string;
  readonly regrownActiveGeodesicId?: string;
}

/** The world ended the carry (design 013 section 7); the client leaves its carry tool. Followed by `carry/released` for the same object. */
export interface CarryDroppedEvent extends EngineEventBase {
  readonly kind: "carry/dropped";
  readonly participantId: string;
  readonly objectId: string;
  readonly reason: CarryDropReason;
}

/** Every event of the module. */
export type CarryEvent = CarryMovedEvent | CarryReleasedEvent | CarryDroppedEvent;

/** Refusal codes of `carry/attach`. */
export const carryRefusals = {
  alreadyCarried: "carry/alreadyCarried",
  notCarriable: "carry/notCarriable",
  outOfReach: "carry/outOfReach",
} as const;
