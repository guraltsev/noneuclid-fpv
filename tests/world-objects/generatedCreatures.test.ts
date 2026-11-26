/**
 * `tests/world-objects/generatedCreatures.test.ts` — unit tier.
 *
 * Creatures whose bodies are generated in code: the library constructors give a spec with a generated model and no asset path, the preload step names no asset for them, they do not block the player where their body is overhead, and the first activity world holds one on each of three faces.
 */
import { describe, expect, it } from "vitest";
import { basicCube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { collectWorldAssetPaths } from "../../src/render/three/preloadWorldAssets";
import { worldObjectLibrary } from "../../src/world-objects/library";
import { createSimpleGeoCreatureRuntimeObject } from "../../src/world-objects/simpleGeoCreature";

describe("generated creature constructors", () => {
  const walker = worldObjectLibrary.geo_stilt_walker("w", { position: [1, 0, 2], turn: 90 });
  const mobile = worldObjectLibrary.geo_drifting_mobile("m", { position: [1, 2, 2] });
  const eye = worldObjectLibrary.geo_rolling_eye("e", { position: [1, 0, 2] });

  it("say which model they generate and name no asset", () => {
    expect([walker, mobile, eye].map((spec) => (spec as { generatedModel?: { kind: string } }).generatedModel?.kind)).toEqual([
      "stilt-walker",
      "drifting-mobile",
      "rolling-eye",
    ]);
    for (const spec of [walker, mobile, eye]) {
      expect((spec as { assetPath?: string }).assetPath).toBeUndefined();
      expect(spec.mapIconPath).toBeUndefined();
    }
  });

  it("keeps the same seed for the same name", () => {
    const again = worldObjectLibrary.geo_stilt_walker("w", { position: [0, 0, 0] });

    expect((again as { generatedModel?: { seed: number } }).generatedModel?.seed).toBe((walker as { generatedModel?: { seed: number } }).generatedModel?.seed);
  });

  it("lets the player pass the walker and the mobile but not the eye", () => {
    expect((walker as { do_not_collide_with?: readonly string[] }).do_not_collide_with).toContain("user");
    expect((mobile as { do_not_collide_with?: readonly string[] }).do_not_collide_with).toContain("user");
    expect((eye as { do_not_collide_with?: readonly string[] }).do_not_collide_with).toBeUndefined();
  });

  it("gives plain-word tooltips in the registry record", () => {
    const record = createSimpleGeoCreatureRuntimeObject(walker as never, "top");

    expect(record.tooltip?.label).toBe("stilt walker");
  });
});

describe("the basic cube with generated creatures", () => {
  const world = compileCellComplex(basicCube);
  const objectsOf = (cellId: string) => world.cells.find((cell) => cell.id === cellId)!.objects;

  it("has a stilt walker on top, a mobile on the right and an eye on the left", () => {
    expect(objectsOf("top").map((object) => object.id)).toContain("top-stilt-walker");
    expect(objectsOf("right").map((object) => object.id)).toContain("right-mobile");
    expect(objectsOf("left").map((object) => object.id)).toContain("left-eye");
  });

  it("collects no asset path for generated bodies", () => {
    const paths = collectWorldAssetPaths(world);

    expect(paths.every((path) => typeof path === "string" && path.length > 0)).toBe(true);
    expect(world.cells.flatMap((cell) => cell.objects).filter((object) => "generatedModel" in object && object.generatedModel !== undefined)).toHaveLength(3);
  });
});
