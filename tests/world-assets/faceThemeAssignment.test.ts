/**
 * `tests/world-assets/faceThemeAssignment.test.ts` — unit tier.
 *
 * Faces get looks that tell them apart: on the cube and the dodecahedron every face has its own theme, glued neighbours never share a theme
 * and their key hues are far apart; the draw is deterministic for a world and changes with the seed; untextured cells get no look.
 */
import { describe, expect, it } from "vitest";
import { cube, dodecahedron, icosahedron } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { assignFaceLooks, decorationThemeIdsFor } from "../../src/world-assets/faceThemeAssignment";
import { faceThemes } from "../../src/world-assets/faceThemes";
import { computeWorldDressing } from "../../src/world-assets/worldDressing";

const worlds = { cube: compileCellComplex(cube), dodecahedron: compileCellComplex(dodecahedron), icosahedron: compileCellComplex(icosahedron) };

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("assignFaceLooks", () => {
  it.each(Object.entries(worlds))("on the %s: neighbours differ in theme and in hue", (_name, world) => {
    const looks = assignFaceLooks(world);
    const themed = world.cells.filter((cell) => looks.has(cell.id));
    expect(themed.length).toBeGreaterThan(0);
    const hueStep = 360 / Math.min(themed.length, 12);

    for (const cell of themed) {
      const look = looks.get(cell.id)!;
      for (const portal of cell.portals) {
        const other = looks.get(portal.targetCellId);
        if (!other || portal.targetCellId === cell.id) {
          continue;
        }
        expect(other.theme.id).not.toBe(look.theme.id);
        expect(hueDistance(other.palette.hue, look.palette.hue)).toBeGreaterThanOrEqual(hueStep - 9);
      }
    }
  });

  it.each(["cube", "dodecahedron"] as const)("gives every face of the %s its own theme", (name) => {
    const looks = assignFaceLooks(worlds[name]);
    const themes = [...looks.values()].map((look) => look.theme.id);
    expect(new Set(themes).size).toBe(themes.length);
  });

  it("is deterministic for a world and changes with the seed", () => {
    const world = worlds.cube;
    const summary = (seed?: number) => [...assignFaceLooks(world, seed)].map(([id, look]) => `${id}:${look.theme.id}:${look.palette.primary}`);
    expect(summary()).toEqual(summary());
    expect(summary(1)).not.toEqual(summary(2));
  });

  it.each(Object.entries(worlds))("on the %s: a face with a decoration takes a theme the decoration fits, whatever the seed", (_name, world) => {
    for (const seed of [1, 2, 3, 99]) {
      const looks = assignFaceLooks(world, seed);
      for (const cell of world.cells) {
        for (const object of cell.objects) {
          const fits = object.kind === "asset" ? decorationThemeIdsFor(object.assetPath) : undefined;
          if (fits && looks.has(cell.id)) {
            expect(fits, `${cell.id} seed ${seed}`).toContain(looks.get(cell.id)!.theme.id);
          }
        }
      }
    }
  });

  it("maps decorations by their model folder to existing themes, and nothing else", () => {
    const ids = new Set(faceThemes.map((theme) => theme.id));
    for (const path of ["bicycle/Bicycle.glb", "Bench/Bench.glb", "Tree1/Tree.glb", "stopsign/stop_sign.glb", "trafficCone/Cone.glb", "flowerPot/flower_pot.glb"]) {
      expect(decorationThemeIdsFor(path)!.length, path).toBeGreaterThan(0);
      for (const id of decorationThemeIdsFor(path)!) {
        expect(ids.has(id), `${path}: ${id}`).toBe(true);
      }
    }
    for (const path of ["questionblock/questionBlock.glb", "small_house/small_house.glb", "grass1/Grass.glb", "toolstand/laser.glb"]) {
      expect(decorationThemeIdsFor(path), path).toBeUndefined();
    }
  });

  it("builds different dressings for different look seeds and reuses one per seed", () => {
    const world = worlds.dodecahedron;
    const summary = (seed: number) => [...computeWorldDressing(world, seed).lookByCellId.values()].map((look) => look.theme.id).join(",");
    expect(computeWorldDressing(world, 5)).toBe(computeWorldDressing(world, 5));
    expect(new Set([1, 2, 3, 4].map(summary)).size).toBeGreaterThan(1);
  });

  it("gives no look to a cell without a textured floor", () => {
    const world = worlds.cube;
    const [first, ...rest] = world.cells;
    const plain = { ...first, floorMaterial: { kind: "floor-color" as const, floorColor: "#888888" } } as unknown as typeof first;
    const looks = assignFaceLooks({ cells: [plain, ...rest], cellsById: new Map([plain, ...rest].map((cell) => [cell.id, cell])) });
    expect(looks.has(plain.id)).toBe(false);
    expect(looks.size).toBe(rest.length);
  });
});
