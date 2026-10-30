# Job 23 - Correct stereo rendering with split eye roots

Status: done, needs review on 2026-10-30 (commits 5ff4df4, 0b618e4, 40fe59a); issue 59 stays open until the headset check passes.
Rewritten on 2026-10-29 for a less capable implementing model (was a pointer to issue 59).
Resolves: issue [59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md), including its "Merged
from issue 21" section.

## Goal

When the two XR eyes render from different roots (the head straddles a portal):

1. Each eye's root cell is not drawn in the other eye except through that eye's own, clipped portal paths.
2. Two eyes rooted in the **same cell id but different frames** (a self-glued cell such as the single torus room) count
   as split, not shared. Today they are treated as shared and eye 1 draws eye 0's placements (new finding, see
   Background).
3. When the union of both eyes' paths is over budget, survivors are chosen fairly: the number of dropped paths per eye
   differs by at most 1 (disjoint lists), and both roots always survive.
4. Cell archetype capacity covers the union of two roots, so straddling a portal causes no capacity overflow.
5. Renderer debug state exposes left, right, union, left-only, right-only and both-eye path counts; job 19's headset
   panel shows them.

## Depends on

- [Job 19](19_vr_palette_and_in_headset_debug.md): the headset panel and `formatDebugOverlayLines` (Part C adds a line
  there).
- Batch order: 37, 25 -> 26 -> 27, 28 -> 29, 20 -> 21 -> 22, 19, **then 23**. Jobs 21, 22, 28 and 29 change the code
  this job edits. **Before each part, re-read these functions by name at your HEAD and adapt the steps to what you
  find:**
  - Job 21 (per-frame visibility): `computeVisiblePortalPaths` / `computeIndependentVisiblePortalPaths` may be replaced
    by a visible-parent traversal with funnel planes, and the 16 px threshold moves to one constant. Use whatever
    `syncStereoPortalInstanceRender` calls at your HEAD.
  - Job 22 (GPU clip planes): `portalClipData.ts`, `portalClipMaterial.ts` and the clip-index attribute in
    `renderPortalInstances.ts` may hold planes instead of NDC polygons, and depth-0 instances may use a separate
    unpatched "root" material. See Decision 2 for what to do in each case.
  - Job 28 (instance sync): `getRuntimeObjectVisiblePaths` returns a list cached by `applyPortal*`; the second
    `syncRuntimeObjectPortalInstances()` call is gone.
  - Job 29 (allocation): scratch buffers may replace the per-frame `Map`s in `remapStereoPortalPathIds` and the union.

## Before you start

Line numbers are from commit `0b468e1`; search by name after jobs 21, 22, 28 and 29.

| File | Lines | What |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 783, 820-832, 874, 885-886 | `maxVisiblePaths = 2_000`; `createActiveWorldBundle` (archetype capacities); `portalClipData`; `portalEyeRenderStates`, `activePortalEyeIndex` |
| `src/render/three/createThreeApp.ts` | 1490-1522 | XR culling cameras; `syncStereoPortalInstanceRender(portalCullingCameras.map(resolvePortalEyeRenderRoot))` when there are 2 cameras |
| `src/render/three/createThreeApp.ts` | 2337-2372 | `syncXrDebugState`, `createPortalEyeDebugStates` |
| `src/render/three/createThreeApp.ts` | 2447-2454 | `resolvePortalEyeRenderRoot` |
| `src/render/three/createThreeApp.ts` | 2530-2651 | `syncStereoPortalInstanceRender`: shared test by root **id only** (2560-2562), shared branch (2563-2590), split branch (2591-2618), `remapStereoPortalPathIds` (2619), union sorted by id (2625-2626), `portalClipData.updateStereo` (2630), `applyPortalVisiblePaths(union)` (2631) |
| `src/render/three/createThreeApp.ts` | 2653-2667, 2687-2708, 2736-2764 | `activatePortalRenderStateForCamera`, `applyPortalVisiblePaths`, `updatePortalVisiblePathInstances`, `findPortalEyeRenderState` (matches `state.camera` matrices, else the viewport centre) |
| `src/render/three/createThreeApp.ts` | 2765-2783, 2942-2963 | `syncRuntimeObjectPortalInstances`, `getRuntimeObjectVisiblePaths` |
| `src/render/three/xrPortalEye.ts` | 40-86 | `resolveXrPortalEyeRenderRoot` (job 17): re-roots when the walk ends in another cell **or the same cell with a non-identity transform** |
| `src/render/three/xrPlayerRig.ts` | 221-226 | `resolveSharedXrRenderRootCellId` returns `pose.cellId`; used only for the debug field `sharedRenderRootCellId` |
| `src/render/three/portalEyeFrameTransforms.ts` | 17-22, 25-39, 59-90 | `PortalEyeRenderState`, `buildUnionVisiblePathById`, `remapStereoPortalPathIds` (key `${rootCellId}:${pathId}`, first-seen order, eye 0 first) |
| `src/render/three/portalClipData.ts` | 108-165 | `updateStereo`: union sorted by id (129), cut to `maxVisiblePaths` (130-131), rows per eye at `eye * maxVisiblePaths + clipIndex`; unwritten rows stay zero |
| `src/render/three/renderPortalInstances.ts` | 75-83, 105-121, 195-224, 237-324, 326-335 | full-screen polygon, `unclippedPortalClipIndex = -2`, `createRootVisiblePortalPath`, `updateCellRenderArchetypeInstances` (-2 for every depth 0 at 211), `updateRuntimeObjectRenderArchetypeInstances` (job 17 placement dedupe 255-297, -2 at 309), `runtimeObjectPlacementKey` |
| `src/render/three/portalClipMaterial.ts` | 262-274, 317-330 | -2 skips the clip test; -1, out of range, or a row with vertex count < 3 discards (both shader modes) |
| `src/render/three/cellRenderArchetypes.ts` | 140-167 | `deriveCellRenderArchetypeCapacities`: per cell, max over roots |
| `src/render/three/visiblePortalPaths.ts` | 72-101, 173-227, 259 | options; root path first (depth 0); results sorted `depth-then-area`; `clipPolygonNdc` winding not guaranteed |
| `src/render/three/renderState.ts`, `debugOverlay.ts`, `portalDebugRuntime.ts` | 42-66, 100-106; 17-32 and `formatDebugOverlayLines` (job 19); 392-400 and `updateVisiblePortalPaths` | debug state, overlay lines, console helper `state` |
| `tests/render-contract/portalClipData.test.ts`, `runtimeObjectPortalInstances.test.ts`, `cellRenderArchetypes.test.ts`, `xrPortalEye.test.ts` | all | existing helpers (`createVisiblePath`, `readTexturePixel`, archetype helpers, `camera(...)`) |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`.

## Background

- Each eye gets an `XrPortalEyeRenderRoot` `{ rootCellId, camera, renderFromRootMatrix }`. The render frame is the
  player's cell. A re-rooted eye uses a camera carried into its root and a `renderFromRootMatrix` that maps root-frame
  content back into the render frame.
- **Split roots draw the other root unclipped (issue 59).** Every depth-0 instance gets clip index -2, which skips the
  clip test in every eye. So eye 0 also draws eye 1's root cell over its whole screen. Wherever the developed copies
  overlap (around a vertex with angle sum above 2pi, as in `genus-2-torus`), the wrong cell wins the depth test.
- **Same id, different frame (new, verified at 0b468e1).** In `torus-moduli` (one 15 m x 15 m cell `torus-room`, east
  side glued to west) a head at the east portal has eye 0 at x = 7.468 (root `torus-room`, identity) and eye 1 at
  x = 7.532, re-rooted to `torus-room` at x = -7.468 with `renderFromRoot` = translation (+15, 0, 0) in world axes.
  The shared test compares ids only, so the shared branch runs. `remapStereoPortalPathIds` gives both eyes' path k the
  same id, and `buildUnionVisiblePathById` keeps eye 0's matrix, so eye 1 draws every cell copy at eye 0's placement.
- **Unfair union.** Remapped ids of eye 1's own paths are all larger than eye 0's. The union is sorted by id and cut to
  `maxVisiblePaths` clip slots, and per-cell capacity cuts follow the same order, so eye 1 always loses.
- **Capacity.** Per-cell capacity is the maximum over single roots. Two roots' union can exceed it.
- **Job 17 dedupe interaction.** `updateRuntimeObjectRenderArchetypeInstances` merges instances of one object that land
  on the same place and keeps the lowest depth. With split roots, eye 1's depth-0 copy of an object and eye 0's depth-1
  copy through the portal coincide. Once depth 0 is clipped to eye 1 (Decision 2), keeping only it would hide the
  object in eye 0. Decision 6 fixes this.

## Decisions

1. **Root identity and split detection.** Decided: an eye's root identity is (`rootCellId`, `renderFromRootMatrix`).
   Two eyes share a root iff the ids are equal **and** every matrix element differs by at most 1e-9. `splitRoots` is
   true iff some eye's identity differs from eye 0's. Each distinct identity gets a **root group** index in eye order
   (eye 0's group is 0). `remapStereoPortalPathIds` keys by `${rootGroup}:${pathId}` instead of
   `${rootCellId}:${pathId}`. The shared branch (`computeIndependentVisiblePortalPaths`) runs only when `!splitRoots`.
   Why: Background, "same id, different frame".
2. **Root clipping.** Decided:
   - `!splitRoots`: depth-0 instances keep `unclippedPortalClipIndex` (-2), exactly as today.
   - `splitRoots`: every instance, depth 0 included, uses `clipIndexByPathId.get(pathId) ?? -1`. A depth-0 path is in
     its own eye's list only, so `updateStereo` writes its row in that eye and the other eye's row stays zero
     (vertex count 0), which the shader discards. The other eye sees that cell only through its own portal paths,
     clipped as usual.
   - In `updateStereo`, a depth-0 path's row is written with the polygon `rootClipPolygonNdc` = (-2, -2), (2, -2),
     (2, 2), (-2, 2) (new exported constant in `portalClipData.ts`), not the +-1 square, so no clip edge lies inside
     the viewport (the smooth shader mode would soften the outermost pixel row).
   - One helper decides the index for both instance writers (new export in `renderPortalInstances.ts`):

     ```ts
     /** -2 for a depth-0 path when unclippedRoot is true; otherwise the path's clip slot, or -1 if it has none. */
     export function resolvePortalInstanceClipIndex(
       path: VisiblePortalPath,
       clipIndexByPathId: ReadonlyMap<number, number>,
       unclippedRoot: boolean,
     ): number;
     ```

     `updateCellRenderArchetypeInstances` gets a 5th parameter `options: { readonly unclippedRoot?: boolean } = {}`
     (default true); `updateRuntimeObjectRenderArchetypeInstances` gets `unclippedRoot?: boolean` in its existing
     options object (default true).
   - **If job 22 changed the clip representation**, keep the meaning: in the owning eye the root row must accept every
     fragment, and in every other eye it must reject every fragment. With planes, a zero row (n = 0, d = 0) **accepts**
     (0 >= -eps), so you must write an explicit reject row (for example n = 0, d = -1) for every (eye, slot) that eye
     does not see, and an accept row (n = 0, d = 1) for the root in its own eye. The test in Step B4 fails if this is
     wrong. If job 22 renders depth-0 instances with a separate unpatched root material, route split-root depth-0
     instances through the clipped material (the root material is only for `unclippedRoot === true`).
   Why: issue 59 change 1.
3. **Fair union.** Decided: round-robin over the eyes' lists, each list in its own order (root first, then
   `depth-then-area`). New export in `portalEyeFrameTransforms.ts`:

   ```ts
   /** Union of the eyes' paths, ranked round-robin: eye 0's next unseen path, eye 1's next unseen path, ... A path id
    *  already taken does not use up an eye's turn. Not truncated. */
   export function rankStereoUnionPaths(pathsByEye: readonly (readonly VisiblePortalPath[])[]): readonly VisiblePortalPath[] {
     const ranked: VisiblePortalPath[] = [];
     const taken = new Set<number>();
     const cursor = pathsByEye.map(() => 0);
     let progressed = true;
     while (progressed) {
       progressed = false;
       for (let eye = 0; eye < pathsByEye.length; eye += 1) {
         const paths = pathsByEye[eye];
         while (cursor[eye] < paths.length && taken.has(paths[cursor[eye]].pathId)) cursor[eye] += 1;
         if (cursor[eye] < paths.length) {
           const path = paths[cursor[eye]];
           taken.add(path.pathId);
           ranked.push(path);
           cursor[eye] += 1;
           progressed = true;
         }
       }
     }
     return ranked;
   }
   ```

   `updateStereo` with more than one eye uses this ranking instead of the id sort; the accepted set is the first
   `maxVisiblePaths` entries, and clip indices follow the ranking (slot 0 = rank 0). With one eye (`update`) keep
   today's ascending-id order. Expose two new read-only getters on `PortalClipData`: `acceptedPathIds:
   ReadonlySet<number>` (accepted by the budget, including polygon-overflow paths) and `rankedAcceptedPaths: readonly
   VisiblePortalPath[]`. Fix the doc of `pathIdByClipIndex` ("ascending path-id order" becomes "rank order in stereo").
   The clip texture keeps `maxVisiblePaths` slots per eye block (no shader change). Each eye's list starts with its
   depth-0 path, so with at least 2 slots both roots always get one. **After job 21**, check that each eye's list still
   starts with depth 0 and is sorted `depth-then-area`; if not, sort a copy by (depth ascending, `screenAreaPixels`
   descending) before ranking. Why: issue 59 change 2; a fixed per-eye cap would waste slots on paths both eyes share.
4. **Only accepted paths are instanced.** Decided: in stereo, the cell and runtime-object instance writers receive
   `portalClipData.rankedAcceptedPaths` (in rank order), not the whole union. Paths that lost the budget are not
   instanced (today they are instanced with -1, wasting capacity). Per-cell capacity cuts then also follow the rank.
   Whatever supplies runtime-object paths after job 28 (`getRuntimeObjectVisiblePaths` or its cache) must return this
   same list in stereo.
5. **Capacity.** Decided: `deriveCellRenderArchetypeCapacities(world, staticCull, maxVisiblePaths?, eyes = 1)`: per cell,
   the sum of the `eyes` largest per-root counts, then clamped to `maxVisiblePaths` and at least 1. `createActiveWorldBundle`
   passes `eyes = 2`. With `eyes = 1` the result is unchanged, so the existing test stays valid. Why: issue 59 change 3;
   the union of two roots' paths to one cell is at most the sum of the two largest per-root counts, and Decision 4
   keeps it at most `maxVisiblePaths`. Memory: cells x 2000 x 64 bytes at most.
6. **Dedupe by root group.** Decided: `updateRuntimeObjectRenderArchetypeInstances` options gain
   `rootGroupByPathId?: ReadonlyMap<number, number>`; the placement key becomes
   `${rootGroupByPathId?.get(path.pathId) ?? 0}|${runtimeObjectPlacementKey(...)}`. In split mode pass the map built
   from the eye states (every remapped path id -> its eye's root group); in shared and mono mode pass nothing (behaviour
   unchanged). Why: Background, "job 17 dedupe interaction". Copies from different root groups are drawn in different
   eyes, so they never z-fight.
7. **Eye lookup independent of re-rooting.** Decided: `PortalEyeRenderState` gains `readonly sourceCamera?: THREE.Camera`
   (the culling camera before re-rooting). The stereo pass sets it to `portalCullingCameras[eyeIndex]`.
   `findPortalEyeRenderState` matches matrices against `state.sourceCamera ?? state.camera`. Why: a re-rooted eye's
   `camera` is a moved clone and never matches the render camera, so today that eye is found only by the viewport
   fallback.
8. **Extract the stereo frame.** Decided: move the body of `syncStereoPortalInstanceRender` that computes the eye states
   (from the shared test to the remap) into a pure function in a new file `src/render/three/stereoPortalFrame.ts`:

   ```ts
   export interface StereoPortalFrame {
     /** Per-eye states with remapped ids, render-frame matrices and `sourceCamera`. */
     readonly eyeStates: readonly PortalEyeRenderState[];
     readonly splitRoots: boolean;
     /** Root group per eye (Decision 1). */
     readonly rootGroupByEye: readonly number[];
     /** Remapped path id -> root group of the eye that produced it. */
     readonly rootGroupByPathId: ReadonlyMap<number, number>;
   }
   /** Returns undefined when some eye's root cell has no static table (the caller clears visibility, as today). */
   export function buildStereoPortalFrame(input: {
     readonly world: CompiledCellComplex;
     readonly staticCull: StaticPortalPathCullResult;
     readonly renderRoots: readonly XrPortalEyeRenderRoot[];
     readonly sourceCameras: readonly THREE.Camera[];
     readonly viewportPixels: { readonly width: number; readonly height: number };
     readonly options: VisiblePortalPathOptions;
   }): StereoPortalFrame | undefined;
   ```

   It calls the same visibility functions as today (or job 21's), `transformVisiblePortalResultToRenderFrame` and
   `mergeStaticPathCounts`. `createThreeApp.ts` calls it and keeps the clip-data, instancing and debug-state writes.
   Why: the split-root contract test runs the same code as the app.
9. **Debug fields.** Decided: new type in `renderState.ts` (exact names; job 19's text refers to them):

   ```ts
   /** Stereo path statistics; eye 0 is labelled left (WebXR lists the left view first on Quest). */
   export interface StereoPortalPathRenderState {
     readonly splitRoots: boolean;
     readonly leftRootCellId: string;
     readonly rightRootCellId: string;
     /** Paths in each eye's own list, before the union budget. */
     readonly leftPathCount: number;
     readonly rightPathCount: number;
     /** Distinct remapped path ids over both eyes, before the union budget. */
     readonly unionPathCount: number;
     /** Cell copies (same destination cell at the same render-frame placement) seen only by eye 0, only by eye 1, or by both. */
     readonly leftOnlyPathCount: number;
     readonly rightOnlyPathCount: number;
     readonly bothEyesPathCount: number;
     /** Paths of each eye's list not accepted by the union budget. */
     readonly droppedLeftPathCount: number;
     readonly droppedRightPathCount: number;
   }
   ```

   Computed by `countStereoPortalPaths(eyeStates, acceptedPathIds, splitRoots)` in `portalEyeFrameTransforms.ts`
   (undefined unless there are exactly 2 eyes). Placement key of a path: `destinationCellId` plus elements 12, 13, 14,
   0, 1, 2 of `rootFromDestinationMatrix`, each `Math.round(value * 1e4)` (the rounding of `runtimeObjectPlacementKey`).
   Placements, not ids, decide "both": with split roots, eye 1's root copy and eye 0's view of the same cell through the
   portal are the same copy. Added as `stereoPortalPaths?` to `XrDebugRenderState`, to `DebugOverlayState` (only when
   the `portal-quantities` item is on), and to `noneuclidPortalDebug.state`. Line formatter in `debugOverlay.ts`:

   ```ts
   export function formatStereoPortalPathLine(state: StereoPortalPathRenderState): string;
   // "stereo: L 812 / R 790 / union 840 / L-only 50 / R-only 28 / both 762 / dropped 0|0 / roots a|b split"
   // shared roots end with "/ roots a shared"
   ```

   `formatDebugOverlayLines` (job 19) inserts it right after the portal-eyes line. Mono frames set the field to
   undefined. Update the doc comment of `resolveSharedXrRenderRootCellId` ("the cell whose frame is the render frame;
   eyes may be rooted elsewhere, see `stereoPortalPaths`"); do not change its behaviour.
10. **Commits.** One per part: A (pure pieces), B (split-root wiring), C (debug state and docs).

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck`.

### Part A: ranking, capacity and the clip-index helper

1. `rankStereoUnionPaths` (Decision 3) and `countStereoPortalPaths` (Decision 9; the type goes in `renderState.ts`
   now). New tests in `tests/render-contract/portalEyeFrameTransforms.test.ts` (use a `createVisiblePath(id, depth,
   cellId, translationX)` helper):
   - disjoint lists, eye 0 ids 0-9 (0 has depth 0), eye 1 ids 10-19 (10 has depth 0): ranked ids start
     `[0, 10, 1, 11, 2, 12]`;
   - overlapping lists `[0, 1, 2, 3]` and `[0, 1, 4, 5]`: ranked ids `[0, 1, 2, 4, 3, 5]`;
   - counts: eye 0 has paths to (cell b, x 15) and (cell a, x 0); eye 1 has a different id to (cell b, x 15) and one to
     (cell c, x 30); accepted = all: `leftPathCount` 2, `rightPathCount` 2, `unionPathCount` 4, `bothEyesPathCount` 1,
     `leftOnlyPathCount` 1, `rightOnlyPathCount` 1, dropped 0 and 0.
2. `updateStereo` ranking, getters and `rootClipPolygonNdc` (Decisions 2-3). New tests in `portalClipData.test.ts`:
   - `maxVisiblePaths: 6`, the disjoint lists above: `clipIndexByPathId` maps 0, 10, 1, 11, 2, 12 to 0-5; per eye
     7 ids are not in `acceptedPathIds` (difference 0 <= 1);
   - `maxVisiblePaths: 4`, the overlapping lists: accepted `{0, 1, 2, 4}`; dropped per eye 1 and 1;
   - a depth-0 path only in eye 1 (`maxVisiblePaths: 4`): eye 1's row texel 0 is `[-2, -2, 4, id]`; eye 0's row at
     the same slot is all zeros;
   - the existing four tests pass unchanged (one eye keeps id order).
3. `deriveCellRenderArchetypeCapacities` with `eyes` (Decision 5). New test in `cellRenderArchetypes.test.ts`, on
   `cube` with the existing table options: for every cell, the `eyes = 2` capacity equals the sum of the two largest
   per-root counts (compute them in the test from `staticCull.tables.tablesByRootCellId`), and `eyes = 1` equals
   today's value.
4. `resolvePortalInstanceClipIndex` and the `unclippedRoot` / `rootGroupByPathId` options (Decisions 2 and 6). Tests in
   `runtimeObjectPortalInstances.test.ts` (reuse its archetype helpers):
   - depth-0 path with slot 3: `unclippedRoot` true -> -2; false -> 3; depth-0 without slot and false -> -1;
   - one record in cell c at identity; paths id 0 (depth 0, identity) and id 5 (depth 1, identity): without
     `rootGroupByPathId` one instance is written (today's dedupe); with `{0 -> 1, 5 -> 0}` two instances.
5. Finish the part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale). Commit
   Part A.

### Part B: split-root wiring

1. Re-read `syncStereoPortalInstanceRender`, `applyPortalVisiblePaths`, `updatePortalVisiblePathInstances`,
   `syncRuntimeObjectPortalInstances`, `getRuntimeObjectVisiblePaths` and `findPortalEyeRenderState` at your HEAD.
2. Create `stereoPortalFrame.ts` (Decision 8) with root identity and groups (Decision 1); remap by group;
   `sourceCamera` (Decision 7).
3. Rewire `syncStereoPortalInstanceRender`:

   ```text
   frame = buildStereoPortalFrame(...)            // undefined -> today's "no tables" branch
   portalEyeRenderStates = frame.eyeStates
   portalRootsUnclipped = !frame.splitRoots       // new shell variable; set to true in the mono pass and "no tables" branches
   portalRootGroupByPathId = frame.splitRoots ? frame.rootGroupByPathId : undefined
   portalClipData.updateStereo(eyeStates.map(s => s.result.paths))
   applyPortalVisiblePaths(portalClipData.rankedAcceptedPaths, false, cameraPositions)
   stereoPortalPathState = countStereoPortalPaths(eyeStates, portalClipData.acceptedPathIds, frame.splitRoots)
   ```

   `updatePortalVisiblePathInstances` passes `{ unclippedRoot: portalRootsUnclipped }`;
   `syncRuntimeObjectPortalInstances` passes `unclippedRoot: portalRootsUnclipped` and
   `rootGroupByPathId: portalRootGroupByPathId`. `createActiveWorldBundle` passes `eyes = 2`. `findPortalEyeRenderState`
   uses `sourceCamera` (Decision 7). Apply the job 22 notes of Decision 2 if they apply at your HEAD.
4. **Split-root contract test** (new `tests/render-contract/stereoSplitRoot.test.ts`). World:
   `compileCellComplex(torusModuli)` (from `src/authoring/exampleWorlds`); static tables from
   `buildStaticallyCulledPortalPathTables(world, { maxDepth: 4, skipImmediateReverse: true, toleranceMeters: 1e-6,
   maxKeptPathsPerRoot: 50_000 })`. Player anchor (7.3, 0, 0) in `torus-room`; head (7.5, 0, 1.6) facing north (+y);
   IPD 0.064 m, so the left eye is at (7.468, 0, 1.6) and the right eye at (7.532, 0, 1.6). Eye cameras:
   `PerspectiveCamera(90, 1, 0.01, 100)` at `worldPointToThree(eye)`, `lookAt` the point 1 m north, `updateMatrixWorld`.
   Roots: `resolveXrPortalEyeRenderRoot` per eye with `sourceCellId: "torus-room"`. Options: `maxDepth: 4`,
   `maxVisiblePaths: 2000`, `minPortalScreenAreaPixels: 16`, `includeRootCell: true`, `sortMode: "depth-then-area"`;
   viewport 1000 x 1000. Then `buildStereoPortalFrame`, a `createPortalClipData({ maxVisiblePaths: 2000 })` and
   `updateStereo`. Assert:
   1. eye roots are both `torus-room`; eye 1's `renderFromRootMatrix` maps the Three origin to world (15, 0, 0) within
      1e-9 (`threePointToWorld(new Vector3().applyMatrix4(m))`); `splitRoots` is true; groups `[0, 1]`;
   2. each eye's depth-0 path has a slot, and `resolvePortalInstanceClipIndex(root, map, false)` returns it (not -2);
   3. CPU emulation of the clip rows: for a 21 x 21 grid of NDC points in [-1, 1]^2, a point is accepted by (eye, slot)
      iff the row's vertex count is at least 3 and the point is inside the row's convex polygon (all edge cross
      products >= -1e-9, or all <= 1e-9: winding is not guaranteed). Eye 0 accepts **0** points for eye 1's root slot,
      eye 1 accepts all 441; and the same with the eyes swapped;
   4. `countStereoPortalPaths(...)`: `splitRoots` true, `bothEyesPathCount >= 1`, and left-only + right-only + both
      equals the number of distinct placements over both eyes;
   5. for every destination cell, the accepted paths to it number at most the `eyes = 2` capacity (so
      `capacityOverflowCount` would be 0);
   6. shared case: anchor (0, 0, 0), head at (0, 0, 1.6), eyes at x = -0.032 and 0.032: `splitRoots` false and
      `resolvePortalInstanceClipIndex(root, map, true)` is -2.
   Run `npx vitest run tests/render-contract/stereoSplitRoot.test.ts`.
5. Finish the part: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`,
   `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Commit Part B.

### Part C: debug state, panel line and docs

1. Wire `stereoPortalPaths` into `syncXrDebugState`, `portalDebugRuntime.updateVisiblePortalPaths` (portal-quantities
   only) and the console `state` getter (Decision 9). Add `formatStereoPortalPathLine` and its place in
   `formatDebugOverlayLines`. Tests in `tests/render-contract/debugOverlay.test.ts`: the example line of Decision 9
   (split and shared variants), and its position right after the portal-eyes line.
2. Docs: `_docs/MATHEMATICAL_MODEL.md` section 8 (eye roots, job 17's paragraph): root identity is (cell, frame), split
   eyes clip each other's roots, fair union. `_docs/ARCHITECTURE.md`: `stereoPortalFrame.ts` in the render pipeline.
3. Finish: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale), `npm run build`,
   `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Commit Part C.

## Tests and checks

All tests named in the steps, plus `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build` and the
smoke command after Parts B and C.

Manual headset checks (issue 59, merged from issue 21). Turn on debug mode, the "UI overlay" and the
"portal-quantities" item; job 19's panel shows the stereo line. Worlds: `torus-moduli` and `genus-2-torus`.

1. Stand with the head across a portal (panel shows `split`). Move the head sideways through the portal and back: a
   portal image may be visible in one eye only, but it never disappears from both, and no eye shows a full-screen
   wrong room.
2. Left and right portal edges stay stable and do not fight.
3. Recursive views reach the same depth as on desktop (compare the portal-eyes line with the desktop overlay at the
   same spot).
4. `dropped` stays `0|0` and `archetypes ... overflow 0` while straddling.
5. Record `portal ms` (fps line) before (previous commit) and after, same world and viewpoint.

If you cannot run them, list them under `### Manual checks not run`. **This forces `Status: done, needs review`:**
issue 59 stays open until the headset checks pass; add a one-line pointer to the report in the issue.

## Bookkeeping

- Headset checks run and passed: close issue 59 (move to `_issues/_closed/` with Outcome and Closing evidence: commits,
  the split-root test, the headset result), update its row in `_issues/50_deep_code_audit_2026_10_09_index.md`, and
  fix links to it.
- Otherwise leave issue 59 open with a dated pointer to this job's report.
- Move the job to `_done/` and mark its queue row either way.

## Do not

- Do not change the mono pass or the shared-root behaviour except through Decisions 3-5 (ranking, accepted set,
  capacity).
- Do not change `resolveXrPortalEyeRenderRoot` (job 17) or the player rig.
- Do not enlarge the clip texture or change the shader beyond what Decision 2 requires after job 22.
- Do not weaken existing tests; record any change under `### Deviations`.

## Done when

- Split roots (including same-id, different-frame roots) clip each other's roots; the split-root test passes.
- The union is ranked round-robin; dropped counts per eye differ by at most 1 in the tests; roots always keep a slot.
- Capacity uses the two-root bound; the test shows no overflow while straddling.
- `stereoPortalPaths` is in the debug state, the overlay and the headset panel.
- Checks pass after each part; three commits (A, B, C). Report written per [README](README.md).

## Report

### Done
Commits: Part A `5ff4df4`, Part B `0b618e4`, Part C `40fe59a`.

- Part A. `rankStereoUnionPaths`, `countStereoPortalPaths` and an optional `rootGroup` on `PortalEyeRenderState` (remap keys by group, else by cell id) in `portalEyeFrameTransforms.ts`. `StereoPortalPathRenderState` in `renderState.ts`. `portalClipData.ts`: round-robin ranking for 2 or more eyes (one eye keeps id order), new getters `acceptedPathIds` and `rankedAcceptedPaths`. `deriveCellRenderArchetypeCapacities(..., eyes)` sums the `eyes` largest per-root counts. `renderPortalInstances.ts`: `resolvePortalInstanceClipIndex`, `unclippedRoot` option on both instance writers, and `rootGroupByPathId` on the runtime-object writer (placement key prefixed by group). Tests added in `portalEyeFrameTransforms`, `portalClipData`, `cellRenderArchetypes` and `runtimeObjectPortalInstances`.
- Part B. New `stereoPortalFrame.ts` (`buildStereoPortalFrame`, `haveSameRootIdentity`; root identity is cell id plus matrix within 1e-9, groups in eye order). `createThreeApp.ts`: the stereo pass calls it, instances only `portalClipData.rankedAcceptedPaths`, passes `separateRoot` and `unclippedRoot` = `!splitRoots`, `createActiveWorldBundle` uses `eyes = 2`. `FrameRenderSnapshot` gained `unclippedRoot` and `rootGroupByPathId`, and `runtimeObjectInstanceSync` forwards them. New `tests/render-contract/stereoSplitRoot.test.ts` (torus-moduli straddling the east portal plus a shared case).
- Part C. `stereoPortalPaths` in `XrDebugRenderState`, in `DebugOverlayState` (portal-quantities only) and in the console `noneuclidPortalDebug.state`. `formatStereoPortalPathLine` is placed right after the portal-eyes line, so the headset panel shows it through `formatDebugOverlayLines`. Tests added in `debugOverlay.test.ts`. `_docs/MATHEMATICAL_MODEL.md` (eye roots, stereo, capacity) and `_docs/ARCHITECTURE.md` updated; generated docs regenerated.

### Deviations
- Job 22 had already replaced NDC polygons with 4 world-space clip planes and per-(slot, eye) rows with "always outside" for an eye that does not see a union path. So Decision 2's `rootClipPolygonNdc` was not needed and was not added: a depth-0 path carries always-inside planes, which accept in the owning eye, and the other eye's row is already always-outside. Its test (a row `[-2, -2, 4, id]`) became "root seen by one eye only is inside in that eye and outside in the other".
- Union budget. Job 22 sizes the clip texture as `maxVisiblePaths * eyes` slots, so the budget I rank against is `maxClipSlots` (2 x `maxVisiblePaths`), not `maxVisiblePaths`. Each eye's list is capped at `maxVisiblePaths`, so the union fits and `visiblePathOverflowCount` stays 0 in practice; the ranking only matters if that ever changes. The Part A tests use `maxVisiblePaths` 3 and 2 (6 and 4 slots) to reproduce the job's numbers, so the dropped-per-eye figures are 7/7 and 1/1.
- Decision 7 (`sourceCamera`, `findPortalEyeRenderState`): `findPortalEyeRenderState` no longer exists (job 22 replaced it by `portalEyeActivator`, which identifies the eye by index in `renderer.xr.getCamera().cameras`). So no `sourceCamera` field was added, and `buildStereoPortalFrame` has no `sourceCameras` input.
- `buildStereoPortalFrame` calls `computeVisiblePortalPaths` once per eye (each camera is already evaluated independently), not `computeIndependentVisiblePortalPaths`. `buildUnionVisiblePathById` is now unused in the app (still exported and tested elsewhere).
- Split-root test samples 3D points in the render frame against the clip planes (the representation after job 22) instead of an NDC grid.
- Existing tests: no change to any existing assertion.

### Uncertain
- The coordinator note "ghost dedupe in `runtimeObjectGhostRecords.ts` must be grouped by root": I read it as Decision 6 (the placement dedupe in `updateRuntimeObjectRenderArchetypeInstances`, grouped by root group) and left `runtimeObjectGhostRecords.ts` untouched, since its dedupe is per cell copy and independent of the eye roots.
- Runtime-object paths come from `snapshot.objectPathsByDestinationCell`, which `flattenVisiblePortalPathGroups` sorts by id, so for objects a capacity cut follows id order, not the rank. Cell archetypes do follow the rank. Practically moot while the union fits.
- The debug-state field `stereoPortalPaths` is read from `xrDebugState`, which `syncXrDebugState` refreshes; it can lag one refresh behind the portal pass.
- Smoke covers desktop only, so the stereo wiring (including temporal-dead-zone ordering of the new `let`s, declared next to `portalEyeRenderStates`) is checked by typecheck, tests and the load of the app, not by an XR frame.

### Not done
- Headset checks (below).

### Checks
- Baseline: `npm run typecheck` ok, `npm test` 142 files passed (1031 tests).
- After Part A, B, C: `npm run typecheck` ok; `npm test` 143 files passed, 1049 tests, 1 skipped; `npm run docs:check` ok after `npm run docs:generate` (the generated docs were stale after each part and were regenerated and committed); `npm run build` ok; `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` SMOKE OK (4 pages) after Parts B and C.

### Manual checks not run
Headset (Quest), debug mode on, "UI overlay" and "portal-quantities" on; the panel shows the `stereo:` line. Worlds `torus-moduli` and `genus-2-torus`.
1. Stand with the head across a portal (line ends `split`). Move the head sideways through the portal and back: a portal image may be visible in one eye only, but never disappears from both, and no eye shows a full-screen wrong room.
2. Left and right portal edges stay stable and do not fight.
3. Recursive views reach the same depth as on desktop (compare the portal-eyes line with the desktop overlay at the same spot).
4. `dropped` stays `0|0` and `archetypes ... overflow 0` while straddling.
5. Record `portal ms` (fps line) before (commit `321eae0`/`31e3557` era) and after (`40fe59a`), same world and viewpoint.

Issue to close once the headset checks pass: issue 59 (including its "Merged from issue 21" section); it stays open until then. Suggested status: `done, needs review`.
