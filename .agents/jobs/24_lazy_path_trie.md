# Job 24 - Replace per-root path tables with a lazy path trie

Status: queued.
Former issue: 60 (converted to a job on 2026-10-28).

Priority: P2 (design / performance / memory). The id inconsistencies already listed in issue 41 disappear under this
design; they are not filed again here.

## Status update 2026-10-28

Nothing in the proposal is implemented. Startup still builds every root's table synchronously
(`createThreeApp.ts:775`, `buildStaticallyCulledPortalPathTables(appState.world, portalPathOptions)`). The worker
still rebuilds and posts `staticCull` on every deformation (`src/runtime/worldGeometryWorker.ts:79-87`). Paths still
copy their step lists and carry two `RigidTransform3` objects. `buildPortalPathTables` still uses `queue.shift()`
(`portalPaths.ts:179`); only tests call it now (`tests/cell-complex/portalPaths.test.ts`,
`portalPathDebug.test.ts`). Archetype capacity still comes from the table (`deriveCellRenderArchetypeCapacities`,
called at `createThreeApp.ts:802`). Line numbers below have been updated. `buildDefaultCellRenderArchetypeCapacities`
(`cellRenderArchetypes.ts:166-180`) is an unused export that builds a second full static cull, and it should go with
this change.

## Summary

At startup, and again on every deformation, the app builds a culled table for *every* cell as root: up to 50 000 paths
each, at depth 10. Each path carries a full copy of its step list and two `RigidTransform3` objects. The whole set is
then structured-cloned from the worker. The table's only runtime roles are these:

1. supplying transforms, which cost one matrix multiply on the fly;
2. supplying stable path ids for instance and clip slots;
3. sizing `InstancedMesh` capacities;
4. holding the static cull flag.

All four can come from a trie of portal words that is grown lazily and shared by all roots. Nodes are created only when
the per-frame funnel (issue 57) reaches them, and each node stores its static-cull cone (issue 56) on creation.

## Evidence

- `createThreeApp.ts:760-775`: `maxDepth 10`, `maxKeptPathsPerRoot 50_000`.
  `buildStaticallyCulledPortalPathTables(appState.world, ...)` runs synchronously on the main thread during startup,
  for all roots.
- `src/runtime/worldGeometryWorker.ts:79-87`: on every deformation the worker rebuilds all roots and `postMessage`s `staticCull`.
  That message holds every path plus the `pathsById`, `pathsByDestinationCellId` and `pathsByParentPathId` maps, and
  `rejectedPaths`. The structured clone grows linearly with Σ_roots |table|.
- `staticPortalPathCull.ts:262-281` and `portalPaths.ts:198-216`: each path allocates `steps: [...parent.steps, step]`,
  which is O(depth) per path, so the total is O(N·depth). It also allocates two `RigidTransform3` objects, each holding
  a `Mat3` and a `Vec3`. A rough estimate is 0.5 KB per path, so a world at the 50 000-path budget costs about 25 MB per
  root cell before the Maps.
- Growth: without culling, a cell graph of degree D yields D·(D-1)^(k-1) words of length k. For D = 4 and k = 10 that is
  78 732 words at depth 10 alone, so the budget, not visibility, decides which deep words exist (see issue 56, budget
  bias).
- `portalPaths.ts:179`: `queue.shift()` in the BFS is O(n) per pop, so the build is O(n²). The function is now used only
  by tests, but still exported.
- `cellRenderArchetypes.ts:140-164`: capacity depends on the table, so a deformation that changes table sizes forces the
  archetype meshes to be rebuilt.
- Ids are positional: they depend on root, culling order and budget. In stereo they are remapped every frame
  (`portalEyeFrameTransforms.ts:59`), and the clip-slot assignment changes between frames. Nothing keyed by path id
  (debug selection, `ShowCellPath`, aim results) survives a root change or a rebuild.

## Proposed change

- **Trie node.** `{ id, parent, portalIndex, cellId, depth, destinationFromRoot?, cone?, children: Int32Array(deg) }`.
  - The key is (root cell, sequence of portal indices). Roots are the depth-0 nodes.
  - `id` is assigned once, when the node is created, and never reused while the world snapshot lives. That makes it
    stable across frames, eyes and root switches.
  - Store transforms in a pooled `Float64Array` (12 numbers per node). Instead of copying step lists, recover steps by
    walking parents.
- **Lazy growth.** The per-frame traversal (issue 57) asks for `child(node, portalIndex)`.
  - On first request it composes the transform, runs the O(|K|) static cone clip (issue 56) and caches either "culled"
    or the cone.
  - Culled children are memoized as a sentinel, so the test runs at most once per word.
  - Memory therefore grows with the set of words actually *seen*, not with D^k.
- **Root switch.** A root change in the same snapshot reuses the new root's subtree. Optionally re-root the stereo union
  by a "same developed placement" key, (destination cell, quantized `rootFromDestination`), so that both eyes share an
  instance even across a root split. That also simplifies issue 59.
- **Capacity.** Size archetypes from `maxVisiblePaths x eyes`, or grow by doubling. Remove
  `deriveCellRenderArchetypeCapacities` and the dependence on the table.
- **Deformation.** The worker returns only the compiled world. The main thread drops the trie and rebuilds it lazily,
  amortized over the next frames, with a per-frame node-creation budget so that the first frame after a deformation
  cannot stall.
- **Debug.** `portalPathDebug.checkPortalPathString` resolves a word by walking the trie directly. That is correct by
  construction and removes the separate-table id mismatch from issue 41. The static-cull debug view lists memoized
  culled sentinels.
- Delete `buildPortalPathTables` or make it a test helper. If it is kept, replace `queue.shift()` with an index cursor.

## Acceptance criteria

- No per-root table is built at startup or posted from the worker. Startup time to first frame and worker message size
  are measured and reported in the PR.
- Path ids for a word stay unchanged across 1000 frames of camera motion and across a root switch and back.
- Heap usage after a 60 s scripted walk through the default worlds is bounded by O(visited words). Peak memory is
  reported before and after.
- All existing visibility contract tests pass with the trie as the source of paths.

## Merged from issue 41 (2026-10-28)

- The path ids that `buildStaticallyCulledPortalPathTables` returns are sparse and differ from those of
  `buildPortalPathTables`. This is documented in its JSDoc (`staticPortalPathCull.ts:181`) but not changed. The lazy
  trie should give one id scheme for culled and unculled tables.
