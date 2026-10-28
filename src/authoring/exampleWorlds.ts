/**
 * Bundled example worlds: compiles the .world.js scripts in src/examples/ (imported as raw text) into CellComplexSpec constants at module load.
 * These are the inputs to the world catalog; compilation runs eagerly on import, so a broken example script makes this module (and anything importing the catalog) throw.
 */
import type { CellComplexSpec } from "../cell-complex/specs";
import { compileWorldScript } from "./compileWorldScript";
import basicCubeWorldSource from "../examples/001-basic-cube.world.js?raw";
import basicTetrahedronWorldSource from "../examples/002-basic-tetrahedron.world.js?raw";
import cubeWorldSource from "../examples/cube.world.js?raw";
import dodecahedronWorldSource from "../examples/dodecahedron.world.js?raw";
import genus2TorusWorldSource from "../examples/genus-2-torus.world.js?raw";
import icosahedronWorldSource from "../examples/icosahedron.world.js?raw";
import octahedronWorldSource from "../examples/octahedron.world.js?raw";
import tetrahedronWorldSource from "../examples/tetrahedron.world.js?raw";
import torusWorldSource from "../examples/torus.world.js?raw";
import torusModuliWorldSource from "../examples/torus-moduli.world.js?raw";

/**
 * Compiled spec of 001-basic-cube.world.js: a cube built from six square faces.
 */
export const basicCube = compileExampleWorld(basicCubeWorldSource, "001-basic-cube.world.js");
/**
 * Compiled spec of 002-basic-tetrahedron.world.js: a tetrahedron built from four triangular faces.
 */
export const basicTetrahedron = compileExampleWorld(basicTetrahedronWorldSource, "002-basic-tetrahedron.world.js");
/**
 * Compiled spec of cube.world.js: six square faces glued as a cube (the catalog default world).
 */
export const cube = compileExampleWorld(cubeWorldSource, "cube.world.js");
/**
 * Compiled spec of dodecahedron.world.js: a dodecahedron built from pentagonal faces.
 */
export const dodecahedron = compileExampleWorld(dodecahedronWorldSource, "dodecahedron.world.js");
/**
 * Compiled spec of genus-2-torus.world.js: a genus-2 surface built from a single octagonal face with sides glued.
 */
export const genus2Torus = compileExampleWorld(genus2TorusWorldSource, "genus-2-torus.world.js");
/**
 * Compiled spec of icosahedron.world.js: an icosahedron built from triangular faces.
 */
export const icosahedron = compileExampleWorld(icosahedronWorldSource, "icosahedron.world.js");
/**
 * Compiled spec of octahedron.world.js: an octahedron built from triangular faces.
 */
export const octahedron = compileExampleWorld(octahedronWorldSource, "octahedron.world.js");
/**
 * Compiled spec of tetrahedron.world.js: a tetrahedron built from four triangular faces.
 */
export const tetrahedron = compileExampleWorld(tetrahedronWorldSource, "tetrahedron.world.js");
/**
 * Compiled spec of torus.world.js: a torus built from a single square face with opposite sides glued.
 */
export const torus = compileExampleWorld(torusWorldSource, "torus.world.js");
/**
 * Compiled spec of torus-moduli.world.js: a torus-moduli variant of the single-square torus world.
 */
export const torusModuli = compileExampleWorld(torusModuliWorldSource, "torus-moduli.world.js");

function compileExampleWorld(sourceText: string, sourceName: string): CellComplexSpec {
  return compileWorldScript(sourceText, { sourceName });
}
