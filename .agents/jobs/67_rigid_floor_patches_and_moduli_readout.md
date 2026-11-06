# Job 67 - Rigid floor patches, Teichmuller steps and a moduli readout for the torus

Status: queued.
Resolves: issue [95](../../_issues/95_torus_moduli_floor_shears_and_the_deformation_does_not_read_as_moduli_space.md) (parts 1 to 3; part 4 stays with [job 35](35_torus_family_as_teichmuller_space.md)).

## Goal

In `torus-moduli`, sweeping the geometry computer must keep the pebbles the shape of pebbles, keep the floor seamless, return to the
very same floor when the torus returns to the same shape, step evenly, and tell the user which torus they are on.

Read issue 95 first. It explains why; this job says exactly what to do.

## Depends on

- Stages 1 and 2 touch no file that the coordinator of jobs 61-66 changes. They can start at once.
- Stages 3 and 4 touch `createThreeApp.ts`, `runtimeCommands.ts`, `runtimeMenuState.ts` and `paletteDefinition.ts`, which that batch
  changes. **Start stage 3 only when `.agents/jobs/_done/66_measurement_tools_and_flags.md` exists.** If it does not, finish stages 1 and 2, write
  the report, set `Status: in progress, stages 3 and 4 wait for job 66.`, and stop. Do not move the job to `_done/`.

## Before you start

Search for function names rather than trusting line numbers; other jobs are moving code.

| File | What to look at |
| --- | --- |
| `_issues/95_...md` | The whole design, especially part 1 |
| `src/cell-complex/floorUv.ts` | The whole module (48 lines) |
| `src/cell-complex/deformations/torusSkewDeformation.ts` | `floorUvFrames`, `nextTorusSkewStep`, `torusLatticeFrame` |
| `src/cell-complex/worldGeometryDeformations.ts` | `DynamicGeometryStepOptions` |
| `src/render/three/buildCellMesh.ts` | `buildFloorMesh` |
| `src/render/three/cellRenderArchetypes.ts` | `cloneMaterial`, `collectCellArchetypeSources` |
| `src/render/three/portalClipMaterial.ts` | `patchSinglePortalClipMaterial`, `patchVertexShader`, `patchFragmentShader` |
| `src/runtime/worldGeometrySession.ts` | `defaultStepOptions`, `LiveGeometryDebugState`, `session.state` |
| `src/render/three/geometryComputerMenu.ts` | `createGeometryComputerMenuOptions` |
| `src/ui/paletteDefinition.ts` | `GeometryComputerActionsPaletteContent`, `createGeometryComputerActionsContent` |
| `src/render/three/palette/pages/geometryComputer.ts` | The page layout |
| `tests/cell-complex/floorUv.test.ts`, `tests/render/portalClipMaterial.test.ts` | Test style |

Environment: Windows; run commands in Git Bash from the repository root. `npm test` includes documentation checks: every new module needs a
header comment, every export a JSDoc comment. Layers: `math` imports nothing, `cell-complex` may import `math`, `ui` may import `cell-complex`.

## Background

Numbers for checking your work, with w = 15, base square, nU = nV = 6, so the tile and the anchor spacing at rest are 2.5 m.

The floor is drawn from anchors A(i, j) = o + i u/nU + j v/nV. A patch paints uv = G (p - A), where G is a **constant** matrix from the base state.
At (a, b) = (30, 7.5): u/6 = (2.5, 0), v/6 = (5, 1.25). Reducing gives steps of length 1.25 and 2.5. The covering radius is
0.5 * sqrt(1.25^2 + 2.5^2) = 1.3975, so R = 1.7469.

Facts about three.js r164 that this job depends on. All were read from `node_modules/three/src`:

1. `Material.clone()` does **not** copy `onBeforeCompile` or `customProgramCacheKey`. They must be installed on each clone.
2. `Material.clone()` **does** copy `userData`, through JSON, so plain numbers survive.
3. `onBeforeCompile` runs once per material, even when the compiled program is shared, so per-material uniforms work with a shared program.
4. `textureGrad` is available: three compiles for GLSL ES 3.00.
5. `patchSinglePortalClipMaterial` **overwrites** `customProgramCacheKey`. If it keeps doing that, a patched floor and an unpatched material with
   the same parameters share one program and one of them draws wrongly. Step 2.3 fixes this. Do not skip it.
6. The clip patch replaces the tokens `#include <common>`, `#include <begin_vertex>`, `#include <project_vertex>` and `void main() {`, so the floor patch must
   leave these tokens in place.

## Decisions

1. **Rigid patches, not reduced-basis UVs or metric UVs.** See the table in issue 95.
2. **Anchors are the tile lattice** (u/nU, v/nV). Every anchor's UV is then an integer, so no per-anchor UV offset exists. Do not add one.
3. **Constants:** radius factor 1.25, kernel exponent 16, relative floor 0.02. They were chosen in the prototype. Do not tune them; if the look is wrong,
   say so under `### Uncertain`.
4. **Skip a patch only when its weight is exactly 0 after subtracting the relative floor.** Never use an absolute threshold: kernel values go as low as 8e-8.
5. **One shader for every state, including rest.** No uniform switch for the rest state; it would compile nothing less and adds a code path.
6. **Keep `floorLatticeUv` and the `uv` attribute.** Three needs a `uv` attribute when a map is set. The patched shader ignores it.
7. **The TypeScript function `floorPatchSamples` is the specification of the shader.** All properties are tested on it. The GLSL transcribes it line by line.
8. **Field lives in `material.userData.floorPatchField`,** so it survives `clone()` and needs no new option through `collectCellArchetypeSources`.
9. **Step option:** replace `maxStepMeters` by `maxTeichmullerStep` everywhere, with default 1/375. Do not keep both: the maintainer's rule is that unreachable code is deleted.
10. **Straight segment in (w, a, b)**, not the hyperbolic geodesic (issue 95, part 2).
11. **Sameness ignores orientation.** Compare |Re tau*| and Im tau*, tolerance 1e-6.
12. **Latin text only** on the palette page. Write "Dehn twist", not Greek letters.
13. **The start of the comparison** is the session's initial deformation, not the base spec.

## Steps

Run `npm run typecheck` after each step and the named tests after each stage. Commit after each stage.

### Stage 1: lattice reduction and the patch field (pure code)

**1.1** Create `src/math/latticeReduction.ts`:

```ts
/**
 * Lagrange-Gauss reduction of a plane lattice basis and the lattice's covering radius.
 * A reduced basis (first, second) has |first| <= |second| and |first . second| <= |first|^2 / 2, so it is the shortest basis of the lattice.
 * The result depends on the lattice up to signs and ties; callers must use it only for quantities that do not depend on the choice of basis.
 */

/** A vector of the plane. */
export interface LatticeVector {
  readonly x: number;
  readonly y: number;
}

/** A reduced basis of a plane lattice. */
export interface ReducedLatticeBasis {
  readonly first: LatticeVector;
  readonly second: LatticeVector;
}

const maxReductionSteps = 64;

/** Reduces the basis (u, v), which must be linearly independent. */
export function reduceLatticeBasis(u: LatticeVector, v: LatticeVector): ReducedLatticeBasis {
  let first = u;
  let second = v;
  for (let step = 0; step < maxReductionSteps; step += 1) {
    if (dot(first, first) > dot(second, second)) {
      [first, second] = [second, first];
    }
    const multiple = Math.round(dot(first, second) / dot(first, first));
    if (multiple === 0) {
      break;
    }
    second = { x: second.x - multiple * first.x, y: second.y - multiple * first.y };
  }
  return { first, second };
}

/** Distance from the farthest point of the plane to the nearest lattice point, for a reduced basis: the circumradius of its non-obtuse triangle. */
export function latticeCoveringRadius(basis: ReducedLatticeBasis): number {
  const { first } = basis;
  const second = dot(first, basis.second) < 0 ? { x: -basis.second.x, y: -basis.second.y } : basis.second;
  const sideA = Math.hypot(first.x, first.y);
  const sideB = Math.hypot(second.x, second.y);
  const sideC = Math.hypot(second.x - first.x, second.y - first.y);
  const doubleArea = Math.abs(first.x * second.y - first.y * second.x);
  return (sideA * sideB * sideC) / (2 * doubleArea);
}

function dot(left: LatticeVector, right: LatticeVector): number {
  return left.x * right.x + left.y * right.y;
}
```

`Math.round(-0.5)` is `-0` and `-0 === 0` is true, so the loop ends on an exact tie. Leave it.

**1.2** In `src/cell-complex/floorUv.ts`:

Add to `FloorLatticeUvFrame`:

```ts
  /** Lattice vector u of the base (undeformed) state, which fixes the shape of a rigid floor patch. */
  readonly restU: { readonly x: number; readonly y: number };
  /** Lattice vector v of the base (undeformed) state. */
  readonly restV: { readonly x: number; readonly y: number };
```

Add the following, and extend the module header with one paragraph: rigid patches, why the UV has no per-anchor offset, and that `floorPatchSamples` is the
specification of the shader in `src/render/three/floorPatchMaterial.ts`.

```ts
import { latticeCoveringRadius, reduceLatticeBasis } from "../math/latticeReduction";

const floorPatchRadiusFactor = 1.25;
const floorPatchRelativeWeightFloor = 0.02;

/** Plain numbers that describe the rigid floor patches of one state; JSON-safe, because it travels in `material.userData`. */
export interface FloorPatchField {
  /** Anchor (0, 0), cell-local meters. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Reduced basis of the anchor lattice, meters. */
  readonly step1: { readonly x: number; readonly y: number };
  readonly step2: { readonly x: number; readonly y: number };
  /** Rows of the inverse of the matrix with columns step1, step2. */
  readonly inverseRow1: { readonly x: number; readonly y: number };
  readonly inverseRow2: { readonly x: number; readonly y: number };
  /** Rows of the constant map from meters to UV, taken from the base state. */
  readonly metersToUvRow1: { readonly x: number; readonly y: number };
  readonly metersToUvRow2: { readonly x: number; readonly y: number };
  /** 1 / R^2, with R the patch radius in meters. */
  readonly inverseRadiusSquared: number;
}

/** One patch that contributes to a floor point: its UV there and its normalized weight. */
export interface FloorPatchSample {
  readonly uv: readonly [number, number];
  readonly weight: number;
}

/** Builds the patch field of a frame; see the module header. */
export function floorPatchField(frame: FloorLatticeUvFrame): FloorPatchField {
  const anchorU = { x: frame.u.x / frame.tilesAlongU, y: frame.u.y / frame.tilesAlongU };
  const anchorV = { x: frame.v.x / frame.tilesAlongV, y: frame.v.y / frame.tilesAlongV };
  const basis = reduceLatticeBasis(anchorU, anchorV);
  const radius = floorPatchRadiusFactor * latticeCoveringRadius(basis);
  const inverse = inverseRows(basis.first, basis.second);
  const metersToUv = inverseRows(
    { x: frame.restU.x / frame.tilesAlongU, y: frame.restU.y / frame.tilesAlongU },
    { x: frame.restV.x / frame.tilesAlongV, y: frame.restV.y / frame.tilesAlongV },
  );
  return {
    origin: frame.origin,
    step1: basis.first,
    step2: basis.second,
    inverseRow1: inverse.row1,
    inverseRow2: inverse.row2,
    metersToUvRow1: metersToUv.row1,
    metersToUvRow2: metersToUv.row2,
    inverseRadiusSquared: 1 / (radius * radius),
  };
}

/**
 * The patches that paint a floor point, with weights summing to 1. This is the specification of the floor shader: change them together.
 */
export function floorPatchSamples(field: FloorPatchField, point: { readonly x: number; readonly y: number }): readonly FloorPatchSample[] {
  const offsetX = point.x - field.origin.x;
  const offsetY = point.y - field.origin.y;
  const centerM = Math.floor(field.inverseRow1.x * offsetX + field.inverseRow1.y * offsetY + 0.5);
  const centerN = Math.floor(field.inverseRow2.x * offsetX + field.inverseRow2.y * offsetY + 0.5);
  const candidates: { readonly toPointX: number; readonly toPointY: number; readonly kernel: number }[] = [];
  let maxKernel = 0;
  for (let index = 0; index < 9; index += 1) {
    const m = centerM + (index % 3) - 1;
    const n = centerN + Math.floor(index / 3) - 1;
    const toPointX = offsetX - m * field.step1.x - n * field.step2.x;
    const toPointY = offsetY - m * field.step1.y - n * field.step2.y;
    const falloff = Math.max(1 - (toPointX * toPointX + toPointY * toPointY) * field.inverseRadiusSquared, 0);
    const kernel = falloff ** 16;
    candidates.push({ toPointX, toPointY, kernel });
    maxKernel = Math.max(maxKernel, kernel);
  }
  const weightFloor = floorPatchRelativeWeightFloor * maxKernel;
  const kept = candidates.filter((candidate) => candidate.kernel > weightFloor);
  const weightSum = kept.reduce((sum, candidate) => sum + candidate.kernel - weightFloor, 0);
  return kept.map((candidate) => ({
    uv: [
      field.metersToUvRow1.x * candidate.toPointX + field.metersToUvRow1.y * candidate.toPointY,
      field.metersToUvRow2.x * candidate.toPointX + field.metersToUvRow2.y * candidate.toPointY,
    ],
    weight: (candidate.kernel - weightFloor) / weightSum,
  }));
}

// Rows of the inverse of the 2x2 matrix with the given columns.
function inverseRows(
  column1: { readonly x: number; readonly y: number },
  column2: { readonly x: number; readonly y: number },
): { readonly row1: { readonly x: number; readonly y: number }; readonly row2: { readonly x: number; readonly y: number } } {
  const determinant = column1.x * column2.y - column2.x * column1.y;
  return {
    row1: { x: column2.y / determinant, y: -column2.x / determinant },
    row2: { x: -column1.y / determinant, y: column1.x / determinant },
  };
}
```

**1.3** In `floorUvFrames` (`torusSkewDeformation.ts`), add `restU: baseFrame.u` and `restV: baseFrame.v` to the returned frame. Update the module header sentence
about the floor UV frame: the floor is painted by rigid patches anchored on the tile lattice.

**1.4** Add `restU` and `restV` to the frame literals in these tests, each equal to the same frame's `u` and `v`: `tests/cell-complex/floorUv.test.ts`, `tests/render/buildCellMesh.test.ts`,
`tests/render/cellRenderArchetypes.test.ts`. Record this under `### Deviations`.

**1.5** Add the tests of "Stage 1 tests" below. Run:

```bash
npx vitest run tests/math/latticeReduction.test.ts tests/cell-complex/floorUv.test.ts tests/cell-complex/torusSkewDeformation.test.ts
```

### Stage 2: the floor shader

**2.1** Create `src/render/three/floorPatchMaterial.ts`. Header comment: what the patch does, that `floorPatchSamples` in `floorUv.ts` is its specification, and fact 1 of
the Background (it must run on each clone). The file exports only `patchFloorPatchMaterial`.

```ts
import * as THREE from "three";
import type { FloorPatchField } from "../../cell-complex/floorUv";

const vertexDeclarations = "varying vec2 vFloorPatchPoint;";

const fragmentDeclarations = [
  "varying vec2 vFloorPatchPoint;",
  "uniform vec2 floorPatchOrigin;",
  "uniform vec2 floorPatchStep1;",
  "uniform vec2 floorPatchStep2;",
  "uniform vec2 floorPatchInverseRow1;",
  "uniform vec2 floorPatchInverseRow2;",
  "uniform vec2 floorPatchMetersToUvRow1;",
  "uniform vec2 floorPatchMetersToUvRow2;",
  "uniform float floorPatchInverseRadiusSquared;",
].join("\n");

// Transcribes floorPatchSamples. Patch UVs differ by constants, so all patches share one gradient; textureGrad keeps mipmapping valid inside the branch.
const fragmentColor = /* glsl */ `
#ifdef USE_MAP
  vec2 floorPatchPointDx = dFdx(vFloorPatchPoint);
  vec2 floorPatchPointDy = dFdy(vFloorPatchPoint);
  vec2 floorPatchUvDx = vec2(dot(floorPatchMetersToUvRow1, floorPatchPointDx), dot(floorPatchMetersToUvRow2, floorPatchPointDx));
  vec2 floorPatchUvDy = vec2(dot(floorPatchMetersToUvRow1, floorPatchPointDy), dot(floorPatchMetersToUvRow2, floorPatchPointDy));
  vec2 floorPatchOffset = vFloorPatchPoint - floorPatchOrigin;
  vec2 floorPatchCenter = floor(vec2(dot(floorPatchInverseRow1, floorPatchOffset), dot(floorPatchInverseRow2, floorPatchOffset)) + 0.5);
  float floorPatchKernels[9];
  vec2 floorPatchToPoints[9];
  float floorPatchMaxKernel = 0.0;
  for (int index = 0; index < 9; index++) {
    float m = floorPatchCenter.x + float(index % 3) - 1.0;
    float n = floorPatchCenter.y + float(index / 3) - 1.0;
    vec2 toPoint = floorPatchOffset - m * floorPatchStep1 - n * floorPatchStep2;
    float falloff = max(1.0 - dot(toPoint, toPoint) * floorPatchInverseRadiusSquared, 0.0);
    float falloff2 = falloff * falloff;
    float falloff4 = falloff2 * falloff2;
    float falloff8 = falloff4 * falloff4;
    float kernel = falloff8 * falloff8;
    floorPatchKernels[index] = kernel;
    floorPatchToPoints[index] = toPoint;
    floorPatchMaxKernel = max(floorPatchMaxKernel, kernel);
  }
  float floorPatchWeightFloor = 0.02 * floorPatchMaxKernel;
  vec4 floorPatchColor = vec4(0.0);
  float floorPatchWeightSum = 0.0;
  for (int index = 0; index < 9; index++) {
    float weight = floorPatchKernels[index] - floorPatchWeightFloor;
    if (weight > 0.0) {
      vec2 toPoint = floorPatchToPoints[index];
      vec2 patchUv = vec2(dot(floorPatchMetersToUvRow1, toPoint), dot(floorPatchMetersToUvRow2, toPoint));
      floorPatchColor += weight * textureGrad(map, patchUv, floorPatchUvDx, floorPatchUvDy);
      floorPatchWeightSum += weight;
    }
  }
  diffuseColor *= floorPatchColor / floorPatchWeightSum;
#endif
`;

/**
 * Installs the rigid floor patches on a material whose `userData.floorPatchField` is set, and leaves any other material alone. Call it on each clone, before
 * `patchPortalClipMaterial`.
 */
export function patchFloorPatchMaterial<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  const field = material.userData.floorPatchField as FloorPatchField | undefined;
  if (!field) {
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.floorPatchOrigin = { value: new THREE.Vector2(field.origin.x, field.origin.y) };
    shader.uniforms.floorPatchStep1 = { value: new THREE.Vector2(field.step1.x, field.step1.y) };
    shader.uniforms.floorPatchStep2 = { value: new THREE.Vector2(field.step2.x, field.step2.y) };
    shader.uniforms.floorPatchInverseRow1 = { value: new THREE.Vector2(field.inverseRow1.x, field.inverseRow1.y) };
    shader.uniforms.floorPatchInverseRow2 = { value: new THREE.Vector2(field.inverseRow2.x, field.inverseRow2.y) };
    shader.uniforms.floorPatchMetersToUvRow1 = { value: new THREE.Vector2(field.metersToUvRow1.x, field.metersToUvRow1.y) };
    shader.uniforms.floorPatchMetersToUvRow2 = { value: new THREE.Vector2(field.metersToUvRow2.x, field.metersToUvRow2.y) };
    shader.uniforms.floorPatchInverseRadiusSquared = { value: field.inverseRadiusSquared };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
      // A floor vertex is (x, 0, -y) in the cell's Three.js frame, already baked into the geometry.
      .replace("#include <begin_vertex>", "vFloorPatchPoint = vec2(position.x, -position.z);\n#include <begin_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragmentDeclarations}`)
      .replace("#include <map_fragment>", fragmentColor);
  };
  material.customProgramCacheKey = () => "floor-rigid-patches:";
  material.needsUpdate = true;
  return material;
}
```

**2.2** `src/render/three/buildCellMesh.ts`, in `buildFloorMesh`: in the branch `if (texture) {`, add after `material.map = texture;`:

```ts
if (floorUvFrame) {
  material.userData.floorPatchField = floorPatchField(floorUvFrame);
}
```

Import `floorPatchField` with the other `floorUv` imports. Update the module header: lattice frames also give the rigid floor patches.

**2.3** `src/render/three/portalClipMaterial.ts`, in `patchSinglePortalClipMaterial`, keep any earlier key:

```ts
const previousProgramKey =
  material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
material.customProgramCacheKey = () =>
  `${previousProgramKey}portal-clip-planes:${state.clipData.maxClipTextureEyes}:${state.hardwareClipDistances ? "hw" : "frag"}`;
```

Read `previousProgramKey` **before** the assignment. The existing `endsWith` test at `tests/render/portalClipMaterial.test.ts` keeps passing.

**2.4** `src/render/three/cellRenderArchetypes.ts`, in `cloneMaterial`, patch every clone before clipping:

```ts
if (Array.isArray(material)) {
  const cloned = material.map((entry) => patchFloorPatchMaterial(entry.clone()));
  return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
}

const cloned = patchFloorPatchMaterial(material.clone());
return portalClipMaterialState ? patchPortalClipMaterial(cloned, portalClipMaterialState) : cloned;
```

Both the instanced material and the root material go through this function, so both are patched. That matters: the room you stand in is drawn by the root mesh.

**2.5** Add the tests of "Stage 2 tests". Run:

```bash
npx vitest run tests/render/floorPatchMaterial.test.ts tests/render/portalClipMaterial.test.ts tests/render/cellRenderArchetypes.test.ts tests/render/buildCellMesh.test.ts
npm run smoke -- --world torus-moduli
```

The smoke run is the first time the GLSL is compiled. A shader error appears in the browser console; fix it before going on. Unit tests do not compile GLSL.

**2.6** Visual check. In two terminals: `npm run serve` and `npm run edge -- --world torus-moduli`. See `_docs/interactive-browser-debugging.md`. Then:

```bash
npm run cdp -- shot .temp/job67-rest.png
npm run cdp -- call geometry.setTorusSkew 15
```

Wait until `npm run cdp -- call geometry.state` shows `current` equal to `target` (about 40 s), and take `.temp/job67-a15.png`. The player is carried too, so the two views differ: do not expect equal images. Pebbles must have the same
size and shape in both, and the exact equality of the floors is what test 5 pins. Then repeat at a = 8. Pebbles must keep their shape, and no line may appear where the room's portals are. If you cannot run a browser, say so under `### Uncertain`.

### Stage 3: Teichmuller steps

First check the gate under `## Depends on`.

**3.1** `src/cell-complex/worldGeometryDeformations.ts`: in `DynamicGeometryStepOptions`, replace `maxStepMeters` with:

```ts
  /**
   * Maximum Teichmuller length of one step, ds = |d tau| / (2 Im tau). It bounds the dilatation of a commit's map by about e^(2 * maxTeichmullerStep).
   */
  readonly maxTeichmullerStep: number;
```

Add next to it:

```ts
/** Default step: today's worst case (0.04 m at b = 7.5 m), so no commit distorts more than before and no sweep is slower. */
export const defaultMaxTeichmullerStep = 1 / 375;
```

**3.2** `nextTorusSkewStep`: replace the first line and use the allowed length:

```ts
// With tau = (a + ib)/w, a step of s meters has Teichmuller length s / (2b), so the allowed length in meters is 2 b maxTeichmullerStep.
const maxStepMeters = 2 * current.depthMeters * Math.max(0, options.maxTeichmullerStep);
```

The rest of the function stays. Update its JSDoc and the module header ("by at most maxStepMeters per rebuild").

**3.3** `src/runtime/worldGeometrySession.ts`: `defaultStepOptions` becomes `{ maxTeichmullerStep: defaultMaxTeichmullerStep, snapToleranceMeters: 1e-6 }`. Update the header line ("at most maxStepMeters,
default 0.08 m") and the `stepOptions` JSDoc.

**3.4** `src/render/three/createThreeApp.ts`: delete the whole `stepOptions: { ... }` argument of `createWorldGeometrySession`. The default is now the same value.

**3.5** Migrate the tests. This is a change of existing tests that this job orders; record it under `### Deviations`.

- `tests/cell-complex/torusSkewDeformation.test.ts`, `runSteps`: `const options = { maxTeichmullerStep: 1 / 375 };` and
  `expect(moved).toBeLessThanOrEqual((2 * state.depthMeters) / 375 + 1e-12);`
- `tests/runtime/worldGeometrySession.test.ts`: at b = 15 the old `0.05` m is `maxTeichmullerStep: 1 / 600`, and the old `1` m is `1 / 30`. Update the helper's default and type
  (`createTestSession`). Rename the test to "advances torus skew by one Teichmuller step per committed snapshot". If exact `toMatchObject` values fail by rounding, replace only
  those with `toBeCloseTo(value, 9)`.
- `tests/app/torusDeformation.release.test.ts`: only the comments that say 0.08 m. The scenario still holds.

**3.6** Add the tests of "Stage 3 tests". Run `npx vitest run tests/cell-complex/torusSkewDeformation.test.ts tests/runtime/worldGeometrySession.test.ts`.

### Stage 4: the moduli readout

**4.1** Create `src/cell-complex/deformations/torusModuli.ts` (with a header comment):

```ts
import { reduceLatticeBasis } from "../../math/latticeReduction";

const moduliTolerance = 1e-6;

/** Named shape of a flat torus. */
export type TorusShape = "square" | "hexagonal" | "rectangular" | "rhombic" | "oblique";

/** The modulus of a flat torus folded to the fundamental domain, ignoring orientation: 0 <= re <= 1/2, re^2 + im^2 >= 1. */
export interface TorusModulus {
  readonly re: number;
  readonly im: number;
}

/** The (a, b) parameters of a torus of width w. */
export interface TorusLatticeParameters {
  readonly widthMeters: number;
  readonly skewXMeters: number;
  readonly depthMeters: number;
}

/** Reduces tau = (a + ib)/w. */
export function reducedTorusModulus(parameters: TorusLatticeParameters): TorusModulus {
  const { first, second } = reduceLatticeBasis(
    { x: parameters.widthMeters, y: 0 },
    { x: parameters.skewXMeters, y: parameters.depthMeters },
  );
  const lengthSquared = first.x * first.x + first.y * first.y;
  return {
    re: Math.abs(first.x * second.x + first.y * second.y) / lengthSquared,
    im: Math.abs(first.x * second.y - first.y * second.x) / lengthSquared,
  };
}

/** Names the shape of a reduced modulus. */
export function torusShape(modulus: TorusModulus): TorusShape {
  const onCircle = Math.abs(modulus.re * modulus.re + modulus.im * modulus.im - 1) <= moduliTolerance;
  const onAxis = modulus.re <= moduliTolerance;
  const onEdge = Math.abs(modulus.re - 0.5) <= moduliTolerance;
  if (onAxis && onCircle) return "square";
  if (onEdge && onCircle) return "hexagonal";
  if (onAxis) return "rectangular";
  if (onCircle || onEdge) return "rhombic";
  return "oblique";
}

/** One line for the geometry computer: how a torus relates to the torus the world started with. */
export function describeTorusRelation(state: TorusLatticeParameters, start: TorusLatticeParameters): string {
  const sameWidth = Math.abs(state.widthMeters - start.widthMeters) <= moduliTolerance;
  const sameDepth = Math.abs(state.depthMeters - start.depthMeters) <= moduliTolerance;
  const twists = (state.skewXMeters - start.skewXMeters) / state.widthMeters;
  if (sameWidth && sameDepth && Math.abs(twists - Math.round(twists)) <= moduliTolerance) {
    const count = Math.abs(Math.round(twists));
    if (count === 0) return "This is the starting torus.";
    return `Same flat torus as the start: ${count} Dehn twist${count === 1 ? "" : "s"}.`;
  }
  const modulus = reducedTorusModulus(state);
  const startModulus = reducedTorusModulus(start);
  const same =
    Math.abs(modulus.re - startModulus.re) <= moduliTolerance && Math.abs(modulus.im - startModulus.im) <= moduliTolerance;
  return same ? "Same flat torus as the start, marked differently." : "A different flat torus from the start.";
}
```

**4.2** Give the page the start. In `src/runtime/worldGeometrySession.ts`, add to `LiveGeometryDebugState`:

```ts
  /** State the session started from; the geometry computer compares the torus with it. */
  readonly initial: WorldDeformationState;
```

and return `initial: options.initialSnapshot.deformation` from `session.state`.

Then search for `targetDepthMeters` in `src/`, and next to **each** type or copy of it in `src/runtime/runtimeCommands.ts` and `src/runtime/runtimeMenuState.ts` add `startSkewXMeters` and `startDepthMeters`
in the same way. `applyRuntimeCommand.ts` spreads the payload and needs no change. In `createGeometryComputerMenuOptions` set them from `state.initial` when its kind is `torus-skew`.

**4.3** `src/ui/paletteDefinition.ts`: add to `GeometryComputerActionsPaletteContent`:

```ts
  /** Shape and relation to the start of the current torus; empty when unavailable. */
  readonly currentModuliLabel: string;
  /** Shape and relation to the start of the target torus; empty when unavailable. */
  readonly targetModuliLabel: string;
```

In `createGeometryComputerActionsContent` build both with one local helper:

```ts
function formatTorusModuliLabel(
  prefix: string,
  state: TorusLatticeParameters,
  start: TorusLatticeParameters,
): string {
  const modulus = reducedTorusModulus(state);
  return `${prefix}: ${torusShape(modulus)}, modulus ${modulus.re.toFixed(2)} + ${modulus.im.toFixed(2)}i. ${describeTorusRelation(state, start)}`;
}
```

Use the unrounded `options.currentSkewXMeters` and `options.currentDepthMeters` for the current label, and `targetA` and `targetB` for the target. The start is `options.startSkewXMeters` and `options.startDepthMeters`,
falling back to the current values. When `available` is false, both labels are `""`.

**4.4** `src/render/three/palette/pages/geometryComputer.ts`: after the existing coordinate `Text`, add two `Text` items with the same props showing `content.currentModuliLabel` and `content.targetModuliLabel`. Use
`#f8fafc` for current and `#34d399` for target: these are the diagram's colours. Raise the panel's `minHeight` if the layout overflows.

**4.5** `src/examples/torus-moduli.world.js`: change the end of the goal text to "Then use the computer to change the world deformation. Set A to 15 and watch the floor: it comes back, because that is the same torus."
`src/ui/helpLensDefinition.ts`, topic `geometry-computer`, both modes: "Changes the shape of the torus. It tells you when two settings are the same flat torus."

**4.6** Add the tests of "Stage 4 tests". Run `npx vitest run tests/cell-complex/torusModuli.test.ts tests/ui/paletteDefinition.test.ts tests/render/scenePaletteAdapter.test.ts`.

### Stage 5: documentation and closing

**5.1** `_docs/MATHEMATICAL_MODEL.md`, the paragraph **Floor texture**: replace the torus part. New content: anchors on the tile lattice, patch UV $G(p-A)$ with $G$ fixed from the base state, the blend formula, seamlessness and the
Dehn-twist property, and that the floor is carried at patch level only. Reference `src/cell-complex/floorUv.ts#floorPatchSamples`. Add one sentence on steps: Teichmuller length, `defaultMaxTeichmullerStep`.

**5.2** `tests/manual_smoke.md`, M11, **Judge**: add "In `torus-moduli`, at A = 15 the floor is the rest floor; at every other setting pebbles keep their shape, and blend bands are narrow and show no seam at the room's edges."

**5.3** Add a dated note at the top of `_issues/_closed/81_floor_texture_slides_under_objects_during_deformation.md`: "Issue 95 replaced whole-floor lattice UVs by rigid patches: the floor is now carried at patch level, not at every point."

**5.4** Close issue 95 per `.agents/jobs/README.md`, except part 4: move it only when no `### Uncertain` or `### Not done` remains, and say in `## Outcome` that part 4 stays with job 35.

## Tests and checks

Use a shared helper `frameAt(a, b)` built from `createTorusSkewDeformationFamily().floorUvFrames!(torusModuli, skewState)` in the existing style of `tests/cell-complex/torusSkewDeformation.test.ts`, and
`const mod1 = (x: number) => x - Math.floor(x);` with a circular difference `Math.min(d, 1 - d)` when comparing UVs modulo 1. States used below: `[0,15], [4,15], [9,20], [15,15], [20,12], [30,7.5], [0,30], [0,7.5]`.
Points: a fixed grid over [-11, 11]^2 with step 1.37, which avoids symmetric points.

### Stage 1 tests

New `tests/math/latticeReduction.test.ts`:

1. "reduces the skewed torus bases": u = (15, 0) with v = (30, 7.5) gives lengths 7.5 and 15; with v = (23, 9) gives (up to sign) (-7, 9) and (8, 9); with v = (15, 15) gives lengths 15 and 15.
2. "keeps the area and the reduction conditions": for the states above, |det| is unchanged, `|first| <= |second|`, and `2 |first . second| <= |first|^2` (+ 1e-9).
3. "computes the covering radius": square of side 2 gives sqrt(2); rectangle 1.25 by 2.5 gives 1.3975 to 1e-4; hexagonal of side 1 gives 1/sqrt(3).

In `tests/cell-complex/floorUv.test.ts`:

4. "paints the rest floor at rest": at [0,15], for every point, every sample's UV equals `floorLatticeUv(frame, p)` modulo 1, to 1e-9.
5. "paints the rest floor again after a Dehn twist": for [15,15] and [30,15], the samples at p, sorted by weight, match those of the rest state at p: same weights to 1e-9 and same UV modulo 1 to 1e-9.
6. "keeps patches rigid at every state": (a) `metersToUvRow1` and `metersToUvRow2` are identical for all states; (b) at each state and point whose largest weight is above 0.9 at both p and p + (0.01, 0), the UV of
   the largest-weight sample changes by exactly 0.01 times the first column of the metersToUv matrix, to 1e-9.
7. "is seamless across u and v": for all states and points, samples at p and p + u, and at p and p + v, have the same weights and the same UVs modulo 1, to 1e-9, when sorted by weight.
8. "always paints every point": samples are non-empty and weights sum to 1 to 1e-9 for all states and points.
9. "finds every patch that the blend needs": for all states and points, compare against a brute force over m, n in -40..40 with the same kernel: the largest kernel and the sum of kernels above the relative floor are equal to 1e-12. **This test pins the 3 x 3 search.**
10. "does not change at a reduced-basis switch": at a = 7.5 - 1e-7 and 7.5 + 1e-7 with b = 15, and likewise at a = 22.5, sorted weights differ by less than 1e-3.

In `tests/cell-complex/torusSkewDeformation.test.ts`:

11. "gives the base state's vectors as the rest frame": `frame(trap).restU` and `restV` equal (15, 0) and (0, 15). Existing floor tests stay as they are.

### Stage 2 tests

New `tests/render/floorPatchMaterial.test.ts`, with a fake shader `{ uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>\nvoid main() {", fragmentShader: "#include <common>\n#include <map_fragment>\nvoid main() {" }` and a call of `material.onBeforeCompile(shader, renderer)`:

12. "leaves a material without a field alone": `onBeforeCompile` and the key are those of a new material.
13. "installs uniforms and replaces the map chunk": all 8 uniforms exist with the field's numbers; the fragment shader contains `textureGrad` and no `#include <map_fragment>`.
14. "keeps the tokens that the clip patch needs": after the patch, `#include <common>`, `#include <begin_vertex>`, `#include <project_vertex>` and `void main() {` are all still present.
15. "survives clone through userData": a material with `userData.floorPatchField`, cloned and patched, has working uniforms. Without patching, the clone's key is the default one (this pins fact 1).

In `tests/render/portalClipMaterial.test.ts`:

16. "keeps an earlier program key": a material with `customProgramCacheKey = () => "earlier:"` keeps it as a prefix after patching; a plain material's key has no prefix.

In `tests/render/cellRenderArchetypes.test.ts`, extending the frame test:

17. "patches both floor materials": the floor archetype's `mesh.material` and `rootMesh.material` both have a key containing `floor-rigid-patches`, the mesh's key also contains `portal-clip-planes`, and no other archetype's key contains `floor-rigid-patches`.

In `tests/render/buildCellMesh.test.ts`:

18. "stores the patch field only for a textured floor with a frame": present with a frame; absent without one, and absent for a colour floor.

### Stage 3 tests

In `tests/cell-complex/torusSkewDeformation.test.ts`:

19. "bounds the dilatation of every commit": walk from (0, 15) to (30, 7.5) with `nextTorusSkewStep` and `defaultMaxTeichmullerStep`. For each step let A be the linear map with A u = u', A v = v', and K from `K + 1/K = (sum of squares of A's entries) / det A`.
    Assert K <= e^(2.02 delta). The 1% is the second-order term of a first-order bound.
20. "steps twice as far at twice the depth": the first step from (0, 15) towards (30, 15) has length 0.08 to 1e-9, and from (0, 30) towards (30, 30) has length 0.16.

### Stage 4 tests

New `tests/cell-complex/torusModuli.test.ts`:

21. "reduces moduli": (a, b) = (0, 15) gives 0 + 1i; (15, 15) gives 0 + 1i; (30, 7.5) gives 0 + 2i; (7.5, 15) gives 0.5 + 1i.
22. "names shapes": (0, 15) square; (0, 30) rectangular; (7.5, 15 * sqrt(3) / 2) hexagonal; (30, 7.5) rectangular; (4, 15) oblique; (7.5, 20) rhombic.
23. "relates a torus to the start": with start (0, 15): (0, 15) gives "This is the starting torus."; (15, 15) gives "Same flat torus as the start: 1 Dehn twist."; (30, 15) gives "Same flat torus as the start: 2 Dehn twists."; (4, 15) gives
    "A different flat torus from the start.". With start (0, 7.5): state (30, 30) gives "Same flat torus as the start, marked differently." (both have modulus 0 + 2i).

In `tests/ui/paletteDefinition.test.ts`:

24. "shows the moduli of current and target": with current (0, 15), target (15, 15), start (0, 15), the content has `currentModuliLabel` containing "square" and "starting torus", and `targetModuliLabel` containing "1 Dehn twist". Unavailable content has empty labels.

### Final commands

```bash
npm run docs:generate
npm run typecheck
npm test
npm run docs:check
npm run smoke -- --world torus-moduli
npm run smoke -- --world cube
```

If `npm test` shows a test that compared `LiveGeometryDebugState` exactly, add `initial` there and record it.

Risky points:

- **Black floor.** `floorPatchWeightSum` is 0 only if `floorPatchMaxKernel` is 0, which means R is too small. Check `inverseRadiusSquared`.
- **The floor is right in the room but wrong through portals, or the reverse.** One of the two clones was not patched, or the program keys collide. See steps 2.3 and 2.4.
- **The floor looks mirrored or flipped compared with `main` at rest.** The sign of `position.z` in the vertex patch is wrong. At rest the floor must not change at all; compare with a `main` screenshot.
- **The floor is correct but seams appear at mip level changes.** The gradient was computed inside the branch. Compute it before the loops, as written.
- **`float(index % 3)` does not compile.** It is valid GLSL ES 3.00, so look for a `#version` problem first. If it stays a problem, unroll with `int column = index - 3 * (index / 3);`.
- **Slow frames.** Record the frame time at rest in `torus-moduli` before and after stage 2 with `npm run cdp -- record`, and report both numbers. Do not optimize in this job.

## Do not

- Do not change `floorLatticeUv`, tile counts or `tileSizeMeters`.
- Do not change how objects, the player or geodesics are carried.
- Do not change the footprint or use the reduced basis as the cell. That is job 35.
- Do not make the commit incremental or change texture caching. That is job 30.
- Do not touch portal wall textures. That is issue 90.
- Do not set `texture.anisotropy`, add normal maps or change `src/world-assets/floorTextures.ts`.
- Do not tune the three constants of Decision 3.
- Do not change the diagram in `latticeDiagram.ts`.

## Done when

- [ ] Tests 1 to 24 exist and pass; `npm run typecheck`, `npm test`, `npm run docs:check` pass; both smoke runs pass.
- [ ] `maxStepMeters` no longer appears in `src/` or `tests/` as an option. It may remain as a local variable in `nextTorusSkewStep`.
- [ ] The browser check of step 2.6 was done, or `### Uncertain` says why not. The maintainer's check of the look stays open either way: list it under `### Uncertain`, and set
  `Status: done, needs review on <date>.`
- [ ] Stage 5 is done, `_docs/generated/*` is regenerated, row 67 of `.agents/jobs/README.md` is updated, and this file has its `## Report` and has moved to `_done/` (fix its relative links: one more `../`).
- [ ] Commit per stage, for example `Floor: rigid patches on the tile lattice (job 67)`. Follow rule 6 of the README.
