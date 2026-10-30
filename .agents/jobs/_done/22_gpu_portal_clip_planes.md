# Job 22 - GPU portal clipping with clip planes

Status: done, needs review on 2026-10-30 (commits d94e46a, ae61b56, 43df83f).
Rewritten on 2026-10-29 for a less capable implementing model (line numbers re-checked at commit `0b468e1`).
Resolves: issue [58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md).

## Goal

Replace the per-fragment NDC-polygon clip (an 8-vertex float texture read up to 32 times per fragment, `discard` in
every patched program) by **4 world-space clip planes per (path, eye)**, evaluated **once per vertex**:

1. With `WEBGL_clip_cull_distance` the vertex shader writes `gl_ClipDistance[0..3]`; the clipped programs contain **no
   `discard`** and keep early depth rejection; triangles are clipped before rasterisation.
2. Without it, the vertex shader writes one `vec4` varying and the fragment shader does a single compare and `discard`
   (no texture fetch, no loop, no winding sum).
3. No visible path is ever drawn fully clipped because its clip did not fit: planes are fixed-size, and the clip slots
   are sized for the union of all eyes. Any slot overflow is counted and reported, never silent.
4. With one root for all eyes (mono and shared-root stereo) the root cell is drawn by an **unpatched** program, so it
   keeps early-Z even on the fallback path.

## Depends on

- [Job 21](21_per_frame_visibility_funnel.md): every `VisiblePortalPath` carries `clipPlanes: Float64Array(16)` (4
  planes `(nx, ny, nz, d)`, inside where `n·X + d >= 0`, in the Three.js frame of the path's root cell, `|n| = 1` or
  `(0, 0, 0, 1)` for "always inside"), and `clipPolygonNdc` has at most 8 vertices.
- In the batch this job runs after jobs 28 and 29, which change `renderFrame`, `findPortalEyeRenderState`,
  `updatePortalClipMaterialViewportFromRenderer` (scratch `Vector4`), the archetype `onBeforeRender` hooks and
  `transformVisiblePortalResultToRenderFrame` (identity fast path, pooled matrices). **Search by function name;**
  keep their allocation fixes when you rewrite these places.
- Job 23 (later, another writer) gives split-root depth-0 paths a normal clip slot whose row is "always inside" in its
  own eye and "always outside" in the other. This job provides those two plane rows (`writeAlwaysInsidePlanes`,
  `writeAlwaysOutsidePlanes`) and leaves the split-root branch otherwise as it is.

## Before you start

| File | Lines at `0b468e1` | What |
| --- | --- | --- |
| `src/render/three/portalClipData.ts` | all (190) | polygon texture: width = 8 vertices, height = `maxVisiblePaths × eyes` rows (:63); `updateStereo` (:108-165): union sorted by path id and cut to `maxVisiblePaths` (:129-131), vertex overflow -> no slot (:133-137) |
| `src/render/three/portalClipMaterial.ts` | all (381) | `PortalClipMaterialState` (:22-40, viewport uniforms), `createPortalClipMaterialState` (:43), `updatePortalClipMaterialViewport` (:64), `updatePortalClipMaterialTextureEye` (:74), `updatePortalClipMaterialViewportFromRenderer` (:87), `patchPortalClipMaterial` (:108), `viewportPixelsToNdc` (:120, test-only), `patchSinglePortalClipMaterial` (:130, cache key :152), `patchVertexShader` (:160, depth push :184-186), `patchFragmentShader` (:193, `discard` at :223/:226/:232), `portalClipShaderFunctions` (:241-380: hard mode :262-315, smooth mode :317-378) |
| `src/render/three/renderPortalInstances.ts` | 9-14, 58-60, 83, 195-224, 237-320, 352-405 | header, debug-state fields `clipPolygonOverflowPathIds` / `visiblePathOverflowCount`, `unclippedPortalClipIndex = -2`, `updateCellRenderArchetypeInstances` (clip index at :211), `updateRuntimeObjectRenderArchetypeInstances` (:309), `createPortalInstanceRenderDebugState` |
| `src/render/three/cellRenderArchetypes.ts` | 37-53, 80-122, 300-313 | `CellRenderArchetype`, `buildCellRenderArchetypes`, material clone + `patchPortalClipMaterial` |
| `src/render/three/runtimeObjectRenderArchetypes.ts` | 81 | runtime-object material patch |
| `src/render/three/portalEyeFrameTransforms.ts` | 42-56 | `transformVisiblePortalResultToRenderFrame` |
| `src/render/three/createThreeApp.ts` | 246, 439, 874-879, 884, 914-915, 1231, 2432-2436, 2469-2473, 2532-2535, 2653-2667, 2710-2734, 2875-2877 | imports (`portalClipEdgeSmoothingEnabled`), `renderer.localClippingEnabled = true`, clip data/state creation, default debug state, viewport updates, archetype `onBeforeRender` hooks, `activatePortalRenderStateForCamera`, `createPortalInstanceRenderStateFromVisibleResult` |
| `src/render/three/renderQuality.ts` | 8, 16, 32-33, 109 | `portalClipEdgeSmoothingEnabled = false` (smooth mode is compiled off today) |
| `src/render/three/renderState.ts` | 144-145 | `clipPolygonOverflowPathIds`, `visiblePathOverflowCount` |
| `src/render/three/debugOverlay.ts` | 143 | overlay line that sums both overflow counters |
| `node_modules/three/src/renderers/webgl/WebGLPrograms.js` | 353 | `extensionClipCullDistance` = `material.extensions.clipCullDistance === true && extensions.has('WEBGL_clip_cull_distance')` |
| `node_modules/three/src/renderers/webgl/WebGLProgram.js` | 148, 523 | adds `#extension GL_ANGLE_clip_cull_distance : require` and `#define USE_CLIP_DISTANCE` to the **vertex** prefix only; three never calls `gl.enable(CLIP_DISTANCEi)` |
| `tests/render-contract/portalClipData.test.ts`, `portalClipMaterial.test.ts`, `portalInstanceBuffers.test.ts` | all | existing tests (shader-string tests run without WebGL) |
| `_docs/MATHEMATICAL_MODEL.md` | 331-352 | Section 8 "Instancing" and "Clipping on the GPU" |

three.js is `^0.164.1` (WebGL2 only, GLSL ES 3.00: `texelFetch` is available in vertex shaders).

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`.

## Background

Issue 58 evidence, re-checked at `0b468e1`: still true, except that the smooth mode is compiled off
(`renderQuality.ts:16`) and the runtime-object clip index line is `renderPortalInstances.ts:309` (not `:275`). The
vertex overflow is already impossible after job 21 (planes give at most 8 NDC vertices), but the polygon path still
pays 32 fetches per fragment and `discard` everywhere.

**Why planes are exact.** Job 21 gives each path's visible region as the intersection of 4 half-spaces through the eye.
A plane equation is affine in world position, and world position is affine in object position, so the per-vertex value
`dot(n, X) + d` interpolates exactly (perspective-correct interpolation of an affine function is exact). Clipping by
`gl_ClipDistance` or by the interpolated varying therefore cuts precisely along the plane.

**Frames.** Planes come in the Three.js frame of the path's root cell. `transformVisiblePortalResultToRenderFrame`
already maps `rootFromDestinationMatrix` by `renderFromRoot`; it must map the planes the same way (a rigid map
`X' = Q X + t` sends the plane `(n, d)` to `(Q n, d - (Q n)·t)`). In the shader the vertex's render-frame position is
`modelMatrix * instanceMatrix * vec4(transformed, 1.0)`.

## Decisions

1. **Not three.js `clippingPlanes`.** Decided: custom shader code. Why: `material.clippingPlanes` are per material, not
   per instance (one draw holds many paths), and three implements them with `discard` in
   `clipping_planes_fragment.glsl.js:53`, which is the early-Z problem itself. `renderer.localClippingEnabled = true`
   (`createThreeApp.ts:439`) stays; nothing in `src` sets `clippingPlanes`.
2. **Plane data layout.** Decided: rewrite `portalClipData.ts` in place (same module and factory name):

   ```ts
   export const portalClipPlaneTextureWidth = 1024;          // texels per row
   export const portalClipEpsilonMeters = 1e-5;              // inside tolerance, meters
   /** Texel holding plane `plane` (0..3) of clip slot `slot` for eye `eye`. */
   export function portalClipPlaneTexelIndex(slot: number, eye: number, plane: number, eyeCount: number): number {
     return (slot * eyeCount + eye) * 4 + plane;
   }
   export interface PortalClipData {
     readonly texture: THREE.DataTexture;                    // RGBA Float, width 1024
     readonly maxClipSlots: number;                          // maxVisiblePaths × maxClipTextureEyes
     readonly maxClipTextureEyes: number;
     readonly textureRows: number;                           // ceil(maxClipSlots × eyes × 4 / 1024)
     readonly clipIndexByPathId: ReadonlyMap<number, number>;
     readonly pathIdByClipIndex: readonly number[];
     readonly visiblePathOverflowCount: number;              // union paths without a slot; 0 by construction
     update(paths: readonly VisiblePortalPath[]): void;
     updateStereo(pathsByEye: readonly (readonly VisiblePortalPath[])[]): void;
     dispose(): void;
   }
   ```

   Texel `t` is at `(t % 1024, floor(t / 1024))`; its RGBA is `(nx, ny, nz, d)`. For `maxVisiblePaths = 2000`, 2 eyes:
   4000 slots, 32 000 texels, 32 rows (issue 58 item 6: no dimension grows with `maxVisiblePaths` beyond what fits in
   2048). `updateStereo`: union by path id (sorted by path id, as today), slot = rank; every texel of every used
   `(slot, eye)` is first set to **always outside** `(0, 0, 0, -1)`, then each eye writes the 4 planes of each of its
   visible paths. So a union path not visible in an eye is fully clipped in that eye (today's empty-row behaviour).
   Upload with `texture.needsUpdate = true` as today.
   Removed: `maxClipVerticesPerPath`, `defaultMaxClipVerticesPerPath`, `polygonVertexCountsByPathId`,
   `polygonVertexOverflowPathIds`, `writePolygonRow`.
3. **Overflow policy.** Decided:
   - Plane count: fixed at 4 by type; nothing can overflow.
   - Slots: `maxClipSlots = maxVisiblePaths × maxClipTextureEyes`, and each eye returns at most `maxVisiblePaths`
     paths, so the union always fits. If it ever does not (a bug), the paths beyond the capacity get **no instance at
     all** (they are removed from the instance list, not drawn with clip index -1), `visiblePathOverflowCount` counts
     them, `console.warn` runs once per session with the count, and the debug overlay shows it (`debugOverlay.ts:143`,
     now only `visiblePathOverflowCount`).
   - A visible path is never given clip index -1. Clip index -1 remains only as the "unknown" default in
     `updateCellRenderArchetypeInstances`; add a test that no visible path in the union maps to -1.
   Why: issue 58 acceptance ("no visible path drawn with clip index -1 because of size"). This also removes the
   "union up to 4000 vs 2000 slots" item of issue 59; tell job 23 (coordinator note) that only the archetype
   capacity part of its union-budget item remains.
4. **Shader.** Decided (vertex stage; `PORTAL_CLIP_HARDWARE` is our own define, set when the state's
   `hardwareClipDistances` is true; in that case also set `material.extensions = { ...material.extensions,
   clipCullDistance: true }` so three emits the `#extension` line and `USE_CLIP_DISTANCE`):

   ```glsl
   // after #include <common>
   uniform highp sampler2D portalClipPlaneTexture;
   uniform int portalClipEyeIndex;
   uniform int portalClipEyeCount;
   attribute float portalPathId;
   attribute float portalClipIndex;
   varying float vPortalPathId;
   #ifndef PORTAL_CLIP_HARDWARE
   varying vec4 vPortalClipDistances;
   #endif
   vec4 portalClipPlane(int slot, int planeIndex) {
     int t = (slot * portalClipEyeCount + portalClipEyeIndex) * 4 + planeIndex;
     return texelFetch(portalClipPlaneTexture, ivec2(t % 1024, t / 1024), 0);
   }
   // after #include <project_vertex>  (keep the existing depth push for portalClipIndex >= -0.5)
   vec4 portalRenderPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
   vec4 portalClipDistances;
   if (portalClipIndex < -1.5) { portalClipDistances = vec4(1.0); }            // -2: unclipped root
   else if (portalClipIndex < -0.5) { portalClipDistances = vec4(-1.0); }      // -1: no slot
   else {
     int slot = int(portalClipIndex + 0.5);
     for (int j = 0; j < 4; j++) {
       vec4 plane = portalClipPlane(slot, j);
       portalClipDistances[j] = dot(plane.xyz, portalRenderPosition.xyz) + plane.w + PORTAL_CLIP_EPSILON;
     }
   }
   #ifdef PORTAL_CLIP_HARDWARE
   gl_ClipDistance[0] = portalClipDistances.x; gl_ClipDistance[1] = portalClipDistances.y;
   gl_ClipDistance[2] = portalClipDistances.z; gl_ClipDistance[3] = portalClipDistances.w;
   #else
   vPortalClipDistances = portalClipDistances;
   #endif
   ```

   `PORTAL_CLIP_EPSILON` is the literal of `portalClipEpsilonMeters` (`1e-5`; a leak of at most
   `1e-5 / (depth × pixel angle)` px, under 0.4 px at the 0.03 m near plane for a 1e-3 rad pixel). Fragment stage:
   in hardware mode **no portal code at all** (the `vPortalPathId` varying stays declared for debugging); otherwise,
   after `void main() {`: `if (any(lessThan(vPortalClipDistances, vec4(0.0)))) discard;`. Guard the
   `instanceMatrix` line with `#ifdef USE_INSTANCING` (non-instanced use: `modelMatrix * vec4(transformed, 1.0)`).
   Program cache key: `portal-clip-planes:${maxClipTextureEyes}:${hardware ? "hw" : "frag"}`.
5. **Enabling hardware clip distances.** Decided: WebGL requires `gl.enable(ext.CLIP_DISTANCE0_WEBGL + i)`, and
   enabling a distance a program does not write is undefined, so enable them only around patched draws. Export from
   `portalClipMaterial.ts`:

   ```ts
   export interface PortalClipDistanceToggle { enable(): void; disable(): void; }
   export function createPortalClipDistanceToggle(renderer: THREE.WebGLRenderer): PortalClipDistanceToggle | undefined;
   ```

   (`undefined` when `renderer.extensions.has("WEBGL_clip_cull_distance")` is false; `ext = renderer.extensions.get(...)`,
   `gl = renderer.getContext()`; enable/disable `CLIP_DISTANCE0_WEBGL + 0..3`.) In `createThreeApp.ts` the patched
   archetype meshes (cell archetypes and runtime-object archetypes; search `archetype.mesh.onBeforeRender`) call
   `toggle?.enable()` at the end of `onBeforeRender` and get an `onAfterRender` that calls `toggle?.disable()`.
   `hardwareClipDistances = toggle !== undefined`. Log once: `console.info("Portal clip mode: hardware clip
   distances")` or `"... fragment discard"`, and expose `portalClipMode: "hardware" | "fragment"` in
   `PortalInstanceRenderDebugState` (shown in the debug overlay next to the overflow count).
6. **Eye selection.** Decided: the uniform `portalClipEyeIndex` replaces `portalClipTextureRowOffset`;
   `updatePortalClipMaterialTextureEye(state, eyeIndex)` keeps its name and now sets it (clamped as today).
   `activatePortalRenderStateForCamera` is unchanged.
7. **Removed.** Decided: the viewport uniforms and functions (`portalViewportOriginPixels`, `portalViewportPixels`,
   `updatePortalClipMaterialViewport`, `updatePortalClipMaterialViewportFromRenderer`, `viewportPixelsToNdc`), the
   uniforms `portalMaxVisiblePaths`, `portalMaxClipVerticesPerPath`, `portalClipTextureRows`,
   `portalClipTextureRowOffset`, both polygon shader modes (`portalFragmentShouldDiscard`,
   `portalFragmentClipCoverage`, `portalInterleavedGradientNoise`, `portalClipVertex`, `portalClipVertexCount`), the
   `smoothClipEdges` option, `portalClipEdgeSmoothingEnabled` and `RenderQualityState.portalClipEdgeSmoothing`
   (`renderQuality.ts`), and the debug fields `clipPolygonVertexCountsByPathId` / `clipPolygonOverflowPathIds`
   (`renderPortalInstances.ts`, `renderState.ts`, `createThreeApp.ts`). Fix every caller `npm run typecheck` reports.
   Keep `clipPolygonNdc` on `VisiblePortalPath`: the debug overlay (`portalClipPolygonOverlay.ts`) still draws it.
   Why: a plane clip has no screen-space edge to smooth, and the smooth mode is off today anyway.
8. **Root without clipping (early-Z on the fallback path).** Decided (Part C): every `CellRenderArchetype` gets
   `readonly rootMesh: THREE.Mesh` sharing the archetype's geometry, with an **unpatched** clone of the source material
   (clone before patching), `matrixAutoUpdate = false`, `visible = false`, `frustumCulled = false`, added to the scene
   next to `mesh` and disposed with it (`disposeCellRenderArchetypes`). `updateCellRenderArchetypeInstances` gets an
   options argument `{ separateRoot: boolean }`: when true, a depth-0 path sets `rootMesh.visible = true`,
   `rootMesh.matrix.copy(path.rootFromDestinationMatrix)`, `rootMesh.matrixWorldNeedsUpdate = true` and is **not**
   written as an instance; archetypes without a depth-0 path hide `rootMesh`. `separateRoot` is true in
   `syncPortalInstanceRender` (mono) and in the shared-root branch of `syncStereoPortalInstanceRender`, false in the
   split-root branch (job 23 changes that branch). Runtime-object archetypes keep `-2` for depth 0 (no separate root
   mesh). Note: after [job 38](38_draw_assets_from_registry.md) static assets (houses, trees) are runtime objects too,
   so they lose the early-Z benefit of `rootMesh` in the root cell; this is accepted (they are a small share of root
   fragments). Do not move assets back into cell archetypes; record the observation in the Report if the fallback
   path is noticeably slower in the root cell. The debug renderer (`createPortalInstanceDebugRenderer`) ignores `rootMesh`.
9. **Planes to the render frame.** Decided: add `transformClipPlanes(planes: Float64Array, renderFromRoot:
   THREE.Matrix4, out: Float64Array): void` to `portalEyeFrameTransforms.ts` and call it from
   `transformVisiblePortalResultToRenderFrame` for each path (into a new `Float64Array(16)`, or into job 29's pool if it
   pools matrices there; with job 29's identity fast path no copy is needed). An always-inside plane `(0,0,0,1)` maps to
   itself.

## Steps

Run `npx vitest run <file>` after each step; `npm run typecheck` after each Part. After each Part also run
`npm run build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` (shader errors only show at
runtime; a single failure right after a build: rerun once).

### Part A: plane data and vertex-stage clipping, fragment fallback only (commit 1)

1. `portalEyeFrameTransforms.ts`: `transformClipPlanes` and its use (Decision 9).
2. Rewrite `portalClipData.ts` (Decisions 2-3) with a new module header.
3. Rewrite `portalClipMaterial.ts` (Decisions 4, 6, 7) **with `hardwareClipDistances` always false for now**:
   `createPortalClipMaterialState(clipData, options: { hardwareClipDistances?: boolean } = {})`; uniforms
   `portalClipPlaneTexture`, `portalClipEyeIndex`, `portalClipEyeCount`. Rewrite the module header.
4. `renderPortalInstances.ts` / `createThreeApp.ts` / `renderQuality.ts` / `renderState.ts` / `debugOverlay.ts`:
   remove what Decision 7 lists; implement the "no instance without a slot" rule (Decision 3) where the union is
   instanced (`applyPortalVisiblePaths` / `applyPortalVisibleResult` and `updateRuntimeObjectRenderArchetypeInstances`
   callers: filter the visible paths by `portalClipData.clipIndexByPathId.has(id)` for depth > 0 before grouping).
5. Tests (rewrite `portalClipData.test.ts` and `portalClipMaterial.test.ts`; list removed tests under
   `### Deviations`):
   - Layout: `portalClipPlaneTexelIndex(3, 1, 2, 2) === 30`; with `maxVisiblePaths: 2000`, 2 eyes:
     `maxClipSlots === 4000`, `textureRows === 32`, texture width 1024.
   - Writing: two eyes, eye 0 sees paths {1, 2}, eye 1 sees {2, 3}, each with distinct planes. Slots: 1 -> 0, 2 -> 1,
     3 -> 2. Read back texels with the index function: eye 0 slot 2 (path 3) holds 4 × `(0,0,0,-1)`; eye 1 slot 1
     holds path 2's eye-1 planes; `visiblePathOverflowCount === 0`.
   - Union of two full eyes (2000 distinct ids each, `maxVisiblePaths: 2000`): all 4000 get slots, overflow 0.
   - `transformClipPlanes`: `renderFromRoot` = translation `(1, 0, 0)`, plane `(1, 0, 0, 0)` -> `(1, 0, 0, -1)`; with a
     90° rotation about +y (`makeRotationY(Math.PI / 2)`) the plane `(1, 0, 0, 0)` -> `(0, 0, -1, 0)`; for 100 random
     rigid matrices and points, `n·X + d` is invariant (`n'·(M X) + d'` equals it to 1e-9).
   - CPU emulation of the shader (no WebGL): write a small TS function in the test that mirrors the GLSL
     (`clipDistancesForVertex(data, slot, eye, eyeCount, renderPosition)` reading the `Float32Array` with the index
     function, plus the -2/-1 branches). For a path computed by `computeVisiblePortalPaths` (cube, a camera looking
     through a portal): world points inside the region pass, a point outside fails, and -2 always passes.
   - Pixel leakage (issue 58 acceptance, CPU form): for that path and camera, for 20 000 random pixel centres, take the
     ray through the pixel and the point at depth 1 m; the plane test (with epsilon) says "inside" => the pixel centre
     is inside `clipPolygonNdc` grown by 1 px; inside `clipPolygonNdc` shrunk by 1 px => the plane test says inside.
     Include a camera where the polygon has an edge shorter than 2 px.
   - Shader strings (same fake-shader pattern as the current `portalClipMaterial.test.ts`): vertex shader contains
     `texelFetch(portalClipPlaneTexture`, `vPortalClipDistances = portalClipDistances;` and the depth push; fragment
     shader contains `any(lessThan(vPortalClipDistances` and **no** `texture2D(` / `texture(` call and no `for (`;
     `customProgramCacheKey()` ends with `:frag`.
6. Commit: "Job 22 Part A: portal clipping by four world-space planes".

### Part B: hardware clip distances (commit 2)

1. `createPortalClipDistanceToggle` and the `onBeforeRender` / `onAfterRender` wiring (Decision 5); pass
   `hardwareClipDistances: toggle !== undefined` to `createPortalClipMaterialState`; set
   `material.extensions.clipCullDistance` in hardware mode; debug-state field `portalClipMode`.
2. Tests:
   - Hardware shader strings: vertex shader contains `gl_ClipDistance[3] = portalClipDistances.w;` inside
     `#ifdef PORTAL_CLIP_HARDWARE` and the define is present; the fragment shader contains **no** `discard`; the
     material has `extensions.clipCullDistance === true`; the cache key ends with `:hw`.
   - Toggle with a fake renderer (`{ extensions: { has: () => true, get: () => ({ CLIP_DISTANCE0_WEBGL: 0x3000 }) },
     getContext: () => ({ enable: spy, disable: spy }) }`): `enable()` calls `gl.enable` with 0x3000..0x3003,
     `disable()` the same with `gl.disable`; with `has: () => false` the factory returns `undefined`.
3. Smoke, then commit: "Job 22 Part B: hardware clip distances when available". Record in the report which mode the
   smoke browser used (the console line of Decision 5).

### Part C: unclipped root mesh (commit 3)

1. Decision 8 in `cellRenderArchetypes.ts`, `renderPortalInstances.ts` and the three sync functions of
   `createThreeApp.ts`.
2. Tests in `portalInstanceBuffers.test.ts`: with `separateRoot: true`, a depth-0 path makes `rootMesh.visible` true
   with the path's matrix, and `mesh.count` excludes it; with `false`, today's behaviour (instance with clip index -2);
   with no depth-0 path, `rootMesh.visible` is false. The root mesh's material has no `onBeforeCompile` patch
   (`customProgramCacheKey` is three's default).
3. Docs: rewrite `_docs/MATHEMATICAL_MODEL.md` Section 8 "Instancing" and "Clipping on the GPU" (planes, hardware
   and fallback modes, slots for the union of eyes, separate root mesh). Update module headers you touched.
4. Full checks, smoke, commit: "Job 22 Part C: draw the shared root cell unpatched".

## Tests and checks

After each Part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale),
`npm run build`, `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

Manual browser checks (record the results, or "not run", in the report; they are the GPU part of issue 58's
acceptance):
- Desktop Chrome, `npm run dev`, `?config=full` with the debug overlay: portal clip mode shows `hardware`; walk through
  `cube`, `icosahedron`, `genus-2-torus`: no portal view leaks outside its doorway, no missing doorway views, no
  z-fighting at portal frames; the clip overflow counter stays 0 while turning quickly near corners.
- Force the fallback (temporarily return `undefined` from `createPortalClipDistanceToggle`, do not commit): same walk,
  same result.
- Timing: in the same world and viewpoint (default world at depth 10, standing still), note the debug overlay's frame
  time / `portal ms` before (previous commit) and after, on desktop, and on Quest if available. If
  `EXT_disjoint_timer_query_webgl2` is available, a GPU time measurement is better; record whatever you could measure.
- Quest (if available): stand in a doorway, move the head sideways; edges stay stable in both eyes.

## Do not

- Do not use `material.clippingPlanes` (Decision 1).
- Do not change visibility (`visiblePortalPaths.ts`, job 21) or the split-root stereo logic (job 23).
- Do not leave `gl.enable(CLIP_DISTANCE*)` active outside patched draws.
- Do not delete `clipPolygonNdc` (debug overlay).

## Done when

- No patched program reads a texture in the fragment stage; with the extension no patched program contains `discard`.
- No visible path is drawn with clip index -1; `visiblePathOverflowCount` is 0 in the union tests.
- The plane-invariance, CPU-emulation and pixel-leakage tests pass; smoke passes after every Part.
- Issue 58 is closed (`_issues/_closed/`) with an Outcome (planes, hardware/fallback modes, union slots, unpatched
  root) and Closing evidence (commits, tests, the manual timing numbers or "not measured"). Job moved to `_done/` with
  its report; queue row updated.

## Report

### Done
Commits: Part A `d94e46a`, Part B `ae61b56`, Part C `43df83f`.
- Part A: `transformClipPlanes` in `portalEyeFrameTransforms.ts` (used by `transformVisiblePortalResultToRenderFrame`);
  `portalClipData.ts` rewritten (1024-wide plane texture, `portalClipPlaneTexelIndex`, `writeAlwaysInsidePlanes` /
  `writeAlwaysOutsidePlanes` exported for job 23, slots = rank in the union over eyes, unseen eyes get always-outside rows,
  `maxClipSlots = maxVisiblePaths x eyes`); `portalClipMaterial.ts` rewritten (vertex-stage `texelFetch` of 4 planes, per-vertex
  distances, `vPortalClipDistances` varying + single `discard` in the fragment stage, cache key `portal-clip-planes:<eyes>:frag|hw`);
  removed viewport uniforms/functions, both polygon modes, `smoothClipEdges`, `portalClipEdgeSmoothingEnabled`,
  `RenderQualityState.portalClipEdgeSmoothing`, debug fields `clipPolygonVertexCountsByPath` / `clipPolygonOverflowPathIds`;
  `omitPathsWithoutClipSlot` (renderPortalInstances.ts) removes slot-less paths before instancing (mono and stereo), with a
  once-per-session `console.warn`; the overlay line now shows `visiblePathOverflowCount` and the clip mode. `applyViewport`
  became an optional hook of `createPortalEyeActivator` (nothing passes it now).
- Part B: `createPortalClipDistanceToggle`; patched cell and runtime-object archetype meshes enable the four clip distances at
  the end of `onBeforeRender` and disable them in `onAfterRender`; `hardwareClipDistances` is `toggle !== undefined`;
  `material.extensions.clipCullDistance = true` in hardware mode; `portalClipMode` in `PortalInstanceRenderDebugState`;
  `console.info("Portal clip mode: ...")` once.
- Part C: `CellRenderArchetype.rootMesh` (shared geometry, unpatched material clone, hidden, added to/removed from the scene,
  disposed); `updateCellRenderArchetypeInstances(..., { separateRoot })` (true for mono and shared-root stereo, false in the
  split-root branch); `renderedInstanceCount` in the debug state counts a visible root mesh as one; `prerenderCells` also
  shows the hidden root meshes during warm-up so their programs compile before play; `_docs/MATHEMATICAL_MODEL.md`
  Instancing / Clipping on the GPU rewritten; generated docs regenerated.
- Tests: new `portalClipPlanes.test.ts` (transform invariance with 100 random rigid maps, CPU emulation of the shader,
  20 000-pixel leakage check, a camera sweep that includes polygons with an edge under 2 px); rewritten
  `portalClipData.test.ts` and `portalClipMaterial.test.ts`; root-mesh tests in `portalInstanceBuffers.test.ts` and
  `cellRenderArchetypes.test.ts`.
- Issue to close (coordinator): 58 (`_issues/58_gpu_portal_clip_overflow_and_clip_planes.md`). Note for job 23: only the
  archetype-capacity part of its union-budget item remains (slots now cover the union).

### Deviations
- Removed tests (Rule 5, the job rewrote these files): in `portalClipMaterial.test.ts` the `viewportPixelsToNdc` test, the
  smoothed-discard shader-string test and the hard-mode shader-string test; in `portalClipData.test.ts` the polygon-row,
  vertex-overflow-hiding and per-eye polygon-row tests (replaced by the plane-layout tests). In `frameAllocations.test.ts` the
  test of `updatePortalClipMaterialViewportFromRenderer` was replaced by a no-allocation test of
  `updatePortalClipMaterialTextureEye`. In `renderQuality.test.ts` the two `portalClipEdgeSmoothing: false` expectations were
  dropped (field removed per Decision 7). The `createArchetype` fixture of `portalInstanceBuffers.test.ts` gained a `rootMesh`.
- `createPortalEyeActivator`'s `applyViewport` dependency became optional (not in the job text) because Decision 7 removes the
  only function it called.
- `prerenderCells.ts` was touched (not in the job text) so the new hidden root meshes get warmed up.
- `renderedInstanceCount` counts the root mesh (so the overlay numbers do not drop by one); not in the job text.

### Uncertain
- The smoke browser (headless Chromium) ran in hardware mode: `Portal clip mode: hardware clip distances` for all four worlds, no
  console errors. Smoke does not compare pixels, so visual correctness of the hardware path (and of the fragment path) is only
  covered by the CPU emulation tests, not by a GPU image.
- The fragment-fallback path was smoked in Part A only (before the toggle existed); after Part B the smoke browser always
  takes the hardware path, so the fallback is not exercised by smoke since then.
- `gl_ClipDistance` writes use constant indices 0..3 without redeclaring the array; this compiled in the smoke browser (ANGLE).
  Other drivers are untested.

### Not done
- Manual browser/GPU checks, see below. No timing measured ("not measured").

### Checks
- Baseline: typecheck and `npm test` green (1006 tests).
- After each Part: `npm run typecheck`, `npm test` (final 1022 passed, 1 skipped), `npm run docs:check`, `npm run build`,
  `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` (SMOKE OK for all four worlds; Part A fragment mode,
  Parts B and C hardware mode). One `npm test` run in Part C failed only because the generated docs were stale; it passed after
  `docs:generate`.

### Manual checks not run
- Desktop Chrome, `npm run dev`, `?config=full` with the debug overlay: the archetype line should show `hardware clip`; walk
  `cube`, `icosahedron`, `genus-2-torus`; check that no portal view leaks outside its doorway, no doorway view is missing, no
  z-fighting at portal frames, and that the `clip` counter stays 0 while turning quickly near corners.
- Force the fallback: temporarily make `createPortalClipDistanceToggle` return `undefined` (do not commit) and repeat the walk;
  the overlay should show `fragment clip`.
- Timing: same world and viewpoint (default world, depth 10, standing still), compare the overlay frame time / `portal ms`
  between `f7277ef` and `43df83f` on desktop and Quest; use `EXT_disjoint_timer_query_webgl2` if available. Also check whether the
  fallback path is noticeably slower in the root cell (static assets are runtime objects and keep `-2`, Decision 8 note).
- Quest: stand in a doorway, move the head sideways; edges should stay stable in both eyes.
