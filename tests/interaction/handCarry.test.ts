/**
 * `tests/interaction/handCarry.test.ts` — unit tier.
 *
 * The player's hand as a carrier (`src/interaction/handCarry.ts`): it holds a carried object while the object is within the leash and lets go of
 * it when it is farther or cannot be reached. The leash has two phases. While the object still glides to the hand after the pickup it is loose,
 * longer than the farthest an object can be from the hand at pickup; once the object has been at the hand it is tight (1 m).
 */
import { describe, expect, it } from "vitest";
import { carryMaxSpeedMetersPerSecond } from "../../src/world-objects/carry";
import {
  decideHandCarry,
  handCarryArrivalMeters,
  handCarryArrived,
  handCarryLeashMeters,
  handCarryLeashSlackMeters,
  heldCarryLeashMeters,
} from "../../src/interaction/handCarry";

describe("the hand's loose leash", () => {
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

        expect(decideHandCarry(pickupRangeMeters + handReachMeters, "gliding", leash)).toBe("hold");
      }
    }
  });
});

describe("the hand's decision while the object glides to the hand", () => {
  const leash = handCarryLeashMeters({ pickupRangeMeters: 2.5, handReachMeters: 0 });

  it("holds an object within the loose leash, at any distance up to it", () => {
    expect(decideHandCarry(0, "gliding", leash)).toBe("hold");
    expect(decideHandCarry(leash - 0.01, "gliding", leash)).toBe("hold");
    expect(decideHandCarry(leash, "gliding", leash)).toBe("hold");
  });

  it("lets go of an object farther than the loose leash", () => {
    expect(decideHandCarry(leash + 0.01, "gliding", leash)).toBe("release");
    expect(decideHandCarry(100, "gliding", leash)).toBe("release");
  });

  it("lets go of an object no straight development reaches", () => {
    expect(decideHandCarry("unreachable", "gliding", leash)).toBe("release");
  });
});

describe("the hand's decision once the object has been at the hand", () => {
  const loose = handCarryLeashMeters({ pickupRangeMeters: 2.5, handReachMeters: 0.75 });

  it("holds an object within the tight leash", () => {
    expect(decideHandCarry(0, "held", loose)).toBe("hold");
    expect(decideHandCarry(heldCarryLeashMeters, "held", loose)).toBe("hold");
  });

  it("lets go of an object beyond the tight leash, though it is still within the loose one", () => {
    expect(heldCarryLeashMeters).toBeLessThan(loose);
    expect(decideHandCarry(heldCarryLeashMeters + 0.01, "held", loose)).toBe("release");
    expect(decideHandCarry(1.5, "held", loose)).toBe("release");
  });

  it("lets go of an object no straight development reaches", () => {
    expect(decideHandCarry("unreachable", "held", loose)).toBe("release");
  });

  it("never holds longer than the loose leash, even when that is shorter than the tight one", () => {
    expect(decideHandCarry(0.8, "held", 0.5)).toBe("release");
  });
});

describe("having arrived at the hand", () => {
  it("is being within the arrival distance of it", () => {
    expect(handCarryArrived(0)).toBe(true);
    expect(handCarryArrived(handCarryArrivalMeters)).toBe(true);
    expect(handCarryArrived(handCarryArrivalMeters + 0.01)).toBe(false);
  });

  it("is never true for an object no straight development reaches", () => {
    expect(handCarryArrived("unreachable")).toBe(false);
  });

  it("happens well inside the tight leash, so an arrived object is not released at once", () => {
    expect(handCarryArrivalMeters).toBeLessThan(heldCarryLeashMeters);
  });
});
