/**
 * Floor texture library: the named floor appearances world scripts can use, via the `floorTexture` helper.
 * A floor is either a flat color or a tiled texture (an entry of `floorTextureDefinitions` with its fallback tint color and the world-space size, in meters, of one repeating tile). The helper returns a FloorMaterialSpec carrying a non-enumerable brand, which the builder normalizes into a plain spec stored on the cell; texture paths are relative to the assets directory.
 */
import type { FloorMaterialSpec } from "../cell-complex/specs";

const floorMaterialBrand = Symbol("floor-material");

/**
 * Static description of a built-in floor texture: name, fallback tint color, default tile size in meters, and the paths of its optional texture maps.
 */
export interface FloorTextureDefinition {
  readonly name: string;
  /** CSS color used as tint/fallback while or if the texture is unavailable. */
  readonly floorColor: string;
  /** World-space edge length in meters of one repeating texture tile. */
  readonly defaultTileSizeMeters: number;
  readonly colorTexturePath?: string;
  readonly normalTexturePath?: string;
  readonly bumpTexturePath?: string;
  readonly roughnessTexturePath?: string;
}

/**
 * Per-use overrides for a named floor texture.
 */
export interface FloorTextureOptions {
  /** Overrides the tile edge length, in meters. */
  readonly tileSize?: number;
  /** Overrides the fallback/tint color. */
  readonly floorColor?: string;
}

/**
 * Options for a plain colored floor.
 */
export interface FloorColorOptions {
  readonly color: string;
}

/**
 * A FloorMaterialSpec branded (non-enumerably) as produced by the floor texture library; shallow-copying it drops the brand.
 */
export type WorldFloorMaterialSpec = FloorMaterialSpec & {
  readonly [floorMaterialBrand]: true;
};

/**
 * The built-in floor textures keyed by name (for example grass1, snow, wood_floor); `grass1` and `forest_leaves` currently share the same color texture file.
 */
export const floorTextureDefinitions = {
  grass1: {
    name: "grass1",
    floorColor: "#5b8f48",
    defaultTileSizeMeters: 60,
    colorTexturePath: "textures/forest_leaves_02_4k/runtime/forest_leaves_02_color.ktx2",
  },
  forest_leaves: {
    name: "forest_leaves",
    floorColor: "#59633d",
    defaultTileSizeMeters: 48,
    colorTexturePath: "textures/forest_leaves_02_4k/runtime/forest_leaves_02_color.ktx2",
  },
  river_pebbles: {
    name: "river_pebbles",
    floorColor: "#7b7f77",
    defaultTileSizeMeters: 40,
    colorTexturePath: "textures/ganges_river_pebbles_4k/runtime/ganges_river_pebbles_color.ktx2",
  },
  gravelly_sand: {
    name: "gravelly_sand",
    floorColor: "#9b8d6e",
    defaultTileSizeMeters: 48,
    colorTexturePath: "textures/gravelly_sand_4k/runtime/gravelly_sand_color.ktx2",
  },
  red_mud_stones: {
    name: "red_mud_stones",
    floorColor: "#8b4e3f",
    defaultTileSizeMeters: 48,
    colorTexturePath: "textures/red_mud_stones_4k/runtime/red_mud_stones_color.ktx2",
  },
  snow: {
    name: "snow",
    floorColor: "#d8dedf",
    defaultTileSizeMeters: 60,
    colorTexturePath: "textures/snow_02_4k/runtime/snow_02_color.ktx2",
  },
  wood_floor: {
    name: "wood_floor",
    floorColor: "#8b6845",
    defaultTileSizeMeters: 22,
    colorTexturePath: "textures/WoodFloor064_4K-JPG/runtime/WoodFloor064_color.ktx2",
  },
  fabric: {
    name: "fabric",
    floorColor: "#806f75",
    defaultTileSizeMeters: 20,
    colorTexturePath: "textures/Fabric022_4K-JPG/runtime/Fabric022_color.ktx2",
  },
  paving_stones: {
    name: "paving_stones",
    floorColor: "#777872",
    defaultTileSizeMeters: 32,
    colorTexturePath: "textures/PavingStones138_4K-JPG/runtime/PavingStones138_color.ktx2",
  },
  paving_blocks: {
    name: "paving_blocks",
    floorColor: "#8a8379",
    defaultTileSizeMeters: 28,
    colorTexturePath: "textures/PavingStones114_4K-JPG/runtime/PavingStones114_color.ktx2",
  },
  tile_grid: {
    name: "tile_grid",
    floorColor: "#90918a",
    defaultTileSizeMeters: 24,
    colorTexturePath: "textures/Tiles118_4K-JPG/runtime/Tiles118_color.ktx2",
  },
  warm_tiles: {
    name: "warm_tiles",
    floorColor: "#9c8c74",
    defaultTileSizeMeters: 24,
    colorTexturePath: "textures/Tiles132A_4K-JPG/runtime/Tiles132A_color.ktx2",
  },
  brushed_metal: {
    name: "brushed_metal",
    floorColor: "#777b7f",
    defaultTileSizeMeters: 18,
    colorTexturePath: "textures/Metal048C_4K-JPG/runtime/Metal048C_color.ktx2",
  },
} satisfies Record<string, FloorTextureDefinition>;

/**
 * Union of the built-in floor texture names.
 */
export type FloorTextureName = keyof typeof floorTextureDefinitions;

/**
 * The floor-related globals exposed to world scripts.
 */
export interface WorldFloorTextureLibrary {
  /** Builds a floor material: `floorTexture("snow", { tileSize })` for a built-in texture, or `floorTexture({ color })` for a flat color. */
  readonly floorTexture: {
    (name: FloorTextureName, options?: FloorTextureOptions): WorldFloorMaterialSpec;
    (options: FloorColorOptions): WorldFloorMaterialSpec;
  };
}

/**
 * Implementation of the floor helpers injected into world scripts; throws on an unknown texture name.
 */
export const worldFloorTextureLibrary: WorldFloorTextureLibrary = {
  floorTexture(input: FloorTextureName | FloorColorOptions, options: FloorTextureOptions = {}) {
    if (typeof input !== "string") {
      return brandFloorMaterial({
        kind: "floor-color",
        floorColor: input.color,
      });
    }

    const definition: FloorTextureDefinition = floorTextureDefinitions[input];

    if (!definition) {
      throw new Error(`Unknown floor texture "${input}".`);
    }

    return brandFloorMaterial({
      kind: "floor-texture",
      name: definition.name,
      floorColor: options.floorColor ?? definition.floorColor,
      tileSizeMeters: options.tileSize ?? definition.defaultTileSizeMeters,
      colorTexturePath: definition.colorTexturePath,
      normalTexturePath: definition.normalTexturePath,
      bumpTexturePath: definition.bumpTexturePath,
      roughnessTexturePath: definition.roughnessTexturePath,
    });
  },
};

/**
 * Converts a floor argument into a plain FloorMaterialSpec: a string becomes a flat-color floor, a library material is shallow-copied (dropping the brand).
 */
export function normalizeFloorMaterial(input: string | WorldFloorMaterialSpec): FloorMaterialSpec {
  if (typeof input === "string") {
    return {
      kind: "floor-color",
      floorColor: input,
    };
  }

  return { ...input };
}

function brandFloorMaterial<T extends FloorMaterialSpec>(material: T): T & WorldFloorMaterialSpec {
  Object.defineProperty(material, floorMaterialBrand, {
    value: true,
    enumerable: false,
  });
  return material as T & WorldFloorMaterialSpec;
}
