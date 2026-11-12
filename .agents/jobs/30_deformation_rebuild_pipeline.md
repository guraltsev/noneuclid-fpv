# Job 30 - Smooth deformation: cheap commits, a step per frame, a worker only for the cull

Status: queued (rewritten 2026-11-11 against `aab3ff5`; the text before that date predated the engine wave and is replaced).
Resolves: issue [82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md), issue
[90](../../_issues/90_portal_wall_textures_pile_up_during_deformation.md), and items 1 to 3 of issue
[55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md). Item 4 of issue 55 (the `Iso2` type) moves to job 24.

## Goal

In `torus-moduli`, the geometry computer's sweep from \(a = 0\) to \(a = 30\) at \(b = 15\) runs in about 4 s on desktop, smoothly: the
world advances one small step per frame instead of about 10 jerky steps per second, and no frame is long because of a commit.

Today each step is a worker round trip (compile, full static cull, structured clone of the whole path table), followed on the main
thread by a teardown and rebuild of every cell's render data. Steps are serial: the next build is requested only after the previous one
is committed.

## Depends on

Nothing queued. Jobs 09, 10, 20 and 67 are done. Job [35](35_torus_family_as_teichmuller_space.md) comes after this job and relies on
its commit path. Job [68](68_deformation_commit_in_the_step.md) moves the commit into the engine step afterwards; do not do that here.

## Before you start

Read, in this order:

- issue 82, issue 90, and issue 55 with its status update of 2026-11-11 (the measured costs below replace its table);
- `src/runtime/worldGeometrySession.ts`, `worldGeometryWorker.ts` and `worldGeometryWorkerClient.ts`;
- `src/render/three/geometryCommit.ts`; `finishGeometryCommit` and `rebuildCellMeshes` in `src/render/three/createThreeApp.ts`;
  `portalFramePass.ts` (`disposeArchetypes`, `buildArchetypes`); `cellRenderArchetypes.ts`; `buildCellMesh.ts`; `buildPortalMesh.ts`;
  `portalWallTexture.ts`; `getConfiguredTexture` in `preloadWorldAssets.ts`;
- `src/cell-complex/portalPaths.ts` (`PortalRenderPath`, `createPortalPathTable`) and the composition at
  `staticPortalPathCull.ts` (search `compose(portal.transformToTarget`);
- design 013 sections 5.2 (step 7), 5.4 and 6.5; design 012 P8, P9 and P12.

## Background: what a step costs now (measured 2026-11-11, slow machine, ratios only)

| \((a, b)\) | worker build | `structuredClone(response)` | kept paths |
| --- | --- | --- | --- |
| (0, 15) | 32 ms | 44 ms | 1793 |
| (15, 15) | 26 ms | 37 ms | 1793 |
| (30, 7.5) | 15 ms | 28 ms | 1793 |

- Job 20 made the static cull about 5 times cheaper; the clone of the response now costs more than the build, and half of it lands on
  the main thread. `compileCellComplex` costs about 0.02 ms.
- `torus-moduli` keeps the same 1793 paths, with the same portal words, at every state. The per-frame funnel and clip planes are
  exact, so a kept set that is a little stale can cause pop-in, never wrong drawing (issue 55, item 2).
- The main-thread commit (`geometryCommit.commit`, then `finishGeometryCommit`) has never been timed. It disposes and rebuilds every
  cell archetype (geometry, two materials, `InstancedMesh` and two instanced attributes per part, at full capacity), every cell group,
  the portal debug runtime (with `portal-static-cull-debug` on, a full main-thread static cull) and the runtime diagnostics (whose
  history resets). Decorations are no longer part of this: they are runtime-object archetypes built once.
- Portal walls: `buildPortalMesh` sets the texture repeat to `max(1, edgeLength / 8)`, which is a key of `getConfiguredTexture`, so
  each new edge length clones and keeps a texture (issue 90). The wall map is a generated 64 x 64 `DataTexture`, so each leak is small.
- `cancel()` is local: the worker finishes a stale build and the next request queues behind it. The client does remove a stale
  resolver when its response arrives (issue 55 was wrong there).
- Job 67 could not make a headless tab advance a deformation (`geometry.setTorusSkew 8` left `current` at 0). Not investigated.

## Decisions

1. **Intermediate states never go to the worker.** The main thread builds each step itself: `family.nextStep`, `applyToSpec`,
   `compileCellComplex`, `validateSnapshot` (all cheap), then **re-develops the kept path table** for the new world (decision 2).
   The worker is used only to refresh the kept set: a full static cull of the state at the **target** when a sweep starts, and of the
   then-current state every 0.5 s of sweeping and when the sweep ends. A refreshed table arrives for an older state; re-develop it for
   the current world before use.
2. **Re-developing a table** is a new pure function, `redevelopPortalPathTable(table, world)` in `src/cell-complex/portalPaths.ts`. It
   walks `table.paths` in order (parents come before children) and recomputes `destinationFromRoot`, `rootFromDestination` and
   `newestPortalInRoot` for each path from its parent and its last step, with exactly the composition the cull uses (`staticPortalPathCull.ts`).
   It keeps ids, steps and parent links. It throws if a step names a portal the world does not have. Factor the shared composition into
   one helper used by `portalPaths.ts`, `staticPortalPathCull.ts` and the new function, so the three cannot drift.
3. **One step per frame, timed by the step budget.** A sweep advances at most one step per rendered frame. The step length stays job
   67's Teichmuller step \(\delta = 1/375\) per commit; at 90 frames per second the sweep from \((0, 15)\) to \((30, 15)\) (Teichmuller
   length about \(1\)) then takes about 4 s. Do not make the step depend on the frame time in this job. Job 68 puts it on simulation ticks.
4. **The commit updates in place.** When the new world has the same cells, side counts and archetype capacities as the old one (always
   true for the torus families), the commit:
   - rewrites the vertex positions (and UVs) of floor, ceiling, wall and portal-frame geometry in place, sets `needsUpdate`, and recomputes
     bounding volumes; it keeps materials, `InstancedMesh` objects and their attributes;
   - keeps the portal debug runtime and the runtime diagnostics, and gives each a `setWorld(world, staticCull)` (or equivalent) that
     updates their data without resetting history;
   - keeps cell groups, and re-creates only the canvas labels whose text changed.

   Otherwise it falls back to today's full rebuild. Record which path a commit took in the debug state.
5. **Wall textures use world-space UVs with a fixed repeat**, as the floor does: the repeat is a constant of the wall material, and the
   UV of a wall vertex is its distance along the edge (and its height) divided by 8 m. So `getConfiguredTexture` sees one wall
   configuration per world, whatever the deformation. Do not touch the floor patch shader.
6. **Measure the commit.** Add `commitMs` to `framePerformance` (debug overlay and in-headset panel) for the frame in which a commit
   runs, and `commitCount` and `lastCommitPath` (`"in-place"` or `"rebuild"`) to the read-only debug state. Expose them through the
   existing `debug` API namespace so a release scenario can read them (it is debug data, as `debug.derivedStats` is).
7. **Worker protocol.**
   - An `init { baseSpecVersion, baseSpec }` message; the worker caches the compiled base world and the family registry. Requests then
     carry `baseSpecVersion`, not `baseSpec`.
   - Requests are queued inside the worker and taken one at a time with `setTimeout(0)` between them, so a `{ cancel: requestId }`
     message that arrives while a build runs is seen before the next queued build starts. A canceled request is answered with
     `{ requestId, canceled: true }`. A build already running is not interrupted.
   - The response drops what the main thread does not use. Check every reader: if nothing outside `portal-static-cull-debug` reads
     `summariesByRootCellId` and rejected paths, post them only when that option is on.
   - Typed-array transport of path tables is **not** in this job (job 24 replaces the tables).
8. **The headless sweep first.** Before changing anything else, find out why a headless tab does not advance a deformation (job 67's
   report) and fix it if the cause is in the app. A release scenario must be able to run a sweep. If the cause is the browser
   (for example no `requestAnimationFrame` in a hidden tab), record it and make the scenario open a visible tab instead.

## Steps

1. **Baseline.** Typecheck and tests. Then, before any change, add decision 6's `commitMs` and counters (a small, separate commit), and
   record in the Report: median and worst `commitMs`, sweep duration and longest frame for the sweep \((0, 15)\) to \((30, 15)\) in
   `torus-moduli` on desktop, and `renderer.info.memory.textures` / `.geometries` before and after it. Tests:
   `tests/render/geometryCommit.test.ts`.
2. **Headless sweep** (decision 8). Write the release scenario `tests/app/torusDeformation.release.test.ts` "sweeps to (30, 15) and
   back": `geometry.setTorusSkew`, wait until `current` equals the target, read the commit counters.
3. **`redevelopPortalPathTable`** (decision 2), with the shared composition helper. Tests in `tests/cell-complex/portalPaths.test.ts`:
   for every example world and for torus states \((0, 15)\), \((7.5, 15)\), \((30, 7.5)\): a table culled at state \(s\) and re-developed for
   state \(t\) equals, to \(10^{-12}\), the table culled at \(t\) restricted to the same paths; re-developing for the same world is the identity.
4. **Main-thread steps** (decisions 1 and 3) in `worldGeometrySession.ts`. The session holds the current kept table, steps once per
   `pollReadySnapshot` call (once per frame), and asks the worker for refreshes. Tests in `tests/runtime/worldGeometrySession.test.ts`:
   one step per poll; a refresh that arrives late is re-developed before use; cancel then a new target starts stepping on the next poll.
5. **Worker protocol** (decision 7). New `tests/runtime/worldGeometryWorkerClient.test.ts` with a fake worker that records message
   order: init once; cancel before a queued build skips it; a stale response is dropped.
6. **In-place commit** (decision 4). Tests: `tests/render/cellRenderArchetypes.test.ts` and `tests/render/buildCellMesh.test.ts`: after
   an in-place update the vertex positions equal a fresh build's; materials and `InstancedMesh` objects are the same objects; a world with
   different capacities takes the rebuild path. A spy test: a commit calls neither `instantiateGltf` nor `getConfiguredTexture` with a new key.
7. **Wall UVs** (decision 5). Test: commits of 10 different edge lengths leave the number of configured textures unchanged; a wall's UV
   at a vertex equals its edge distance and height over 8 m.
8. **Measure again** as in step 1 and record the numbers side by side.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, the release tier, `npm run smoke -- --world torus-moduli`, `npm run bench`
(the counters must not rise; this job touches no module tick).

## Do not

- Do not move the commit into the engine step, add `world/geometryChanged` or a module `transformGeometry`: that is job 68.
- Do not change the reduced footprint or the marking: that is job 35.
- Do not add `Iso2` or typed-array path tables: job 24.
- Do not change the floor patch shader or the Teichmuller step length.

## Done when

- The desktop sweep \((0, 15) \to (30, 15)\) takes at most 5 s, with one commit per frame, median `commitMs` at most 1 ms and no frame
  over 20 ms caused by a commit (numbers in the Report, before and after).
- `renderer.info.memory.textures` and the configured-texture count are unchanged after 100 commits.
- Every commit in `torus-moduli` takes the in-place path; a commit calls no `instantiateGltf`.
- `cancel()` followed by a new target starts moving on the next frame.
- The release scenario of step 2 passes in two consecutive runs.
- The manual check, for the maintainer: sweep in `torus-moduli` on desktop and on a Quest, judge smoothness, and read `commitMs` on the Quest.
