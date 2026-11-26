/**
 * Which face gets which theme and palette (design 018 section 9.3). Random but reproducible: the draw is seeded from the world's cell ids
 * (or an explicit seed), so a world always looks the same and two worlds look different.
 *
 * Faces must be told apart at a glance, so the draw is constrained:
 * - Themes: faces are visited breadth-first from the first cell; each takes, among the themes no glued neighbour has, one used least often so
 *   far (ties broken at random). With at least as many themes as faces every face has its own.
 * - Hues: the colour wheel is cut into `max(3, min(faces, 12))` evenly spaced key hues, turned by a random offset. Each face takes, among the
 *   hues used least often so far, the one farthest (on the wheel) from the hues of its glued neighbours that already have one.
 * - The scheme (how the secondary and accent hues relate to the key) is drawn per face, and differs from the neighbours' where it can.
 *
 * Only cells with a textured floor are themed (the torus family keeps its lattice floor and gets no landmarks). Pure; layer rule: imports
 * only `cell-complex` and sibling modules.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import { buildFacePalette, paletteSchemes, type FacePalette, type PaletteScheme } from "./facePalettes";
import { faceThemes, type FaceTheme } from "./faceThemes";
import { createSeededRandom, hashStringToSeed } from "./seededNoise";

/** What a face looks like. */
export interface FaceLook {
  readonly theme: FaceTheme;
  readonly palette: FacePalette;
}

/**
 * The themes an authored decoration fits, by the folder of its model (`library.ts`), best first. Objects with a job (the question cube, the
 * starting house, the tool stand, creatures) are not decorations and constrain nothing; nor is grass, which belongs anywhere.
 */
export const decorationThemeIdsByAssetFolder: Readonly<Record<string, readonly string[]>> = {
  bicycle: ["clockwork", "village", "lamplight"],
  "_legacy/clock_low_poly": ["clockwork", "parlour"],
  Bench: ["village", "lamplight", "grove", "ruins"],
  Tree1: ["grove", "village", "ruins", "fungi"],
  TreeSwirl: ["grove", "fungi", "mobiles", "ruins"],
  FloweGroup: ["grove", "village", "parlour", "fungi"],
  flowerPot: ["grove", "parlour", "village", "thresholds"],
  stopsign: ["lamplight", "village", "kites"],
  trafficCone: ["lamplight", "kites", "village", "totems"],
  "_legacy/low_poly_campfire": ["lamplight", "cairns"],
  "_legacy/low_poly_rocks": ["cairns", "crystals", "ruins"],
};

/** The theme ids the decoration with model `assetPath` fits, best first, or undefined when it is not a decoration. */
export function decorationThemeIdsFor(assetPath: string): readonly string[] | undefined {
  return decorationThemeIdsByAssetFolder[assetPath.slice(0, assetPath.lastIndexOf("/"))];
}

// The themes a cell may take: those every decoration on it fits (or, when they agree on none, those its first decoration fits).
function allowedThemesOf(cell: CompiledPrismCell): readonly FaceTheme[] | undefined {
  const lists = cell.objects.flatMap((object) => (object.kind === "asset" ? [decorationThemeIdsFor(object.assetPath)] : [])).filter((list): list is readonly string[] => list !== undefined);

  if (lists.length === 0) {
    return undefined;
  }

  const common = lists[0].filter((id) => lists.every((list) => list.includes(id)));
  return (common.length > 0 ? common : lists[0]).map((id) => faceThemes.find((theme) => theme.id === id)).filter((theme): theme is FaceTheme => theme !== undefined);
}

/** Most key hues the wheel is cut into. */
export const maxKeyHues = 12;

/** Whether a cell is themed (gets landmarks and a palette). */
export function isThemedCell(cell: Pick<CompiledPrismCell, "floorMaterial">): boolean {
  return cell.floorMaterial.kind === "floor-texture";
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/**
 * Assigns a theme and a palette to every themed cell of the world (see the module header). `seed` overrides the seed drawn from the cell ids.
 */
export function assignFaceLooks(world: Pick<CompiledCellComplex, "cells" | "cellsById">, seed?: number): ReadonlyMap<string, FaceLook> {
  const cells = world.cells.filter(isThemedCell);
  const random = createSeededRandom((seed ?? hashStringToSeed(`face-looks|${world.cells.map((cell) => cell.id).join("|")}`)) >>> 0);
  const neighbours = new Map(cells.map((cell) => [cell.id, [...new Set(cell.portals.map((portal) => portal.targetCellId))].filter((id) => id !== cell.id)]));

  // Breadth-first order, so every face after the first has a placed neighbour to differ from.
  const order: CompiledPrismCell[] = [];
  const seen = new Set<string>();

  for (const root of cells) {
    if (seen.has(root.id)) {
      continue;
    }

    seen.add(root.id);
    const queue = [root];

    while (queue.length > 0) {
      const cell = queue.shift()!;
      order.push(cell);

      for (const id of neighbours.get(cell.id) ?? []) {
        const next = world.cellsById.get(id);

        if (next && isThemedCell(next) && !seen.has(id)) {
          seen.add(id);
          queue.push(next);
        }
      }
    }
  }

  // Faces with decorations choose their themes first (among those their decorations fit), then the free faces.
  const allowed = new Map(cells.map((cell) => [cell.id, allowedThemesOf(cell)] as const));
  const hueCount = Math.max(3, Math.min(cells.length, maxKeyHues));
  const hueOffset = random() * 360;
  const hues = Array.from({ length: hueCount }, (_, index) => (hueOffset + (index * 360) / hueCount) % 360);
  const themeUses = new Map<string, number>();
  const hueUses = new Array<number>(hueCount).fill(0);
  const looks = new Map<string, FaceLook>();
  const hueIndexByCell = new Map<string, number>();
  const schemeByCell = new Map<string, PaletteScheme>();

  const themeByCell = new Map<string, FaceTheme>();
  const chooseTheme = (cell: CompiledPrismCell): FaceTheme => {
    const around = neighbours.get(cell.id) ?? [];
    const pool = allowed.get(cell.id) ?? faceThemes;
    const takenThemes = new Set(around.map((id) => themeByCell.get(id)?.id).filter((id): id is string => id !== undefined));
    const themeChoices = pool.filter((entry) => !takenThemes.has(entry.id));
    const themePool = themeChoices.length > 0 ? themeChoices : pool;
    const fewestThemeUses = Math.min(...themePool.map((entry) => themeUses.get(entry.id) ?? 0));
    const theme = pickRandom(random, themePool.filter((entry) => (themeUses.get(entry.id) ?? 0) === fewestThemeUses));
    themeUses.set(theme.id, (themeUses.get(theme.id) ?? 0) + 1);
    themeByCell.set(cell.id, theme);
    return theme;
  };

  for (const cell of order.filter((entry) => allowed.get(entry.id) !== undefined)) {
    chooseTheme(cell);
  }

  for (const cell of order) {
    const around = neighbours.get(cell.id) ?? [];
    const theme = themeByCell.get(cell.id) ?? chooseTheme(cell);

    const neighbourHues = around.map((id) => hueIndexByCell.get(id)).filter((index): index is number => index !== undefined);
    const fewestHueUses = Math.min(...hueUses);
    const candidates = hues.map((_, index) => index).filter((index) => hueUses[index] === fewestHueUses);
    const scores = candidates.map((index) =>
      neighbourHues.length === 0 ? random() : Math.min(...neighbourHues.map((other) => hueDistance(hues[index], hues[other]))) + random() * 1e-3,
    );
    const hueIndex = candidates[scores.indexOf(Math.max(...scores))];
    hueUses[hueIndex] += 1;
    hueIndexByCell.set(cell.id, hueIndex);

    const takenSchemes = new Set(around.map((id) => schemeByCell.get(id)));
    const schemeChoices = paletteSchemes.filter((scheme) => !takenSchemes.has(scheme));
    const scheme = pickRandom(random, schemeChoices.length > 0 ? schemeChoices : paletteSchemes);
    schemeByCell.set(cell.id, scheme);

    looks.set(cell.id, { theme, palette: buildFacePalette(hues[hueIndex] + (random() - 0.5) * 8, scheme, random) });
  }

  return looks;
}

function pickRandom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}
