# Job 21 - Per-frame visibility: visible-parent traversal and the exact funnel

Status: queued.
Rewritten on 2026-10-29 for a less capable implementing model (line numbers re-checked at commit `0b468e1`).
Resolves: issue [57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md), including its "Merged from
issue 21" section.

## Goal

`computeVisiblePortalPaths` and `computeIndependentVisiblePortalPaths` (`src/render/three/visiblePortalPaths.ts`):

1. visit only the children of visible parents (explicit stack over `pathsByParentPathId`), never the whole table;
2. decide visibility with the **exact funnel**: a 2D sector of plan directions from the eye, clipped by each portal,
   plus the top and bottom edges of the newest portal; the visible region of a path is the intersection of at most 4
   half-spaces through the eye (`clipPlanes`);
3. get the screen polygon, rectangle and area from those planes (NDC square clipped by 4 lines: at most 8 vertices, no
   near plane, no camera-space projection of apertures);
4. stop leaving holes: a path whose area is below the 16 px threshold is **kept as a terminal path** (its children are
   not visited) instead of being dropped with its subtree;
5. allocate nothing per *examined* path; cache each path's Three.js matrix;
6. take the 16 px threshold and the other options from **one** place in `createThreeApp.ts`.

## Depends on

- [Job 20](20_exact_static_cull.md): this job imports `OrientedPortalSegment` from `src/cell-complex/orientedPortal.ts`
  and reads `PortalRenderPath.newestPortalInRoot` (the newest portal of the path, developed into the root frame:
  `left`, `right` in meters, `apertureTopMeters`). If a table path lacks it (hand-built test fixtures), compute it with
  `developPortalSegment(world, step.sourceCellId, step.sourcePortalSideIndex, parent.rootFromDestination)`.
- In the batch this job runs after jobs 37, 25-27, 28-29 and 20. Jobs 28 and 29 rewrite parts of `renderFrame`,
  `syncPortalInstanceRender`, `syncStereoPortalInstanceRender`, `getRuntimeObjectVisiblePaths` and
  `transformVisiblePortalResultToRenderFrame` (job 29 adds an identity fast path and pooled matrices there). **Search by
  function name; the line numbers below are from `0b468e1` and will have moved.** Keep whatever 28/29 did; only change
  what this job names.
- Job 22 consumes `VisiblePortalPath.clipPlanes`. Job 23 (split-root stereo, later) changes the split-root branch of
  `syncStereoPortalInstanceRender`; do not restructure that branch beyond the option constant (Step B6).

## Before you start

| File | Lines at `0b468e1` | What |
| --- | --- | --- |
| `src/render/three/visiblePortalPaths.ts` | 1-20 | module header (describes the old algorithm; rewrite) |
| | 43-83 | `ComputeVisiblePortalPathsInput` (has `cameras?`, the conservative-hull input), `ComputeIndependentVisiblePortalPathsInput`, `VisiblePortalPathOptions` |
| | 86-130 | `VisiblePortalPath`, `VisiblePortalPathDebugSummary` (`clippedByCameraCount`, `clippedByAreaCount`), `ComputeVisiblePortalPathsResult` |
| | 173-249 | `computeVisiblePortalPaths`: full-table loop at :195, area drop at :217, sort/truncate at :227-231 |
| | 259-332 | `computeIndependentVisiblePortalPaths`: full-table loop at :291 |
| | 341-451 | `buildPortalApertureCorners`, `transformApertureCornersToRoot`, `projectRootSpacePointsToNdc` (`near` fallback 0.01 at :385), `projectNearCoplanarPortalToNdc` (5 cm at :159/:428), `projectCameraSpacePointsToNdc` |
| | 461-508 | `clipConvexPolygonByConvexPolygon`, `ndcRectForPolygon` (four spreads), `ndcPolygonAreaPixels` |
| | 545-630 | `projectNewestPortalApertureToNdc`, `buildNewestPortalApertureInRoot`, `finalizeVisiblePortalPathResult`, `projectRootSpacePointsToConservativeNdc` (hull), `createVisiblePath` (`rigidTransformToThreeMatrix` per frame at :624) |
| | 632-839 | `compareVisiblePaths` (keep), Sutherland-Hodgman, near-plane clip, dedupe, `convexHull`, `signedPolygonArea`, `orient2` |
| `src/render/three/createThreeApp.ts` | 782-783 | `rootRenderPathMaxDepth = 10`, `maxVisiblePaths = 2_000` |
| | 2459-2525 | `syncPortalInstanceRender` (mono): `minPortalScreenAreaPixels: 16` at :2502 |
| | 2530-2651 | `syncStereoPortalInstanceRender`: shared root at :2563-2590 (`:2573`), split root at :2591-2618 (`:2602`) |
| `src/render/three/renderPortalInstances.ts` | 106-122, 409-420 | `createRootVisiblePortalPath` (builds a `VisiblePortalPath`), `visiblePortalSummaryToRenderState` (`clippedByAreaCount`) |
| `src/render/three/renderState.ts` | 116 | `clippedByAreaCount` in debug state |
| `src/render/three/appDebugHelpers.ts` | 469 | `clippedByAreaCount` |
| `src/render/three/portalEyeFrameTransforms.ts` | 42-56 | `transformVisiblePortalResultToRenderFrame` (job 29 changes it; read the current version) |
| `src/render/three/worldAxes.ts` | | `worldPointToThree` (x, y, z) -> (x, z, -y), `threePointToWorld`, `rigidTransformToThreeMatrix` |
| `src/render/three/xrPortalEye.ts` | 40-86 | `resolveXrPortalEyeRenderRoot`: the eye's root is the cell that contains it |
| `src/cell-complex/segmentWalk.ts` | 112 | `walkDevelopedSegment` (for the brute-force test) |
| `tests/render-contract/visiblePortalPaths.test.ts` | all (573) | existing tests and helpers `createCamera`, `defaultOptions`, `twoRoomsWithPortal` |
| `tests/support/portalWordWitness.ts` | | job 20 helpers (`mulberry32`, `wordSignature`) |
| `_docs/MATHEMATICAL_MODEL.md` | 311-329 | Section 8 "Which paths are visible" (describes the old algorithm) |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`.

## Background

Frames: the funnel is computed in the **root cell's world axes** (x right, y forward, z up, meters). The eye
`E = (e.x, e.y, z_e)` is the camera position converted with `threePointToWorld`. For a re-rooted XR eye the camera
passed in is already the clone in the root frame (`xrPortalEye.ts`). **Precondition:** the eye lies in the root cell
(within 1e-6 m). This holds by construction: the mono root is the player's cell and the player's camera is at the
player's anchor; the XR root is the cell `locateDevelopedPoint` puts the eye in.

**Plan sector.** Visible plan directions form a sector `W` of directions `d` from `e`. For a portal
`(left L, right R)` developed into the root frame (job 20), a line through `e` with direction `d` crosses it forward iff

```text
cross(d, L - e) >= 0      <=>  d · gL >= 0,   gL = rotCW(L - e)  = ( (L-e).y, -(L-e).x )
cross(d, R - e) <= 0      <=>  d · gR >= 0,   gR = rotCCW(R - e) = (-(R-e).y,  (R-e).x )
```

`W(path) = W(parent) ∩ {d·gL >= 0} ∩ {d·gR >= 0}` for the newest portal, starting from "all directions" at the root.
Because `e` is in the root cell, a line through `e` that satisfies the constraints of a word crosses the portals in
order **ahead of** `e` (job 20 / issue 56 convexity argument), so `W` is exactly the set of visible plan directions.
Standing in a doorway (`e` on the first portal's line) makes `W` a half-plane; the clip routine below handles the
angle-π case.

**Vertical.** Every ray in `W` meets the newest portal `p_k` last; z is linear along the ray; with all ceilings at the
same height, `0 <= z <= top` at `p_k` and at `E` implies it everywhere in between. So only `p_k`'s top and bottom edges
bind. The visible region of the path is the cone of 4 half-spaces through `E`.

**Screen.** A plane through the eye maps to a line in NDC. For a three.js perspective projection matrix
(`elements` column-major: `P00 = e[0]`, `P11 = e[5]`, `P02 = e[8]`, `P12 = e[9]`, with `e[11] = -1`, `e[15] = 0`;
asymmetric XR frusta have `P02, P12 != 0`) the camera-space direction of NDC point `p` is
`v(p) = ((p.x + P02)/P00, (p.y + P12)/P11, -1)`. A plane through the eye with camera-space normal `n_c` keeps NDC
points with

```text
g(p) = (n_c.x / P00) p.x + (n_c.y / P11) p.y + (n_c.x P02 / P00 + n_c.y P12 / P11 - n_c.z) >= 0
```

Only points in front of the camera have NDC coordinates, and dividing by `w > 0` keeps the sign, so the image of the
visible region is exactly `[-1,1]^2 ∩ {g_j >= 0}`: Sutherland-Hodgman of the square by 4 lines, at most 8 vertices. An
empty image means nothing of the path (or its descendants) is on screen.

## Decisions

1. **New pure module.** Decided: put the funnel math in `src/render/three/portalFunnel.ts` (no THREE objects except
   reading `camera.projectionMatrix.elements` / `matrixWorldInverse.elements`), and keep traversal, options and results
   in `visiblePortalPaths.ts`. Why: unit tests with hand values, and job 24 will reuse it from the trie.
2. **Sector representation and clip.** Decided:

   ```ts
   /** Plan directions from the eye: all directions, or the ccw sector from `right` to `left` (angle in [0, π]). Unit vectors. */
   export type DirectionSector = { readonly full: true } | { readonly full: false; readonly right: Vec2xy; readonly left: Vec2xy };
   ```

   Inside the traversal store sectors as 4 numbers per stack slot in a `Float64Array` (see Decision 8); the object type
   is for the exported, tested helper `clipDirectionSector(sector, g): DirectionSector | undefined` (`undefined` =
   empty). Pseudocode (`τ = 1e-12`, all vectors normalized first):

   ```text
   clipDirectionSector(S, g):                                   // keep {d : d·g >= 0}
     if S.full: return { right: rotCW(g), left: rotCCW(g) }      // half-plane, angle π
     a = g·S.right ; b = g·S.left
     isPi = cross(S.right, S.left) <= τ and dot(S.right, S.left) < 0
     if a >= -τ and b >= -τ:
       if isPi and g·rotCCW(S.right) < -τ: return undefined     // only the boundary line survives
       return S
     if a < -τ and b < -τ: return undefined
     if a >= -τ:                                                  // left boundary moves
       newLeft = isPi ? (the t in {rotCW(g), rotCCW(g)} with cross(S.right, t) >= 0) : normalize(a·S.left - b·S.right)
       R = { right: S.right, left: newLeft }
     else:                                                        // right boundary moves
       newRight = isPi ? (the t in {rotCW(g), rotCCW(g)} with cross(t, S.left) >= 0) : normalize(b·S.right - a·S.left)
       R = { right: newRight, left: S.left }
     if cross(R.right, R.left) <= τ and dot(R.right, R.left) > 0: return undefined   // angle 0: no area
     return R
   ```

   `rotCW(x, y) = (y, -x)`, `rotCCW(x, y) = (-y, x)`, `cross(u, v) = u.x v.y - u.y v.x`.
   `clipSectorByPortal(S, portal, e)` = clip by `gL` then `gR` (Background).
3. **Clip planes.** Decided: `VisiblePortalPath` gets

   ```ts
   /** 4 planes (nx, ny, nz, d), inside where n·X + d >= 0, in the Three.js frame of the root cell (the frame that
    *  rootFromDestinationMatrix maps into). |n| = 1, or (0, 0, 0, 1) for "always inside". Never mutate. */
   readonly clipPlanes: Float64Array;   // length 16
   /** True when the traversal did not visit this path's children (area below the threshold, or depth == maxDepth). */
   readonly terminal: boolean;
   ```

   Plane order: 0 = right sector boundary, 1 = left sector boundary, 2 = top, 3 = bottom. Computed in world axes, then
   converted to Three axes with `(x, y, z) -> (x, z, -y)` for `n` (`d` unchanged). In world axes, with the newest
   portal `L`, `R`, `top = apertureTopMeters`, `E` the eye and `M` the portal's bottom midpoint `((L+R)/2, 0)`:

   ```text
   plane0: n = (-right.y, right.x, 0),  d = -n·E
   plane1: n = ( left.y, -left.x, 0),   d = -n·E
   if |signed distance of e to the line through L and R| < 1e-6 m:        // eye in the portal's vertical plane
     plane2 = plane3 = (0, 0, 0, 1)
   else:
     plane2: A = (R, top), B = (L, top); n = normalize(cross(A - E, B - E)); d = -n·E; if n·M + d < 0: negate
             (if |cross| < 1e-12: n = (0, 0, -1), d = top)
     plane3: A = (R, 0),   B = (L, 0);   n = normalize(cross(A - E, B - E)); d = -n·E; if n·((L+R)/2, top) + d < 0: negate
             (if |cross| < 1e-12: n = (0, 0, 1), d = 0)
   ```

   The root path (depth 0) has four `(0, 0, 0, 1)` planes; so does `createRootVisiblePortalPath` in
   `renderPortalInstances.ts`. Why the Three frame: `transformVisiblePortalResultToRenderFrame` must move planes with the
   same matrix it applies to `rootFromDestinationMatrix` (job 22 adds that).
4. **Screen polygon.** Decided: `clipPolygonNdc`, `clipRectNdc` and `screenAreaPixels` keep their meaning but are
   computed from the planes: transform each plane normal into camera space (`n_c = R_view · n`, `R_view` = upper 3×3 of
   `camera.matrixWorldInverse`; planes through the eye need no offset; an "always inside" plane is skipped), form
   `g(p)` (Background) and clip the NDC square with Sutherland-Hodgman. If the projection is not perspective
   (`|e[11] + 1| > 1e-9` or `|e[15]| > 1e-9`) use the full square (conservative; no such camera exists today). The
   polygon has at most 8 vertices, so the clip-texture vertex overflow of issue 58 cannot happen any more.
5. **Visibility rule.** Decided, for a child of a visible, non-terminal parent:
   - sector empty -> drop the child and its subtree (`clippedByFunnelCount`);
   - screen polygon empty (fewer than 3 vertices or area 0) -> drop with subtree (`clippedByCameraCount`: sight lines
     exist but none is in the view);
   - area > 0 but below `minPortalScreenAreaPixels` -> **keep, terminal**, do not visit its children
     (`terminalByAreaCount`);
   - otherwise keep; terminal iff `depth === maxDepth`.
   Why: a dropped sliver leaves clear-colour pixels; a kept terminal sliver draws its own cell. A terminal path's
   unvisited children show the scene background, which is already the fog colour (`createThreeApp.ts:420-422`:
   `scene.background` and `scene.fog` share `SCENE_BACKGROUND_COLOR`), so no extra "terminal fill" instance is added.
6. **Summary counters.** Decided: rename `clippedByAreaCount` to `terminalByAreaCount` everywhere (typecheck finds
   `renderPortalInstances.ts`, `renderState.ts`, `appDebugHelpers.ts`), add `clippedByFunnelCount` and
   `examinedPathCount` (children looked at). Keep `candidatePathCount` (table size), `keptPathCount`,
   `clippedByCameraCount`, `clippedByBudgetCount`, `budgetExhausted`.
7. **Traversal.** Decided: explicit stack (depth-first) over `pathTable.pathsByParentPathId.get(parent.id)`, pushing
   only kept non-terminal paths. Children are expanded from **pre-budget** visibility; sorting
   (`compareVisiblePaths`, unchanged) and truncation to `maxVisiblePaths` happen after the traversal, as today.
   `includeRootCell` and `sortMode` are unchanged. `computeIndependentVisiblePortalPaths` runs the same traversal once
   per camera (each eye has its own `E`; no shared projection any more).
8. **Scratch ownership.** Decided: module-scope scratch in `visiblePortalPaths.ts`, documented in a comment block:
   "Owned by `computeVisiblePortalPaths` / `computeIndependentVisiblePortalPaths`; valid only during one call; the
   functions are not re-entrant; nothing returned aliases scratch." Contents: `stackPaths: PortalRenderPath[]` and
   `stackSectors: Float64Array` (4 numbers per slot: right.x, right.y, left.x, left.y; NaN in slot 0 = full), grown by
   doubling; a `Float64Array(16)` plane scratch; a `Float64Array(2 * 9)` NDC polygon scratch and one for the clip
   output; a `THREE.Vector3` for the eye. Allocation per **examined** path: none. Allocation per **returned** path: the
   `VisiblePortalPath` object, its `clipPlanes` (copied from scratch) and its `clipPolygonNdc` array (still read by
   `portalClipData` until job 22 and by the debug overlay). Zero allocation per returned path needs stable ids and
   pooled results; that is job 24's trie, not this job. Record this in issue 57's Outcome.
9. **Matrix cache.** Decided: `const threeMatrixByPath = new WeakMap<PortalRenderPath, THREE.Matrix4>()` in
   `visiblePortalPaths.ts`; `rootFromDestinationMatrix` is the cached matrix (built once with
   `rigidTransformToThreeMatrix`). Document on the field: shared, never mutate. (`transformVisiblePortalResultToRenderFrame`
   multiplies into a new or pooled matrix and does not mutate it; check this after job 29.)
10. **Deleted.** Decided: delete the `cameras` option of `ComputeVisiblePortalPathsInput` and the conservative hull
    (`projectRootSpacePointsToConservativeNdc`, `convexHull`, `dedupeSortedPoints`: unsafe as a clip source at cone
    points, issue 57), the near-plane code (`projectRootSpacePointsToNdc`, `projectNearCoplanarPortalToNdc`,
    `projectCameraSpacePointsToNdc`, `clipCameraSpacePolygonAgainstNearPlane`, `intersectCameraSpaceNearPlane`,
    `dedupeCameraSpaceVertices`, `nearCoplanarPortalToleranceMeters`), the aperture helpers
    (`buildPortalApertureCorners`, `transformApertureCornersToRoot`, `buildNewestPortalApertureInRoot`,
    `projectNewestPortalApertureToNdc`) and `clipConvexPolygonByConvexPolygon`. Keep `ndcPolygonAreaPixels`,
    `summarizeVisiblePathCountByDepth`, `describeVisiblePortalPath`, `compareVisiblePaths`; rewrite `ndcRectForPolygon`
    as a loop (no spreads).
11. **One place for the options.** Decided: export `export const defaultMinPortalScreenAreaPixels = 16;` from
    `visiblePortalPaths.ts` (JSDoc: "Paths whose on-screen area is below this many physical pixels are kept but their
    children are not visited.") and build one `const visiblePortalPathOptions: VisiblePortalPathOptions` next to
    `maxVisiblePaths` in `createThreeApp.ts` (`maxDepth: rootRenderPathMaxDepth, maxVisiblePaths,
    minPortalScreenAreaPixels: defaultMinPortalScreenAreaPixels, includeRootCell: true, sortMode: "depth-then-area"`).
    The three call sites (mono, shared-root stereo, split-root stereo; search `minPortalScreenAreaPixels: 16`) pass it.
12. **Unequal heights.** Decided: out of scope. `apertureTopMeters` is `min` of the two cells' heights (job 20), and only
    `p_k`'s top binds; with unequal heights this over-includes rays blocked by an earlier lower portal. Those pixels
    show the nearer wall above the earlier portal through the depth test. Note it in `_docs/MATHEMATICAL_MODEL.md`
    Section 11.

## Steps

Run `npx vitest run <file>` after each step; `npm run typecheck` after each Part.

### Part A: the funnel module (commit 1)

1. Create `src/render/three/portalFunnel.ts` with header and JSDoc on every export: `DirectionSector`,
   `clipDirectionSector`, `clipSectorByPortal(sector, portal: OrientedPortalSegment, eye: Vec2xy)`,
   `writeFunnelClipPlanes(out: Float64Array, offset, sectorRight, sectorLeft, portal, eye: Vec3)` (world axes, then
   converted to Three axes, Decision 3), `writeAlwaysInsideClipPlanes(out, offset)`, and
   `clipPlanesToNdcPolygon(planes: Float64Array, projectionElements, viewRotationElements, out: Float64Array): number`
   (returns the vertex count; Decision 4).
2. Create `tests/render-contract/portalFunnel.test.ts` with hand-computed cases:
   - Eye `e = (0,0)`, portal `{ left: (-1,1), right: (1,1) }` (crossed toward +y; facing +y, left is -x):
     from full, the sector is `right = (1,1)/√2`, `left = (-1,1)/√2`.
   - Same portal, eye `(0,1)` (on the portal line, in the doorway): the sector is the half-plane `right = (1,0)`,
     `left = (-1,0)` (angle π). Clipping it by `g = (1,0)` (keep `d.x >= 0`) gives `right = (1,0)`, `left = (0,1)`.
   - Eye `(0,0)`, first portal as above, second portal `{ left: (4,3), right: (5,3) }` (directions 36.9° and 31.0°,
     both right of the first sector's 45° edge): empty.
   - Planes: eye `E = (0,0,1)` (world axes), portal `{ left: (-1,1), right: (1,1), apertureTopMeters: 3 }`, sector
     from the first case. In world axes: plane 0 is `n = (-1,1,0)/√2, d = 0`; plane 1 is `n = (1,1,0)/√2, d = 0`;
     plane 2 (top) is `n = (0,2,-1)/√5, d = 1/√5` (boundary at y = 2 is z = 5); plane 3 (bottom) is
     `n = (0,1,1)/√2, d = -1/√2` (boundary at y = 2 is z = -1). Points: `(0,2,1)` inside all four; `(2,1.5,1)` outside
     plane 0; `(0,2,5.5)` outside plane 2; `(0,2,-1.5)` outside plane 3. The function returns Three-axes planes:
     convert the points with `worldPointToThree` and compare `n·X + d` values (they are equal in both frames).
   - Screen: camera at the Three origin looking down -z, `PerspectiveCamera(90, 1, 0.01, 100)` (so `P00 = P11 = 1`,
     `P02 = P12 = 0`), one plane with camera-space normal `(1,0,0)` and three always-inside planes: the NDC polygon is
     the right half `[0,1] × [-1,1]`, area 2 (NDC units) = `2 · w · h / 4` px. A plane with normal `(0,0,1)`
     (`v.z >= 0`, only rays behind the camera) gives an empty polygon.
   - Sector clip properties (seeded PRNG): for 500 random sectors and vectors `g`, the result is contained in the input
     (both boundary rays satisfy the input's constraints within 1e-9) and satisfies `d·g >= -1e-9` at both boundaries.
3. Commit: "Job 21 Part A: plan-sector funnel and clip planes".

### Part B: traversal, results, options (commit 2)

1. Add `clipPlanes` and `terminal` to `VisiblePortalPath` (Decision 3); update `createRootVisiblePortalPath`
   (`renderPortalInstances.ts`) and every test helper that builds a `VisiblePortalPath` literal (typecheck lists them,
   e.g. `fakeVisibleResult` in `visiblePortalPaths.test.ts`, `portalClipData.test.ts`).
2. Rewrite the core as one private function used by both exports:

   ```text
   visitFromRoot(world, table, camera, viewport, options, scratch) -> { discovered, counters }
     camera.updateMatrixWorld(true); if camera has updateProjectionMatrix: call it   // as today
     E = threePointToWorld(position of camera.matrixWorld)                            // scratch Vector3
     root = table.pathsById.get(0)  (throw as today if missing)
     discovered = includeRootCell ? [visiblePath(root, alwaysInsidePlanes, fullSquare, terminal: maxDepth == 0)] : []
     push (root, FULL sector)
     while stack not empty:
       (parent, sector) = pop
       for child of table.pathsByParentPathId.get(parent.id) ?? []:
         if child.depth > options.maxDepth: continue
         examined += 1
         portal = child.newestPortalInRoot ?? developPortalSegment(world, lastStep.sourceCellId,
                                                  lastStep.sourcePortalSideIndex, parent.rootFromDestination)
         s = clipSectorByPortal(sector, portal, E.xy)                              // into scratch, no allocation
         if s empty: clippedByFunnel += 1; continue
         writeFunnelClipPlanes(scratchPlanes, 0, s.right, s.left, portal, E)
         n = clipPlanesToNdcPolygon(scratchPlanes, camera.projectionMatrix.elements, view rotation, scratchPolygon)
         area = n >= 3 ? shoelace(scratchPolygon, n) * w * h / 4 : 0
         if area <= 0: clippedByCamera += 1; continue
         terminal = area < options.minPortalScreenAreaPixels or child.depth == options.maxDepth
         if area < options.minPortalScreenAreaPixels: terminalByArea += 1
         discovered.push(createVisiblePath(child, copy of planes, copy of polygon, area, terminal))
         if not terminal: push (child, s)
   ```

   Then sort, truncate and summarise exactly as today (`finalizeVisiblePortalPathResult`), with the counters of
   Decision 6. `computeVisiblePortalPaths(input)` = one call; `computeIndependentVisiblePortalPaths(input)` = one call
   per camera (empty camera list returns `[]`, as today).
3. Delete the code listed in Decision 10 and the `cameras` input field. Rewrite the module header (no near plane, no
   hull; the funnel; terminal paths; scratch ownership).
4. Add the matrix cache (Decision 9).
5. `transformVisiblePortalResultToRenderFrame` (`portalEyeFrameTransforms.ts`): copy `clipPlanes` and `terminal`
   through unchanged for now (job 22 transforms the planes). If job 29 made results pooled, follow its pattern.
6. `createThreeApp.ts`: Decision 11 (one options object; three call sites). Do not otherwise restructure the
   split-root branch (job 23 owns it).
7. Update `tests/render-contract/visiblePortalPaths.test.ts` (record every change under `### Deviations`):
   - delete "uses a conservative clip polygon across multiple culling cameras" (the `cameras` option is gone) and the
     `clipConvexPolygonByConvexPolygon` describe block;
   - "rejects a portal fully behind the camera": still `clippedByCameraCount === 1` (sight lines exist, none on screen);
   - tests that assert a sliver path is **absent** ("clips a grazing parent aperture instead of making cube path 0 3
     visible", "drops near-corner duplicate sliver paths while keeping the main portal views"): change the assertion to
     "absent, or present with `terminal === true` and `screenAreaPixels <` the test's threshold". Before changing one,
     confirm with the brute-force helper of Part C (a pixel whose ray walks that word exists) and note it;
   - any other changed expectation: verify the new value with the brute-force helper and list it.
8. Run `npx vitest run tests/render-contract`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Commit: "Job 21 Part B: visible-parent
   traversal with the exact funnel".

### Part C: equivalence and brute-force tests; docs (commit 3)

1. **Traversal equals full-table scan** (issue 57 merged item; new `describe` in `visiblePortalPaths.test.ts`): write a
   reference in the test file that loops over `table.paths` in table order (parents first) keeping a
   `Map<pathId, sector>` and applying Decision 5 with the exported `portalFunnel.ts` helpers, without the stack. Compare
   pre-budget id sets (use `maxVisiblePaths: 100_000`):
   - mono: cube root `front` with `buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: 1e-6 })`
     and three cameras (`createCamera` from the file: centre looking at `(2,2,1.6)` fov 110; near a portal at
     `x = 7.49`; pitched down 30°);
   - shared-root stereo: `computeIndependentVisiblePortalPaths` with eyes at ±0.032 m: each eye's set equals the
     reference for that eye, and equals `computeVisiblePortalPaths` for that camera alone.
2. **Cost independent of table size**: cube, depth-10 culled table for `front` (assert it has > 1000 paths); a camera
   at the centre looking at a wall with fov 40: `summary.examinedPathCount` equals the sum over returned non-terminal
   paths of their child counts, and is below 5% of the table size.
3. **Brute-force ray walk (no false negatives)**, new file `tests/render-contract/visiblePortalPaths.property.test.ts`:
   for worlds `cube`, `icosahedron`, `torusModuli`, `genus2Torus`, 40 random cameras each (fast-check or seeded PRNG):
   root cell random, eye `arbPointInCell` at height 1.45, plus 10 cameras placed within 1 cm of a random portal (inside
   the root); yaw random, pitch in [-60°, 60°], roll in [-30°, 30°], vertical half-FOV in [30°, 80°], aspect in
   [0.6, 1.8]. Tables: `buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: 1e-6 })`, built
   once per world. Options: `maxDepth: 6`, `minPortalScreenAreaPixels: 0`, `maxVisiblePaths: 100_000`. For 300 random
   NDC points per camera:
   - direction `u` = world-axes unit vector of the camera ray through the NDC point;
   - horizontal walk as in job 16: `s = hypot(u.x, u.y)`; skip if `s < 1e-6`; `T` = distance to the floor (`u.z < 0`:
     `-z_e/u.z`) or ceiling (`u.z > 0`: `(h - z_e)/u.z`), capped at 200 m; `walkDevelopedSegment({ world, cellId:
     root, start: e, direction: (u.x, u.y)/s, lengthMeters: s·T, maxCrossings: 6 })`;
   - the walked word (crossings) and each of its prefixes must be a **returned** path (look up by `wordSignature`), and
     the NDC point must satisfy every plane of each of those paths (evaluate `n·X + d` at `X = E + 1·u` in Three axes,
     tolerance 1e-9);
   - skip points within 1e-6 of a sector boundary (ties at cell corners).
   Record the run time; keep the test under 20 s (reduce counts if needed and say so).
4. **Matrix identity**: two calls with the same table and camera return the identical `rootFromDestinationMatrix`
   object for the same path id (`toBe`).
5. Docs: rewrite `_docs/MATHEMATICAL_MODEL.md` Section 8 "Which paths are visible" (funnel, planes, screen polygon,
   terminal paths, traversal) and add the unequal-heights note to Section 11 (Decision 12). Update
   `_docs/ARCHITECTURE.md:139-141` if it still says "recursive convex clipping of portal apertures".
6. Full checks (below). Commit: "Job 21 Part C: visibility equivalence and brute-force tests".

## Tests and checks

After each Part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale). After Parts
B and C: `npm run build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` (rerun once on a
single failure right after a build).

Manual checks (browser, `npm run dev`; record results or "not run" in the report):
- Walk along a wall past a doorway at a grazing angle in `cube` and `icosahedron`: no flickering background-coloured
  lines along the door jambs.
- Stand exactly in a doorway and turn around: the view through the doorway never blinks out.
- In XR (if available): lean the head through a portal; the view stays stable in both eyes.

## Do not

- Do not change the static cull (job 20) or the GPU clip shader and clip texture (job 22).
- Do not change sort modes, `maxVisiblePaths` or the stereo id remapping (`remapStereoPortalPathIds`, job 23/24).
- Do not add a fog/terminal-fill instance (Decision 5).
- Do not keep any near-plane or convex-hull code path "just in case".

## Done when

- No code in `visiblePortalPaths.ts` iterates `pathTable.paths`; `examinedPathCount` test passes.
- The equivalence tests (mono and shared-root stereo) and the brute-force property test pass.
- Every returned path has 4 clip planes and a polygon of at most 8 vertices.
- `minPortalScreenAreaPixels: 16` appears nowhere; `defaultMinPortalScreenAreaPixels` is used once in `createThreeApp.ts`.
- Issue 57 is closed (`_issues/_closed/`) with an Outcome (funnel, traversal, terminal paths; per-returned-path objects
  remain until job 24; the readPixels grazing walk is a manual check) and Closing evidence (commits, test names). Job
  moved to `_done/` with its report; queue row updated.
