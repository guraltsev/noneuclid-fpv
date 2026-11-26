/**
 * Decorations generated in code (design 018 section 9.8): the bench, bicycle, trees, flowers, sign, cone and house that world files place
 * by hand are built from the landmark part kit instead of loaded from glTF files. Each is drawn in its face's palette and varied by its
 * own seed (the object id and the world's look seed), so the same bench is a little different in every look and always belongs to its face.
 *
 * A generated decoration is an asset object whose `assetPath` is `generated/<kind>`; nothing is preloaded for it, and the renderer builds
 * its mesh from {@link buildDecorationParts}. Parts are in meters at author scale 1, in the object's own frame (`u` right, `v` forward,
 * `w` up), origin on the ground, sized to the collision cylinder the library gives the kind. The house's door is on its front (+v), where
 * the player starts. Pure; layer rule: imports only sibling modules.
 */
import type { FacePalette } from "./facePalettes";
import { bench, between, bicycle, build, firTiers, house, integer, pick, polyline, TAU, tree } from "./faceThemes";
import type { LandmarkPart, Vec3 } from "./landmarkParts";
import { createSeededRandom, hashStringToSeed } from "./seededNoise";

/** The decorations built in code. */
export type GeneratedDecorationKind =
  | "bench"
  | "bicycle"
  | "tree"
  | "tree_swirl"
  | "flower_pot"
  | "flower_group"
  | "stop_sign"
  | "traffic_cone"
  | "small_house";

/** Every generated decoration kind. */
export const generatedDecorationKinds: readonly GeneratedDecorationKind[] = [
  "bench",
  "bicycle",
  "tree",
  "tree_swirl",
  "flower_pot",
  "flower_group",
  "stop_sign",
  "traffic_cone",
  "small_house",
];

/** Prefix of the asset path of a generated decoration. */
export const generatedDecorationPathPrefix = "generated/";

/** The asset path that names a generated decoration. */
export function generatedDecorationPath(kind: GeneratedDecorationKind): string {
  return `${generatedDecorationPathPrefix}${kind}`;
}

/** The kind named by `assetPath`, or undefined when it is not a generated decoration. */
export function generatedDecorationKindOf(assetPath: string | undefined): GeneratedDecorationKind | undefined {
  if (assetPath === undefined || !assetPath.startsWith(generatedDecorationPathPrefix)) {
    return undefined;
  }

  const kind = assetPath.slice(generatedDecorationPathPrefix.length) as GeneratedDecorationKind;
  return generatedDecorationKinds.includes(kind) ? kind : undefined;
}

/** The seed of an object's model: its id and the world's look seed, so every look varies it. */
export function decorationSeed(objectId: string, lookSeed: number | undefined): number {
  return hashStringToSeed(`decoration|${objectId}|${lookSeed ?? ""}`);
}

const builders: Record<GeneratedDecorationKind, (kit: Parameters<Parameters<typeof build>[2]>[0]) => void> = {
  bench: (kit) => {
    bench(kit, [0, 0, 0], between(kit.random, 1.35, 1.6), Math.PI);
  },
  bicycle: (kit) => {
    bicycle(kit, between(kit.random, 0.32, 0.36));
  },
  tree: (kit) => {
    tree(kit, [0, 0, 0], between(kit.random, 3.4, 4.2), false);
  },
  tree_swirl: (kit) => {
    // A trunk winding upwards under a pointed crown.
    const { random } = kit;
    const height = between(random, 3.4, 4.2);
    const turns = between(random, 0.8, 1.4);
    const points: Vec3[] = Array.from({ length: 7 }, (_, index) => {
      const t = index / 6;
      const angle = t * turns * TAU;
      return [Math.cos(angle) * 0.22 * t, Math.sin(angle) * 0.22 * t, t * height * 0.45];
    });
    polyline(kit, points, 0.11, "dark");
    firTiers(kit, points[points.length - 1], height, integer(random, 3, 4), 0.4);
  },
  flower_pot: (kit) => {
    const { random } = kit;
    kit.prism([0, 0, 0], 8, 0.17, 0.24, 0.34, pick(random, ["secondary", "dark"] as const));
    kit.prism([0, 0, 0.3], 8, 0.25, 0.25, 0.05, "dark", undefined, { collide: false });
    const flowers = integer(random, 3, 5);
    for (let index = 0; index < flowers; index += 1) {
      const angle = (index / flowers) * TAU + random();
      const top: Vec3 = [Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, between(random, 0.55, 0.75)];
      kit.strut([0, 0, 0.33], top, 0.012, "dark", { collide: false });
      kit.star(top, 5, 0.09, 0.04, 0.03, pick(random, ["accent", "light", "primary"] as const), { roll: Math.PI / 2 });
    }
  },
  flower_group: (kit) => {
    const { random } = kit;
    const flowers = integer(random, 5, 8);
    for (let index = 0; index < flowers; index += 1) {
      const angle = random() * TAU;
      const reach = between(random, 0, 0.5);
      const height = between(random, 0.3, 0.6);
      const base: Vec3 = [Math.cos(angle) * reach, Math.sin(angle) * reach, 0];
      kit.strut(base, [base[0], base[1], height], 0.012, "dark", { collide: false });
      kit.star([base[0], base[1], height], 5, 0.1, 0.045, 0.03, pick(random, ["accent", "light", "secondary"] as const), { roll: Math.PI / 2 });
    }
  },
  stop_sign: (kit) => {
    const height = between(kit.random, 2.0, 2.2);
    kit.prism([0, 0, 0], 6, 0.05, 0.04, height, "dark");
    // The plate faces forward (+v); an octagon in the accent colour with a light rim.
    kit.prism([0, 0.06, height], 8, 0.36, 0.36, 0.04, "light", { roll: -Math.PI / 2 }, { phase: Math.PI / 8 });
    kit.prism([0, 0.1, height], 8, 0.31, 0.31, 0.03, "accent", { roll: -Math.PI / 2 }, { phase: Math.PI / 8 });
  },
  traffic_cone: (kit) => {
    const height = between(kit.random, 0.68, 0.76);
    kit.box([0, 0, 0], 0.5, 0.5, 0.04, "dark");
    kit.prism([0, 0, 0.04], 10, 0.2, 0.035, height - 0.04, "accent");
    kit.prism([0, 0, 0.04 + (height - 0.04) * 0.42], 10, 0.13, 0.1, (height - 0.04) * 0.18, "light", undefined, { collide: false });
  },
  small_house: (kit) => {
    // Turned half round, so the door is on the front (+v), facing the start.
    house(kit, [0.17, -0.08, 0], between(kit.random, 2.0, 2.3), between(kit.random, 1.8, 2.0), between(kit.random, 1.6, 1.8), Math.PI);
  },
};

/** The parts of a generated decoration of `kind` from `seed`, in `palette`. */
export function buildDecorationParts(kind: GeneratedDecorationKind, seed: number, palette: FacePalette): readonly LandmarkPart[] {
  return build(createSeededRandom(seed), palette, builders[kind]);
}
