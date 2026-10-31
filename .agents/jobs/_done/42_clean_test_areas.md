# Job 42 - Clean every test area except render

Status: done, needs review on 2026-10-31.
Resolves: nothing by itself (it pays off test debt recorded in `tests/hygiene-baseline.txt`).

## Goal

Bring every test area except `render` up to `_docs/tests.md`, one area at a time:
- every behaviour protected before stays protected (the behaviour map makes that checkable);
- duplicates, history names and tests of internals are gone;
- each file has a module comment;
- the project tests sit in `tests/project/`;
- benchmarks are scripts;
- the `unit` tier runs in under 30 s serially.

## Depends on

Job 41 (tiers, seed, hygiene checks, baseline).

## Before you start

Read:

| File | What to look at |
| --- | --- |
| `_docs/tests.md` | all; especially §2, §4 (writing), §4.8 (proof), §4.9 (properties), §8.1 (areas) |
| `_docs/tests_hygiene.md` | §5 (clean up area by area) |
| `.agents/jobs/_reports/test_audit_2026_10_31.md` | §2: the per-file verdicts for this job; "behaviours tested in several places" |
| `_docs/MATHEMATICAL_MODEL.md` | the sections the property tests refer to |
| `tests/support/arbitraries.ts` | the shared generators |

Baseline: `npm run typecheck`, `npm test`, and `npm run test:report`; save the output.

## Decisions

1. **Order of areas.** Do one area per commit, in this order:
   1. `math`;
   2. `cell-complex`;
   3. `movement`;
   4. `authoring`;
   5. `runtime`;
   6. `glue`;
   7. `ui`;
   8. `world-objects`, including `geodesic/`;
   9. `project`, made from `assets`, `docs`, `scripts`, `server` and `smoke`.
   Each commit leaves `npm test` green and removes that area's lines from the baseline.
2. **The verdicts** in audit §2 are the default plan. When you find a verdict wrong after reading the file, follow
   `_docs/tests.md` and record the difference under `### Deviations`.
3. **The behaviour map.** For each area, add a table to the report: old file and test name, then the behaviour (one
   sentence), then the new file and test name, or `retired: <reason>`. Delete a test only when its row names the test
   that now protects the behaviour, or says on purpose that the behaviour is not protected.
4. **Merging property and example files.** `x.property.test.ts` and `x.test.ts` of one feature become one `x.test.ts`
   with a `describe("properties")` block. Drop example cases that a property already covers, unless they show a
   documented edge case.
5. **Depth and size:**
   - `portalPaths` "builds cube paths to depth 10 without NaN transforms": replace it with a property. Compose the
     portal transforms along generated portal words of length 10 and assert that the result is still a rigid transform
     within `geometryTolerance`. Keep table-building cases at depth 4 or less.
   - The depth-10 cases in `staticPortalPathCull` and `torusSkewDeformation`: use the smallest depth that still shows
     the behaviour (at most 6). Say in the comment why that depth is enough.
   - `movementNumerics`: \(10^5\) crossings become at most \(10^3\), with the same assertion.
   - Lower `numRuns` above 100 to 100, unless the comment explains why more are needed.
6. **Benchmarks.** Move `tests/cell-complex/staticCullBenchmark.test.ts` to
   `scripts/bench/staticCull.bench.ts`, a plain script that prints its table. Add
   `"bench": "node scripts/bench/run.mjs"`, where `run.mjs <name>` runs `npx vite-node scripts/bench/<name>.bench.ts`
   (see `.agents/knowledge/running-ad-hoc-typescript.md`). Remove the environment gate. Job 43 moves the second
   benchmark into the same folder.
7. **The `project` area:**
   - Move with `git mv`: `assets/publicAssetPolicy.test.ts`, `docs/*.test.ts`, `scripts/checkDistSize.test.ts`,
     `smoke/smokeArgs.test.ts` and the three `.process.test.ts` files into `tests/project/`.
   - Rename on collision: `server/channel.process.test.ts` becomes `localServerChannel.process.test.ts`.
   - In `localServerChannel`, replace the real 1 s wrong-password delay and the 150 ms sleeps with a parameter or an
     injected clock **only if** `scripts/server/localServer.mjs` already accepts one. Otherwise leave them (it is
     `process` tier) and note it under `### Not done`.
   - `publicAssetPolicy` greps `src/` for `_legacy/` names. Keep it: it protects the asset policy. Its comment says so.
8. **Support code is not tested.** Retire `tests/support/arbitraries.test.ts`. Its precondition checks (counter-clockwise
   convex polygons, unit vectors, orthonormal rotations) become assertions inside the generators
   (`.map(x => { assert(...); return x; })`). The "ten worlds" and "cone fan specs compile" cases are covered by
   `authoring/exampleWorlds`; name that test in the map.
9. **Fixtures.** Move `tests/world-objects/geodesic/fixtures.ts` to `tests/fixtures/world-objects/geodesic.ts`, and
   `tests/fixtures/twoPrismLoop.ts` to `tests/fixtures/cell-complex/twoPrismLoop.ts`. Add one shared two-room spec and one
   square base to `tests/fixtures/cell-complex/`; job 43 uses them too.
10. **Test-only exports.** Do not change `src/`. Stop importing `leaderForDebug` and `geodesicTerminalFromWalkPiece`:
    test the behaviour through the public function, or retire the case and record why.
11. **Names and comments:**
    - Every file gets a module comment: the feature, its rules, its edges, and a link to the documentation section.
    - Names lose plan ids and issue or job numbers, and state the behaviour in under 90 characters.
    - History goes into the commit message.
12. **Proof.** For each test you rewrite or merge, break the behaviour it protects with a temporary edit of the code
    under test, see the test fail, and restore the code (`_docs/tests.md` §4.8). Record each edit in one line of the
    report. You do not need proof for a test only renamed or given a comment.

## Steps

For each area in decision 1:

1. Read every test file of the area and the source module it tests.
2. Write the behaviour map (decision 3) before deleting anything.
3. Apply the verdicts, then decisions 4–11 for that area.
4. Do the proof runs (decision 12).
5. Remove the area's lines from `tests/hygiene-baseline.txt`. `npm test` fails if a line is left with no violation, or
   if a violation is left with no line.
6. Run `npx vitest run tests/<area>` and `npm test`, then commit.

Then run `npm run test:report` and compare it with the baseline output.

## Tests and checks

After each area: `npm test`. At the end: `npm run typecheck`, `npm test`, `npm run test:report`, `npm run docs:check`.

## Do not

- Touch `tests/render-contract/` (job 43) or change `src/`.
- Add lines to `tests/hygiene-baseline.txt`.
- Weaken an assertion to make a test pass. A test that fails after a rewrite has found a real difference: record it
  under `### Uncertain`, and keep the old test until it is resolved.
- Change the meaning of a test while renaming it.

## Done when

- No baseline line remains for any area except `render`.
- Every area has a behaviour map in the report.
- The serial time of the `unit` tier (`npm run test:report`) is under 30 s, or the report names the tests that keep it
  above and why.
- `npm test` and `npm run docs:check` pass.

## Report

### Done

Cleaned every area but `render` (job 43), one commit per area, in the order the job names:

| Area | Commit |
| --- | --- |
| math | `5520f786ff0a476bee91c2a7b1553e65cdf35fc0` |
| cell-complex | `3bc82af2a8dc587d1672554c347add810442741f` |
| movement | `4fe75a3a9b5dc3b4dc30f633803b516198036daa` |
| authoring | `84780e0eac6610aa031de61d7605897d3c4da936` |
| runtime | `f5b8e3b652b489699271dc70ffb768b86c3c634a` |
| glue | `15ea8fb4fc5f6a663faf1cc62ea07d14026711a6` |
| ui | `001251036b566a553bba75d586f9adf0f14918d0` |
| world-objects (incl. `geodesic/`) | `94eb3d05f5eae01e462b3695cb5b1f897b18bf01` |
| project | `bc23629399dd4fe397a393d237450683ac2289b9` |
| fixtures follow-up (decision 9) | `1822aeecb76248c63f5a2d46b8c1577ba0726ff3` |

Every file in every area now has a module doc comment; every retained test name is free of plan ids, issue/job
numbers and history wording, and is at most 90 characters. `tests/hygiene-baseline.txt` has no line outside
`tests/render-contract/` (0 of 80 remaining violations; was 257). Unit tier serial time: 7.2 s (was 69.8 s; the
62.8 s `portalPaths.test.ts` case alone is now ~0.03 s, replaced by a property). `npm test`, `npm run typecheck` and
`npm run docs:check` all pass; see Checks.

#### Behaviour maps

**math** — all "keep" verdicts. Merged `x.property.test.ts` into `x.test.ts` as a `describe("properties")` block
for vec3, polygons, rigidTransform3 and intersections; numRuns 200 → 100. One retirement: `rigidTransform3.property`
's "keeps a fixed example consistent" → covered by `rigidTransform3.test.ts`'s existing "composes transforms by
applying the second transform first" (same worked numeric example). Nothing else changed in behaviour.

**cell-complex** — see the table below; everything not listed is unchanged content with a module comment added.

| Old file / test | Behaviour | New file / test |
| --- | --- | --- |
| compileCellComplex.test.ts "compiles the stage geometry examples" | per-shape counts across 4 example worlds | retired: a sweep over bundled examples (Q4); "every world compiles" is owned by `authoring/exampleWorlds.test.ts`, side/portal counts by `prismCells.test.ts` + `compilePortalTransforms.test.ts`'s properties |
| compileCellComplex.test.ts "keeps the tetrahedron example glued as four distinct tetrahedral vertices" | vertex-quotient of the tetrahedron's gluing | retired: computed entirely by test-local helper functions, never calls `compileCellComplex` — tests the example data, not the compiler (Q3; not in the audit's verdict row, found while reading the file, recorded as a deviation below) |
| compileCellComplex.test.ts "derives expected wraparound translations for the torus example" | torus self-gluing transforms | moved to `compilePortalTransforms.test.ts` (owner), renamed "...for the one-cell torus example" |
| compileCellComplex.test.ts "derives seam-consistent compiled transforms for every example portal" | reciprocal/seam consistency over 8 worlds | retired: covered by `compilePortalTransforms.test.ts`'s properties |
| compileCellComplex.test.ts "reports readable movement-critical authoring errors" / "rejects non-convex and clockwise prism bases" | validator error wording | wording moved to `validateCellComplexSpec.test.ts` (owner); `compileCellComplex.test.ts` keeps one rewritten wiring case, "throws listing every error when the spec fails validation" (proof: disabling the throw in `compileCellComplex.ts` failed the test; restored) |
| validateCellComplexSpec.test.ts "validates every bundled catalog world" | every catalog world passes validation | retired: a sweep over bundled examples (Q4) |
| portalPaths.test.ts "builds cube paths to depth 10 without NaN transforms" (62.5 s of the whole suite) | depth-10 table has no NaN | rewritten as a property, "composing 10 portal crossings along a generated word stays a valid rigid transform": composes one generated length-10 word directly (no full table build) and checks orthogonality/determinant/finiteness within `geometryTolerance`. Proof: perturbing a rotation in `compilePortalTransforms.ts` by 1e-3 failed the test; restored |
| staticPortalPathCull.test.ts "prunes the dodecahedron path tree contextually at depth 10" | contextual pruning holds at depth | shrunk to depth 6 (666 kept / 800 rejected measured, vs ≤12000 kept at depth 10); proof: disabling the geometric-rejection check in `staticPortalPathCull.ts` failed the test; restored |
| segmentWalk.test.ts "walks the issue-62 cube vertex pass..." | zero-length middle piece at a vertex pass | renamed, "issue-62" dropped |
| staticCullBenchmark.test.ts (env-gated) | depth-10 timing | moved to `scripts/bench/staticCull.bench.ts`, run by the new `npm run bench`; env gate removed |
| compilePortalTransforms.property / portalPaths.property / staticPortalPathCull.property / segmentWalk.property | various properties | merged into their example file's `describe("properties")`; numRuns >100 lowered to 100 |

**movement** — `moveDynamicObject.test.ts` reorganized into behaviour describes (basic collision, portal crossing,
forbidden zones, multi-step consistency, bodies across portals, numerics, properties), folding in
`moveDynamicObject.property.test.ts` and `movementNumerics.test.ts`; every issue number dropped from names;
`movementNumerics`'s 10^5-crossing case shrunk to 1000 (same assertion/tolerance). `sweptCollision.test.ts`'s
"stops in every corner (issue 61)" retired, covered by `moveDynamicObject.test.ts`'s wiring case (audit's explicit
call). `portalCrossing.property.test.ts` merged into `portalCrossing.test.ts`. Two vague/helper-named cases renamed
in `collision.test.ts` and `movePlayer.test.ts`.

**authoring** — `exampleWorlds.test.ts`'s three `it.each` sweeps that ran the same rule over all 10 bundled worlds
(no repeated assets; starter house/question cube; houses clear of the player) collapsed into one test per rule
with a `for` loop, naming the world on failure. The topology table ("glues %s into the intended surface") stays an
`it.each`: each row is a genuinely different class (topology), not a repeated instance of one rule. One rename
("...at the corrected small scale" → "...at its documented small scale").

**runtime** — `torusSkewDeformation.test.ts`'s depth-10 static-cull case shrunk to depth 3 (comment corrected: see
Uncertain). `worldGeometryDeformations.property.test.ts` (identity-map tests) retired as trivial/duplicated (Q4);
its one example-file test's "without importing Three.js" name replaced with what it actually checks.
`worldGeometryComputedObjects.test.ts`'s 4 cases (≈90 lines each) rewritten with shared helpers
(`addCannon`/`shoot`/`threeCannonWorld`/`moveIncoming`); proof: inverting the locked/unlocked branch in
`worldGeometryComputedObjects.ts` failed all 4 cases; restored.

**glue** — `debugSettings.test.ts` rewritten from 6 `toBe(true)` instances of one always-true default into 4 cases
with a real false class (support excluding an enabled option); proof: forcing the function to always return `true`
failed the new rejection case; restored. `geometrySelection.test.ts` (despite its name, entirely about
`readLaunchOptions`) merged into `readLaunchOptions.test.ts`, its 3-row starter-config `it.each` collapsed to one
test.

**ui** — module comments only; no behaviour changed.

**world-objects (incl. `geodesic/`)** — see the table below; everything not listed is unchanged content with a
dropped history prefix/suffix and/or a module comment.

| Old file / test | Behaviour | New file / test |
| --- | --- | --- |
| geodesicMarmot.test.ts "marmot ownership" (1 test) | direct write to an owned marmot throws | retired: covered by `runtimeObjectRegistry.test.ts` (owner) + `worldObjectOwner.test.ts` (wiring) |
| library.test.ts `it.each` of 9 asset-path mappings | library wrapper → asset path | collapsed to 2 rows: one current-convention asset, one `_legacy/`-convention asset (the two real classes) |
| simpleGeoCreature.test.ts "leader and detour" (9 tests, all via the debug-only `leaderForDebug`) | detour/rejoin/leash/re-seed behaviour | **H4 fix.** Rewritten to observe only the creature's public pose. New helpers: `pureGeodesicWalk` + `expectRejoinsGeodesic` (resume an independent unobstructed walk from the creature's current pose; "rejoined" = the next steps retrace it exactly); position bounds replace lag bounds for "stopped short of a body". Side-rule sign proof: inverting it in `simpleGeoCreature.ts` failed 4 detour tests; restored. `transformGeometry`/`reset` re-seed proof: removing the `seedLeaderOnCreature()` call after `transformGeometry` failed the test; restored. Renamed every numbered test (1.–8., 7a–7c) |
| geodesicTracingKernel.test.ts "maps a walk piece that exits through a vertex..." | vertex-tie exit with no zone → forbidden-zone-hit | **H4 fix.** Stopped calling `geodesicTerminalFromWalkPiece` directly; rewritten as "reports a forbidden-zone-hit at a plain wall corner via the walk's vertex tie rule", reached through the public `shootGeodesic` on a portal-less room aimed exactly at a corner. Proof: disabling the `throughVertexIndex` mapping in `trace.ts` failed the test; restored |
| geodesicTracingKernel.test.ts "intersections" (3 tests) | geodesic-segment crossing rules | moved to `intersections.test.ts` (owner) |
| curveShortening.test.ts "C4: resolving a pair traces each result chord once (preview only, no rebuild)" | — | retired: after dropping its perf-counter assertion, its remaining assertions were a strict subset of the (unprefixed) "wraps the junction disk..." case on the identical scenario |
| performance.test.ts (7 cases, `vi.spyOn` + internal pass/trace counters) | geodesic rebuild/classify outcomes under carry and deferred batching | renamed `geodesicRebuildOutcomes.test.ts`. "B2: a public call makes one intersection pass" retired (no assertion beyond the dropped perf counter, redundant with `intersections.test.ts`). The other 5 kept, perf assertions dropped, outcome assertions unchanged |
| carry.test.ts (22 tests, mostly flat) | carrying/rebuilding a geodesic under emitter motion | split into 5 behaviour describes: carrying across a portal; carrying within one cell; updating a locked interval's word from carried traversal; live rebuilds that cannot connect cleanly; loop words under anchor portal crossings. Job/issue refs dropped (`job 05`, `job 13 part C`) |
| sleeve.test.ts A1–A9 prefixes | pure sleeve/taut-path geometry | prefixes dropped, behaviour unchanged |
| `tests/world-objects/geodesic/fixtures.ts` | shared geodesic fixtures | moved to `tests/fixtures/world-objects/geodesic.ts`; 8 importers updated |

**project** — moved with `git mv` into `tests/project/`: `publicAssetPolicy.test.ts`, `documentation.test.ts`,
`moduleImportRules.test.ts`, `checkDistSize.test.ts`, `smokeArgs.test.ts`, `staticServer.process.test.ts`,
`localServer.process.test.ts`, and `channel.process.test.ts` → `localServerChannel.process.test.ts` (renamed on
collision, per the job). Fixed the now-stale `tests/docs/documentation.test.ts` reference in
`scripts/docs/checks.mjs` and `_docs/tests_hygiene.md`. `smokeArgs.test.ts`'s "legacy page-url form" case kept: the
form is still implemented in `scripts/smoke/smokeArgs.mjs`, not retired. `localServerChannel.process.test.ts` keeps
its real 1 s wrong-password delay and two 150 ms sleeps — see Not done.

**support (decision 8)** — retired `tests/support/arbitraries.test.ts` entirely. Its precondition checks moved
into the generators in `tests/support/arbitraries.ts` as `node:assert` calls: `arbUnitVec3` (unit length),
`arbRigidTransform3` (orthonormal rotation, determinant 1), `arbConvexPolygon2xy` (CCW, `validatePolygon2xy`
passes). The "ten worlds compile" and "cone fan specs compile" cases: per the job's decision, treated as covered by
`authoring/exampleWorlds.test.ts`; see Uncertain for a caveat on the cone-fan case. The remaining three cases
(coordinate/vector range, yaw range, yaw-transform purity) were retired as trivial restatements of each
generator's own construction (guaranteed by `fc.double`'s own range and by the deterministic yaw-matrix formula),
not a behaviour of the product.

**fixtures (decision 9)** — moved `tests/fixtures/twoPrismLoop.ts` to `tests/fixtures/cell-complex/twoPrismLoop.ts`
and repointed its 4 `tests/cell-complex/` importers; left a one-line re-export shim at the old path for
`tests/render-contract/buildCellMesh.test.ts` and `visiblePortalPaths.test.ts` (job 43's area, not touched — see
Not done). Added `tests/fixtures/cell-complex/twoRoomWorld.ts` (`squareRoomBase`, `twoRoomsWithPortal()`) for job
43 and future tests; existing areas' own near-identical copies were not migrated to it (see Not done).

### Deviations

- **compileCellComplex.test.ts's tetrahedron vertex-quotient test**, retired as described above, is not in the
  audit's per-file verdict row (which only said "rewrite; drop the example-world and seam blocks"). Found while
  reading the file: it never calls `compileCellComplex` at all, reimplementing vertex-class computation entirely
  with test-local helpers — it tests the tetrahedron example's own gluing, not the compiler (Q3). No product code
  for vertex classes exists yet (job 18, queued); when it lands, its own test should cover this.
- **`moveDynamicObject.test.ts`'s policy-constant check** ("keeps the autonomous dynamic-object traversal policy
  explicit and anchor-based") was flagged by the audit as "Q1 (a constant check)" for the "rewrite" verdict, but
  kept unchanged: it is a real, cheap, intentional-decision check (the constant is consumed by `simpleGeoCreature.ts`
  and `geodesicMarmot.ts`), not an assertion that "cannot fail".
- **debugSettings.test.ts's "parsing and serializing debug options" case** stays in `debugSettings.test.ts` even
  though it exercises `src/glue/debugOptions.ts` functions, not `debugSettings.ts`: `debugOptions.ts` has no test
  area of its own and creating one for three small functions did not seem warranted.
- **13 test names beyond the audit's per-file notes** were shortened to clear the 90-character limit (H6), since
  the job's "Done when" requires zero baseline lines outside `render`, not just the audit's specific renames:
  6 in `carry.test.ts`, 2 in `curveShortening.test.ts`, 1 each in `geodesicTracingKernel.test.ts`,
  `library.test.ts`, `measureLengthTool.test.ts`, `protractorTool.test.ts`, and `documentation.test.ts`.

### Uncertain

- **simpleGeoCreature.test.ts's leash-bound scope reduction.** The original "leashes to a blocking body..." test
  asserted a precise numeric bound on the leader's transient lag (≤ 0.5 m + ε) via `leaderForDebug`. After the H4
  fix, I could not find a public-API equivalent: resuming an independent walk ("rejoined") converges to the same
  final state whether or not the leash actually bounds the lag, given enough recovery ticks — only the *speed* of
  convergence depends on the leash, and that is not asserted. I proved this by disabling the leash check
  (`lagBefore < creatureLeashMeters`) in `simpleGeoCreature.ts` and confirming the renamed test ("stops short of a
  blocking body and resumes its geodesic once it is removed") still passed with the existing 600-tick recovery
  window; then restored the code. The test now only proves the body is never driven through and that the geodesic
  is eventually resumed — the specific "≤ 0.5 m" leash bound is unprotected by any test. This would be confirmed
  wrong if someone can find a public query that reveals the leader's position or the current lag.
- **torusSkewDeformation.test.ts's shrunk depth-3 case.** While shrinking it, I found the original (and now the
  shrunk) assertion does not actually isolate `skipImmediateReverse`: disabling that flag in
  `staticPortalPathCull.ts` did not fail the test, because the candidate word is independently excluded by the
  geometric transversal check regardless. I renamed the test and rewrote its comment to claim only what it
  checks (the word is absent from the culled table, not which mechanism excludes it) rather than fix the
  double coverage, since the geometric check already proves the behaviour and this test's wiring value is small.
- **"cone fan specs compile" coverage.** Decision 8 says this and "ten worlds compile" are "covered by
  `authoring/exampleWorlds`". `exampleWorlds.test.ts` does cover the 10 named worlds, but I could not find a cone-fan
  case there; `arbConeFanWorldSpec` is actually exercised (compiled, via `compileCellComplex`) inside
  `staticPortalPathCull.test.ts`'s "keeps every prefix of a walked line in random cone-point fans" property. I
  retired the case anyway, since that property would fail immediately if the generator produced specs that could
  not compile.

### Not done

- **`localServerChannel.process.test.ts`'s real delays.** `scripts/server/localServer.mjs` does not accept an
  injected clock or a configurable `WRONG_PASSWORD_DELAY_MS`; per the job's decision, left the real 1 s delay and
  two 150 ms sleeps in place (it is the `process` tier, which real timers are allowed in).
- **`tests/fixtures/twoPrismLoop.ts` shim.** The fixture's real content now lives at
  `tests/fixtures/cell-complex/twoPrismLoop.ts`; the old path is a one-line re-export kept only for
  `tests/render-contract/buildCellMesh.test.ts` and `visiblePortalPaths.test.ts`, which this job must not touch.
  Job 43 should repoint those two imports and delete the shim.
- **`tests/fixtures/cell-complex/twoRoomWorld.ts` adoption.** Added per decision 9 but not adopted by existing
  areas (movement, cell-complex, world-objects) that still carry their own near-identical `squareRoomBase`/
  `twoRoomsWithPortal` copies; migrating them was out of scope for this pass.

### Checks

- Baseline (before any change): `npm run typecheck` ok; `npm test` ok (160 files, 1071 tests passing); `npm run
  test:report`: hygiene baseline 257 (H4:3, H5:59, H6:193, H9:2), unit tier serial time 69.79 s (62.81 s in
  `tests/cell-complex/portalPaths.test.ts` alone).
- After every area (and the final fixture/support follow-ups): `npm run typecheck`, the area's own
  `npx vitest run tests/<area>`, and `npm test` all passed before committing.
- Final: `npm run typecheck` — clean. `npm test` — 133 files, 1014 tests passing, 1 skipped (release-tier, no
  release test files exist yet). `npm run docs:check` — all 6 checks ok. `npm run test:report` — H1–H10 all ok;
  hygiene baseline 80, all within `tests/render-contract/` (H4:1, H6:78, H9:1); unit tier serial time 7.2 s.
- Proof runs (decision 12), each: broke the behaviour with a temporary source edit, confirmed the test failed,
  restored the code, confirmed the test passed again:
  - `compileCellComplex.ts`: disabled the validation-error throw → "throws listing every error..." failed.
  - `compilePortalTransforms.ts`: perturbed a rotation entry by 1e-3 → the new 10-crossing property failed.
  - `staticPortalPathCull.ts`: disabled the geometric transversal rejection → the depth-6 dodecahedron case failed
    (and, separately, confirmed `skipImmediateReverse` does *not* gate the torus-skew test — see Uncertain).
  - `src/glue/debugSettings.ts`: forced `canApplyDebugSettingsAtRuntime` to always return `true` → the new
    rejection case failed.
  - `src/runtime/worldGeometryComputedObjects.ts`: inverted the locked/unlocked branch → all 4 rewritten cases
    failed.
  - `src/world-objects/simpleGeoCreature.ts`: inverted the forbidden-zone side sign → 4 detour tests failed;
    removed the post-`transformGeometry` leader re-seed → the re-seed test failed; disabled the leash check → no
    test failed (see Uncertain).
  - `src/world-objects/geodesic/trace.ts`: disabled the `throughVertexIndex` → `forbidden-zone-hit` mapping → the
    new vertex-corner test failed.
  All edits were reverted; `git diff --stat` against every touched `src/` file is empty.
