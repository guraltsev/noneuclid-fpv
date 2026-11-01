# Batch report: jobs 41-44 (test rehaul)

Coordinator: [00_coordinate_jobs_41_44](../_done/00_coordinate_jobs_41_44.md).
Batch start: 2378b1f. Batch end: 114c0c5.

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
| 44 | done, needs review (`test:release` does not pass 3/3 — a real, disclosed, unresolved flake; see below) | `3bbcd9d`, `efedfed` | fresh agent; 0 must findings, 1 should-level note (below), not fixed |

## Indicators

| Indicator | Start | After 41 | After 42 | After 43 | After 44 |
| --- | --- | --- | --- | --- | --- |
| Test lines / src lines | ~25.5k / ~46.7k | 25,851 / 48,974 | 25,908 / 48,974 | 25,781 / 48,974 | 26,772 / 48,974 |
| Test files / tests (unit, process, release) | 160 files / 1,071 tests (undifferentiated) | unit 146f/942t; process 3f/18t; release 0f/0t | unit 131f/928t; process 3f/18t; release 0f/0t | unit 127f/915t; process 3f/18t; release 0f/0t | unit 127f/915t; process 3f/18t; release 5f/7t (static count; 11 tests at runtime, `it.each` undercounted) |
| Unit tier serial time; slowest file | ~75s summed; portalPaths.test.ts ~62.5s | 73.50s; portalPaths.test.ts 66.36s | 8.23s; moduleImportRules.test.ts 2.11s | 5.38s; moduleImportRules.test.ts 1.43s | 5.50s; moduleImportRules.test.ts 1.37s (unchanged tier; job 44 only added release) |
| Baseline lines (total; per rule) | n/a (baseline not created yet) | 257 total (H1:0 H2:0 H3:0 H4:3 H5:59 H6:193 H7:0 H8:0 H9:2) | 80 total, all in tests/render-contract/ (H1:0 H2:0 H3:0 H4:1 H5:0 H6:78 H7:0 H8:0 H9:1) | 0 total (H1-H9 all 0) | 0 total (unchanged) |
| Manual checks in tests/manual_smoke.md | 0 (file does not exist) | 0 (file still does not exist; job 44) | 0 (unchanged; job 44) | 0 (unchanged; job 44) | 12 (M1-M12) |
| Scenarios in tests/app | 0 | 0 (tests/app does not exist yet; job 44) | 0 (unchanged; job 44) | 0 (unchanged; job 44) | 5 files, 11 tests (appLoading, appCommands, torusDeformation, objectPlacement, creatures) |

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

Extracted one shared CDP client (`scripts/lib/cdpClient.mjs`), built a release-tier scenario runner
(`tests/support/scenario/`), wrote five scenarios (`tests/app/{appLoading,appCommands,torusDeformation,
objectPlacement,creatures}.release.test.ts`), moved `scripts/smoke/browser-smoke.mjs` onto the public API, and
wrote `tests/manual_smoke.md` (M1-M12), replacing the scattered manual checklists in `_docs/acceptance-checklists.md`
and issues 56/57/58/59/71/73/75. Full report with the per-check conversion table, proof-run log, and a full
diagnostic trail for the flake below: [44_api_scenario_runner_and_manual_checklist.md](../_done/44_api_scenario_runner_and_manual_checklist.md).

Zero `src/` changes (confirmed by the coordinator): no function of `window.noneuclid.api` was added or changed,
respecting this job's explicit scope boundary (job 45 is where that happens, blocked on the maintainer).

**The headline problem: `npm run test:release` does not pass three times in a row.** The coordinator independently
reproduced this exactly, running the command three more times after the job's own three runs (six runs total,
all six showing the same pattern): `appLoading`, `torusDeformation`, `objectPlacement` and `creatures` passed
cleanly every single time; `appCommands.release.test.ts` — the only scenario file that restarts the running app
more than once inside one page — failed exactly one of its three tests every run, each time with a genuine
CDP-level timeout (`Runtime.evaluate` got no response at all, not just slowly), on a *different* sub-case each
time (`changeWorld` in the coordinator's run 1, `changeConfig` in runs 2 and 3; the job's own three runs saw
`changeWorld` twice then `changeConfig` once). This is a real, 100%-reproducible-but-nondeterministic flake, not
a one-off.

The job's own report discloses this in full under `### Uncertain`, with a dedicated knowledge note
(`.agents/knowledge/scenario-runner-browser-limits.md`) recording the diagnostic trail so it does not need
re-running: several mitigations were tried and kept because they are sound on their own merits, not because any
of them fixed the flake (a 12s per-CDP-command deadline so a hang rejects instead of blocking forever; a
reconnecting `SessionBox` wrapper around the CDP WebSocket; abandoned-page cleanup between tests); several more
were tried and reverted because they made no difference (halving round trips per poll, avoiding `app.changeWorld`
specifically). A plain Node script driving the identical CDP calls outside Vitest did not reproduce the hang in
several tries, so something about the Vitest worker environment plays a part, though what exactly is not
confirmed. It is the same *class* of flake already on record for multi-world `npm run smoke`
(`.agents/knowledge/test-and-smoke-timing.md`): a rerun of that script during this same investigation flipped
from a real failure to `SMOKE OK` with no code change in between.

No retry was added inside any test to hide this (forbidden by the job's own "Do not" list), and the job's own
Checks table honestly records all three of its own runs as failing this gate. Per this coordinator job's own
"Gates specific to these jobs" for job 44 ("a failure that does not repeat is a flake: list it in the batch
report"), this is recorded here rather than blocking the batch: the behaviour under test is correctly specified
and does work when the transport does not hang (fixing the test by weakening an assertion, adding a hidden
retry, or extending the timeout past a true no-response hang would not address a transport-level problem and
would just mask it). It is flagged below for the maintainer as warranting its own follow-up investigation,
separate from this batch.

**Review finding.** The fresh-context review (`_docs/tests_hygiene.md` §4) independently reproduced the flake
once (same symptom, same file) and treated it as pre-disclosed per the coordinator's framing, then focused on
the rest of the job: all 5 scenarios' proof claims (each assertion read closely and confirmed falsifiable, none
tautological), scenario rule compliance (no DOM/old-globals access, no fixed sleeps, frame-bounded polling), the
runner (fails rather than skips with no browser, per H9), decision 6's smoke-on-the-API migration, decision 1's
CDP-client extraction (`tests/project/smokeArgs.test.ts` re-run, 7/7 pass), all 12 `tests/manual_smoke.md` entries
and all 7 issue-pointer additions (spot-checked against `git show`, exact match), and the `torusDeformation`/
`objectPlacement` scope restrictions (confirmed nothing stronger is asserted than disclosed). **No must-level
finding.** One should-level note, not blocking: all 5 scenario module comments cite "audit's check #N," which
sits close to `_docs/tests.md` §4.2's ban on history in a test comment, though H5's actual regex does not flag
the word "audit" and decision 4 itself asked for the citation — worth a maintainer call on whether the
convention should continue, not a hygiene violation as implemented. (Trivial cosmetic nit also noted: a stray
extra blank line in the diff to `_issues/73_...md`.)

**Deviations/Uncertain carried from the job** (for the maintainer, below): `appCommands`'s `changeWorld` case
does not re-check the `debug` namespace (deliberate de-duplication, not an oversight, predates the flake
investigation); `torusDeformation` asserts only `.target`, not `.current` convergence, because `.current` never
moved from its initial value after `setTorusSkew` in this environment even in a standalone script outside
Vitest — possibly a real gap in the live-deformation pipeline that queued job 30 (issues 55/82) is meant to
address; decision 4.5's bundle-loading check (audit #66) was investigated but not written as a test because
`inter-BNVRAYFH.js` loads eagerly on every page regardless of palette interaction, so "no uikit/Inter file before
the palette opens" is not a true, stable rule for this build — recorded for job 34 instead; decision 5's
`tests/render/fakeRendererContract.release.test.ts` was not added because the API exposes no renderer query (the
`TODO(job44)` in `tests/support/fakeRenderer.ts` stays, for job 45).

## Questions for the maintainer

1. **The `appCommands.release.test.ts` flake (job 44) needs its own follow-up, separate from this batch.** A real,
   CDP-level `Runtime.evaluate` hang (no response at all) hit exactly one of its three restart tests on every one
   of six runs across the job and the coordinator's own independent verification, with a different sub-case
   failing each time. Full diagnostic trail in `.agents/knowledge/scenario-runner-browser-limits.md`. Several
   mitigations were tried and ruled out; the root cause (something about the Vitest worker environment, since a
   standalone Node script reproducing the identical calls did not hang) is not identified. It is the same class
   of flake already on record for multi-world `npm run smoke`. Recommend a dedicated follow-up job/issue to
   investigate the CDP/Vitest-worker interaction, rather than extending timeouts or retrying blindly.
2. **`geometry.state().current` never converges toward a requested `torus-moduli` skew target** (job 44),
   confirmed even in a standalone script outside Vitest/CDP: `buildInFlight` flips to `false` almost immediately
   but `current.skewXMeters` never moves, and `lastBuildMs` reports as a large negative number. This may be a
   real gap in the live-deformation/world-geometry-worker pipeline that queued job 30 ("Incremental deformation
   rebuild pipeline", issues 55/82) is meant to address. Worth a look before or alongside that job.
3. **Five historical docs still cite the pre-rename `tests/render-contract/` path** (job 43): `_docs/design/
   006-non-euclidean-renderer-general-01.md`, `011-vr-hand-tools-palette.md`, two `_docs/llm-handoff/*` files, and
   `_docs/llm-implementation-workflow.md`. Job 43 left them as frozen pre-job planning narrative (the same spirit
   as the `_done`/`_reports` grep exemption, several already citing test files that do not exist under any name),
   but decision 1's literal wording does not name this exemption. A maintainer call on whether to edit them, mark
   them explicitly historical, or leave them is needed; they do not affect any passing check.
4. **Scenario module comments cite "audit's check #N"** (job 44), referencing a review artifact
   (`.agents/jobs/_reports/test_audit_2026_10_31.md`). This is close to `_docs/tests.md` §4.2's ban on a test
   comment carrying "the issue, decision, task or review that added the test," though H5's literal regex does not
   flag the word "audit," and decision 4 itself asked for the citation. Worth a decision on whether this
   convention should continue past this batch.
5. **The original job's stated baseline ("160 files, 1,071 tests") was never reproduced** (job 41): the repo at
   batch start had 148 files, 1,071 tests — the test count matches, the file count does not. Not acted on; left
   as a discrepancy for the record.
6. **H4 flags `PreparedKtx2Loader`'s "injectable for tests" JSDoc** (job 41) even though it looks like legitimate
   injection-seam design, because the check is a literal text match. Not changed; a design question for whoever
   owns the hygiene checks, not a defect in this batch's work.
7. **Bundle loading before the palette opens is not a stable rule** (job 44, audit #66): a fresh `cube` page
   requests `assets/inter-BNVRAYFH.js` (~420 KB) and `assets/ktx2/basis_transcoder.js` immediately, with no
   palette interaction, so "no uikit or Inter file loads before the palette opens" does not hold for this build.
   Recorded here for job 34 (queued) rather than converted into a test.

## State of job 45

Not started: blocked on the maintainer agreeing its API functions in `_docs/design/012-engine-api.md`.
