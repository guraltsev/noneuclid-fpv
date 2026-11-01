/**
 * The player's hand as a carrier: when does it let go of what it carries?
 *
 * Carrying is a relation between a carrier and an object (`src/world-objects/carry.ts`). The object decides how it reacts to each step it is sent;
 * whether the relation goes on is the carrier's policy, and this is the player's hand's. The hand holds on while the carried object is within the
 * leash of it and lets go when it is farther, or when no straight development reaches it at all. A wall or an exclusion zone never ends a carry:
 * the object stops short and stays in the hand, and it is the distance that releases it if the hand keeps going.
 *
 * The input is the distance the carrier's stream reports (`CarryRemaining`: meters along the valid straight development, or "unreachable"), so a
 * carrier with another policy takes the same input. A force field would replace the boolean decision here by a pull toward the carrier that grows
 * with the distance and decide the release from it; nothing outside this module would change.
 *
 * The leash has two phases. Right after a pickup the object glides to the hand and may be as far from it as the pickup range allows, so the leash
 * is loose (longer than the farthest an object can be from the hand at pickup, so a fresh pickup never lets go). Once the object has been at the hand
 * the leash is tight (`heldCarryLeashMeters`): an object held in the hand that falls this far behind it, because it is stuck at a wall or a zone and
 * the hand keeps going, is let go. An object that never reaches the hand is let go at the loose leash.
 */
import { carryMaxSpeedMetersPerSecond, type CarryRemaining } from "../world-objects/carry";

/** What the hand does after a frame of carrying: keep holding, or let go (the carry ends where the object is). */
export type HandCarryDecision = "hold" | "release";

/** Where a carry is: still gliding to the hand after the pickup (loose leash), or held, having been at the hand (tight leash). */
export type HandCarryPhase = "gliding" | "held";

/** Leash in meters once the object has been at the hand (1.0; tunable): beyond this distance the hand lets go. */
export const heldCarryLeashMeters = 1;
/** Distance in meters (0.1; tunable) within which the object counts as having reached the hand. */
export const handCarryArrivalMeters = 0.1;

/** The slowest frame the leash allows for, in seconds: the object may lag the hand by what it travels at the speed cap in one such frame. */
export const handCarrySlowestFrameSeconds = 1 / 30;
/** Lag the leash allows on top of the pickup distance, in meters (about 0.67): the speed cap times the slowest frame. */
export const handCarryLeashSlackMeters = carryMaxSpeedMetersPerSecond * handCarrySlowestFrameSeconds;

/**
 * The leash of the hand, in meters: how far the carried object may be from the hand before it is let go.
 * An object is picked up from at most `pickupRangeMeters` away from the aim origin and the hand holds it `handReachMeters` ahead of that origin
 * (0.75 m on desktop, 0 in a headset), so at pickup it is at most their sum from the hand; the leash adds `handCarryLeashSlackMeters` of lag.
 */
export function handCarryLeashMeters(input: { readonly pickupRangeMeters: number; readonly handReachMeters: number }): number {
  return input.pickupRangeMeters + input.handReachMeters + handCarryLeashSlackMeters;
}

/** True when the object is at the hand: within `handCarryArrivalMeters` of it. An unreachable object is not. */
export function handCarryArrived(remaining: CarryRemaining): boolean {
  return remaining !== "unreachable" && remaining <= handCarryArrivalMeters;
}

/**
 * Holds while the object is within the leash of the phase (`glidingLeashMeters` while gliding, `heldCarryLeashMeters` once held, never longer than the
 * loose one); releases when it is farther or cannot be reached.
 */
export function decideHandCarry(remaining: CarryRemaining, phase: HandCarryPhase, glidingLeashMeters: number): HandCarryDecision {
  const leashMeters = phase === "held" ? Math.min(heldCarryLeashMeters, glidingLeashMeters) : glidingLeashMeters;
  return remaining !== "unreachable" && remaining <= leashMeters ? "hold" : "release";
}
