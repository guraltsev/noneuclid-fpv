/**
 * `tests/world-assets/landmarkJoints.test.ts` — unit tier.
 *
 * The near-miss checker joins touching, crossing and nested parts and reports pieces (or a piece and the ground) that are not joined but
 * close; it leaves clear gaps alone. Then the rule itself: across many seeds, no generator of any theme and no generated decoration has a
 * gap that looks like a joint that barely failed to meet. Large floating boulders mostly hang perfectly still.
 */
import { describe, expect, it } from "vitest";
import { buildDecorationParts, generatedDecorationKinds } from "../../src/world-assets/decorationModels";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { faceThemes } from "../../src/world-assets/faceThemes";
import { findNearMisses } from "../../src/world-assets/landmarkJoints";
import type { LandmarkPart } from "../../src/world-assets/landmarkParts";
import { createSeededRandom } from "../../src/world-assets/seededNoise";

const box = (at: readonly [number, number, number], size = 1): LandmarkPart => ({ shape: "box", at, sx: size, sy: size, sz: size, color: "#808080" });

describe("near-miss checker", () => {
  it("joins touching, crossing and nested parts", () => {
    expect(findNearMisses([box([0, 0, 0]), box([0, 0, 1])])).toEqual([]);
    expect(findNearMisses([box([0, 0, 0]), box([0.5, 0.5, 0.5])])).toEqual([]);
    expect(findNearMisses([box([0, 0, 0], 2), box([0, 0, 0.5], 0.5)])).toEqual([]);
  });

  it("reports a part that barely misses another or the ground", () => {
    const misses = findNearMisses([box([0, 0, 0]), box([0, 0, 1.05])]);
    expect(misses).toHaveLength(1);
    expect(misses[0].gapMeters).toBeCloseTo(0.05, 6);
    expect(findNearMisses([box([0, 0, 0.08])])).toHaveLength(1);
  });

  it("leaves clear gaps alone: a boulder floating high, two things far apart", () => {
    expect(findNearMisses([box([0, 0, 2.5])])).toEqual([]);
    expect(findNearMisses([box([0, 0, 0]), box([0, 0, 2])])).toEqual([]);
  });
});

describe("generated models", () => {
  const palette = buildFacePalette(30, "analogous");
  const seeds = Array.from({ length: 12 }, (_, index) => index + 1);

  it.each(faceThemes.map((theme) => theme.id))("%s: every gap looks intentional", (id) => {
    const theme = faceThemes.find((entry) => entry.id === id)!;
    for (const role of ["major", "minor", "prop"] as const) {
      for (const generator of theme[role]) {
        for (const seed of seeds) {
          const misses = findNearMisses(generator.build({ random: createSeededRandom(seed), palette }));
          expect(misses.map((miss) => `${miss.gapMeters.toFixed(3)} m`), `${generator.name} seed ${seed}`).toEqual([]);
        }
      }
    }
  });

  it("decorations: every gap looks intentional", () => {
    for (const kind of generatedDecorationKinds) {
      for (const seed of seeds) {
        expect(findNearMisses(buildDecorationParts(kind, seed, palette)).length, `${kind} seed ${seed}`).toBe(0);
      }
    }
  });

  it("keeps the monolith and most large floating boulders perfectly still", () => {
    const drift = faceThemes.find((theme) => theme.id === "drift")!;
    for (const seed of seeds) {
      const monolith = drift.major.find((entry) => entry.name === "monolith")!.build({ random: createSeededRandom(seed), palette });
      expect(monolith.filter((part) => part.shape === "ball" && part.collide !== false).every((part) => part.motion === undefined)).toBe(true);
    }
    const large = seeds.flatMap((seed) =>
      drift.major
        .find((entry) => entry.name === "floating boulders")!
        .build({ random: createSeededRandom(seed), palette })
        .filter((part) => part.shape === "ball" && part.collide !== false && part.rx >= 1.2),
    );
    expect(large.filter((part) => part.motion === undefined).length).toBeGreaterThan(large.length / 2);
  });
});
