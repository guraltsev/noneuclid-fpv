/**
 * `tests/interaction/handCarry.test.ts` — unit tier.
 *
 * The player's hand as a carrier (`src/interaction/handCarry.ts`): it holds a carried object while the object is within the leash and lets go of
 * it when it is farther or cannot be reached. The leash is longer than the farthest an object can be from the hand the moment it is picked up.
 */
import { describe, expect, it } from "vitest";
import { carryMaxSpeedMetersPerSecond } from "../../src/world-objects/carry";
import { decideHandCarry, handCarryLeashMeters, handCarryLeashSlackMeters } from "../../src/interaction/handCarry";

describe("the hand's leash", () => {
  it("is the pickup range plus the hand's reach plus the slack for lag", () => {
    expect(handCarryLeashMeters({ pickupRangeMeters: 2.5, handReachMeters: 0.75 })).toBeCloseTo(2.5 + 0.75 + handCarryLeashSlackMeters, 9);
  });

  it("allows more lag than the speed cap lets an object fall behind in a 60 fps frame", () => {
    expect(handCarryLeashSlackMeters).toBeGreaterThan(carryMaxSpeedMetersPerSecond / 60);
  });

  it("is longer than the farthest an object can be from the hand at pickup", () => {
    for (const pickupRangeMeters of [0.5, 2.5, 6]) {
      for (const handReachMeters of [0, 0.75]) {
        const leash = handCarryLeashMeters({ pickupRangeMeters, handReachMeters });

        expect(decideHandCarry(pickupRangeMeters + handReachMeters, leash)).toBe("hold");
      }
    }
  });
});

describe("the hand's decision", () => {
  const leash = handCarryLeashMeters({ pickupRangeMeters: 2.5, handReachMeters: 0 });

  it("holds an object within the leash, at any distance up to it", () => {
    expect(decideHandCarry(0, leash)).toBe("hold");
    expect(decideHandCarry(leash - 0.01, leash)).toBe("hold");
    expect(decideHandCarry(leash, leash)).toBe("hold");
  });

  it("lets go of an object farther than the leash", () => {
    expect(decideHandCarry(leash + 0.01, leash)).toBe("release");
    expect(decideHandCarry(100, leash)).toBe("release");
  });

  it("lets go of an object no straight development reaches", () => {
    expect(decideHandCarry("unreachable", leash)).toBe("release");
  });
});
