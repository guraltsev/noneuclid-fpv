# Job 10 - Floor texture in lattice coordinates

Status: done, needs review on 2026-10-29.
Resolves: issue [81](../../../_issues/_closed/81_floor_texture_slides_under_objects_during_deformation.md).
Depends: [job 09](09_deformation_commit_safety.md).

## Goal

1. `tileSizeMeters` means what it says: a floor texture with tile size T repeats every T meters, in every world,
   whatever the cell size.
2. In the `torus-skew` family the floor texture is carried by the deformation exactly like the objects are: a floor
   point and an object at the same lattice coordinates keep the same texture coordinate across every commit, and the
   texture is seamless across every portal at every deformation.

## Depends on

[Job 09](09_deformation_commit_safety.md). After job 09, `validateTorusSkewBaseSpec` rejects any torus footprint that
is not `buildTorusParallelogramVertices(inferred)`, so the lattice frame `torusLatticeFrame(state)` is guaranteed to be
the frame of the floor that is actually drawn. Check that `.agents/jobs/_done/09_deformation_commit_safety.md` exists
before you start. If it does not, do not start this job; record that under `### Not done` and stop.

## Before you start

Read these, in this order. Line numbers are from commit `e094b82`; if they moved, search for the function name.

| File | Lines | What to look at |
| --- | --- | --- |
| `_issues/81_floor_texture_slides_under_objects_during_deformation.md` | all | The defect and acceptance criteria |
| `_docs/MATHEMATICAL_MODEL.md` | 27-55, 334-361 | Conventions; §9 live deformation |
| `src/render/three/buildCellMesh.ts` | 1-12, 31-81, 94-163 | `buildCellMesh`, `buildFloorMesh`, `floorTextureRepeat` |
| `src/render/three/cellRenderArchetypes.ts` | 1-11, 55-65, 77-118, 200-243, 305-320 | Options, `buildCellRenderArchetypes`, `collectCellArchetypeSources`, `cloneMaterial` |
| `src/render/three/preloadWorldAssets.ts` | 215-256 | `getConfiguredTexture` and its cache key |
| `src/render/three/runtimeSceneUtils.ts` | 77-96 | `disposeObject3D`, `disposeMaterial` (they do not dispose `map`) |
| `src/render/three/createThreeApp.ts` | 787-812, 1554-1594, 2341-2404 | Initial snapshot, commit, `rebuildCellMeshes` |
| `src/runtime/worldGeometryDeformations.ts` | 45-87 | `WorldDeformationFamily` interface |
| `src/runtime/worldGeometryDeformationFamilies.ts` | 89-131 | `createInitialWorldDeformationState`, static family |
| `src/runtime/deformations/torusSkewDeformation.ts` | 60-115, 137-168, 242-258, 338-374 | Family object, maps, inference, lattice frame |
| `src/world-assets/floorTextures.ts` | 1-130 | `defaultTileSizeMeters` table |
| `src/cell-complex/specs.ts` | 86-115 | `FloorMaterialSpec` |
| `src/examples/torus-moduli.world.js` | all | The world: 15 m square, `river_pebbles` floor |
| `tests/render-contract/buildCellMesh.test.ts` | 1-15, 268-308, 340-350 | Test style, `createPreparedAssets` |
| `tests/authoring/worldBuilder.test.ts` | 45-63 | Asserts `tileSizeMeters: 60` for `grass1` |
| `tests/runtime/torusSkewDeformation.test.ts` | all | Family tests, `skewState` helper |

Environment: Windows, run commands in Git Bash from the repository root.

Baseline, before you change anything:

```bash
npm run typecheck
npm test
```

Both must pass. If they do not, record the failing output under `### Checks` in `## Report` and continue only if
the failures are unrelated to the files of this job. Run one test file with `npx vitest run <path>`.

`npm test` includes `tests/docs/documentation.test.ts`. It fails when a new module has no header comment, when an
exported symbol has no JSDoc comment, when an import breaks the layer table (`layers` in `scripts/docs/lib.mjs`:
`cell-complex` may import only `math`; `runtime` may import `cell-complex`; `render` may import anything), or when
`_docs/generated/*` is out of date. After adding exports, run `npm run docs:generate`.

## Background

### How the floor is textured today

`buildFloorMesh` (`buildCellMesh.ts:95-148`) builds the floor from a `THREE.Shape` over `cell.baseVertices`:

```ts
const geometry = new THREE.ShapeGeometry(shape);   // :107
geometry.rotateX(-Math.PI / 2);                    // :108, (x, y, 0) -> (x, 0, -y)
...
const repeat = floorTextureRepeat(cell.baseVertices, cell.floorMaterial.tileSizeMeters);   // :120
const texture = assets.getConfiguredTexture({ ..., repeatX: repeat, repeatY: repeat, wrapS/T: RepeatWrapping, userData: { textureUrl, repeatX: repeat, repeatY: repeat } });
```

`ShapeGeometry` sets each vertex's UV to its raw (x, y) in meters (three.js `ShapeGeometry.js:110`,
`uvs.push( vertex.x, vertex.y ); // world uvs`). `floorTextureRepeat` (`buildCellMesh.ts:151-163`):

```ts
const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
return Math.max(span / tileSizeMeters, 0.01);
```

The texture coordinate of a point is (x, y)·repeat, so one tile is `tileSizeMeters / span` meters, not
`tileSizeMeters`. Measured over the shipped worlds (all cells, bounding-box span):

| Worlds | Span | Effective tile for T = 40 |
| --- | --- | --- |
| cube, basic cube, torus, torus-moduli | 15 m | 2.67 m |
| dodecahedron | 15.22 m | 2.63 m |
| tetrahedron, octahedron, icosahedron, basic tetrahedron | 23.09 m | 1.73 m |
| genus-2 torus (`paving_stones`, T = 32) | 133.04 m | 0.24 m |

In `torus-moduli` at a = 15 the footprint spans x ∈ [−15, 15], so the repeat doubles and the texture zooms by 2×
about the centre. The app steps by 0.04 m (`createThreeApp.ts:808-811`, `maxStepMeters: 0.04`), so the floor swims
continuously.

### How objects move in a commit

`createTorusSkewCellDeformationMaps` (`torusSkewDeformation.ts:137-168`) keeps lattice coordinates:

```ts
mapPoint(point) {
  const coordinates = latticeCoordinates(previousFrame, point);
  return vec3(nextFrame.origin.x + coordinates.alpha * nextFrame.u.x + coordinates.beta * nextFrame.v.x, ...);
}
```

with `torusLatticeFrame(state)` (`:338-350`): u = (w, 0), v = (a, b), origin o = −(u + v)/2. So an object at
p = o + α·u + β·v goes to o' + α·u' + β·v'. If the floor UV is a function of (α, β) only, the floor moves exactly
with the objects.

### Lattice UVs

Given a frame (o, u, v) and two positive integers nU, nV, the UV of a floor point p is

```text
d = p − o
det = u.x·v.y − u.y·v.x
α = (d.x·v.y − d.y·v.x) / det
β = (u.x·d.y − u.y·d.x) / det
uv = (nU·α, nV·β)
```

This is the inverse of the lattice frame applied to p, scaled by the tile counts. Crossing a portal adds u or v to
the point, i.e. adds 1 to α or β, i.e. adds the integer nU or nV to the UV. With `RepeatWrapping` an integer shift is
invisible, so there is no seam. nU and nV are chosen once, from the **base** (undeformed) state, so they never change
during a deformation:

```text
nU = max(1, round(|u_base| / T)),   nV = max(1, round(|v_base| / T))
```

At rest the tile is |u_base| / nU by |v_base| / nV meters, the nearest whole fraction of the lattice to T. During a
deformation the tiles shear and stretch with the lattice (that is honest: the Teichmüller map is not an isometry).

### Worked example (`torus-moduli`, after this job)

`river_pebbles` gets T = 2.667 m (see Decision 2). Base state w = b = 15, a = 0:
u = (15, 0), v = (0, 15), o = (−7.5, −7.5). nU = nV = round(15 / 2.667) = round(5.624) = 6, so at rest the tile is
2.5 m (today it is 2.67 m).

- Floor point p = (6, 3): d = (13.5, 10.5), det = 225, α = 13.5·15/225 = 0.9, β = 15·10.5/225 = 0.7,
  uv = (5.4, 4.2).
- Commit to a = 30, b = 7.5: u' = (15, 0), v' = (30, 7.5), o' = (−22.5, −3.75). `mapPoint(p)` =
  o' + 0.9·u' + 0.7·v' = (12, 1.5). Its UV in the new frame: d = (34.5, 5.25), det = 112.5,
  α = (34.5·7.5 − 5.25·30)/112.5 = 0.9, β = (15·5.25)/112.5 = 0.7, uv = (5.4, 4.2). Same UV: the pebble under the
  object stays under it.
- Seam: the point (0, −7.5) on side 0 has α = 0.5, β = 0 → uv (3, 0). Through the side-0 portal it is (0, 7.5) on
  side 2, α = 0.5, β = 1 → uv (3, 6). The difference (0, 6) is an integer.
- Today, by contrast, p = (6, 0) has texture coordinate 6·0.375 = 2.25 at rest and 6·0.75 = 4.5 at a = 15 (issue 81).

### Render pipeline facts

- `buildCellMesh` is only called from `collectCellArchetypeSources` (`cellRenderArchetypes.ts:200-243`). That clones
  the geometry and bakes the mesh's world matrix into it (`geometry.clone()` then `applyMatrix4`); the `uv` attribute
  is copied unchanged. Materials are cloned with `material.clone()` (`:305-320`), which keeps the same `map` texture
  object.
- `disposeCellRenderArchetypes` → `disposeMaterial` (`runtimeSceneUtils.ts:87-96`) never disposes `map`, so the
  cached texture survives a rebuild.
- `getConfiguredTexture` caches by `(assetPath, colorSpace, repeatX, repeatY, wrapS, wrapT, name, JSON(userData))`
  (`preloadWorldAssets.ts:222-238`). Today every commit asks for a new repeat, so every commit clones and uploads a
  new texture and the cache grows (part of issue 82). With repeat fixed at 1 every commit gets the same cached texture.
- `rebuildCellMeshes` (`createThreeApp.ts:2341-2404`) builds the archetypes with `buildCellRenderArchetypes(activeWorld(), {...})`
  at `:2382`. It runs at startup (`:1086`), after each commit (`:1574`, after `activeWorldBundle` is swapped) and on
  debug changes (`:1805`).
- The startup snapshot uses the **base** spec (`createThreeApp.ts:788-792`) but its `deformation` is
  `createInitialWorldDeformationState(options.worldSpec)`, which is a `torus-skew` state for torus worlds. So a policy
  computed from `(baseSpec, snapshot.deformation)` is available from the first frame, and the floor does not jump at
  the first commit.

## Decisions

1. **Where the UV policy lives.** Decided: an optional method on the deformation family,
   `floorUvFrames?(baseSpec, state): ReadonlyMap<string, FloorLatticeUvFrame>`, implemented only by `torus-skew`. The
   renderer asks the active family in `rebuildCellMeshes` and passes the frame of each cell down to `buildCellMesh`.
   Cells without a frame use metric UVs. The UV maths lives in a new pure module `src/cell-complex/floorUv.ts`.
   Why: `buildCellMesh` stays free of torus knowledge (issue 81 §Proposed change 3); the method is optional, so the
   static family needs no change; `cell-complex` is importable from both `runtime` and `render`. Alternative
   considered: store the frame in the deformed spec's floor material inside `applyToSpec`; rejected because the
   startup snapshot uses the base spec, which never goes through `applyToSpec`, so the floor would jump at the first
   commit.
2. **Tile-size semantics and the shipped look.** Decided: T = `tileSizeMeters` is a true period in meters (metric UV
   = (x/T, y/T), texture repeat 1), and every `defaultTileSizeMeters` in `src/world-assets/floorTextures.ts` is
   divided by 15 (table in step 6). Why: issue 81 requires "tileSize 4 gives a 4 m period"; the shipped values were
   tuned for 15 m cells under the old formula, so dividing by 15 keeps the cube, dodecahedron and torus worlds looking
   as they do now (to within 0.02%). Side effects, accepted: tiles in the 23.09 m triangle worlds become 1.54× larger,
   and the genus-2 torus floor goes from 0.24 m to 2.13 m tiles (it was far too fine). Alternative considered: keep
   the old values and the new meaning; the cube and torus floors would become 15× coarser.
3. **Tile counts.** Decided: nU = max(1, round(|u_base| / T)), nV = max(1, round(|v_base| / T)), computed from the
   base state inferred from the base spec, fixed for the life of the session. Why: integers make the floor seamless
   across portals; fixing them makes the UV a function of (α, β) only. Alternative considered: recompute from the
   current state; then the tile count jumps during a deformation and the floor slides again.
4. **Frame at rest.** Decided: the torus family returns a frame for every state including the rest state, so the
   torus floor always uses lattice UVs (2.5 m tiles in `torus-moduli`), never metric ones. Why: no jump at the first
   commit. Alternative considered: metric UVs at rest; there would be a visible jump from 2.67 m to 2.5 m tiles at the
   first commit.
5. **Colour-only floors.** Decided: write metric UVs with T = 1 for `floor-color` cells too. Why: one code path;
   the UVs are unused when there is no map. Alternative considered: skip the UV write; more branches for no gain.
6. **Texture request.** Decided: always request `repeatX: 1, repeatY: 1` (and `userData` with the same values) and
   delete `floorTextureRepeat`. Why: the scale now lives in the UVs; a constant request also hits the texture cache on
   every commit. Alternative considered: keep a repeat factor of 1/T with UV in meters; that couples the texture cache
   key to T again and spreads the scale over two places.

## Steps

Run `npm run typecheck` after each step.

1. Create `src/cell-complex/floorUv.ts` (imports nothing). Start it with a module header comment explaining metric
   and lattice floor UVs (copy the formulas from §Background). Exports, each with JSDoc:

   ```ts
   /** A lattice frame for floor UVs: p = origin + alpha*u + beta*v (cell-local meters) and the tile counts per lattice vector. */
   export interface FloorLatticeUvFrame {
     readonly origin: { readonly x: number; readonly y: number };
     readonly u: { readonly x: number; readonly y: number };
     readonly v: { readonly x: number; readonly y: number };
     /** Positive integer number of texture tiles along u. */
     readonly tilesAlongU: number;
     /** Positive integer number of texture tiles along v. */
     readonly tilesAlongV: number;
   }

   /** UV (tilesAlongU*alpha, tilesAlongV*beta) of a cell-local floor point. */
   export function floorLatticeUv(frame: FloorLatticeUvFrame, point: { readonly x: number; readonly y: number }): readonly [number, number] {
     const dx = point.x - frame.origin.x;
     const dy = point.y - frame.origin.y;
     const det = frame.u.x * frame.v.y - frame.u.y * frame.v.x;
     const alpha = (dx * frame.v.y - dy * frame.v.x) / det;
     const beta = (frame.u.x * dy - frame.u.y * dx) / det;
     return [frame.tilesAlongU * alpha, frame.tilesAlongV * beta];
   }

   /** UV (x/T, y/T) of a cell-local floor point, so one texture tile is T meters; T <= 0 or non-finite is treated as 1. */
   export function floorMetricUv(point: { readonly x: number; readonly y: number }, tileSizeMeters: number): readonly [number, number] {
     const tile = tileSizeMeters > 0 && Number.isFinite(tileSizeMeters) ? tileSizeMeters : 1;
     return [point.x / tile, point.y / tile];
   }

   /** Whole number of tiles, at least 1, that best fits a length: max(1, round(length / T)); T <= 0 gives 1. */
   export function floorTilesAlong(lengthMeters: number, tileSizeMeters: number): number {
     if (!(tileSizeMeters > 0) || !Number.isFinite(tileSizeMeters)) {
       return 1;
     }
     return Math.max(1, Math.round(lengthMeters / tileSizeMeters));
   }
   ```

2. Add the optional method to `WorldDeformationFamily` in `src/runtime/worldGeometryDeformations.ts` (interface at
   lines 48-87), after `validateSnapshot`, with a JSDoc comment:

   ```ts
   /**
    * Optional floor-texture policy: per cell id, the lattice frame whose coordinates the floor UVs follow in the given
    * state. Cells not in the map use metric UVs. Families without this method use metric UVs everywhere.
    */
   floorUvFrames?(baseSpec: CellComplexSpec, state: TState): ReadonlyMap<string, FloorLatticeUvFrame>;
   ```

   Import the type with `import type { FloorLatticeUvFrame } from "../cell-complex/floorUv";`.

3. Implement it in `createTorusSkewDeformationFamily` (`torusSkewDeformation.ts:60-115`), after `validateSnapshot`:

   ```ts
   floorUvFrames(baseSpec, state) {
     const material = requireTorusCell(baseSpec).visuals?.floorMaterial;
     if (material?.kind !== "floor-texture") {
       return new Map();
     }
     let baseState: TorusSkewDeformationState;
     try {
       baseState = inferTorusSkewState(baseSpec);
     } catch {
       return new Map();          // base footprint out of range: fall back to metric UVs
     }
     const baseFrame = torusLatticeFrame(baseState);
     const frame = torusLatticeFrame(normalizeTorusSkewState(state));
     return new Map([
       [
         torusCellId,
         {
           origin: frame.origin,
           u: frame.u,
           v: frame.v,
           tilesAlongU: floorTilesAlong(length2(baseFrame.u), material.tileSizeMeters),
           tilesAlongV: floorTilesAlong(length2(baseFrame.v), material.tileSizeMeters),
         },
       ],
     ]);
   },
   ```

   `requireTorusCell`, `inferTorusSkewState`, `torusLatticeFrame`, `normalizeTorusSkewState` and `length2` already
   exist in this file. Import `floorTilesAlong` from `"../../cell-complex/floorUv"`. Update the module header (lines
   1-6) with one sentence about the floor UV frame.

4. `src/render/three/buildCellMesh.ts`:
   - Add to `BuildCellMeshOptions` (lines 32-43):
     `readonly floorUvFrame?: FloorLatticeUvFrame;` with JSDoc "Lattice frame for floor UVs (deformable families);
     when absent the floor uses metric UVs with the material's tile size."
   - Change `group.add(buildFloorMesh(cell, options.assets));` (line 60) to pass `options.floorUvFrame` as a third
     argument, and add that parameter to `buildFloorMesh`.
   - In `buildFloorMesh`, right after `const geometry = new THREE.ShapeGeometry(shape);` and **before**
     `geometry.rotateX(-Math.PI / 2);`, overwrite the UVs:

     ```ts
     const tileSizeMeters = cell.floorMaterial.kind === "floor-texture" ? cell.floorMaterial.tileSizeMeters : 1;
     const positions = geometry.getAttribute("position");
     const uvs = new Float32Array(positions.count * 2);
     for (let index = 0; index < positions.count; index += 1) {
       const point = { x: positions.getX(index), y: positions.getY(index) };   // still cell-local (x, y): not rotated yet
       const [s, t] = floorUvFrame ? floorLatticeUv(floorUvFrame, point) : floorMetricUv(point, tileSizeMeters);
       uvs[index * 2] = s;
       uvs[index * 2 + 1] = t;
     }
     geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
     ```

   - In the texture request use `repeatX: 1, repeatY: 1` and `userData: { textureUrl: ..., repeatX: 1, repeatY: 1 }`.
   - Delete `floorTextureRepeat` (lines 150-163) and its comment.
   - Update the module header (lines 1-12): floor UVs are metric (one tile = `tileSizeMeters`) or lattice UVs when a
     frame is given.

5. Plumb the frame.
   - `src/render/three/cellRenderArchetypes.ts`: add
     `readonly floorUvFramesByCellId?: ReadonlyMap<string, FloorLatticeUvFrame>;` (with JSDoc) to
     `BuildCellRenderArchetypesOptions` (lines 55-65), and in `collectCellArchetypeSources` (line 205) pass
     `floorUvFrame: options.floorUvFramesByCellId?.get(cell.id)` to `buildCellMesh`.
   - `src/render/three/createThreeApp.ts`, in `rebuildCellMeshes`, just before `buildCellRenderArchetypes` (line 2382):

     ```ts
     const deformation = activeWorldBundle.snapshot.deformation;
     const floorUvFramesByCellId = deformationFamilyRegistry
       .get(deformation.kind)
       ?.floorUvFrames?.(options.worldSpec, deformation as never);
     ```

     and add `floorUvFramesByCellId,` to the options object. (`deformationFamilyRegistry` is defined at line 787,
     before the first `rebuildCellMeshes()` call at line 1086.)

6. Retune the tile sizes in `src/world-assets/floorTextures.ts` (lines 51-130). New `defaultTileSizeMeters`
   (old value / 15, rounded to 3 decimals):

   | Name | Old | New |
   | --- | --- | --- |
   | grass1 | 60 | 4 |
   | forest_leaves | 48 | 3.2 |
   | river_pebbles | 40 | 2.667 |
   | gravelly_sand | 48 | 3.2 |
   | red_mud_stones | 48 | 3.2 |
   | snow | 60 | 4 |
   | wood_floor | 22 | 1.467 |
   | fabric | 20 | 1.333 |
   | paving_stones | 32 | 2.133 |
   | paving_blocks | 28 | 1.867 |
   | tile_grid | 24 | 1.6 |
   | warm_tiles | 24 | 1.6 |
   | brushed_metal | 18 | 1.2 |

   Add one line to the module header: "Tile sizes were divided by 15 when `tileSizeMeters` became a true period
   (job 10); before that one tile was `tileSizeMeters / span` meters."
   Update `tests/authoring/worldBuilder.test.ts:58` from `tileSizeMeters: 60` to `tileSizeMeters: 4`. Leave the
   literal `tileSizeMeters: 60` in `tests/render-contract/preloadWorldAssets.test.ts:176` alone (it does not come from
   the library). Search for other uses: `grep -rn "tileSize" src tests _docs --include=*.ts --include=*.js --include=*.md`.
   In `_docs`, fix only sentences that describe the old span-based behaviour; list each edit under `### Done`.

7. Documentation.
   - `_docs/MATHEMATICAL_MODEL.md` §9: add a paragraph "Floor texture": floor UVs are (nU·α, nV·β) with nU, nV whole
     numbers fixed from the base state, so the floor moves with the objects and is seamless across portals; other
     worlds use metric UVs (x/T, y/T). Reference `src/cell-complex/floorUv.ts#floorLatticeUv`.
   - Run `npm run docs:generate`.

## Tests and checks

Use `toBeCloseTo(x, 9)` for 1e-9 comparisons.

### New file `tests/cell-complex/floorUv.test.ts`

1. `it("computes lattice UVs from the inverse lattice frame")`: frame origin (−7.5, −7.5), u (15, 0), v (0, 15),
   6 and 6 tiles; `floorLatticeUv(frame, { x: 6, y: 3 })` is [5.4, 4.2]; for frame origin (−22.5, −3.75),
   u (15, 0), v (30, 7.5), 6 and 6 tiles, `floorLatticeUv(frame, { x: 12, y: 1.5 })` is [5.4, 4.2].
2. `it("computes metric UVs with one tile per tileSizeMeters")`: `floorMetricUv({ x: 8, y: -2 }, 4)` is [2, −0.5];
   `floorMetricUv({ x: 8, y: -2 }, 0)` is [8, −2].
3. `it("rounds the tile count to a whole number of at least one")`: `floorTilesAlong(15, 2.667)` is 6,
   `floorTilesAlong(15, 40)` is 1, `floorTilesAlong(15, 0)` is 1.

### `tests/runtime/torusSkewDeformation.test.ts`

Shared: `const family = createTorusSkewDeformationFamily();`, the existing `skewState` helper, and
`torusModuli` from `src/authoring/exampleWorlds`. States: `rest = skewState(0)`,
`s15 = skewState(15)`, `trap = { ...skewState(30), depthMeters: 7.5 }`.

4. `it("keeps the floor UV of a mapped point across commits")`: `frame(state) = family.floorUvFrames!(torusModuli, state).get("torus-room")!`.
   For the commits rest → s15 and rest → trap, and points (0, 0), (6, 3), (−7, 7), (7.4, −7.4), (−3.0, 0.6):
   `floorLatticeUv(frame(next), map.mapPoint(vec3(p.x, p.y, 0)))` equals `floorLatticeUv(frame(rest), p)` to 1e-9,
   with `map = createTorusSkewCellDeformationMaps(rest, next).get("torus-room")!`.
5. `it("keeps floor UVs seamless across every torus portal")`: for each state in [rest, s15, trap], compile
   `family.applyToSpec(torusModuli, state)`; for each portal of `"torus-room"` and for the side's start, midpoint and
   end points `q`: `uvA = floorLatticeUv(frame(state), q)`, `q' = transformPoint3(portal.transformToTarget, vec3(q.x, q.y, 0))`,
   `uvB = floorLatticeUv(frame(state), q')`; for both components `d = uvB − uvA`, expect
   `Math.abs(d - Math.round(d))` to be `< 1e-9`. (`transformPoint3` is in `src/math/rigidTransform3.ts`.)
6. `it("uses six tiles per lattice vector for the torus-moduli pebbles")`: `frame(rest).tilesAlongU` and
   `tilesAlongV` are 6, and `frame(trap)` has the same counts.
7. `it("has no floor UV frame for a colour floor")`: a torus spec whose cell has
   `visuals: { ...torus.cells[0].visuals, floorMaterial: { kind: "floor-color", floorColor: "#888888" } }` gives an
   empty map.

### `tests/render-contract/buildCellMesh.test.ts`

Helper for these tests: a one-cell spec `"floor-room"`, height 4, base (−5, −5), (5, −5), (5, 5), (−5, 5), no
portals, `visuals: { floorMaterial: { kind: "floor-texture", name: "test", floorColor: "#5b8f48", tileSizeMeters: 4, colorTexturePath: "textures/test.ktx2" } }`,
compiled with `compileCellComplex`, built with `createPreparedAssets()` (already in the file). Read the floor mesh with
`mesh.getObjectByName("floor:floor-room") as THREE.Mesh`, then its `geometry.getAttribute("position")` and
`getAttribute("uv")`. After `rotateX(-π/2)` a cell point (x, y) is at position (x, 0, −y).

8. `it("gives floor textures a period of tileSizeMeters meters")`: for every vertex index, `uv.getX(i)` equals
   `position.getX(i) / 4` and `uv.getY(i)` equals `-position.getZ(i) / 4`. Repeat with the base scaled to
   (−20, −20) … (20, 20): the same formula holds (period independent of cell size).
9. `it("requests the floor texture with repeat 1")`: with a `vi.fn` `getConfiguredTexture` (as in the test at line
   268), expect every call for the floor's `assetPath` to have `repeatX: 1` and `repeatY: 1`.
10. `it("uses lattice UVs when a floor UV frame is given")`: build the same cell with
    `floorUvFrame: { origin: { x: -5, y: -5 }, u: { x: 10, y: 0 }, v: { x: 2, y: 10 }, tilesAlongU: 3, tilesAlongV: 2 }`;
    for every vertex, `[uv.getX(i), uv.getY(i)]` equals `floorLatticeUv(frame, { x: position.getX(i), y: -position.getZ(i) })`
    to 1e-6 (Float32 storage).

### `tests/render-contract/cellRenderArchetypes.test.ts`

11. `it("passes the floor UV frame through to the floor archetype")`: `planCellRenderArchetypes` cannot be used here
    because it discards the meshes; use `buildCellRenderArchetypes(world, { ...options, floorUvFramesByCellId: new Map([["floor-room", frame]]) })`
    with the world from test 8 and options copied from the existing tests in that file (`capacitiesByCellId: new Map([["floor-room", 1]])`,
    `assets: createPreparedAssets()` or the file's own stub). Find the archetype with `kind === "floor"` and check
    its geometry `uv` attribute matches test 10. Then call `disposeCellRenderArchetypes`.

Commands:

```bash
npx vitest run tests/cell-complex/floorUv.test.ts
npx vitest run tests/runtime/torusSkewDeformation.test.ts tests/render-contract/buildCellMesh.test.ts tests/render-contract/cellRenderArchetypes.test.ts tests/authoring/worldBuilder.test.ts
npm run docs:generate
npm run typecheck
npm test
```

Manual check (do it if you can run a browser; record the result under `### Checks`): `npm run dev`, open
`torus-moduli`, look at the pebbles under the house, bench and flowers, and sweep the computer target to A = 30,
B = 8 and back. They must stay on the same pebbles, and no seam may appear at the room's edges. Also open `cube` and
`icosahedron` and compare the floor scale with `main`: the cube should look the same, the icosahedron's tiles about
1.5× larger.

Risky points:

- If the texture looks mirrored or rotated compared with `main` in the cube world, the UV axes are swapped or
  negated; the metric UV must be exactly (x/T, y/T) of the **unrotated** shape point (read positions before
  `rotateX`). Fix that and note it under `### Deviations`.
- If `registry.get(...)?.floorUvFrames?.(...)` does not typecheck because of the generic `get`, cast the family as
  `WorldDeformationFamily<WorldDeformationState> | undefined`; note it under `### Deviations`.
- If the documentation test reports a layering error for `src/cell-complex/floorUv.ts`, it imports something it
  should not: it must import nothing.
- If you think the retuned tile sizes look wrong in some world, do not change the table on your own; describe it
  under `### Uncertain`.

## Do not

- Do not make the commit incremental, reuse archetypes across commits or change texture caching: that is
  [job 30](../30_deformation_rebuild_pipeline.md) (issue 82). This job only stops the floor texture request from
  changing.
- Do not change how objects or headings are mapped (jobs 07 and 09).
- Do not change the lattice frame itself (offset or rotated footprints, reduced bases): [job 35](../35_torus_family_as_teichmuller_space.md).
- Do not texture the ceiling or walls differently.
- Do not use the normal, bump or roughness maps; `buildFloorMesh` uses only the colour map today, keep it that way.

## Done when

- [ ] Tests 1-11 above exist and pass; `npm run typecheck` and `npm test` pass.
- [ ] `npm run docs:generate` was run and `_docs/generated/*` changes are committed.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §9 has the floor-texture paragraph.
- [ ] Issue 81 is closed: move `_issues/81_floor_texture_slides_under_objects_during_deformation.md` to
  `_issues/_closed/`, set `Status: closed on <date>.`, fix its relative links (one more `../`), point its `Jobs:` line
  at `.agents/jobs/_done/10_floor_texture_in_lattice_coordinates.md`, and add `## Outcome` and `## Closing evidence`
  (test file and test name for each acceptance criterion; the manual sweep result, or "not run" if you could not run
  it). Use `_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md` as the model. If the manual check
  was not run, close the issue anyway and say so under `### Uncertain`.
- [ ] Add a dated line to the status area of `_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md`:
  "Job 10 fixed the floor texture repeat at 1, so a commit no longer creates a new configured texture; the scene
  rebuild remains (job 30)." Do not close issue 82.
- [ ] Move this file to `.agents/jobs/_done/10_floor_texture_in_lattice_coordinates.md`, fix its relative links (one
  more `../`), and set `Status: done on <date>.` if `### Uncertain` is empty, otherwise
  `Status: done, needs review on <date>.`
- [ ] Add a `## Report` section at the end of this file with these subsections (write "None." where empty):
  - `### Done`: what changed, file by file, with commit hashes;
  - `### Deviations`: where the work differs from the steps, and why;
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them;
  - `### Not done`: anything skipped, and why;
  - `### Checks`: every command you ran and its result, including failures.
- [ ] Update row 10 in the queue table of `.agents/jobs/README.md`: link to `_done/10_floor_texture_in_lattice_coordinates.md`,
  strike the title and add "(done)", as row 01 does.
- [ ] Commit with a message like `Floor UVs in lattice coordinates; tileSizeMeters is a true period (job 10)`. Do not
  push unless asked.

## Report

### Done
- `src/cell-complex/floorUv.ts` (new): `FloorLatticeUvFrame`, `floorLatticeUv`, `floorMetricUv`, `floorTilesAlong`.
- `src/runtime/worldGeometryDeformations.ts`: optional `floorUvFrames` on `WorldDeformationFamily`.
- `src/runtime/deformations/torusSkewDeformation.ts`: `floorUvFrames` (lattice frame of the state, tile counts from the base state).
- `src/render/three/buildCellMesh.ts`: floor UVs written from metric or lattice maths before `rotateX`; texture requested with repeat 1; `floorTextureRepeat` deleted.
- `src/render/three/cellRenderArchetypes.ts`, `createThreeApp.ts`: `floorUvFramesByCellId` plumbed from `rebuildCellMeshes`.
- `src/world-assets/floorTextures.ts`: all default tile sizes divided by 15 (per step 6 table); header note.
- `tests/authoring/worldBuilder.test.ts`: `tileSizeMeters: 60` to `4` (as the job says).
- New tests 1-11 in `tests/cell-complex/floorUv.test.ts`, `tests/runtime/torusSkewDeformation.test.ts`, `tests/render-contract/buildCellMesh.test.ts`, `tests/render-contract/cellRenderArchetypes.test.ts`.
- `_docs/MATHEMATICAL_MODEL.md` section 9 "Floor texture" paragraph; `_docs/generated/*` regenerated. No other `_docs` sentence described the span-based behaviour.
- Issue 81 closed (moved to `_issues/_closed/`); issue 82 status line added; README row 10 updated.
- Commit: see the git log entry "Floor UVs in lattice coordinates; tileSizeMeters is a true period (job 10)".

### Deviations
None.

### Uncertain
- The manual browser check (sweep to A = 30, B = 8; cube and icosahedron scale comparison) was not run. The automated tests cover the UV invariants, but the look of the retuned tile sizes is unconfirmed.

### Not done
None.

### Checks
- Baseline `npm run typecheck` and `npm test`: pass (695 passed, 8 skipped).
- After the change: `npm run typecheck`, `npm test`, `npm run docs:check`: pass.
