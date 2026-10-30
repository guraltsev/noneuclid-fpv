# Job 38 - Draw static assets from their registry record

Status: done, needs review on 2026-10-29 (commits 1c3b1e5, 6039c20, dd1f507).
Written on 2026-10-29 after job 37 was checked against the source. Resolves: no open issue (completes job 37's goal
"`placeAt` moves any positioned object" for the visible model of static assets).

## Goal

1. A static asset's **visible model** is drawn from its registry record (cell and pose), like creatures and flags,
   not from the authored spec baked into the cell mesh. After `objectHost.placeAt(assetId, ...)` the model, the
   collision, the tooltip and the aim target move together, and a deformation commit cannot snap the model back.
2. **Every** asset spec (not only collidable ones) has a registry record and a `PlainWorldObject` owner.
3. At the authored pose the picture is unchanged: same model, same place, same tilt and scale (checked to 1e-9).
4. A world reset returns placed assets to their authored pose, as it does for creatures.

Not in this job: sharing one instanced mesh between several assets of the same model (job 29 lists it as a follow-up),
a UI to move assets, particles.

## Depends on

- [Job 37](37_object_owners_and_place_at.md) (owners, `ObjectHost`, `PlainWorldObject`, `staticAssetOwners`).
- [Job 28](28_frame_snapshot_instance_sync.md) (`runtimeObjectInstanceSync.ts`: records collected once per sync, and an
  unchanged registry object **reuses its records, ghosts included**). This reuse is what keeps static assets from
  costing a ghost walk every frame. Without job 28 this job would add per-frame work for every asset; do not start it
  before job 28 is done.
- Runs **before** [job 29](29_frame_loop_allocation_and_draw_calls.md), which then sees assets as ordinary runtime
  objects (its Part C keeps per-object archetypes for assets).

## Before you start

Line numbers are **at commit 0b468e1**. Jobs 37 and 28 (and the jobs between them) change these files; search by the
quoted name.

| File | What to look at (lines at 0b468e1) |
| --- | --- |
| `src/render/three/buildCellMesh.ts` | header 1-12 ("one decoration per static object spec"); decoration loop 75-81 (skips creatures, calls `buildDecorationMesh`); imports 24-27 |
| `src/render/three/buildDecorationMesh.ts` | `buildDecorationMesh` 24-34; `buildStaticAssetMesh` 36-87: group at `spec.position + modelOffset`, rotation `rotateX(forwardTilt)`, `rotateZ(sideTilt)`, `rotateY(yaw)` (so R = Rx·Rz·Ry), scale `scaleXYZ` or `scale`; legacy marmot proxy for `staticMarmotAssetPath` |
| `src/render/three/cellRenderArchetypes.ts` | `CellRenderArchetypeKind` 29-34 (`"static-object"`); classification 282-283 (`decoration:` / `asset:` ancestors) |
| `src/render/three/runtimeObjectRenderRecords.ts` | `collectRuntimeObjectRenderSourceMeshes` 45-70 (hides each source mesh, keys `<prefix>:mesh:<i>`) |
| `src/render/three/runtimeObjectRenderArchetypes.ts` | `buildRuntimeObjectRenderArchetype` 71-78: geometry baked as `inverse(root.matrixWorld) * mesh.matrixWorld`, i.e. **in the root's frame** |
| `src/render/three/worldAxes.ts` | `rigidTransformToThreeMatrix` 58 (cell-local pose -> Three matrix; the instance matrix of every runtime object) |
| `src/render/three/runtimeSceneUtils.ts` | `runtimeObjectArchetypeKeyPrefix` 180-186 (`asset:<id>` for assets); `disposeObject3D` 76 |
| `src/render/three/createThreeApp.ts` | `runtimeObjectRenderRoot` 852-854 (in the scene); `runtimeObjectRootsById` 855; creation loop 1153-1179 (assets at 1175-1177, `objectSpec.collision` condition); startup sync 1181 and `prerenderCells` 1201 (compiles the whole scene, so archetypes that exist before it are warmed up); `syncRuntimeObjectRenderSources` 2794-2882 and `collectRuntimeObjectRenderRecords` 2899-2940 (moved into `runtimeObjectInstanceSync.ts` by job 28); `dispose` 1917; `resetRuntimeWorld` 3167-3175 |
| `src/world-objects/runtimeObjectRegistry.ts` | `createRuntimeStaticAssetObject` 275-338 (`portalRenderable: false` at 311) |
| `src/world-objects/worldObjectOwner.ts` | created by job 37: `PlainWorldObject`, `createPlainWorldObject`, `ObjectHost` |
| `src/runtime/worldGeometryDeformations.ts` | `transformCellObjectsWithMaps` 245-261 (deformation maps asset specs too) |
| `tests/render-contract/cellRenderArchetypes.test.ts` | line 36 expects a `"static-object"` archetype |
| `tests/render-contract/portalInstanceBuffers.test.ts` | line 171 uses `kind: "static-object"` as a fixture value |
| `tests/runtime/worldGeometryRuntimeTransforms.test.ts` | `stubAssets` 103-118 (copy it), `skewState`, torus bench test from job 37 |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`,
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

## Background: the registry and the actual objects

Read this once; it explains why the change is needed and what must stay true.

At 0b468e1 there are four different "sets of objects", each with its own source of truth:

| Set | Holds | Source of truth |
| --- | --- | --- |
| Authored specs (`cell.objects`) | assets, marmot, mice, butterflies | the world script; re-mapped by every deformation commit (`transformCellObjectsWithMaps`) |
| Registry (`RuntimeObjectRegistry`) | creatures (copy), **collidable** assets only, flags, cannons, geodesic intervals/segments/ends/pairs/intersections, measurements, protractor angles | itself for flags, cannons, geodesics, measurements; the creature runtime for creatures (job 37: the owner); the spec for assets |
| Behaviour runtimes | creature/marmot runtimes, flag runtimes, tool runtimes | private state |
| Drawn sets | cell archetypes: walls, floors **and every asset model** (from the spec); runtime-object archetypes: registry records that are `portalRenderable` and have a root in `runtimeObjectRootsById` (creatures, flags, tool objects), geodesic objects, the rover | cell archetypes: spec; runtime archetypes: registry pose |

So an asset is split in two: its collision, tooltip, interaction, aim proxy and debug wireframe come from the registry
record, but its model comes from the spec inside the cell mesh. Before job 37 both were derived from the same spec, so
they agreed. After job 37 the owner can move the record (`placeAt`, or a commit mapping with depenetration), and the
model does not follow; on the next deformation commit `rebuildCellMeshes` even redraws the model at the spec position
while the record keeps the owner's pose. Also, assets without collision have no record at all (no tooltip or help,
even with `displayHelpMessage`).

The target rule, which this job completes for assets: **one registry record per thing in the world; its owner is the
only writer; drawing, collision, aim and UI read only the record; specs are initial state.** The spec's (mapped) asset
positions remain meaningful only as the authored pose that `reset` returns to.

The runtime-object render path already does what assets need. For each registry object that is `portalRenderable` and
has a root in `runtimeObjectRootsById`, the renderer takes every mesh under the root, bakes its geometry into the
**root's frame**, and draws one instance per visible portal path (plus portal ghosts) with the instance matrix
`rigidTransformToThreeMatrix(record.localPose)`. Draw-call cost is the same as today: today each asset mesh is one
instanced mesh per cell archetype; afterwards it is one instanced mesh per asset (`asset:<id>:mesh:<i>`).

## Decisions

1. **Records for every asset.** Decided: the creation loop creates a record and a `PlainWorldObject` for every
   `objectSpec.kind === "asset"`, dropping the `&& objectSpec.collision` condition. Collision stays optional on the
   record (the registry's collidable queries already filter on it). Why: an object that is drawn must have a record.
   Side effect, accepted: a non-collidable asset with `displayHelpMessage` now gets its tooltip (today it silently has
   none). Record it under `### Deviations`.
2. **Assets are portal-renderable.** Decided: `createRuntimeStaticAssetObject` sets `portalRenderable: true`, and its
   JSDoc drops "Static assets are never portal-renderable via this registry record."
3. **Render root with a fixed visual offset.** Decided: new module `src/render/three/staticAssetRenderRoot.ts`:

   ```ts
   /** Builds the render root of a static asset: an identity group whose single child is the decoration model,
    *  placed so that drawing the root at `record.localPose` reproduces the authored decoration exactly. */
   export function buildStaticAssetRenderRoot(
     cellId: string, objectSpec: AssetObjectSpec, authoredPose: RigidTransform3, assets: PreparedWorldAssets,
   ): THREE.Group;
   ```

   ```text
   decoration = buildDecorationMesh(cellId, objectSpec, assets)        // unchanged builder; matrix = T(pos+offset)·Rx·Rz·Ry·S
   decoration.updateMatrix()
   visualFromPose = inverse(rigidTransformToThreeMatrix(authoredPose)) · decoration.matrix
   decoration.matrixAutoUpdate = false; decoration.matrix.copy(visualFromPose)
   root = new THREE.Group(); root.name = `asset-root:${objectSpec.id}`; root.add(decoration)
   ```

   `authoredPose` is the record's pose at creation (`yawRigidTransform3(turn ?? yaw ?? 0, position)`, the value
   `createRuntimeStaticAssetObject` writes). Why: the instance matrix is `rigidTransformToThreeMatrix(record.localPose)`
   times the baked geometry, so at the authored pose the product is `decoration.matrix`, identical to today. Under
   `placeAt` the tilted, offset, scaled model is carried rigidly with the pose. Use `matrix` with
   `matrixAutoUpdate = false` rather than decompose (a tilt plus a non-uniform scale does not round-trip through
   position/quaternion/scale exactly). Check that `collectRuntimeObjectRenderSourceMeshes` and
   `buildRuntimeObjectRenderArchetype` read `matrixWorld` after `root.updateMatrixWorld(true)`, which respects
   `matrixAutoUpdate = false` children (they do at 0b468e1, lines 50 and 77-78).
   The decoration group name `decoration:<id>` and the inner `asset:<id>` stay as they are.
4. **The root is not in the scene.** Decided: register it with `runtimeObjectRootsById.set(id, root)` only; do not add
   it to a cell group (assets do not move by themselves, so there is no `syncParent`). Its meshes are templates.
5. **Cells draw no objects.** Decided: delete the decoration loop in `buildCellMesh` (75-81) and the now-unused imports
   (`buildDecorationMesh`, `isGeodesicMarmotObjectSpec`, `isSimpleGeoCreatureObjectSpec`). Remove `"static-object"`
   from `CellRenderArchetypeKind` and its classification (282-283). Update the two tests listed under "Before you
   start" (line 36: expect `false` and rename the test to "... and no static-object archetypes ..."; line 171: use
   `kind: "floor"`). Record both under `### Deviations`.
6. **No per-frame cost for static records.** Decided: rely on job 28's record reuse (`cached.object === object`).
   Verify it with the test in step B5; do not add a second cache. If job 28 did not land its reuse, stop after Part A
   and record it under `### Not done`.
7. **Warm-up.** Decided: create the asset roots in the creation loop, i.e. before the startup instance sync (1181 at
   0b468e1) and `prerenderCells` (1201), so the asset archetypes exist when the scene is compiled. If job 29 has
   already landed and hides empty archetypes, its "force visible during warm-up compile" rule covers assets as well;
   check it, do not duplicate it.
8. **Reset.** Decided: `PlainWorldObject` remembers its authored record. `transformGeometry` maps the authored pose
   with the same maps (no depenetration: it is the spec-equivalent pose; the spec itself is mapped the same way by
   `transformCellObjectsWithMaps`). New method `reset(): void` publishes the authored pose. Add `reset` to
   `PlainWorldObject` only, not to `WorldObjectOwner` (the maintainer fixed that interface). `resetRuntimeWorld` calls
   `owner.reset()` for every entry of `staticAssetOwners`. Why: a placed house must come back on "reset world", as
   creatures do.
9. **Deformation commits.** Decided: asset models no longer depend on `rebuildCellMeshes`. The spec mapping
   (`applyToSpec` / `transformCellObjectsWithMaps`) stays unchanged: asset preloading and diagnostics still read
   asset paths from the spec, and nothing reads asset positions from it any more except the creation loop at load.
10. **Dispose.** Decided: in `dispose`, for each asset root: `runtimeObjectRootsById.delete(id)` and
    `disposeObject3D(root)`. Archetype meshes are already disposed by the runtime-object archetype code.
11. **Debug helper.** Decided: add `placeObjectAt(id, cellId, x, y, yawDegrees)` to the general debug helpers
    (`installGeneralDebugHelpers`, called at `createThreeApp.ts` 1143): it calls
    `objectHost.placeAt(id, cellId, yawRigidTransform3(yawDegrees * Math.PI / 180, { x, y, z: 0 }))` and logs the
    boolean. Why: the manual check needs a way to call `placeAt` in the browser.

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck`.

### Part A: records and render roots (nothing drawn differently yet)

1. `staticAssetRenderRoot.ts` (Decision 3) with a header comment and JSDoc.
2. `PlainWorldObject` (Decision 8): authored record, mapped in `transformGeometry`, `reset()`.
3. Creation loop: drop the collision condition (Decision 1). Keep `portalRenderable: false` for now.
4. Tests:
   - new `tests/render-contract/staticAssetRenderRoot.test.ts`, with a `stubAssets` whose `instantiateGltf` returns a
     group holding one `THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))`. For each of these specs (cell `"room"`):
     (a) position `(1, 2, 0)`, turn `0.7`; (b) plus `modelOffset (0, 0, 0.1)`, `scale 1.5`; (c) plus
     `forwardTiltRadians 0.2`, `sideTiltRadians -0.1`, `scaleXYZ (1, 2, 0.5)`; and (d) the legacy marmot
     (`assetPath: staticMarmotAssetPath`):
     build today's decoration with `buildDecorationMesh` and call `updateMatrixWorld(true)`; build the root, then for
     every mesh `m` in the root compute
     `rigidTransformToThreeMatrix(authoredPose) · inverse(root.matrixWorld) · m.matrixWorld` and compare it with the
     matching mesh's `matrixWorld` in today's decoration (same traversal order). Every element within `1e-9`;
   - `tests/world-objects/worldObjectOwner.test.ts`: `reset` after `place` restores the authored pose; after a
     translation map `(x+2, y-1)` followed by `place` and `reset`, the pose is the **mapped** authored pose;
   - a non-collidable asset spec gets a record (`registry.get(id)` defined, `getCollidableObjectsInCell` excludes it).
5. Commit: `Job 38 Part A: records and render roots for every static asset`.

### Part B: draw assets from the registry

1. `createRuntimeStaticAssetObject`: `portalRenderable: true` (Decision 2).
2. Creation loop: after creating the owner, `runtimeObjectRootsById.set(id, buildStaticAssetRenderRoot(cell.id,
   objectSpec, owner record's localPose, options.assets))`. The loop is above the startup sync (Decision 7).
3. `buildCellMesh` and `cellRenderArchetypes` (Decision 5), with the two test updates; update the `buildCellMesh.ts`
   header (no decorations; assets are runtime objects drawn from the registry).
4. Dispose (Decision 10) and reset (Decision 8) in `createThreeApp.ts`; debug helper (Decision 11). Follow the
   declaration-order rule of job 37 ("Ordering hazard"): no new `const` below code that reads it.
5. Tests in `tests/render-contract/runtimeObjectInstanceSync.test.ts` (job 28's file):
   - an asset record with a root: one sync produces one record per mesh with `localMatrix` equal to
     `rigidTransformToThreeMatrix(record.localPose)`; after `publish` of a new pose the next sync's matrix follows;
   - two syncs with the same (unchanged) asset record return the **same** record objects (reference equality),
     i.e. no ghost walk is repeated (Decision 6).
6. `npm run build` and the four-world smoke test.
7. Commit: `Job 38 Part B: static assets drawn from their registry record`.

### Part C: docs

1. `_docs/ARCHITECTURE.md`, "Runtime objects" bullet (edited by job 37): every asset is a registry record owned by a
   `PlainWorldObject` and drawn through the runtime-object archetypes; cell meshes contain only cell geometry; specs
   are initial state. Add the four-sets table of "Background" in condensed form if the section has room for it (at
   most 8 lines).
2. `npm run docs:generate` if `docs:check` reports stale files.
3. Commit: `Job 38 Part C: document assets as registry-drawn runtime objects`.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, and
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` pass.

Manual browser check (write it under `### Manual checks not run` if you cannot run a browser; it does not force
"needs review"):

1. `npm run dev`, open the cube world with debug on. Every asset looks as before (compare with a screenshot of the
   baseline build), including through portals.
2. In the console, `placeObjectAt("<an asset id from the cube world>", "<its cell id>", 0, 0, 45)`: the model, its
   collision wireframe (debug) and its tooltip move together.
3. Open `torus-moduli`, place an asset, change the deformation in the geometry computer and commit: the model stays
   with its collision and does not jump back to the authored position.
4. "Reset world": the asset returns to its authored (deformation-mapped) position.

## Do not

- Do not change `buildDecorationMesh`'s placement math; the render root compensates for it.
- Do not add asset roots to the scene or to cell groups.
- Do not share archetypes between assets (follow-up recorded in job 29).
- Do not add a second per-frame record cache; use job 28's.
- Do not add `reset` to the `WorldObjectOwner` interface.

## Done when

- Every asset spec has a registry record and an owner; models are drawn from the record.
- The parity test passes to 1e-9 for all four specs; cell meshes contain no decorations.
- `placeAt`, a deformation commit and a reset move model, collision and tooltip together (tests; manual check listed).
- Unchanged asset records reuse their render records between syncs.
- Three commits `Job 38 Part A/B/C: ...` exist; Report written per [README](README.md).


## Report

### Done
- Part A (1c3b1e5): new `src/render/three/staticAssetRenderRoot.ts` (`buildStaticAssetRenderRoot`); `PlainWorldObject.reset()` plus an authored pose that `transformGeometry` maps with the same maps (no push-out); the creation loop in `createThreeApp.ts` makes a record and owner for every asset (collision condition dropped). Tests: `tests/render-contract/staticAssetRenderRoot.test.ts` (parity to 1e-9 for the four specs, a non-collidable asset has a record and is not collidable), reset tests in `tests/world-objects/worldObjectOwner.test.ts`.
- Part B (6039c20): `createRuntimeStaticAssetObject` is `portalRenderable: true`; each asset root is registered in `runtimeObjectRootsById` (not in the scene) in the creation loop before the startup sync and `prerenderCells`; `buildCellMesh` draws no objects; `"static-object"` removed from `CellRenderArchetypeKind` (and the unused `hasAncestorNamed`); dispose removes and disposes asset roots; `resetRuntimeWorld` calls `owner.reset()` for every static asset owner; debug helper `placeObjectAt(id, cellId, x, y, yawDegrees)` on `window.noneuclidDebug` and as a window global (`appDebugHelpers.ts`, `debugPlaceObjectAt` in `createThreeApp.ts`, wired into both `installGeneralDebugHelpers` calls). Tests in `runtimeObjectInstanceSync.test.ts`: asset drawn at its record pose and following a published pose; unchanged asset record causes 1 ghost computation over 3 syncs. Generated docs regenerated.
- Part C (dd1f507): `_docs/ARCHITECTURE.md` "Runtime objects" bullet updated. I did not add the four-sets table.

### Deviations
- Existing tests changed as the job says: `cellRenderArchetypes.test.ts` renamed to "...no static-object archetypes..." and expects `false` (compares `entry.kind as string` because the kind no longer exists in the type); `portalInstanceBuffers.test.ts` fixture uses `kind: "floor"`.
- A non-collidable asset with `displayHelpMessage` now gets a tooltip (Decision 1, accepted side effect).
- Generated docs (`_docs/generated/*`) were stale after Part A and were regenerated and committed with Part B.
- Asset matrix tests in the sync test use `toBeCloseTo` (6 digits), since instance matrices are float32.
- Parity test for "carries the model rigidly" is a weak sanity check only.

### Uncertain
- Decision 7 (warm-up): job 29 has not landed, so there is no empty-archetype hiding to check. Asset archetypes are created in the startup sync before `prerenderCells`.
- The smoke test passes but does not compare pixels, so "every asset looks as before" is only covered by the parity unit test.

### Not done
- The four-sets table in ARCHITECTURE.md (optional, "if room").

### Checks
- Baseline `npm run typecheck`, `npm test` (938 tests) passed.
- Final: `npm run typecheck` ok; `npm test` 129 files, all pass after regenerating docs (one run failed only on the stale generated docs check); `npm run docs:check` ok; `npm run build` ok; `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` SMOKE OK (4 pages), first run.

### Manual checks not run
No browser run. Steps: `npm run dev`, open the cube world with debug on and compare assets to a baseline screenshot (also through portals). In the console run `placeObjectAt("<asset id>", "<its cell id>", 0, 0, 45)`: model, debug collision wireframe and tooltip move together. In `torus-moduli`, place an asset, commit a deformation in the geometry computer: the model stays with its collision. Use "Reset world": the asset returns to its authored (deformation-mapped) position.