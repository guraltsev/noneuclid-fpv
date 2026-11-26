/**
 * `tests/world-assets/faceThemes.test.ts` — unit tier.
 *
 * The part kit counts exactly the triangles it emits for every shape and measures colliders (a strut at its foot only) and hovering parts.
 * Every generator of every theme builds, for many seeds, a deterministic part list in its role's size range and triangle budget, using only
 * its palette's colours. Theme ids are unique.
 */
import { describe, expect, it } from "vitest";
import { buildFacePalette, groundPaletteMultiplier, hslToHex } from "../../src/world-assets/facePalettes";
import { faceThemes, type LandmarkRole } from "../../src/world-assets/faceThemes";
import { measureParts, partTriangleCount, tessellatePart, type LandmarkPart } from "../../src/world-assets/landmarkParts";
import { createSeededRandom } from "../../src/world-assets/seededNoise";

const sampleParts: LandmarkPart[] = [
  { shape: "box", at: [0, 0, 0], sx: 1, sy: 2, sz: 3, color: "#ffffff" },
  { shape: "prism", at: [0, 0, 0], sides: 6, r0: 1, r1: 0.5, h: 2, color: "#ffffff" },
  { shape: "prism", at: [0, 0, 0], sides: 5, r0: 1, r1: 0, h: 2, color: "#ffffff" },
  { shape: "ball", at: [0, 0, 1], rx: 1, ry: 1, rz: 1, longitudes: 7, latitudes: 5, wobble: 0.2, wobbleSeed: 3, color: "#ffffff" },
  { shape: "ring", at: [0, 0, 2], radius: 1, tube: 0.1, arc: Math.PI, segments: 9, tubeSides: 3, color: "#ffffff", pose: { roll: 0.4 } },
  { shape: "star", at: [0, 0, 1], points: 5, outer: 1, inner: 0.4, thickness: 0.1, color: "#ffffff", pose: { yaw: 1, pitch: 0.2 } },
  { shape: "strut", at: [0, 0, 0], from: [0, 0, 0], to: [1, 1, 3], radius: 0.05, color: "#ffffff" },
];

describe("landmark parts", () => {
  it.each(sampleParts.map((part) => [part.shape, part] as const))("emits exactly the counted triangles for a %s", (_shape, part) => {
    expect(tessellatePart(part)).toHaveLength(partTriangleCount(part));
  });

  it("puts a strut's collider at its foot and finds a hovering part", () => {
    const measure = measureParts([
      { shape: "strut", at: [0, 0, 0], from: [2, 0, 0], to: [0, 0, 4], radius: 0.05, color: "#000000" },
      { shape: "ball", at: [0, 0, 4], rx: 0.6, ry: 0.6, rz: 0.6, color: "#000000" },
    ]);
    expect(measure.colliders).toHaveLength(1);
    expect(measure.colliders[0].u).toBeCloseTo(2, 6);
    expect(measure.colliders[0].radiusMeters).toBe(0.12);
    expect(measure.floating).toHaveLength(1);
    expect(measure.floating[0].topMeters).toBeCloseTo(4.6, 6);
    expect(measure.heightMeters).toBeCloseTo(4.6, 6);
  });

  it("lets a part opt out of blocking the player", () => {
    expect(measureParts([{ shape: "box", at: [0, 0, 0], sx: 1, sy: 1, sz: 1, color: "#000000", collide: false }]).colliders).toEqual([]);
  });
});

const heightRange: Record<LandmarkRole, readonly [number, number]> = { major: [4.5, 11], minor: [1.2, 5], prop: [0.15, 1.6] };
const triangleBudget: Record<LandmarkRole, number> = { major: 700, minor: 400, prop: 260 };

describe("face themes", () => {
  it("have unique ids and generators for every role", () => {
    expect(new Set(faceThemes.map((theme) => theme.id)).size).toBe(faceThemes.length);
    expect(faceThemes.length).toBeGreaterThanOrEqual(12);
    for (const theme of faceThemes) {
      expect(theme.major.length).toBeGreaterThan(0);
      expect(theme.minor.length).toBeGreaterThan(0);
      expect(theme.prop.length).toBeGreaterThan(0);
    }
  });

  it.each(faceThemes.map((theme) => theme.id))("%s: every generator stays in its size range and budget, in its palette, deterministically", (id) => {
    const theme = faceThemes.find((entry) => entry.id === id)!;
    const palette = buildFacePalette(140, "split");
    const allowed = new Set([palette.primary, palette.secondary, palette.accent, palette.dark, palette.light, palette.glow, "#050505"]);

    for (const role of ["major", "minor", "prop"] as const) {
      for (const generator of theme[role]) {
        for (let seed = 1; seed <= 12; seed += 1) {
          const parts = generator.build({ random: createSeededRandom(seed), palette });
          expect(generator.build({ random: createSeededRandom(seed), palette })).toEqual(parts);
          const measure = measureParts(parts);
          expect(measure.heightMeters, `${generator.name} seed ${seed}`).toBeGreaterThanOrEqual(heightRange[role][0]);
          expect(measure.heightMeters, `${generator.name} seed ${seed}`).toBeLessThanOrEqual(heightRange[role][1]);
          expect(measure.triangles, `${generator.name} seed ${seed}`).toBeLessThanOrEqual(triangleBudget[role]);
          for (const part of parts) {
            expect(allowed.has(part.color), `${generator.name}: ${part.color}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("face palettes", () => {
  it("converts HSL to hex", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
  });

  it("gives the ground a multiplier of at most unit luminance that leans to the key hue", () => {
    const [r, g, b] = groundPaletteMultiplier(buildFacePalette(0, "analogous"));
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThanOrEqual(1 + 1e-9);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.5);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    for (let hue = 0; hue < 360; hue += 30) {
      expect(Math.max(...groundPaletteMultiplier(buildFacePalette(hue, "triadic")))).toBeLessThanOrEqual(1.9 + 1e-9);
    }
  });
});
