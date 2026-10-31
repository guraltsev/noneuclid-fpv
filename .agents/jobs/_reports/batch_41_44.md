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
| 42 | TBD | | |
| 43 | TBD | | |
| 44 | TBD | | |

## Indicators

| Indicator | Start | After 41 | After 42 | After 43 | After 44 |
| --- | --- | --- | --- | --- | --- |
| Test lines / src lines | ~25.5k / ~46.7k | 25,851 / 48,974 | | | |
| Test files / tests (unit, process, release) | 160 files / 1,071 tests (undifferentiated) | unit 146f/942t; process 3f/18t; release 0f/0t | | | |
| Unit tier serial time; slowest file | ~75s summed; portalPaths.test.ts ~62.5s | 73.50s; portalPaths.test.ts 66.36s | | | |
| Baseline lines (total; per rule) | n/a (baseline not created yet) | 257 total (H1:0 H2:0 H3:0 H4:3 H5:59 H6:193 H7:0 H8:0 H9:2) | | | |
| Manual checks in tests/manual_smoke.md | 0 (file does not exist) | 0 (file still does not exist; job 44) | | | |
| Scenarios in tests/app | 0 | 0 (tests/app does not exist yet; job 44) | | | |

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

## Job 43

## Job 44

## Questions for the maintainer

## State of job 45

Not started: blocked on the maintainer agreeing its API functions in `_docs/design/012-engine-api.md`.
