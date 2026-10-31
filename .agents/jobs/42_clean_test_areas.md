# Job 42 - Clean every test area except render

Status: queued.
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
