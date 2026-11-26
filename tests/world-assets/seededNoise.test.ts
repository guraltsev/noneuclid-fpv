/**
 * `tests/world-assets/seededNoise.test.ts` — unit tier.
 *
 * The seeded noise helpers are deterministic, stay in their documented ranges and vary smoothly.
 */
import { describe, expect, it } from "vitest";
import { createSeededRandom, fractalNoise2, hashStringToSeed, valueNoise2 } from "../../src/world-assets/seededNoise";

describe("seededNoise", () => {
  it("hashes the same text to the same seed and different text to different seeds", () => {
    expect(hashStringToSeed("front")).toBe(hashStringToSeed("front"));
    expect(hashStringToSeed("front")).not.toBe(hashStringToSeed("back"));
    expect(hashStringToSeed("")).toBe(0x811c9dc5);
  });

  it("repeats a random sequence for one seed and stays in [0, 1)", () => {
    const first = createSeededRandom(7);
    const second = createSeededRandom(7);

    for (let index = 0; index < 200; index += 1) {
      const value = first();
      expect(value).toBe(second());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps value and fractal noise in [0, 1], repeatable and continuous", () => {
    for (let index = 0; index < 300; index += 1) {
      const x = index * 0.37 - 20;
      const y = index * 0.53 - 30;
      for (const value of [valueNoise2(3, x, y), fractalNoise2(3, x, y, 3)]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(valueNoise2(3, x, y)).toBe(valueNoise2(3, x, y));
      expect(Math.abs(valueNoise2(3, x + 0.001, y) - valueNoise2(3, x, y))).toBeLessThan(0.01);
    }
  });
});
