# Batch report: jobs 41-44 (test rehaul)

Coordinator: [00_coordinate_jobs_41_44](../_done/00_coordinate_jobs_41_44.md).
Batch start: 2378b1f. Batch end: TBD.

## Start state

`git status --short`: clean.

Baseline checks (2026-10-31, commit 2378b1f):

- `npm run typecheck`: pass.
- `npm test`: pass. 146 test files passed + 2 skipped (148 total; the job's note of "160 files" is not reproduced by
  this run — recorded as a discrepancy, not acted on), 1069 tests passed + 2 skipped (1071 total, matching the audit).
  Duration 58.34 s (summed: transform 11.63s + collect 50.95s + tests 72.48s, overlapping; wall 58.34s).
- `npm run docs:check`: pass (module headers, exported JSDoc, layering, module import rules, generated documents,
  document references all ok).
- `npm run smoke -- --world cube,torus-moduli`: pass (both worlds SMOKE OK).

`npm run test:report` does not exist before job 41; start indicators are taken from audit §1
(`test_audit_2026_10_31.md`): 160 test files, 1,071 tests, all passing; ~25.5k lines of tests/support for ~46.7k lines
of `src/`; summed file time ~75s (62.5s in `portalPaths.test.ts`'s depth-10 case); 2 env-gated benchmark files; 0
temporary/conditional folders; ~71 manual checks (≈25 convertible now, ≈20 need a small API function, ≈7 need the
engine split, ≈15 need a person, 4 stale).

Working branch: `design/012-engine-api` (current branch at batch start). This repo's existing history shows this
branch is periodically merged into `main` via merge commits; continuing on it for this batch keeps that convention
rather than switching branches.

## Summary

| Job | Result (pass / needs review / skipped / failed) | Commits | Review (fresh agent / self-review; findings) |
| --- | --- | --- | --- |
| 41 | done, needs review (two Uncertain items for the maintainer; no open review finding) | `653a8a2`, `d7fec50`, `8b49b4c` (repair) | fresh agent; 1 must-adjacent finding (below), fixed |
| 42 | done, needs review (three Uncertain items for the maintainer; no open review finding) | `5520f78`..`05666ff` (11 commits, one per area + fixtures follow-up + report) | fresh agent; 0 must findings, 4 should-level reporting-wording notes (below), not fixed |
| 43 | done, needs review (two Uncertain items for the maintainer; 1 undisclosed must finding, fixed) | `d61865d`..`0a19214` (13 commits + repair) | fresh agent; 0 must findings (after the coordinator's own pre-review repair), 3 should-level notes (below), not fixed |
| 44 | TBD | | |

## Indicators

| Indicator | Start | After 41 | After 42 | After 43 | After 44 |
| --- | --- | --- | --- | --- | --- |
| Test lines / src lines | ~25.5k / ~46.7k | 25,851 / 48,974 | 25,908 / 48,974 | 25,781 / 48,974 | |
| Test files / tests (unit, process, release) | 160 files / 1,071 tests (undifferentiated) | unit 146f/942t; process 3f/18t; release 0f/0t | unit 131f/928t; process 3f/18t; release 0f/0t | unit 127f/915t; process 3f/18t; release 0f/0t | |
| Unit tier serial time; slowest file | ~75s summed; portalPaths.test.ts ~62.5s | 73.50s; portalPaths.test.ts 66.36s | 8.23s; moduleImportRules.test.ts 2.11s | 5.38s; moduleImportRules.test.ts 1.43s | |
| Baseline lines (total; per rule) | n/a (baseline not created yet) | 257 total (H1:0 H2:0 H3:0 H4:3 H5:59 H6:193 H7:0 H8:0 H9:2) | 80 total, all in tests/render-contract/ (H1:0 H2:0 H3:0 H4:1 H5:0 H6:78 H7:0 H8:0 H9:1) | 0 total (H1-H9 all 0) | |
| Manual checks in tests/manual_smoke.md | 0 (file does not exist) | 0 (file still does not exist; job 44) | 0 (unchanged; job 44) | 0 (unchanged; job 44) | |
| Scenarios in tests/app | 0 | 0 (tests/app does not exist yet; job 44) | 0 (unchanged; job 44) | 0 (unchanged; job 44) | |

## Job 41

Built the four Vitest projects/commands, the unit setup file (fast-check seed, real-timer guard), the hygiene
checks H1-H10 (`scripts/tests/hygiene.mjs`, run by `tests/project/testHygiene.test.ts` and `npm run test:report`),
a 257-line frozen baseline, the three `.process.test.ts` renames, the pre-push `release` project run, and deleted
empty `tests/scratch/`. No test was rewritten (out of scope; jobs 42/43 do that). Full report:
[41_test_tiers_and_hygiene_checks.md](../_done/41_test_tiers_and_hygiene_checks.md).

**Coordinator's own H9/H10 proofs** (independent of the implementing agent's step-6 proof), run twice (before and
after the review fix below), both times with the same result:

- A `.skip(` test added outside `tests/_temp/` fails `testHygiene.test.ts` under H9, naming the file and the fix;
  deleting it restores a pass.
- Removing one line from `tests/hygiene-baseline.txt` without fixing the violation it covers (the H4
  `preloadWorldAssets.test.ts` line) fails the same test under H4 with the real violation message (the ratchet
  resurrects it); restoring the line (`git checkout -- tests/hygiene-baseline.txt`) restores a pass.

**Review finding and fix.** The fresh-context review (`_docs/tests_hygiene.md` §4) found that `gitTrackedFiles()`
in `scripts/tests/hygiene.mjs` shelled out to `git ls-files` via `execSync`, so the new unit test
(`tests/project/testHygiene.test.ts`) spawned a real child process on every run despite declaring the `unit` tier
— violating the tier rule it exists to check for every other file (`_docs/tests.md` §5), and making its own
module comment's "reads repository files read-only" claim false. No deletions, no assertions-that-can't-fail, no
other must-rule failures were found; the three file renames were confirmed byte-identical.

Repaired in one round (commit `8b49b4c`): replaced `gitTrackedFiles()` with a pure recursive filesystem walk that
skips the directories git ignores wholesale (`.git`, `node_modules`, `dist`, `.vite`, `coverage`, `assets-src`) —
none of H1-H10 needs git's finer-grained ignores (textures, key files). Re-ran `npm run typecheck`, `npm test`,
`npm run docs:check`, `npm run test:release` and `npm run test:report` (same 257-line baseline, same indicators),
and re-ran the H9 scratch-file proof against the new mechanism. All green; pushed.

**Deviations/Uncertain carried from the job** (not blockers, recorded for the maintainer below): `passWithNoTests`
moved from per-project config to the command line (a Vitest 1.6 type limitation); the job's stated baseline
("160 files, 1,071 tests") doesn't match the repo (148 files, 1,071 tests — test count matches, file count
doesn't); H4 flags `PreparedKtx2Loader`'s "injectable for tests" JSDoc even though it looks like legitimate
injection-seam design, because the check is a literal text match.

## Job 42

Cleaned every test area except `render` (math, cell-complex, movement, authoring, runtime, glue, ui, world-objects
incl. `geodesic/`, project), one commit per area plus a fixtures follow-up and the job report, following the prior
audit's verdicts. Full report with per-area behaviour maps:
[42_clean_test_areas.md](../_done/42_clean_test_areas.md).

Headline results: `tests/hygiene-baseline.txt` dropped from 257 to 80 lines, and the coordinator independently
confirmed all 80 remaining lines sit inside `tests/render-contract/` (job 43's area) — zero elsewhere. Unit tier
serial time dropped from 73.50s to 8.23s (the 62.8s `portalPaths.test.ts` depth-10 case was replaced by a property
test that composes one generated length-10 word, now ~0.03s). Two H4 debug-only-import violations were fixed by
reaching the same behaviour through public APIs (`simpleGeoCreature.test.ts` no longer imports `leaderForDebug`;
the geodesic tracing test no longer imports `geodesicTerminalFromWalkPiece`). `tests/support/arbitraries.test.ts`
was retired, its precondition checks moved into the generators themselves. About 10 proof runs (break the
behaviour, see the test fail, restore) are logged in the job's Checks section.

**Coordinator's own gate-out** (independent of the sub-agent's own checks): `npm run typecheck`, `npm test` (133
files / 1014 tests / 1 skipped — matches the job's own count), `npm run docs:check`, and `npm run build && npm run
test:release` (no release tests exist yet; expected, job 44's work) all passed. `npm run test:report`: H1-H10 all
`ok`; confirmed via `grep` that zero baseline lines fall outside `tests/render-contract/`.

**Review finding.** The fresh-context review (`_docs/tests_hygiene.md` §4) ran three independent sub-reviews
across all 11 commits plus its own direct checks (re-running `test:report`, diffing `src/` across the full commit
range to confirm zero net product-code change, reading replacement tests directly rather than trusting the
behaviour-map prose). **No must-level finding.** Four should-level (debt) notes, none blocking:

1. `compileCellComplex.test.ts`'s retired per-shape object-count coverage is real (owned by the pre-existing
   `compileWorldScript.test.ts`) but not credited in the behaviour map.
2. `geodesicRebuildOutcomes.test.ts`'s rewrite silently drops a fixture segment-count sanity bound (≥195/≤205)
   beyond the disclosed perf-counter drops; defensible (it checks test-fixture construction, not product
   behaviour) but the report's "perf assertions dropped, outcome assertions unchanged" line overclaims slightly.
3. math area: the retired "fixed example" test's replacement uses a different numeric example than the report's
   wording implies (same behaviour class, not the identical worked example) — cosmetic.
4. glue area: the report misattributes which old file held the "3-row starter-config `it.each`" (it was already in
   `readLaunchOptions.test.ts`, not `geometrySelection.test.ts`) — no coverage impact, just an imprecise sentence.

Not repaired (should-level, debt per job 00's process, not a blocker); recorded here instead of editing the job's
own report.

The review explicitly checked the job's own Deviations/Uncertain/Not done sections against the actual diffs and
found all of them honest and complete: the `simpleGeoCreature` leash-bound coverage gap, the
`torusSkewDeformation`/`skipImmediateReverse` non-isolation, and the cone-fan coverage claim are all exactly as
described, with no better alternative found by the reviewer either.

**Deviations/Uncertain carried from the job** (for the maintainer, below): the `moveDynamicObject.test.ts`
policy-constant check was kept against the audit's "Q1" flag (it is a real, cheap, intentional-decision check, not
an unfalsifiable one); 13 test names beyond the audit's specific notes were shortened to clear H6's 90-character
limit; the tetrahedron vertex-quotient test in `compileCellComplex.test.ts` was retired as a deviation from the
audit (found independently — it never called the compiler under test).

## Job 43

Renamed `tests/render-contract/` to `tests/render/`, built 5 shared boundary fakes in `tests/support/`
(`fakeRenderer.ts`, `fakeXr.ts`, `fakeCanvas2d.ts`, `preparedAssets.ts`, `cameras.ts`), moved two more benchmarks
(`funnelStaticCullBenchmark`, `frameAllocations`) to `scripts/bench/*.bench.ts`, and rewrote the render tests to
stop asserting object/mesh identity, child counts, GLSL substrings, internal statistics counters, and
`traverse()` spies, in favor of GPU-facing data, dispose behaviour, frame-snapshot reads, and visibility. Full
report with the behaviour map, proof-run log, and a parallel-fork process note:
[43_clean_render_tests_and_shared_fakes.md](../_done/43_clean_render_tests_and_shared_fakes.md).

Headline results: `tests/hygiene-baseline.txt` is now fully empty (was 80, all in this area). Unit tier serial
time dropped from 8.23s to 5.38s. No file in `tests/render/` builds its own renderer/XR/canvas/prepared-assets
fake. 130 files / 1,008 tests passing; `src/` untouched across the whole job (confirmed empty `git diff --stat`).

**Coordinator's own gate-out**: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build && npm run
test:release`, and `npm run test:report` (H1-H10 all `ok`) all passed, matching the job's own numbers. Also ran
the job's own special gate (`.agents/jobs/00_coordinate_jobs_41_44.md`'s "Gates specific to these jobs"): confirmed
`tests/render-contract/` no longer exists.

**Pre-review finding and fix (coordinator).** Running that same gate's grep (`render-contract` across `_docs/`,
`.agents/jobs/` outside `_done`/`_reports`, and `scripts/`) turned up `_docs/design/012-engine-api.md` itself
still citing 3 stale paths (two `frameAllocations.test.ts` citations, one `visiblePortalPaths.property.test.ts`
citation) that the job's own sweep missed — only the one `funnelStaticCull` sentence (decision 4) had been fixed.
This is a live design doc, not one of the five docs the job deliberately left as frozen historical narrative, so
it failed the gate as written. Fixed directly (commit `0a19214`): repointed the two `frameAllocations` citations
to `npm run bench -- frameAllocations` (matching the existing `funnelStaticCull` citation style) and the
`visiblePortalPaths` citation to its new path. Re-ran `npm run docs:check` and the grep; both clean. This repair
was applied before delegating the fresh-context review, so the review scope excluded it.

**Review finding.** The fresh-context review (`_docs/tests_hygiene.md` §4) checked decision 2's fake-sharing
claim, decision 5's banned-assertion-pattern removal, decision 7's four duplicate-ownership cleanups, the H4 fix,
the zero-net-`src/`-change claim, and independently spot-checked 8 of the ~38 files touched by the job's
parallel-fork commit (`90c190b`) for soundness, not just trusting the sub-agent's own spot-check claim.
**No must-level finding.** Three should-level notes, none blocking:

1. Four pre-existing "keep" files the job did not touch — `protractorAngleRenderer.test.ts`,
   `measureLengthRenderer.test.ts`, `buildDecorationMesh.test.ts`, `staticAssetRenderRoot.test.ts` — use
   `traverse()` to assert object/mesh *names* that no production code reads back (pure implementation-detail
   labels), which is exactly what decision 5 bans; the job's report never re-justifies them against decision 5
   since they predate this job and were marked "keep" by the original audit. Contrast with
   `xrControllerHandModels.test.ts`, where name-prefix classification is the module's actual documented contract,
   so asserting names there is legitimate.
2. `buildCellMesh.test.ts` and `scenePaletteLibraryAdapter.test.ts` assert `userData` fields extensively — on its
   face a decision-5-banned pattern, but confirmed legitimate: both modules' own comments state the `userData`
   payload is read downstream by real consumers. Not a defect; the report just never calls out the exception.
3. A dangling cross-reference in the job's report: a note on `prerenderCells.test.ts`'s narrow fake points to
   "see Uncertain," but the Uncertain section never discusses it (the underlying code is fine — it satisfies a
   production function's own narrow `Pick<WebGLRenderer, ...>` parameter type, not an ad-hoc renderer fake).

Not repaired (should-level, debt per job 00's process, not a blocker); recorded here instead of editing the job's
own report. A natural follow-up for a later job: rewrite the 4 name-asserting "keep" files under point 1 to
assert structural/geometric facts instead, or add an explicit decision-5 exception for "name is the documented
classification key."

The review also independently confirmed both of the job's own Uncertain items: `aimTarget.test.ts`'s 7
"prioritizes/missed" cases are genuinely distinct pairwise cases (its module comment says the priority order is
"non-transitive-by-design"), and the parallel-fork commit-boundary irregularity (one fork's commit absorbed all
four forks' edits instead of 4 separate commits) did not hide anything — content verified sound.

**Deviations/Uncertain carried from the job** (for the maintainer, below): the 5 historical docs
(`006-...`, `011-...`, two `llm-handoff/*`, `llm-implementation-workflow.md`) still cite `render-contract` paths,
left as frozen pre-job planning narrative rather than edited — a judgment call on how far decision 1's grep
exemption for `_done`/`_reports` should extend; `scenePaletteLibraryAdapter.test.ts` kept 6 cases against the
audit's suggested 1-2, trading the suggested count for not silently dropping adapter-only coverage.

## Job 44

## Questions for the maintainer

## State of job 45

Not started: blocked on the maintainer agreeing its API functions in `_docs/design/012-engine-api.md`.
