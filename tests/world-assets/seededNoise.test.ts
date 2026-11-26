/**
 * `tests/world-assets/seededNoise.test.ts` — unit tier.
 *
 * The seeded noise helpers are deterministic (same seed, same numbers), stay inside their documented ranges, and give
 * different results for different seeds or strings. They use no `Math.random`.
 */
import { describe, expect, it } from "vitest";
import { createSeededRandom, fractalNoise2, hashStringToSeed, valueNoise2 } from "../../src/world-assets/seededNoise";

describe("seeded noise", () => {
  it("hashes strings to stable unsigned 32-bit seeds", () => {
    expect(hashStringToSeed("")).toBe(0x811c9dc5);
    expect(hashStringToSeed("a")).toBe(0xe40c292c);
    expect(hashStringToSeed("cell-1")).toBe(hashStringToSeed("cell-1"));
    expect(hashStringToSeed("cell-1")).not.toBe(hashStringToSeed("cell-2"));
  });

  it("makes a repeatable random sequence in [0, 1)", () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);
    const values = Array.from({ length: 200 }, () => first());
    expect(values).toEqual(Array.from({ length: 200 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(190);
  });

  it("gives value and fractal noise in [0, 1] that repeats and depends on the seed", () => {
    let differs = false;
    for (let index = 0; index < 400; index += 1) {
      const x = Math.sin(index) * 30;
      const y = Math.cos(index * 1.7) * 30;
      const value = valueNoise2(7, x, y);
      const fractal = fractalNoise2(7, x, y, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(fractal).toBeGreaterThanOrEqual(0);
      expect(fractal).toBeLessThanOrEqual(1);
      expect(valueNoise2(7, x, y)).toBe(value);
      differs ||= valueNoise2(8, x, y) !== value;
    }
    expect(differs).toBe(true);
  });

  it("is continuous across lattice cells", () => {
    expect(Math.abs(valueNoise2(3, 2.0001, 5.5) - valueNoise2(3, 1.9999, 5.5))).toBeLessThan(0.01);
  });
});
