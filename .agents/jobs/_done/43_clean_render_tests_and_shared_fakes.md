# Job 43 - Clean the render tests and share the boundary fakes

Status: done, needs review on 2026-10-31.
Resolves: nothing by itself (it pays off test debt recorded in `tests/hygiene-baseline.txt`).

## Goal

Rename `tests/render-contract/` to `tests/render/`, give the boundaries of the renderer one shared fake each, and bring
the render tests up to `_docs/tests.md`: they assert renderer contracts, never the layout of three.js objects or
internal counters.

## Depends on

Job 41. Job 42 must have added the shared fixtures in `tests/fixtures/cell-complex/` (two-room spec, square base).

## Before you start

Read:

| File | What to look at |
| --- | --- |
| `_docs/tests.md` | §2.2, §4.5 (fakes), §8.1 (the paragraph on renderer tests), §8.3 (boundaries and their fakes) |
| `.agents/jobs/_reports/test_audit_2026_10_31.md` | §3: the per-file verdicts and the list of repeated fakes |
| `.agents/jobs/32_layer_dag.md` | which modules job 32 will move; their tests stay in `render` until then |
| `_docs/design/012-engine-api.md` | the paragraph citing `funnelStaticCullBenchmark.test.ts` (section 6) |

Baseline: `npm run typecheck`, `npm test` and `npm run test:report`. Save the output.

## Decisions

1. **The rename.** `git mv tests/render-contract tests/render` in its own commit. Update every path that refers to it
   (grep for `render-contract` in `_docs/`, `.agents/` and `scripts/`). Leave `_done` jobs and `_reports` alone: they
   are history.
2. **Shared fakes** go in `tests/support/`, one file per boundary:
   - `fakeRenderer.ts`: a WebGL renderer with `info`, `setRenderTarget`, `render` and `xr`. It records the calls a test
     reads.
   - `fakeXr.ts`: the navigator `xr` object, a session and its input sources, and gamepads.
   - `fakeCanvas2d.ts`: a 2D context.
   - `preparedAssets.ts`: a builder of `PreparedWorldAssets` with defaults and overrides.
   - `cameras.ts`: one camera builder replacing the 8 local ones.

   Each file has a module comment naming the real interface it stands in for. A fake implements only what the tests
   use. The contract test of `fakeRenderer` against a real `WebGLRenderer` belongs to job 44 (`release` tier): add a
   `TODO(job44)` line to the fake's comment.
3. **The verdicts** in audit §3 are the default plan. A different choice is recorded under `### Deviations`.
4. **Benchmarks.**
   - `funnelStaticCullBenchmark.test.ts` becomes `scripts/bench/funnelStaticCull.bench.ts` (runner from job 42).
   - `frameAllocations.test.ts` becomes `scripts/bench/frameAllocations.bench.ts`: it mocks the `three` module to count
     constructors, which is a measurement, not a behaviour.
   - In `_docs/design/012-engine-api.md`, change only the sentence that cites the old path, so it names
     `npm run bench -- funnelStaticCull`. Do not edit anything else in 012 and add no decision-log line: it is a path
     fix, not a design change.
5. **What a render test may assert:**
   - data handed to the GPU (clip planes, instance matrices and counts, uniforms the shader contract names);
   - what is released on dispose;
   - what a frame reads from the snapshot;
   - which objects are visible.

   It may not assert:
   - object names, child counts or the identity of meshes or matrices;
   - GLSL substrings;
   - `userData` flags;
   - internal statistics counters;
   - a spy on `traverse`.

   Where such an assertion was the only proof of a behaviour (for example "the cache is reused"), keep the behaviour by
   asserting its outcome, or retire the case and say why in the behaviour map.
6. **Tests follow the code.** Do not move a test to a new area for code that is still in `src/render/`, even when it
   imports no three.js. Job 32 moves those tests with their code. Exception: cases that test `src/ui/paletteDefinition`
   through `scenePaletteLibraryAdapter` move to `tests/ui/`, because their owner is in `src/ui/` already.
7. **Duplicates (one owner each):**
   - joystick dead zone and strafing: `xrControls`;
   - each eye has its own root: `xrPortalEye`;
   - stereo ranking and budget: `portalClipData`;
   - ghost suppression: `runtimeObjectPortalInstances`.
8. **Names, comments, proof and behaviour map:** as in job 42, decisions 3, 11 and 12.

## Steps

1. The rename (decision 1). Run `npm test`, then commit.
2. Write the shared fakes and fixtures (decision 2), and switch the files that rebuilt them inline, one file at a time,
   running each file after its switch. Then commit.
3. Write the behaviour map for the whole area.
4. Apply the verdicts and decisions 4–7, in commits of about ten files. Do the proof runs.
5. Remove the area's lines from `tests/hygiene-baseline.txt`.
6. Run `npm run test:report` and compare it with the baseline.

## Tests and checks

After each commit: `npx vitest run tests/render` and `npm test`. At the end: `npm run typecheck`, `npm test`,
`npm run test:report`, `npm run docs:check`.

## Do not

- Change `src/`.
- Move tests for code that job 32 will move (decision 6).
- Weaken an assertion to make a test pass, or add baseline lines.

## Done when

- `tests/render-contract/` no longer exists.
- No file in `tests/render/` builds its own renderer, XR, canvas or prepared-assets fake.
- No baseline line remains for `render`.
- The report has the behaviour map and the proof lines.
- `npm test` and `npm run docs:check` pass.

## Report

### Done

Commits on `design/012-engine-api` (b49fc07..a78cbb0), in order:

1. `d61865d` — Rename: `git mv tests/render-contract tests/render`. Fixed every live path reference in `_docs/`
   and `.agents/` (`_docs/ARCHITECTURE.md`, `_docs/design/012-engine-api.md` §6 only the sentence decision 4 names,
   `.agents/jobs/32_layer_dag.md`, `.agents/jobs/34_type_strictness_lint_bundle.md`,
   `.agents/knowledge/running-ad-hoc-typescript.md`). `funnelStaticCullBenchmark.test.ts` and
   `frameAllocations.test.ts` moved to `scripts/bench/{funnelStaticCull,frameAllocations}.bench.ts` as plain
   scripts (decision 4). `frameAllocations`'s constructor-counting `vi.mock("three")` cannot run outside Vitest
   (confirmed by probing `vite-node` directly: `three` builds as genuine ESM with frozen export bindings, and `vi`
   throws "Vitest failed to access its internal state" outside a Vitest worker); the new script instead measures
   heap growth per call (`process.memoryUsage().heapUsed` deltas over many iterations). The two importers of the
   `tests/fixtures/twoPrismLoop.ts` shim (`visiblePortalPaths.test.ts`, `buildCellMesh.test.ts`) repointed to
   `tests/fixtures/cell-complex/twoPrismLoop.ts`; the shim deleted. `tests/hygiene-baseline.txt` paths rewritten;
   its two lines for the removed benchmark file dropped (80 → 78).
2. `6ee850d` — The five shared fakes in `tests/support/`: `fakeRenderer.ts`, `fakeXr.ts`, `fakeCanvas2d.ts`,
   `preparedAssets.ts`, `cameras.ts` (behaviour map below). First rewrites: `buildCellMesh`, `debugVisualization`,
   `portalClipMaterial`, `renderQuality` (absorbing `renderCameraClip`), `runtimeObjectInstanceSync` (absorbing
   `frameRenderSnapshot`). Baseline 78 → 68.
3. `90c190b` — Mechanical pass (4 parallel forks) over the 38 remaining "keep, comment/name/fake only" files:
   module doc comments, shared-fake swaps, H6 name fixes, and `prerenderCells`' trim (dropped the `userData`
   flag assertions, added a real case for the camera-restoration guarantee its own comment already claimed).
   Baseline 68 → 22.
4. `c219987` — `portalEyeActivation` (shared renderer fake), `preloadWorldAssets` (H4 fix: dropped an unneeded
   `PreparedKtx2Loader` return-type annotation; dropped the stale "_legacy/abstract" half of a case),
   `geodesicEmitterLabelController` (rewrite), `protractorToolFeedback` (rewrite), `playerRoverModel` merged into
   `runtimeObjectGhostRecords`, module comments recording `runtimeObjectPortalInstances` as ghost-suppression's
   owner. `fakeCanvas2d.ts` gained the rest of the 2D context surface. Baseline 22 → 14.
5. `7417277` — `portalEyeFrameTransforms`' `rankStereoUnionPaths` cases merged into `portalClipData` (decision 7:
   stereo ranking/budget's single owner); `portalClipPlanes` switched to the shared camera fake and samples
   3,000 pixels instead of 20,000 (§4.7). Baseline 14 → 10.
6. `a202dca` — `vrLocomotion`: dropped the dead-zone/strafe case (owned by `xrControls`) and the per-eye-root
   case (owned by `xrPortalEye`) (decision 7).
7. `0bb95c5` — `aimTarget`: rewrote the cache test from a resolver call count to an outcome proof; dropped two
   tuning-constant-only cases; three over-length names shortened.
8. `72c20dc` — `scenePaletteLibraryAdapter` split (decision 6): new `tests/ui/paletteDefinition.test.ts` (9 cases,
   the menu-content rules); render file trimmed to 6 adapter-only cases. Baseline 10 → 4.
9. `c3aafb6` — `visiblePortalPaths`'s six captured-pose cases became one `describe.each` table; dropped the
   cached-matrix identity case; `visiblePortalPaths.property` dropped its wall-time assertion and halved its
   sample counts (1.1 s → 0.33 s). **Baseline file now empty (0 lines).**
10. `15ac54c` — Verification sweep found 5 files the mechanical batch missed (each needed a custom
    `instantiateGltf`, so the batch's simple find-and-replace skipped them): `buildDecorationMesh`,
    `staticAssetRenderRoot`, `cellRenderArchetypes`, `geodesicCreatureDebug`, `geodesicCannonRenderer` — all
    switched to `createFakePreparedAssets(overrides)`.
11. `a78cbb0` — Fixed a wrong module name in `fakeCanvas2d.ts`'s own comment.

`tests/render-contract/` no longer exists; `tests/render/` has 57 files (was 62 after the bench move: 3 merged
away — `renderCameraClip`→`renderQuality`, `frameRenderSnapshot`→`runtimeObjectInstanceSync`,
`playerRoverModel`→`runtimeObjectGhostRecords`, minus the earlier `frameAllocations`/`funnelStaticCullBenchmark`
moves — plus `tests/ui/paletteDefinition.test.ts`). A repo-wide sweep (`grep -rn "getContext\|PreparedWorldAssets
= \|navigator\.xr ="` etc. over `tests/render/`) found no remaining file-local renderer, XR, canvas or
prepared-assets fake; every `as unknown as THREE.WebGLRenderer` cast now wraps the shared fake.

**The five shared fakes (`tests/support/`):**

| File | Stands in for | Consumers |
| --- | --- | --- |
| `fakeRenderer.ts` | `THREE.WebGLRenderer` (`info`, `xr`, `setRenderTarget`, `render`, `compile`, size/viewport queries, `extensions`/`getContext`); `TODO(job44)` contract test noted | `portalClipMaterial`, `renderQuality`, `portalEyeActivation`, `prerenderCells` (its own narrow `{compile,render}` object; not swapped, see Uncertain) |
| `fakeXr.ts` | `navigator.xr`, an `XRSession`, `XRInputSource`/gamepad | `xrSessionState`, `xrSessionRestart`, `xrScenePaletteInput` (`xrControls` keeps its inline gamepad literals — real per-case test data, not a fake) |
| `fakeCanvas2d.ts` | `<canvas>` + its 2D context | `placedFlagRenderer`, `buildCellMesh`, `geodesicEmitterLabelController` |
| `preparedAssets.ts` | `PreparedWorldAssets` | `buildCellMesh`, `placedFlagRenderer`, `buildDecorationMesh`, `staticAssetRenderRoot`, `cellRenderArchetypes`, `geodesicCreatureDebug`, `geodesicCannonRenderer`, `runtimeObjectGhostRecords` |
| `cameras.ts` | n/a (THREE objects are never faked); a position/lookAt/random camera builder replacing 8 local ones | `visiblePortalPaths(.property)`, `portalClipPlanes`, `xrPortalEye`, `aimTarget` (kept its own thin positional wrapper over `createCameraAt`, see Not done) |

### Behaviour map

One row per file now in `tests/render/` or moved; "verdict" names what changed. Files not listed kept their
existing behaviour, name and location and gained only a module doc comment (and, where noted above, a fake swap);
listing all ~40 of those individually would not add information beyond the table above.

| File | Verdict | Behaviour / notes |
| --- | --- | --- |
| `buildCellMesh` | rewrite | Floor/ceiling/wall/portal geometry and materials from a cell + assets; dropped 2 child-count checks, uses `preparedAssets`/`fakeCanvas2d`. |
| `debugVisualization` | rewrite | Debug-overlay rebuild-on-change; dropped the mesh-identity check, kept the boolean-outcome proof that already covered it. |
| `portalClipMaterial` | rewrite (slim) | Clip-shader patching contract (uniforms, cache-key suffix, `extensions.clipCullDistance`); dropped GLSL substring assertions. |
| `renderQuality` | rewrite + merge | Pixel-ratio capping, CSS/drawing-buffer sizes, near/far clip planes; absorbed `renderCameraClip`. |
| `renderCameraClip` | **retired: merged into `renderQuality`** | One small policy check, not its own area (Q1). |
| `runtimeObjectInstanceSync` | rewrite + merge | Per-frame instance/clip-index sync and ghost suppression wiring; dropped 3 `sync.stats`-counter cases and the `traverse()` spy (§2.2), kept one outcome case (a deleted render source is rebuilt); absorbed `frameRenderSnapshot`. |
| `frameRenderSnapshot` | **retired: merged into `runtimeObjectInstanceSync`** | Small per-frame value only that module reads. |
| `prerenderCells` | rewrite | Warm-up render pass; dropped 3 `userData` flag assertions, added a real case for the camera-pose-restoration guarantee. |
| `portalEyeActivation` | fake swap | Per-eye activation selected once per rendered eye, not per mesh; now built on `fakeRenderer`. |
| `preloadWorldAssets` | rewrite (H4) | Asset preload/dispose contract; dropped an unneeded type annotation that imported a test/debug-marked type, and a stale `_legacy` half-case. |
| `geodesicEmitterLabelController` | rewrite | Label sync/sweep; replaced a fabricated stale-map-entry case with one driven through a real registered cannon and removal. |
| `protractorToolFeedback` | rewrite | Angle-sector drawing and signature; replaced a cache-signature-only case with the sector's real draw condition and a signature-agreement case. |
| `playerRoverModel` | **retired: merged into `runtimeObjectGhostRecords`** | One small case, not its own area. |
| `runtimeObjectGhostRecords` | keep + merge target | Multi-cell ghost records for a straddling object; gained the player-rover case. |
| `runtimeObjectPortalInstances` | keep | Documented as ghost suppression's single owner (decision 7); no duplicate found elsewhere to remove. |
| `portalClipData` | rewrite + merge target | Clip-plane texture/slots; absorbed `rankStereoUnionPaths` (stereo ranking/budget's single owner, decision 7); one over-length name shortened. |
| `portalEyeFrameTransforms` | rewrite | Per-eye render-frame transforms, stereo path counting/remapping; dropped its `rankStereoUnionPaths` cases (now `portalClipData`'s). |
| `portalClipPlanes` | rewrite | CPU shader emulation vs. real cube worlds; fewer random pixels (20,000 → 3,000), shared camera fake. |
| `vrLocomotion` | rewrite (drop) | Thumbstick/room-scale locomotion mapping; dropped the dead-zone/strafe case (xrControls' now) and the per-eye-root case (xrPortalEye's now), per decision 7. |
| `aimTarget` | rewrite | Aim-ray resolution and priority; cache test rewritten to an outcome proof (stale until invalidated/frame advances); dropped 2 tuning-constant-only cases; 3 names shortened. See Uncertain for the "near-duplicate priority" cases left as is. |
| `scenePaletteLibraryAdapter` | split | Kept 6 adapter-only mechanism cases (icon mapping, item-present-but-inert, lock suppression, sign keyboard, diagram points); moved 5 menu-content cases to `tests/ui/paletteDefinition.test.ts` (new, 9 direct cases). |
| `visiblePortalPaths` | rewrite | Per-frame visible-path discovery; 6 captured-pose regressions → one `describe.each`; dropped the cached-matrix identity case; shared camera builder and two-room fixture. |
| `visiblePortalPaths.property` | rewrite | Brute-force no-false-negative property; dropped the wall-clock guard, halved sample counts, shared random-camera builder. |
| `buildDecorationMesh`, `staticAssetRenderRoot`, `cellRenderArchetypes`, `geodesicCreatureDebug`, `geodesicCannonRenderer` | fake swap | Comment/name work done by the mechanical batch; their local `PreparedWorldAssets` literals/helpers found and swapped in the verification sweep. |
| `aimCrossMarker`, `debugCollisionWireframes`, `debugOverlay`, `desktopControls`, `frameErrorGuard`, `geodesicCannonAimTarget`, `geodesicCarryPortalTransition`, `cellRenderArchetypes` (names) | keep | Module comment + (for `cellRenderArchetypes`) 3 names shortened. |
| `measureLengthRenderer`, `placedFlagRenderer`, `portalClipPolygonOverlay`, `portalFunnel`, `portalInstanceBuffers` (name), `portalWallTexture`, `protractorAngleRenderer`, `runtimeObjectRenderArchetypes` (name) | keep | Module comment; `placedFlagRenderer` also fake-swapped (canvas + prepared assets); 2 names shortened. |
| `runtimeSceneDispose`, `sceneLighting`, `scenePaletteTooltip`, `scenePointers`, `staticAssetRenderRoot` (rename), `stereoSplitRoot`, `vrComfort`, `vrPaletteHeaderActions`, `vrPalettePlacement`, `buildDecorationMesh` (rename) | keep | Module comment; 2 history-named cases reworded ("legacy marmot", "old twelve boxes"). |
| `worldResultBadge`, `xrControllerHandModels`, `xrControls`, `xrDebugPanel`, `xrPortalEye` (fake+name), `xrScenePaletteInput` (fake+names), `xrSessionRestart` (fake), `xrSessionState` (fake), `desktopScenePaletteInput` (rename) | keep | Module comment; `xrPortalEye`/`xrScenePaletteInput`/`xrSessionRestart`/`xrSessionState` fake-swapped; 3 names shortened; 1 history-named case reworded ("older inset cursor bounds"). |

### Deviations

- **`scenePaletteLibraryAdapter` kept 6 cases, not the audit's suggested "1-2".** Each kept case protects an
  adapter-only fact with no other home (icon-to-tool/action mapping, the item-present-but-inert convention for a
  disabled action, suppressing an item entirely for a locked geodesic, the sign keyboard's key choice, the
  geometry-computer diagram's world points); none duplicates the new `tests/ui/paletteDefinition.test.ts`. Traded
  the suggested count for not silently dropping coverage.
- **`aimTarget`'s cache test** was rewritten rather than simply having its call-count assertion deleted, because
  it was the only test of `createAimInteraction` at all; the rewrite proves the same documented contract
  ("cached per distinct ray, ignored geodesic and frame serial") through registry mutation instead of a resolver
  spy, so the interaction layer keeps real coverage.
- **`visiblePortalPaths.test.ts` keeps a thin local `createCamera(position, lookAt, fovDegrees?, aspect?)`**
  wrapping `createCameraAt` with the old positional signature, rather than rewriting ~25 call sites to the
  options-object form. It no longer builds the camera itself (no `new THREE.PerspectiveCamera` outside
  `tests/support/cameras.ts`), so it satisfies the "no file builds its own fake" rule; `aimTarget.test.ts` keeps
  a same-shaped wrapper for the same reason.
- **Historical docs left unchanged** despite matching the rename's grep: `_docs/design/006-...md`,
  `_docs/design/011-...md`, `_docs/llm-handoff/15_...md`, `_docs/llm-handoff/18_...md`,
  `_docs/llm-implementation-workflow.md`. Treated as frozen planning narrative from the pre-job, stage-based
  workflow (several already cite test files that do not exist under any name, e.g. `visiblePortalImages.test.ts`,
  `xrHands.test.ts`), in the same spirit as the decision's explicit `_done`/`_reports` exemption, though the
  decision's literal wording does not name them. See Uncertain.

### Uncertain

- **Whether the 5 historical docs above should have been edited.** Decision 1 says "grep for `render-contract` in
  `_docs/`, `.agents/` and `scripts/`" with no exemption beyond `_done`/`_reports`; I read the spirit of that
  exemption as covering any frozen historical record, not just those two folder names, but a stricter reading
  would want these five paths fixed too (or explicitly marked historical in their own header). A current `grep
  -rn "render-contract" _docs .agents/jobs scripts` still finds these five.
- **Review fix (coordinator, after the fresh-context review):** `_docs/design/012-engine-api.md` itself still had
  3 stale `tests/render-contract/...` path citations (lines 632, 646: `frameAllocations.test.ts`; line 871:
  `visiblePortalPaths.property.test.ts`) that the job's own grep sweep missed — only the one `funnelStaticCull`
  sentence (decision 4) had been fixed. This is a live design doc for this project (not one of the five docs
  deliberately left as frozen historical narrative above), so it fails the coordinator job's explicit job-43 gate
  ("a grep for `render-contract` in `_docs/`... finds nothing"). Fixed by repointing the two `frameAllocations`
  citations to `npm run bench -- frameAllocations` (matching the existing `funnelStaticCull` citation style, since
  that benchmark also moved to `scripts/bench/` under decision 4) and the `visiblePortalPaths` citation to its new
  path, `tests/render/visiblePortalPaths.property.test.ts`. Verified: a repeat grep across `_docs/`, `.agents/jobs/`
  (outside `_done/`/`_reports/`) and `scripts/` now finds only the five disclosed historical docs and the
  coordinator job's own gate-description sentence; `npm run docs:check` still passes.
- **`aimTarget`'s five "prioritizes X over Y" cases and two "near their emitter, hitbox missed" cases** look like
  candidates for the audit's "thin the near-duplicate priority cases," but `aimTarget.ts`'s own module comment
  says its priority order is "not transitive by design," and reading all seven in full showed each covers a
  distinct pairwise tolerance or a distinct camera/segment-length configuration, not a repeat. I left them as is
  rather than risk silently dropping coverage of a non-transitive rule; a maintainer who knows which pairs really
  share one tolerance window could consolidate further.
- **~38 files updated by parallel forks in one mechanical pass** (commit `90c190b`) were verified by: the full
  suite passing, `npm run typecheck` and `npm run docs:check` clean, a repo-wide grep sweep for leftover
  file-local fakes (which did catch 5 misses, fixed in `15ac54c`), and an independent spot-check of 10 of those
  files' module comments against their source modules (all fine). I did not personally read every line of all
  38; the above is the verification trail if a discrepancy turns up later.
- **The two parallel forks (A, B, D) that ran alongside the long-running fork C never got to commit their own
  work**; fork C's working tree already contained their edits (same shared working directory) when it ran its
  own `git add`/`git commit`, so its first commit (`90c190b`) ended up covering all four batches' files in one
  shot. The result was verified as above and is correct, but the multi-agent mechanics were not what I
  originally planned (four independent commits); noting it in case the commit boundaries matter for review.

### Not done

Nothing from the job's scope was skipped. The items above are deviations/uncertainties, not omissions.

### Checks

- Baseline (commit `b49fc07`, before any change): `npm run typecheck` clean; `npm test` → 133 files / 1014 tests
  (1 skipped) passing; `tests/hygiene-baseline.txt` had 80 lines (H4:1, H6:78, H9:1); unit tier serial time 8.23 s
  per job 42's report (confirmed consistent by my own post-rename measurement of 8.47 s before any further
  cleanup).
- After every file-level change: `npx vitest run tests/render/<file>` (and, for merges, the merge target);
  always green before moving on.
- Final state: `npm run typecheck` clean. `npm test` → 130 files / 1008 tests passing. `npm run test:report` → H1
  through H10 all `ok`, baseline 0 lines, unit tier serial time 5.40 s (down from 8.23 s). `npm run docs:check` →
  all six checks `ok`.
- Proof runs (tests.md §4.8), each: broke the behaviour in `src/`, ran the specific test, saw it fail naming the
  behaviour, restored the source, saw it pass again, confirmed `git diff -- src/` was empty afterward:
  - `portalClipMaterial`: broke the hardware/software suffix branch of `customProgramCacheKey` in
    `src/render/three/portalClipMaterial.ts` → the mode-suffix case failed → restored.
  - `runtimeObjectInstanceSync`: relaxed the render-source cache-validity check in
    `src/render/three/runtimeObjectInstanceSync.ts` → "rebuilds a render source that was removed from the cache"
    failed → restored.
  - `aimTarget`/`aimInteraction`: disabled the aim cache's key check in
    `src/render/three/aimInteraction.ts` → the new cache case failed → restored.
  - `prerenderCells`, `geodesicEmitterLabelController`, `protractorToolFeedback`, `playerRoverModel`-merge (fork
    C, commit `c219987`): reverted the camera position-restore line, the sweep gate, the `first && hover`
    angle-sector guard, and the `omitRootVisiblePath` literal in turn; each corresponding case failed; all
    restored. (`git diff -- src/` is empty at every commit in this job, confirming every proof edit was reverted.)
- `src/` is unchanged across the whole job: `git diff b49fc07 HEAD --stat -- src/` is empty.
