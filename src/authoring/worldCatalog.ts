/**
 * World catalog: the list of selectable bundled worlds and the lookup that turns a world id (or a file-like name) into a CellComplexSpec.
 * Ids are file stems of the bundled example scripts (for example "cube" or "genus-2-torus"); `defaultWorldId` is used when an id is unknown. Specs come from exampleWorlds and are already compiled, so loading is an immediate async resolve.
 */
import type { CellComplexSpec } from "../cell-complex/specs";
import {
  basicCube,
  basicTetrahedron,
  cube,
  dodecahedron,
  genus2Torus,
  icosahedron,
  octahedron,
  tetrahedron,
  torus,
  torusModuli,
} from "./exampleWorlds";

/**
 * A selectable world: its id, display label and an async loader returning its spec.
 */
export interface WorldCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly loadSpec: () => Promise<CellComplexSpec>;
}

interface WorldCatalogRecord extends WorldCatalogEntry {
  readonly spec: CellComplexSpec;
}

const worldCatalogRecords = [
  createWorldCatalogRecord("001-basic-cube", "001 Basic Cube", basicCube),
  createWorldCatalogRecord("002-basic-tetrahedron", "002 Basic Tetrahedron", basicTetrahedron),
  createWorldCatalogRecord("cube", "Cube", cube),
  createWorldCatalogRecord("dodecahedron", "Dodecahedron", dodecahedron),
  createWorldCatalogRecord("genus-2-torus", "Genus 2 Torus", genus2Torus),
  createWorldCatalogRecord("icosahedron", "Icosahedron", icosahedron),
  createWorldCatalogRecord("octahedron", "Octahedron", octahedron),
  createWorldCatalogRecord("tetrahedron", "Tetrahedron", tetrahedron),
  createWorldCatalogRecord("torus", "Torus", torus),
  createWorldCatalogRecord("torus-moduli", "Torus Moduli", torusModuli),
] as const satisfies readonly WorldCatalogRecord[];

/**
 * Id of the world loaded when none (or an unknown one) is requested.
 */
export const defaultWorldId = "cube";

/**
 * Catalog entries sorted alphabetically by label, for building world pickers.
 */
export const worldCatalog: readonly WorldCatalogEntry[] = [...worldCatalogRecords]
  .sort((a, b) => a.label.localeCompare(b.label))
  .map(({ spec, ...entry }) => entry);

/**
 * All bundled world specs in registration order (not sorted), for code that needs every world, such as tests.
 */
export const starterWorldSpecs: readonly CellComplexSpec[] = worldCatalogRecords.map((entry) => entry.spec);

/**
 * Resolves the spec for a world id or file name, falling back to the default world when the id is unknown; rejects only if the default world is missing.
 */
export async function loadWorldSpec(worldId: string): Promise<CellComplexSpec> {
  const selectedWorld = findWorldCatalogRecord(worldId) ?? findWorldCatalogRecord(defaultWorldId);

  if (!selectedWorld) {
    throw new Error("No world specs are available.");
  }

  return selectedWorld.loadSpec();
}

/**
 * Looks up a catalog entry by id or file-like name (normalized with normalizeWorldId); returns undefined with no fallback if absent.
 */
export function findWorldCatalogEntry(worldId: string): WorldCatalogEntry | undefined {
  return worldCatalog.find((entry) => entry.id === normalizeWorldId(worldId));
}

/**
 * Reduces a world id, path or file name to a bare id by dropping directories and a ".world.js", ".js" or ".ts" extension; returns undefined for empty input.
 */
export function normalizeWorldId(rawValue: string | null | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  const fileName = rawValue.split(/[\\/]/).pop() ?? rawValue;
  return fileName.replace(/(\.world)?\.js$/, "").replace(/\.ts$/, "");
}

function findWorldCatalogRecord(worldId: string): WorldCatalogRecord | undefined {
  return worldCatalogRecords.find((entry) => entry.id === normalizeWorldId(worldId));
}

function createWorldCatalogRecord(id: string, label: string, spec: CellComplexSpec): WorldCatalogRecord {
  return {
    id,
    label,
    spec,
    loadSpec: async () => spec,
  };
}
