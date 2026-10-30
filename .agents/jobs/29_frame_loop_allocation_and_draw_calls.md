# Job 29 - Frame-loop allocation and per-object draw calls

Status: queued.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md) (all seven items, plus the
per-frame palette serialisation merged into it from issue [41](../../_issues/_closed/41_documentation_audit_findings.md)).

## Goal

1. **Part A - allocation churn.** The steady-state frame (desktop, standing still, no tool in use) constructs no
   `THREE.Vector2/3/4`, `Matrix4`, `Quaternion` or `Group` in the code paths listed under Part A.
2. **Part B - version counters.** The palette is rebuilt only when its definition changes (no per-frame
   `JSON.stringify`), registry queries return cached arrays, and per-frame refreshes skip work when nothing changed.
3. **Part C - buffers and draw calls.** Instance buffers are uploaded only when their content changed, and only the
   written prefix; empty archetypes are not drawn; placed flags of one type share their model's draw calls; the marmot
   is one draw call instead of 12.

**One commit per Part** (A, then B, then C), each green on its own.

## Depends on

- [Job 28](28_frame_snapshot_instance_sync.md): it adds `runtimeObjectInstanceSync.ts` (where Parts A and C change the
  source and record code), `frameRenderSnapshot.ts`, `registry.getVersion()` and the request flags this job uses.
- Through job 28: jobs [37](37_object_owners_and_place_at.md) and 25-27. Jobs
  [21](21_per_frame_visibility_funnel.md)-[23](23_stereo_split_root_correctness.md) and
  [19](19_vr_palette_and_in_headset_debug.md) run earlier and touch the same render files (see "Conflicts" below).

**Line numbers below are at commit `0b468e1`. Jobs 19-28 and 37 shift them; search by function name.** Where a named
function no longer exists (for example job 22 replaced the viewport uniform), skip that item and record it under
`### Deviations`.

## Before you start

| File | Lines at `0b468e1` | What |
| --- | --- | --- |
| `src/render/three/portalClipMaterial.ts` | 63-98 | `updatePortalClipMaterialViewport`, `updatePortalClipMaterialViewportFromRenderer` (`new THREE.Vector4()` at :91, two object literals at :95-96) |
| `src/render/three/createThreeApp.ts` | 2433-2436, 2875-2878 | per-mesh `onBeforeRender` of cell and object archetypes (the object one moved into job 28's `buildArchetype` closure) |
| | 2653-2667, 2736-2763 | `activatePortalRenderStateForCamera`, `findPortalEyeRenderState` (`new Vector4`/`new Vector2` at :2749-2750) |
| | 1513-1519, 2459-2465 | mono render root with `renderFromRootMatrix: new THREE.Matrix4()` every frame |
| | 2785-2792 | `runtimeObjectCameraPosition` (`new THREE.Vector3()` per call) |
| | 2113-2175 | `updateScenePalette` (`createPaletteDefinition` every frame at :2140/:2172; `new Vector3`/`new Quaternion` fallbacks at :2123-2124) |
| | 1483 | `refreshMeasuredGeodesicLengths()` every frame |
| | 3482-3572 | `updateProtractorToolFeedback`, `syncProtractorToolFeedback` (builds, then disposes on an equal signature at :3558-3561) |
| `src/render/three/portalEyeFrameTransforms.ts` | 42-90 | `transformVisiblePortalResultToRenderFrame` (no identity fast path), `remapStereoPortalPathIds` |
| `src/render/three/xrPortalEye.ts` | all (109) | `new Matrix4` :49, `new Vector3` :58, `rigidTransformToThreeMatrix` :75, `.clone().invert()` :84, `new Matrix4` in `isIdentity` :89, `camera.clone()` :95 |
| `src/render/three/worldAxes.ts` | 52-79 | `rigidTransformToThreeMatrix` allocates two matrices per call |
| `src/render/three/renderPortalInstances.ts` | 195-224, 237-332 | `updateCellRenderArchetypeInstances`, `updateRuntimeObjectRenderArchetypeInstances` (scratch `Matrix4`/`Vector3` per call :247-248; dedupe `Map`/`Set` per archetype :257, :279; `needsUpdate` always :216-218, :316-318) |
| `src/render/three/runtimeObjectInstanceSync.ts` | (job 28) | source sync re-traverses every object each sync (today `createThreeApp.ts:2810`, `:2833`) |
| `src/render/three/geodesicEmitterLabelController.ts` | 53-96 | `new Set`, `new Quaternion` per frame, `[...map]` copy |
| `src/render/three/protractorToolFeedback.ts` | 27-67 | signature computed inside the builder |
| `src/render/three/scenePaletteController.ts` | 107-117, 225-235 | `definition` compared by `JSON.stringify` every frame |
| `src/ui/paletteDefinition.ts` | 257-262 | `createPaletteDefinition(state, appConfig, inputMode)`; reads `Date.now()` |
| `src/world-objects/runtimeObjectRegistry.ts` | 122-257 | `getObjectsInCell` builds 3 arrays (:226-230), subsets filter again, `getAll` copies (:247-249) |
| `src/render/three/runtimeObjectRenderArchetypes.ts` | 64-108, 138-144 | archetype build (`count = 0`, `frustumCulled = false` at :87-88), capacity |
| `src/render/three/cellRenderArchetypes.ts` | 94-95 | `count = 0`, `frustumCulled = false` |
| `src/render/three/prerenderCells.ts` | 37-72 | warm-up `compile` + `render` |
| `src/render/three/runtimeSceneUtils.ts` | 179-186 | `runtimeObjectArchetypeKeyPrefix` (kind + id; flags: `placed-flag:<type>:<id>`) |
| `src/render/three/runtimeObjectRenderRecords.ts` | 45-70 | `collectRuntimeObjectRenderSourceMeshes` (`<prefix>:mesh:<index>`) |
| `src/render/three/placedFlagRenderer.ts` | 130-169, 295-319 | flag = glTF model meshes + two text planes `placed-flag-text-plane:ID:front` and `...:back` (per-flag texture) |
| `src/render/three/buildDecorationMesh.ts` | 95-154 | `buildStaticMarmotProxy`: 12 box meshes (issue 75 says "about 13"), mostly cloned materials |
| `node_modules/three/src/renderers/webgl/WebGLBufferRenderer.js` | 21 | `if ( primcount === 0 ) return;` (setProgram and uniforms already ran) |
| Tests | | `tests/render-contract/portalClipMaterial.test.ts`, `portalInstanceBuffers.test.ts`, `runtimeObjectPortalInstances.test.ts`, `xrPortalEye.test.ts`, `prerenderCells.test.ts`, `placedFlagRenderer.test.ts` (fake sign assets and canvas shim), `runtimeObjectInstanceSync.test.ts` (job 28); `tests/world-objects/runtimeObjectRegistry.test.ts` |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`,
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

## Background

### Issue 75 claims at `0b468e1`

| # | Claim | At `0b468e1` |
| --- | --- | --- |
| 1 | `Vector4` per draw call in `updatePortalClipMaterialViewportFromRenderer`; `findPortalEyeRenderState` matches matrices and allocates in its fallback; re-rooted eyes never match | **Holds** (`portalClipMaterial.ts:91`; `createThreeApp.ts:2736-2763`; the re-rooted camera is a clone, `xrPortalEye.ts:94-108`). |
| 2 | No identity fast path; mono passes `new Matrix4()` each frame; `buildVisiblePathsByDestinationCell` twice per mono frame; `getRuntimeObjectVisiblePaths` rebuilt 3-6 times per frame by aim | Fast path and `new Matrix4()`: **hold** (:1518, :2463). Double join: **fixed by job 28** (snapshot). Aim calls: **fixed by job 16**; `getRuntimeObjectVisiblePaths` is deleted by job 28. `remapStereoPortalPathIds` still rebuilds (stereo only; out of scope, Decision 12). |
| 3 | `xrPortalEye` allocates per eye per frame; `camera.clone()` per re-rooted eye | **Holds** (line numbers changed by job 17: :49, :58, :75, :84, :89, :95). |
| 4 | Registry copies arrays; no version counter; labels allocate | Copies and labels: **hold**. Version counter: **added by job 28**. |
| 5 | Protractor feedback built then disposed on an equal signature | **Holds** (`createThreeApp.ts:3506-3517`, `:3558-3561`). |
| 6 | `needsUpdate` on every buffer of every archetype every frame | **Holds** (`renderPortalInstances.ts:216-218`, `:316-318`; moved by job 17). Job 17 also added a `Map`, a `Set` and one key string per candidate instance per archetype per frame (:257, :279, :327-332). |
| 7 | Per-object archetypes; empty archetypes stay visible | **Holds** (`runtimeSceneUtils.ts:180-186`; `runtimeObjectRenderArchetypes.ts:87-88`; `cellRenderArchetypes.ts:94-95`; `WebGLBufferRenderer.js:21` confirmed). Geodesic segments, cannons and balloons already share archetypes across objects (`geodesicCannonRenderer.ts:59-160`). |
| 41 | `scenePaletteController` serialises the whole definition every frame | **Holds** (`scenePaletteController.ts:231`); `createPaletteDefinition` also allocates a new definition every frame (`createThreeApp.ts:2140`, `:2172`). |

Also found (not in issue 75): every instance sync re-traverses every object's mesh hierarchy to collect its sources
(`collectRuntimeObjectRenderSourceMeshes`, today `createThreeApp.ts:2833`; the rover's at :2810), and
`runtimeObjectCameraPosition` allocates a `Vector3` per call (:2790). Part A fixes both.

### Allocations left after this job (do not fix; do not claim them fixed)

`syncXrDebugState` builds a new debug object each frame; `createPortalInstanceRenderDebugState` builds arrays each
frame; the visibility computation (job 21), the segment walk in `locateDevelopedPoint` and the aim ray walk allocate plain
objects; `remapStereoPortalPathIds` and the non-identity branch of `transformVisiblePortalResultToRenderFrame` allocate in
XR; the dedupe key strings in `updateRuntimeObjectRenderArchetypeInstances`; per-frame record arrays in the instance sync.

### How to count allocations in vitest

vitest runs in `node`. A test file can replace `three` with subclasses that count constructions; three's own internal
code imports its classes by relative path, so only **our** code is counted:

```ts
const counts = vi.hoisted(() => ({ Vector2: 0, Vector3: 0, Vector4: 0, Matrix4: 0, Quaternion: 0, Group: 0 }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  function counting<T extends new (...args: any[]) => object>(Base: T, name: keyof typeof counts): T {
    return class extends Base {
      constructor(...args: any[]) { super(...args); counts[name] += 1; }
    };
  }
  return {
    ...actual,
    Vector2: counting(actual.Vector2, "Vector2"), Vector3: counting(actual.Vector3, "Vector3"),
    Vector4: counting(actual.Vector4, "Vector4"), Matrix4: counting(actual.Matrix4, "Matrix4"),
    Quaternion: counting(actual.Quaternion, "Quaternion"), Group: counting(actual.Group, "Group"),
  };
});
function resetCounts(): void { for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0; }
```

Pattern for every allocation test: build inputs, call the function **once** (warm-up: module-scope scratch objects
and caches are created here), `resetCounts()`, call it again with the same inputs, expect every count to be 0.
`matrix.clone()` uses `new this.constructor()`, so clones of our matrices are counted too. If `vi.mock("three")` does
not work in this vitest version, use the fallback for that test: pass a fake renderer / target whose method records the
object it receives and assert that two calls receive the **same** object (`toBe`). Record which method you used.

### Conflicts with other jobs

- Job 22 (clip planes) may remove or change `updatePortalClipMaterialViewportFromRenderer` and the viewport uniforms:
  apply A1 to whatever per-draw viewport code exists, or skip it.
- Job 23 (stereo split roots) changes `syncStereoPortalInstanceRender`, `remapStereoPortalPathIds` and the union.
  This job does not touch those beyond the eye activation (A2).
- Job 19 (VR palette) may change `updateScenePalette` / `scenePaletteController`; B1 applies to whatever calls
  `scenePaletteController.update`.
- Job 37 adds the registry publisher; B2's cache invalidation must run on publisher writes too (same helper as job 28's
  version bump).

## Decisions

### Part A

1. **Viewport scratch (item 1).** Decided: `updatePortalClipMaterialViewportFromRenderer` uses a module-scope
   `const viewportScratch = new THREE.Vector4()` and sets the two uniforms directly
   (`portalViewportOriginPixels.value.set(v.x, v.y)`, `portalViewportPixels.value.set(v.z, v.w)`), no object literals.
2. **Eye activation once per eye (item 1).** Decided: a new module `src/render/three/portalEyeActivation.ts`:

   ```ts
   export interface PortalEyeActivatorDeps {
     getEyeCount(): number;                              // portalEyeRenderStates.length
     applyEye(eyeIndex: number): void;                   // sets activePortalEyeIndex + updatePortalClipMaterialTextureEye
     applyViewport(renderer: THREE.WebGLRenderer): void; // updatePortalClipMaterialViewportFromRenderer
   }
   export interface PortalEyeActivator {
     /** Call from scene.onBeforeRender: forgets the last camera so the next mesh re-applies eye and viewport. */
     beginRender(): void;
     /** Call from every archetype mesh's onBeforeRender; does nothing when renderCamera is the previous mesh's camera. */
     beforeMesh(renderer: THREE.WebGLRenderer, renderCamera: THREE.Camera): void;
   }
   export function createPortalEyeActivator(deps: PortalEyeActivatorDeps): PortalEyeActivator;
   ```

   `beforeMesh`: if `renderCamera === lastCamera` return. Else set `lastCamera`; if `getEyeCount() <= 1` the eye is 0;
   otherwise the eye is `renderer.xr.getCamera().cameras.indexOf(renderCamera)` when `renderer.xr.isPresenting`
   (three r0.164 renders stereo by calling `renderScene` once per persistent sub-camera of the `ArrayCamera`,
   `WebGLRenderer.js:1204-1208`, and its `cameras[i]` belongs to XR view `i`, the same order as
   `portalEyeRenderStates`); if that gives -1 or an index `>= getEyeCount()`, use today's viewport-centre fallback
   (:2749-2759) with module-scope scratch `Vector4`/`Vector2`. Then `applyEye(eye)` and `applyViewport(renderer)`.
   In `createThreeApp`: create the activator before line 1103 (temporal dead zone, see job 28), set
   `scene.onBeforeRender = () => portalEyeActivator.beginRender()` once (nothing else assigns it at `0b468e1`), replace
   both per-mesh hooks with `portalEyeActivator.beforeMesh(renderer, renderCamera)`, and delete
   `activatePortalRenderStateForCamera` and `findPortalEyeRenderState` (and the `matricesNearlyEqual` import if unused).
   Why: matching by camera identity works for re-rooted eyes too (the render camera is the XR sub-camera, never the
   clone), and the work runs once per eye instead of once per mesh.
3. **Identity fast path (item 2).** Decided: `xrPortalEye.ts` exports
   `export const identityRenderFromRootMatrix: THREE.Matrix4` with `Object.freeze(identityRenderFromRootMatrix.elements)`
   (a write through any `Matrix4` method then throws in strict-mode modules, so an accidental mutation fails loudly).
   It is returned by `unchanged()` and used for the mono roots at :1518 and :2463. `transformVisiblePortalResultToRenderFrame`
   returns `result` itself when `renderFromRootMatrix === identityRenderFromRootMatrix` or all 16 elements equal the
   identity exactly; otherwise unchanged behaviour (allocating). Before freezing, grep every use of
   `renderFromRootMatrix` and confirm none mutates it (they are read by `multiply` as the right operand, `applyMatrix4`,
   `clone`); record the list in the report.
4. **Persistent eye cameras (item 3).** Decided: `resolveXrPortalEyeRenderRoot` gets an optional
   `target?: XrPortalEyeRenderRootTarget`:

   ```ts
   export interface XrPortalEyeRenderRootTarget {
     camera: THREE.Camera | undefined;          // created on first re-root, then reused
     readonly renderFromRootMatrix: THREE.Matrix4;
   }
   export function createXrPortalEyeRenderRootTarget(): XrPortalEyeRenderRootTarget;
   ```

   With a target, a re-root copies into `target.camera` (create it once with `input.camera.clone(false)`, recreate if
   `target.camera.type !== input.camera.type`; then `target.camera.copy(input.camera, false)` and set the matrices as
   `transformCamera` does) and writes the inverse into `target.renderFromRootMatrix`; it returns those objects. Without
   a target, behaviour is unchanged (tests call it that way). The eye position uses a module-scope scratch `Vector3`;
   `isIdentity` compares with a module-scope constant array; `rigidTransformToThreeMatrix` gains an optional
   `target?: THREE.Matrix4` parameter (and uses a module-scope scratch for its inner matrix) so the walk transform is
   written into a module-scope scratch. `createThreeApp` keeps `const portalEyeRootTargets: XrPortalEyeRenderRootTarget[] = []`
   (before line 1103) and passes `portalEyeRootTargets[eyeIndex] ??= createXrPortalEyeRenderRootTarget()` from
   `resolvePortalEyeRenderRoot(cullingCamera, eyeIndex)` (mono uses eye 0).
5. **Protractor signature first (item 5).** Decided: export
   `protractorToolFeedbackSignature(options): string` from `protractorToolFeedback.ts` (the same string as :39-47);
   `createProtractorToolFeedback` calls it. `updateProtractorToolFeedback` computes the signature first and returns
   early when it equals `protractorToolFeedback?.signature`; only then builds. Remove the now-dead equal-signature branch
   of `syncProtractorToolFeedback` (:3558-3561).
6. **Instance writer scratch (item 6, allocation half).** Decided: `updateRuntimeObjectRenderArchetypeInstances` uses
   module-scope `Matrix4`, `Vector3`, `Map<string, number>` and `Set<string>`, cleared per archetype (`.clear()`).
   The key strings stay.
7. **No re-traversal of sources.** Decided: in `runtimeObjectInstanceSync.ts` keep
   `sourceKeysByObjectId: Map<string, { root: THREE.Object3D; keys: readonly string[] }>`. For an object whose root is
   the cached root and whose cached keys are all still in `renderSourcesByKey`, add the cached keys to `activeKeys`
   without calling `collectRuntimeObjectRenderSourceMeshes`; otherwise collect and re-cache. Same for the rover (key
   `"rover"`). Drop entries of objects not seen in the sync. Why: `toolObjectRuntimes.invalidateRuntimeObjectRenderState`
   deletes keys from the shared map, and a missing key is exactly the signal to re-collect.
8. **Other per-frame scratch.** Decided:
   - `runtimeObjectCameraPosition(renderCamera, renderFromRootMatrix, eyeIndex)` writes into
     `runtimeObjectCameraPositionScratch[eyeIndex]` (an array of `Vector3`, grown on demand, declared before line 1103);
     the snapshot's `cameraPositions` array is a reused array whose `length` is set per frame. JSDoc: "aliases scratch;
     valid until the next portal pass".
   - `updateScenePalette`: the `new THREE.Vector3()` / `new THREE.Quaternion()` fallbacks (:2123-2124) use shell scratch objects.
   - `geodesicEmitterLabelController`: one `Quaternion` and one `Set` created in the factory and reused (`.clear()`);
     the sweep iterates `geodesicEmitterLabelsByKey` directly (deleting the current entry while iterating a `Map` is safe).

### Part B

9. **Palette definition version (issue 41 item).** Decided: `createPaletteDefinition` gains an optional
   `nowMs = Date.now()` parameter used for `reloadConfirmationActive`. New in `src/ui/paletteDefinition.ts`:

   ```ts
   export interface PaletteDefinitionCache {
     /** Returns the cached definition, rebuilding it (version + 1) only when `state` (by reference), `inputMode` or the
      *  reload-confirmation flag at `nowMs` differ from the last call. */
     get(state: RuntimeMenuState, inputMode: InputMode, nowMs?: number): { readonly definition: PaletteDefinition; readonly version: number };
   }
   export function createPaletteDefinitionCache(appConfig: AppConfig): PaletteDefinitionCache;
   ```

   `ScenePaletteControllerUpdate` gains `readonly definitionVersion: number`; the controller calls
   `adapter.setDefinition` only when it differs from the last one (start at -1) and no longer calls `JSON.stringify`.
   Update the JSDoc of `definition` ("compared by `definitionVersion`, not by content"). `createThreeApp` creates the
   cache (before line 1103; `appConfig` is fixed for the app's lifetime, a config change restarts the app) and passes
   `definition` and `definitionVersion` from it at both `scenePaletteController.update` calls. Before relying on the
   key, read `createPaletteDefinition` to the end: if it reads anything other than its parameters and the clock, add it
   to the key and record that. Why: `menuState` is replaced immutably (module header of `createThreeApp.ts`), so
   reference equality is a complete change test.
10. **Cached registry queries (item 4).** Decided: `runtimeObjectRegistry.ts` caches query results:
    `allObjects: readonly RuntimeWorldObject[] | undefined` and
    `cellQueries: Map<string, { all?, collidable?, playerBlocking?, interactable?, tooltip? }>`, each array built on
    first request and `Object.freeze`d. Every content change (the helper that bumps the version in job 28, so also
    job 37's publisher) clears `allObjects` and the entries of the affected cells (both cells when an object moves).
    A returned array never changes afterwards; a later change returns a new array, so iterating an old `getAll()` while
    removing objects stays safe. Update the interface JSDoc ("fresh arrays" becomes "frozen arrays shared between calls
    until the next change"). Any caller that mutates a returned array is a bug the freeze will expose; fix it and
    record it.
11. **Skip unchanged per-frame refreshes (item 4).** Decided:
    - `refreshMeasuredGeodesicLengths()` in the frame (:1483) runs only when `runtimeObjectRegistry.getVersion()`,
      `playerPose.cellId` or the player's position (x, y, z, exact) differ from the values stored **after** its last run
      (store the version after the run, since the refresh itself may update the registry). Key variables go before line 1103.
    - `updateGeodesicEmitterLabels` runs the create/remove sweep only when the registry version differs from the last
      sweep (give the controller a `getRegistryVersion` dep); positioning of visible labels still runs every frame.
    - Hitbox debug is already gated by job 28.

### Part C

12. **Upload only changed instances (item 6).** Decided: both update functions in `renderPortalInstances.ts` write each
    instance through one helper that compares before writing: the 16 matrix floats as
    `array[16 * index + k] !== Math.fround(matrix.elements[k])` (the buffers are `Float32Array`), and `getX(index)` for
    the two attributes. Track `matrixChanged`, `pathIdChanged`, `clipIndexChanged` per archetype. After the loop, for
    each changed buffer: `clearUpdateRanges()`, `addUpdateRange(0, count * itemSize)` (16 or 1), `needsUpdate = true`.
    A buffer that did not change is not flagged; a smaller `count` alone needs no upload. Why: exact, needs no
    upstream dirty signals, and `addUpdateRange` exists in three r0.164 (`BufferAttribute.js:62`).
13. **Hide empty archetypes (item 7).** Decided: both update functions end with `archetype.mesh.visible = count > 0`.
    `prerenderCells` must still compile them: before `compile`, traverse `options.scene`, set every
    `isInstancedMesh` object with `visible === false` to `true` and remember it; after the warm-up views, set them back
    to `false`. Why: `renderer.compile` uses `traverseVisible` (`WebGLRenderer.js:920`), so hidden archetypes would
    compile on first sight and stall.
14. **Shared flag model archetypes (item 7, scoped).** Decided: placed flags of one `flagType` share the archetypes
    of their **model** meshes; the two text planes stay per flag (each flag has its own canvas texture). In
    `runtimeObjectRenderRecords.ts` add:

    ```ts
    export function placedFlagModelArchetypeKeyPrefix(flagType: string): string;   // `placed-flag:${flagType}:model`
    /** Like collectRuntimeObjectRenderSourceMeshes, but meshes named `placed-flag-text-plane:*` get keys under
     *  `ownPrefix` and every other mesh under the model prefix; both are numbered separately in traversal order. */
    export function collectPlacedFlagRenderSourceMeshes(
      flagId: string, flagType: string, root: THREE.Object3D, ownPrefix: string,
    ): readonly RuntimeObjectRenderSourceMesh[];
    ```

    The instance sync uses it for `kind === "placed-flag"`; a flag's records use the keys of its own prefix **and** of
    the model prefix (both from job 28's prefix index). The first flag to register a model key provides that source
    (`objectId` = that flag). When that flag is removed, `invalidateRuntimeObjectRenderState` drops the shared source and
    archetype; on the next sync another flag's cached keys are incomplete (Decision 7), so it re-collects and the archetype
    is rebuilt with all remaining flags. Capacity is `flagCount x maxVisiblePaths` (existing rule). Out of scope, record as
    follow-ups: sharing creature and asset archetypes by model (per-object scale and tint differ) and a text atlas.
15. **Marmot in one draw call (item 7).** Decided: `buildStaticMarmotProxy` builds the same 12 boxes (body, head,
    muzzle, tail, 2 ears, 2 eyes, 4 legs) (same sizes and
    positions), bakes each box's position into its geometry, adds a `color` attribute per vertex (body `0x8c6a43`,
    accent `0xe4d6bb`, eye `0x111111`), merges them with `mergeGeometries` from
    `three/examples/jsm/utils/BufferGeometryUtils.js`, and returns a group with **one** mesh `marmot:${objectId}` using
    `new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })`. The eyes lose their 0.6 roughness;
    accepted. Keep the function name and the root name `asset:${objectId}`.

## Steps

Run `npx vitest run <file>` after each step as named, then `npm run typecheck`. Each Part ends with the full check
list (Tests and checks) and **one commit** whose message starts with `Job 29 Part A:` / `Part B:` / `Part C:`.

### Part A: allocation churn

1. A1 (Decision 1). Test in a new `tests/render-contract/frameAllocations.test.ts` (with the counting mock from
   Background): a fake renderer `{ getCurrentViewport: (target) => target.set(10, 20, 300, 400) }`; after warm-up a
   second call constructs no `Vector4`, and the uniforms hold `(10, 20)` and `(300, 400)`. Run the file and
   `tests/render-contract/portalClipMaterial.test.ts`.
2. A2 (Decision 2). New `tests/render-contract/portalEyeActivation.test.ts` with two `THREE.PerspectiveCamera`s `camL`,
   `camR` and a fake renderer `{ xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) },
   getCurrentViewport, getDrawingBufferSize }` (`vi.fn`s):
   - `getEyeCount = 2`: `beginRender()`, 100 x `beforeMesh(renderer, camL)`, 100 x `beforeMesh(renderer, camR)`:
     `applyEye` calls are `[0, 1]`, `applyViewport` is called twice, `getCurrentViewport` never;
   - an unknown camera with viewport `(960, 0, 960, 1080)` and drawing buffer width 1920 gives eye 1; two such calls
     (with `beginRender()` between) pass the same target object to `getCurrentViewport` (`toBe`);
   - `getEyeCount = 1`: eye 0, once per `beginRender()`;
   - after `beginRender()` the same camera applies again.

   Then wire it into `createThreeApp.ts`. Run the file and `npx vitest run tests/render-contract`.
3. A3 and A4 (Decisions 3, 4). New `tests/render-contract/portalEyeFrameTransforms.test.ts`: identity input returns the
   same result object (`toBe`); a translation `renderFromRoot` premultiplies every path matrix (compare elements);
   `identityRenderFromRootMatrix.makeTranslation(1, 0, 0)` throws. In `xrPortalEye.test.ts` add: with a target, two
   re-rooting calls return the **same** camera object (`toBe(target.camera)`) and the same matrix as without a target
   (within 1e-9); the eye-inside-the-cell case returns `identityRenderFromRootMatrix`. In `frameAllocations.test.ts`:
   the inside-the-cell call and a second re-rooting call with a target construct no `Matrix4` and no `Vector3`
   (`counts.Matrix4 === 0`, `counts.Vector3 === 0`). Run those files and `tests/render-contract/vrLocomotion.test.ts`.
4. A5 (Decision 5). New `tests/render-contract/protractorToolFeedback.test.ts`: equal inputs give equal signatures;
   a hover yaw differing by 1e-3 gives a different one; `createProtractorToolFeedback(...).signature` equals
   `protractorToolFeedbackSignature(...)`. Run it.
5. A6 (Decision 6). In `frameAllocations.test.ts`: a second `updateRuntimeObjectRenderArchetypeInstances` call with the
   same inputs (one record, two paths) constructs no `Matrix4`/`Vector3`. Run it and
   `tests/render-contract/runtimeObjectPortalInstances.test.ts`.
6. A7 and A8 (Decisions 7, 8). In `runtimeObjectInstanceSync.test.ts`: wrap `collectRuntimeObjectRenderSourceMeshes`
   by counting `traverse` calls on the object's root (`vi.spyOn(root, "traverse")`): two syncs traverse once; after
   deleting one of its keys from `renderSourcesByKey`, the next sync traverses again. In `frameAllocations.test.ts`: a
   second `updateGeodesicEmitterLabels()` with an empty registry constructs no `Quaternion`. Run both files.
7. Part A checks (Tests and checks), manual allocation check (below) if a browser is available, commit "Job 29 Part A: ...".

### Part B: version counters

8. B1 (Decision 9). New `tests/ui/paletteDefinitionCache.test.ts`: the same state object twice gives the same
   `version` and the same `definition` (`toBe`); a new state object gives `version + 1`; switching `inputMode` gives
   `+1`; a state with `reloadConfirmUntilMs = 1000` gives `reloadConfirmationActive === true` at `nowMs = 500` and, for the
   **same** state object at `nowMs = 1500`, a new version with `false`. Then change `scenePaletteController.ts` and the two
   call sites. Run the file, `tests/ui` and `tests/render-contract/scenePalette*.test.ts`.
9. B2 (Decision 10). In `runtimeObjectRegistry.test.ts`: two `getObjectsInCell("cell-a")` calls without a change return
   the same array (`toBe`); after `update` of an object in `cell-a` the array differs and holds the new object; the
   `cell-b` array is unchanged (`toBe`) after a change in `cell-a`; arrays are frozen (`Object.isFrozen`); iterating an
   old `getAll()` array while removing every object visits all of them; a job-37 publisher write invalidates like
   `update`. Run the file, then `npm test` (other modules depend on the registry).
10. B3 (Decision 11). No unit test for the shell skip (no harness); `npm run typecheck` and the smoke cover it. For the
    label sweep, add `tests/render-contract/geodesicEmitterLabelController.test.ts` with an empty registry and a stub
    `getRegistryVersion`: call `updateGeodesicEmitterLabels()` once; then put a stale entry
    `{ text: "G9", root: new THREE.Object3D() }` under key `"stale"` into `geodesicEmitterLabelsByKey`; a second call with
    the **same** version leaves it there (sweep skipped); after the stub returns version + 1, the next call removes it.
    Run the files touched.
11. Part B checks, commit "Job 29 Part B: ...".

### Part C: buffers and draw calls

12. C1 (Decision 12). In `portalInstanceBuffers.test.ts` (cells) and `runtimeObjectPortalInstances.test.ts`
    (objects): a second identical update leaves `instanceMatrix.version`, `portalPathIdAttribute.version` and
    `portalClipIndexAttribute.version` unchanged; changing one path matrix bumps only `instanceMatrix.version` and
    `instanceMatrix.updateRanges` equals `[{ start: 0, count: count * 16 }]`; changing only a clip index bumps only the
    clip attribute's version. Run both files.
13. C2 (Decision 13). In the same two files: an archetype with no paths ends `visible === false`, with one path
    `true`. In `prerenderCells.test.ts`: add an `InstancedMesh` with `visible = false` to the scene; a `compile` spy sees
    it visible at call time; afterwards it is `visible === false` again. Run the three files.
14. C3 (Decision 14). In `runtimeObjectInstanceSync.test.ts`: three `createPlacedFlagObject({ flagType: "WoodenSign1", ... })`
    flags in one cell, each with a root holding two model meshes (`fake-sign-board`, `fake-sign-post`, as in
    `placedFlagRenderer.test.ts`) and two text meshes named `placed-flag-text-plane:<id>:front|back`. After one sync with a
    depth-0 path for that cell: 8 archetypes (2 model + 3 x 2 text; before this job 12), and each model archetype has
    `mesh.count === 3`. Remove one flag the way `toolObjectRuntimes` does (registry `remove`, delete its root, delete its
    sources and archetypes) and sync: the model archetypes exist again with `count === 2`. Run the file and
    `tests/render-contract/placedFlagRenderer.test.ts`.
15. C4 (Decision 15). In `tests/render-contract/buildDecorationMesh.test.ts` (or a new file): `buildStaticMarmotProxy("m")`
    contains exactly one `THREE.Mesh`, its geometry has a `color` attribute and `12 * 24 = 288` vertices, and its bounding
    box equals the union of the old boxes, min `(-0.17, 0, -0.46)` and max `(0.17, 0.41, 0.5)`, within 1e-6 (body x
    half-width 0.17; legs reach y = 0; ears reach y = 0.41; tail reaches z = -0.46; muzzle reaches z = 0.5). Run it and `tests/world-objects/geodesicMarmot.test.ts`.
16. Docs: header comments of `renderPortalInstances.ts` (dirty upload, visibility), `runtimeObjectRenderArchetypes.ts`
    (shared flag archetypes), `scenePaletteController.ts`, `runtimeObjectRegistry.ts` (cached frozen queries),
    `portalEyeActivation.ts`. `npm run docs:check`; `npm run docs:generate` if stale.
17. Part C checks, the manual draw-call check (below), commit "Job 29 Part C: ...".

## Tests and checks

After **each** Part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale),
`npm run build`, then `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Runtime-only errors such
as a temporal-dead-zone crash (`Cannot access 'X' before initialization`) are invisible to typecheck and vitest: every
new `const`/`let` in `createThreeApp.ts` must be declared **before** the initial build (`rebuildCellMeshes()` /
`syncPortalInstanceRender()`, line 1103 at `0b468e1`), never next to the function that uses it.

Manual checks (record "not run" with the reason if no browser/headset):

- **Allocation (after Part A), Chrome:** `npm run build`, `npx vite preview`, open
  `?config=full&world=cube`, click into the canvas, stand still. DevTools > Performance > tick "Memory" > record 10 s.
  Note the JS heap sawtooth (MB per second, number of minor GCs) on the parent commit and after Part A. Then
  DevTools > Memory > "Allocation sampling" > 10 s > sort by "Self size": none of `updatePortalClipMaterialViewportFromRenderer`,
  `findPortalEyeRenderState`, `transformVisiblePortalResultToRenderFrame`, `resolveXrPortalEyeRenderRoot`,
  `runtimeObjectCameraPosition`, `updateGeodesicEmitterLabels` should appear. Record the numbers.
- **Draw calls (after Part C):** `?config=full&world=cube&debugLevel=basic&debugOverlay=1&debugOverlayItems=fps`
  (or enable the overlay in the menu: settings > debug > overlay > FPS). Place 20 flags of one type in the start cell,
  stand still facing them, read `webgl: N calls` on the parent commit of Part C and after it. Expected per flag:
  `M + 2` calls before, 2 after (plus `M` once), where `M` is the sign model's mesh count, so at least a 50% drop when
  `M >= 2`. Record both numbers and `M`; if the drop is below 50%, record it under `### Uncertain` (not a failure). No
  bundled world has marmots; the marmot is covered by test 15.
- **Headset:** stereo XR, look through a portal at a flag with one eye's view crossing the portal: the image matches
  the parent commit (issue 75 acceptance "stereo XR visual output unchanged").

## Bookkeeping

Close issue 75 when the job is done (Outcome, Closing evidence: the three commits, the tests, the manual numbers). If
a manual check was not run, set the job to "done, needs review" and leave issue 75 open with a one-line pointer.

## Do not

- Do not change the visibility computation (job 21), clip planes (job 22) or stereo union / path-id remapping (job 23).
- Do not change the ghost rule, the placement dedupe rule or instance order.
- Do not share creature or asset archetypes across objects, and do not merge flag text planes (follow-ups).
- Do not mutate `identityRenderFromRootMatrix` or any array returned by the registry.
- Do not leave `JSON.stringify` in the per-frame palette path.
- Do not squash the Parts into one commit.

## Done when

- [ ] Part A: the allocation tests in `frameAllocations.test.ts` pass with zero counts; the eye activator replaces
      `findPortalEyeRenderState`; committed.
- [ ] Part B: palette rebuilt only on a new `definitionVersion`; registry queries cached and frozen; measured-length
      refresh and label sweep skip unchanged frames; committed.
- [ ] Part C: buffers uploaded only on change with `addUpdateRange`; empty archetypes hidden and still pre-compiled;
      flags share model archetypes; the marmot is one mesh; committed.
- [ ] `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build` and the smoke on four worlds pass after each Part.
- [ ] Issue 75 closed (or left open with a pointer); report written per [README](README.md), with the manual numbers.
