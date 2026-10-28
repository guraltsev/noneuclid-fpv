/**
 * World object library: the catalogue of named, ready-to-place objects available to world scripts (tree, house, bench, geo_mouse, geodesic_marmot, ...).
 * Each library entry wraps createStaticAssetObject, createSimpleGeoCreature or createGeodesicMarmot with library-owned defaults (asset path, visual scale, model offset, collision cylinder and collision class) that scale with the author's `scale`, and brands the result so WorldBuilder.OnFace can reject hand-made specs.
 * Authoring coordinates are [x, height, y] triples (meters); the library swaps them into cell-local (x, y, z) with z up. Turn/tilt angles are in degrees at the authoring layer and converted to radians in the specs.
 */
import type { CellObjectSpec, GeodesicMarmotObjectSpec, SimpleCollisionCylinderSpec } from "../cell-complex/specs";
import { createGeodesicMarmot } from "./geodesicMarmot";
import { createSimpleGeoCreature, type SimpleGeoCreatureAuthoringParams } from "./simpleGeoCreature";
import { createStaticAssetObject, type StaticObjectAuthoringParams } from "./staticAssets";
import { userObjectClass } from "./objectMetadata";

const libraryObjectBrand = Symbol("world-library-object");

// Re-exported so world scripts and library consumers can reference the player's collision class.
export { userObjectClass };

/**
 * Shape of the fixed definition of the player's robot avatar (asset, scale, collision cylinder and class).
 */
export interface StandardUserRobotObjectDefinition {
  readonly id: "user-robot";
  readonly class: typeof userObjectClass;
  readonly assetPath: string;
  readonly scale: number;
  readonly collision: SimpleCollisionCylinderSpec;
  readonly do_not_collide_with: readonly string[];
}

/**
 * The player's rover avatar definition: class "user", 0.32 m radius by 1 m high collision cylinder centred 0.5 m above the floor, ignoring no classes.
 */
export const standardUserRobotObject: StandardUserRobotObjectDefinition = {
  id: "user-robot",
  class: userObjectClass,
  assetPath: "rover/rover.glb",
  scale: 0.1925,
  collision: {
    radius: 0.32,
    height: 1,
    offset: { x: 0, y: 0, z: 0.5 },
  },
  do_not_collide_with: [],
};

interface StaticLibraryDefinition {
  readonly assetPath: string;
  readonly class: string;
  readonly visualScale?: number;
  readonly visualScaleXYZ?: (authorScale: number) => readonly [number, number, number];
  readonly modelOffset?: (authorScale: number) => readonly [number, number, number];
  readonly collision?: (authorScale: number) => SimpleCollisionCylinderSpec;
  readonly do_not_collide_with?: readonly string[];
  readonly displayHelpMessage?: string;
}

const smallHouseAssetScale = 2.5;
const questionCubeAssetScale = 4;
// Collision cylinder is centred on the model's measured footprint, not its origin.
const smallHouseFootprintCenter = {
  // Center of public/assets/small_house/small_house.glb in authoring world axes,
  // measured from the asset bounds after the library's base model scale.
  x: 0.17220746725797653,
  y: -0.084492526948451995,
};

const staticLibraryDefinitions = {
  small_house: {
    assetPath: "small_house/small_house.glb",
    class: "house",
    displayHelpMessage: "A static landmark. Use nearby landmarks to keep track of where you are in the world.",
    visualScale: smallHouseAssetScale,
    modelOffset: (scale) => [0, scale * smallHouseAssetScale * 0.5, 0],
    collision: (scale) => ({
      radius: scale * 1.1 + 0.1,
      height: scale * 2.1,
      offset: {
        x: scale * smallHouseFootprintCenter.x,
        y: scale * smallHouseFootprintCenter.y,
        z: scale * 1.05,
      },
    }),
  },
  tree: {
    assetPath: "Tree1/Tree.glb",
    class: "tree",
    displayHelpMessage: "A static tree. It marks the local shape of this face and blocks movement at its trunk.",
    visualScaleXYZ: treeScaleXYZ,
    collision: (scale) => ({
      radius: scale * 0.42,
      height: scale * 3.1,
      offset: { x: 0, y: 0, z: scale * 1.55 },
    }),
  },
  tree_swirl: {
    assetPath: "TreeSwirl/tree_swirl.glb",
    class: "tree",
    displayHelpMessage: "A static tree. It marks the local shape of this face and blocks movement at its trunk.",
    visualScaleXYZ: treeScaleXYZ,
    collision: (scale) => ({
      radius: scale * 0.48,
      height: scale * 3.3,
      offset: { x: 0, y: 0, z: scale * 1.65 },
    }),
  },
  grass: {
    assetPath: "grass1/Grass.glb",
    class: "grass",
    do_not_collide_with: [userObjectClass],
  },
  bench: {
    assetPath: "Bench/Bench.glb",
    class: "bench",
    displayHelpMessage: "A static bench. It is a landmark and collision object in this cell.",
    visualScale: 0.9,
    modelOffset: (scale) => [0, scale * 0.9 * 0.45, 0],
    collision: (scale) => ({
      radius: scale * 0.8,
      height: scale * 0.9,
      offset: { x: 0, y: 0, z: scale * 0.45 },
    }),
  },
  bicycle: {
    assetPath: "bicycle/Bicycle.glb",
    class: "bike",
    displayHelpMessage: "A static bicycle. It is a landmark and collision object in this cell.",
    visualScale: 0.9,
    collision: (scale) => ({
      radius: scale * 0.85,
      height: scale * 1.1,
      offset: { x: 0, y: 0, z: scale * 0.55 },
    }),
  },
  flower_group: {
    assetPath: "FloweGroup/flower_group.glb",
    class: "flowers",
    visualScale: 0.7,
    do_not_collide_with: [userObjectClass],
  },
  flower_pot: {
    assetPath: "flowerPot/flower_pot.glb",
    class: "flower-pot",
    displayHelpMessage: "A small decorative object. It can help you recognize this part of the world.",
    visualScale: 0.75,
    collision: (scale) => ({
      radius: scale * 0.28,
      height: scale * 0.5,
      offset: { x: 0, y: 0, z: scale * 0.25 },
    }),
  },
  stop_sign: {
    assetPath: "stopsign/stop_sign.glb",
    class: "sign",
    displayHelpMessage: "A static sign. Use it as a landmark while exploring portal connections.",
    visualScale: 0.03,
    collision: (scale) => ({
      radius: scale * 0.32,
      height: scale * 2.15,
      offset: { x: 0, y: 0, z: scale * 1.075 },
    }),
  },
  traffic_cone: {
    assetPath: "trafficCone/Cone.glb",
    class: "cone",
    displayHelpMessage: "A static traffic cone. It marks this spot and blocks movement.",
    visualScale: 0.75,
    collision: (scale) => ({
      radius: scale * 0.32,
      height: scale * 0.75,
      offset: { x: 0, y: 0, z: scale * 0.375 },
    }),
  },
  question_cube: {
    assetPath: "questionblock/questionBlock.glb",
    class: "question-cube",
    displayHelpMessage: "A help cube. Aim at it to see a short tutorial prompt.",
    visualScale: questionCubeAssetScale,
    modelOffset: (scale) => [0, scale * questionCubeAssetScale * 0.13, 0],
    collision: (scale) => ({
      radius: scale * 0.55,
      height: scale * 1.1,
      offset: { x: 0, y: 0, z: scale * 0.55 },
    }),
  },
  clock: {
    assetPath: "_legacy/clock_low_poly/scene.gltf",
    class: "clock",
    do_not_collide_with: [userObjectClass],
  },
  campfire: {
    assetPath: "_legacy/low_poly_campfire/scene.gltf",
    class: "fire",
    displayHelpMessage: "A static campfire landmark.",
    collision: (scale) => ({
      radius: scale * 0.55,
      height: scale * 0.45,
      offset: { x: 0, y: 0, z: scale * 0.225 },
    }),
  },
  rocks: {
    assetPath: "_legacy/low_poly_rocks/scene.gltf",
    class: "rocks",
    displayHelpMessage: "Static rocks. They are landmarks and collision objects in this cell.",
    collision: (scale) => ({
      radius: scale * 0.45,
      height: scale * 0.35,
      offset: { x: 0, y: 0, z: scale * 0.175 },
    }),
  },
  emergency_button: {
    assetPath: "_legacy/low_poly_emergency_button/scene.gltf",
    class: "interactive",
    displayHelpMessage: "A static button-like object. Use it as an exploration landmark.",
    collision: (scale) => ({
      radius: scale * 0.25,
      height: scale * 0.25,
      offset: { x: 0, y: 0, z: scale * 0.125 },
    }),
  },
  computer_large: {
    assetPath: "computerlarge/ComputerLarge.glb",
    class: "geometry-computer",
    displayHelpMessage: "Use this computer to change world deformation when the current world supports live geometry changes.",
    visualScale: 0.9,
    modelOffset: (scale) => [0, 0, scale * 0.05],
    collision: (scale) => ({
      radius: scale * 0.9,
      height: scale * 1.35,
      offset: { x: 0, y: 0, z: scale * 0.675 },
    }),
  },
} as const satisfies Record<string, StaticLibraryDefinition>;

/**
 * Authoring parameters for the `geodesic_marmot` library entry.
 * `position` is [x, height, y] in meters like other library objects, `velocity` is the planar [vx, vy] in m/s in the cell's x/y axes; `doNotCollideWith` is a camel-case alias of `do_not_collide_with`.
 */
export interface GeodesicMarmotAuthoringParams {
  readonly position: readonly [x: number, y: number, z: number];
  readonly velocity: readonly [vx: number, vy: number];
  readonly scale?: number;
  readonly class?: string;
  readonly do_not_collide_with?: readonly string[];
  readonly doNotCollideWith?: readonly string[];
  readonly displayHelpMessage?: string;
}

/**
 * A CellObjectSpec carrying a non-enumerable brand proving it was produced by the object library.
 * The brand is a symbol property that is dropped when the spec is spread (WorldBuilder strips it), so it never reaches serialized specs.
 */
export type WorldLibraryObjectSpec = CellObjectSpec & {
  readonly [libraryObjectBrand]: true;
};

/**
 * The set of constructors injected as globals into world scripts.
 * Every entry is `(name, params) => WorldLibraryObjectSpec` where `name` becomes the object id (unique per world, enforced by WorldBuilder).
 */
export interface WorldObjectLibrary {
  /**
   * Static authored objects. Each has library-owned base asset scale, collision class, and collision area.
   * Authors may override position, scale, turn, tilt, collision, class, and do_not_collide_with per instance.
   */
  readonly small_house: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly tree: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly tree_swirl: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly grass: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly bench: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly bicycle: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly flower_group: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly flower_pot: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly stop_sign: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly traffic_cone: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly question_cube: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  /**
   * Autonomous creature objects. Authors may set speed, oscillationRate,
   * oscillationMagnitude, turn, scale, collision, class, and do_not_collide_with.
   */
  readonly geo_mouse: (name: string, params: SimpleGeoCreatureAuthoringParams) => WorldLibraryObjectSpec;
  readonly geo_butterfly: (name: string, params: SimpleGeoCreatureAuthoringParams) => WorldLibraryObjectSpec;
  /** Alias for small_house. */
  readonly house: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly clock: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly campfire: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly rocks: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly emergency_button: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  readonly computer_large: (name: string, params: StaticObjectAuthoringParams) => WorldLibraryObjectSpec;
  /**
   * Autonomous moving object. Authors may set scale, class, do_not_collide_with,
   * and velocity; the library owns its default asset, size, and collision area.
   */
  readonly geodesic_marmot: (name: string, params: GeodesicMarmotAuthoringParams) => WorldLibraryObjectSpec;
}

/**
 * The object library instance; `house` aliases `small_house`.
 * Static entries merge the per-entry defaults with the author's overrides (author values win); `geodesic_marmot` swaps [x, height, y] into cell-local (x, y, z).
 */
export const worldObjectLibrary: WorldObjectLibrary = {
  small_house: (name, params) => createDefinedStaticLibraryObject("small_house", name, params),
  tree: (name, params) => createDefinedStaticLibraryObject("tree", name, params),
  tree_swirl: (name, params) => createDefinedStaticLibraryObject("tree_swirl", name, params),
  grass: (name, params) => createDefinedStaticLibraryObject("grass", name, params),
  bench: (name, params) => createDefinedStaticLibraryObject("bench", name, params),
  bicycle: (name, params) => createDefinedStaticLibraryObject("bicycle", name, params),
  flower_group: (name, params) => createDefinedStaticLibraryObject("flower_group", name, params),
  flower_pot: (name, params) => createDefinedStaticLibraryObject("flower_pot", name, params),
  stop_sign: (name, params) => createDefinedStaticLibraryObject("stop_sign", name, params),
  traffic_cone: (name, params) => createDefinedStaticLibraryObject("traffic_cone", name, params),
  question_cube: (name, params) => createDefinedStaticLibraryObject("question_cube", name, params),
  geo_mouse: (name, params) =>
    brandLibraryObject(createSimpleGeoCreature("geo-mouse", name, "mouse/Mouse.glb", params)),
  geo_butterfly: (name, params) =>
    brandLibraryObject(createSimpleGeoCreature("geo-butterfly", name, "butterfly/Butterfly.glb", params)),
  house: (name, params) => worldObjectLibrary.small_house(name, params),
  clock: (name, params) => createDefinedStaticLibraryObject("clock", name, params),
  campfire: (name, params) => createDefinedStaticLibraryObject("campfire", name, params),
  rocks: (name, params) => createDefinedStaticLibraryObject("rocks", name, params),
  emergency_button: (name, params) => createDefinedStaticLibraryObject("emergency_button", name, params),
  computer_large: (name, params) => createDefinedStaticLibraryObject("computer_large", name, params),
  geodesic_marmot: (name, params) =>
    brandLibraryObject(
      createGeodesicMarmot({
        id: name,
        position: {
          x: params.position[0],
          y: params.position[2],
          z: params.position[1],
        },
        velocity: {
          x: params.velocity[0],
          y: params.velocity[1],
        },
        scale: params.scale,
        class: params.class,
        do_not_collide_with: params.do_not_collide_with ?? params.doNotCollideWith,
        displayHelpMessage: params.displayHelpMessage,
      }),
    ),
};

/**
 * Type guard: true when the value carries the object-library brand (and so was built by `worldObjectLibrary`).
 */
export function isWorldLibraryObjectSpec(value: unknown): value is WorldLibraryObjectSpec {
  if (!value || typeof value !== "object") {
    return false;
  }

  return libraryObjectBrand in value;
}

function createStaticLibraryObject(
  name: string,
  assetPath: string,
  params: StaticObjectAuthoringParams,
): WorldLibraryObjectSpec {
  return brandLibraryObject(createStaticAssetObject(name, assetPath, params));
}

function createDefinedStaticLibraryObject(
  key: keyof typeof staticLibraryDefinitions,
  name: string,
  params: StaticObjectAuthoringParams,
): WorldLibraryObjectSpec {
  const definition: StaticLibraryDefinition = staticLibraryDefinitions[key];
  const authorScale = params.scale ?? 1;
  const resolvedParams: StaticObjectAuthoringParams = {
    ...params,
    // Uniform visual scale = author scale times the library's base model scale, unless a non-uniform scaleXYZ override is given (then it is used verbatim).
    scale: params.scaleXYZ ? params.scale : authorScale * (definition.visualScale ?? 1),
    scaleXYZ: params.scaleXYZ ?? definition.visualScaleXYZ?.(authorScale),
    modelOffset: params.modelOffset ?? definition.modelOffset?.(authorScale),
    collision: params.collision ?? definition.collision?.(authorScale),
    class: params.class ?? definition.class,
    do_not_collide_with: params.do_not_collide_with ?? params.doNotCollideWith ?? definition.do_not_collide_with,
    displayHelpMessage: params.displayHelpMessage ?? definition.displayHelpMessage,
  };

  return createStaticLibraryObject(name, definition.assetPath, resolvedParams);
}

// Non-uniform scale compensating for the tree model's native proportions (0.02 base; narrower horizontally than vertically).
function treeScaleXYZ(scale = 1): readonly [number, number, number] {
  const assetScale = scale * 0.02;
  return [assetScale / 1.5, (assetScale * 2.5) / 3, assetScale / 1.5];
}

function brandLibraryObject<T extends CellObjectSpec | GeodesicMarmotObjectSpec>(objectSpec: T): T & WorldLibraryObjectSpec {
  Object.defineProperty(objectSpec, libraryObjectBrand, {
    value: true,
    enumerable: false,
  });
  return objectSpec as T & WorldLibraryObjectSpec;
}
