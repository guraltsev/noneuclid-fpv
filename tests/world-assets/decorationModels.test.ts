/**
 * `tests/world-assets/decorationModels.test.ts` — unit tier.
 *
 * Every decoration generated in code is named by its `generated/<kind>` path, is built in its palette's colours only, differs with its
 * seed but not between two builds from one seed, stands on the ground, and fits the collision cylinder the library gives its kind at
 * scale 1 (its footprint and height roughly match what blocks the player). Nothing is preloaded for it.
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { cube } from "../../src/authoring/exampleWorlds";
import { collectWorldAssetPaths } from "../../src/render/three/preloadWorldAssets";
import {
  buildDecorationParts,
  decorationSeed,
  generatedDecorationKindOf,
  generatedDecorationKinds,
  generatedDecorationPath,
} from "../../src/world-assets/decorationModels";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { measureParts } from "../../src/world-assets/landmarkParts";
import { worldObjectLibrary } from "../../src/world-objects/library";

const palette = buildFacePalette(200, "analogous");
const colours = new Set([palette.primary, palette.secondary, palette.accent, palette.dark, palette.light, palette.glow]);

describe("generated decorations", () => {
  it("are named by their path and nothing else is", () => {
    for (const kind of generatedDecorationKinds) {
      expect(generatedDecorationKindOf(generatedDecorationPath(kind))).toBe(kind);
    }
    expect(generatedDecorationKindOf("Bench/Bench.glb")).toBeUndefined();
    expect(generatedDecorationKindOf("generated/teapot")).toBeUndefined();
  });

  it.each(generatedDecorationKinds)("%s: in its palette, seeded, on the ground, about the size of its collision", (kind) => {
    const object = worldObjectLibrary[kind](`${kind}-a`, { position: [0, 0, 0] });
    expect(object.assetPath).toBe(generatedDecorationPath(kind));
    const first = buildDecorationParts(kind, 1, palette);
    expect(buildDecorationParts(kind, 1, palette)).toEqual(first);
    expect(buildDecorationParts(kind, 2, palette)).not.toEqual(first);
    for (const part of first) {
      expect(colours.has(part.color), part.color).toBe(true);
    }

    const measure = measureParts(first);
    expect(measure.heightMeters).toBeGreaterThan(0.3);
    const collision = object.kind === "asset" ? object.collision : undefined;
    if (collision) {
      // A roof or a crown may rise above what blocks the player; a tree's crown is wider than its trunk, which is all that blocks.
      expect(measure.heightMeters, "height").toBeGreaterThan(collision.height * 0.6);
      expect(measure.heightMeters, "height").toBeLessThan(collision.height * 1.7);
      if (kind !== "tree" && kind !== "tree_swirl") {
        expect(measure.footprintRadiusMeters, "footprint").toBeLessThan(collision.radius * 1.6 + 0.6);
      }
    }
  });

  it("varies with the object and the look seed", () => {
    expect(decorationSeed("bench-a", 1)).not.toBe(decorationSeed("bench-a", 2));
    expect(decorationSeed("bench-a", 1)).not.toBe(decorationSeed("bench-b", 1));
    expect(decorationSeed("bench-a", 1)).toBe(decorationSeed("bench-a", 1));
  });

  it("preloads nothing for a generated decoration", () => {
    const paths = collectWorldAssetPaths(compileCellComplex(cube));
    expect(paths.some((path) => path.startsWith("generated/"))).toBe(false);
  });
});
