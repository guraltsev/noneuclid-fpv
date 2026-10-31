# Job 00 - Coordinate jobs 41-44 (test rehaul)

Status: queued.
Coordinates: jobs [41](41_test_tiers_and_hygiene_checks.md), [42](42_clean_test_areas.md),
[43](43_clean_render_tests_and_shared_fakes.md) and [44](44_api_scenario_runner_and_manual_checklist.md), which bring
the suite up to the test policy and start replacing manual checks with tests through the public API. Job
[45](45_api_functions_for_scenarios.md) is **not** part of this batch: it is blocked until the maintainer agrees its API
functions in `_docs/design/012-engine-api.md`. Resolves no issue itself.

## Goal

Carry out jobs 41, 42, 43 and 44 one at a time, in that order. Keep `main` green: every pushed commit passes
`npm run typecheck`, `npm test` and `npm run docs:check`, and from job 44 on also `npm run test:release`. After each
job, have the job's test changes reviewed by a second agent with a fresh context, as `_docs/tests_hygiene.md` §4
requires. Never stop to ask. When a job cannot be finished, record it and move on to the next job that does not depend
on it. At the end, write one batch report that a more capable model can review.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, reviews,
indicators, bookkeeping and the batch report.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read [`_docs/tests.md`](../../_docs/tests.md) §2.1 (the Q1–Q10 checklist) and
   [`_docs/tests_hygiene.md`](../../_docs/tests_hygiene.md) §4 (reviews) and §5 (clean-up). You check the reviews against
   them.
3. Read this whole file. Then skim the "Goal", "Depends on" and "Decisions" sections of the four jobs, and §1 of
   `.agents/jobs/_reports/test_audit_2026_10_31.md`.
4. Check the starting state:

   ```sh
   git status --short          # must be empty
   git log --oneline -1        # note the hash: this is the batch start
   npm run typecheck
   npm test                    # about 75 s on 2026-10-31: 160 files, 1,071 tests passing
   npm run docs:check
   npm run smoke -- --world cube,torus-moduli
   ```

   If the tree is not clean, do not discard anything. Record the files in the batch report under "Start state" and
   continue. Never commit files you did not change.
5. Create the batch report `.agents/jobs/_reports/batch_41_44.md` from the template at the end of this file, and fill
   in "Start state". `npm run test:report` does not exist before job 41, so record the start indicators from audit §1.

## Order and dependencies

"Needs" means the job must be **done** (in `_done/`, either status) before it starts.

| Order | Job | Needs | Notes |
| --- | --- | --- | --- |
| 1 | 41 | - | Tiers, unit-tier guard, fast-check seed, hygiene checks and baseline, `npm run test:report`. Every later job relies on it. |
| 2 | 42 | 41 | Every area except `render`, one commit per area. The largest job. Adds the shared fixtures in `tests/fixtures/cell-complex/` and the `scripts/bench/` runner. |
| 3 | 43 | 41, 42 | Uses job 42's fixtures and bench runner. |
| 4 | 44 | 41 | Does not need 42 or 43; it runs last so the renderer fake from job 43 exists for its contract test (decision 5 of job 44 covers the case where it does not). |

Skip rules:

- Job 41 failed: **stop the batch** and report. Every later job needs its tiers, seed and baseline.
- Job 42 failed as a whole: skip 43, but still run 44.
- Job 42 finished only some areas: that is a pass with `### Not done`. Job 43 still runs if the
  `tests/fixtures/cell-complex/` fixtures and the bench runner exist. Otherwise skip 43.
- Job 43 failed: 44 still runs.
- Do not start job 45, or any job numbered below 41.

## Files several jobs touch

Always search for the quoted code instead of trusting a line number. If the code a job quotes is gone or different,
follow the job's intent and record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `tests/hygiene-baseline.txt` | 41 creates; 42, 43 shorten | Only job 41 adds lines. A later job that needs a new line has found a question for the maintainer: record it and do not add the line. |
| `vitest.workspace.ts`, `package.json` scripts | 41 creates; 42 adds `bench`; 44 uses `release` | Never rename the tier commands. |
| `tests/support/` | 41 (`unitSetup.ts`), 43 (fakes), 44 (`scenario/`) | One file per boundary or helper; nothing in it is a test. |
| `tests/fixtures/` | 42 moves and creates; 43 uses | |
| `tests/project/` | 41 creates (`testHygiene.test.ts`); 42 fills; 44 adds `bundleLoading` | |
| `scripts/bench/` | 42 creates; 43 adds two benchmarks | |
| `scripts/smoke/browser-smoke.mjs`, `scripts/debug/cdp.mjs` | 44 | They move onto `scripts/lib/cdpClient.mjs`; their command lines must not change. |
| `.githooks/pre-push` | 41 | 41 adds the `release` project run. Do not change the smoke retry. |
| `_docs/tests.md` §8, `_docs/tests_hygiene.md` §8 | all | Each job updates only the "Status (2026-10-31)" lines it makes true. |
| `_docs/design/012-engine-api.md` | 43 (one sentence) | Only the benchmark path. Any other edit to 012 is out of scope. |
| `.agents/jobs/README.md` (queue table) | all | Update only the row of the job just finished. |

## For each job

1. **Gate in.**
   - The tree must be clean, apart from the start-state files.
   - The job's "Needs" must be in `_done/`. If a need is missing, mark the job **skipped**: set its
     `Status: skipped on <date>: needs job NN.`, leave it in place, add its row to the batch report, and go on to the
     next job.
2. **Start.**
   - Set the job's `Status: in progress.` Do not commit this alone.
   - Record the current commit hash as the job's start hash in the batch report.
   - From job 42 on, run `npm run test:report` and save its output as the job's "before" indicators.
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to
   one sub-agent at a time, never two in parallel, because they share files. Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository. First read `.agents/jobs/README.md` ("Rules for the
   > implementing model" and "Report") and `_docs/tests.md`, and follow them. Never stop to ask: make your best choice
   > and record anything uncertain in the job's `## Report`. Do only this job. Finish with typecheck, tests, docs:check,
   > the Report (including the behaviour map and the proof lines when the job asks for them), the job's "Done when"
   > checklist, and the commits the job asks for (do not push). Reply with the commit hashes and the Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out.** After the job's last commit, run:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   npm run test:release        # from job 44 on (before job 41 it does not exist)
   git status --short
   ```

   - **Pass:** all green and the tree clean. Go to the review, and do not push yet.
   - **Red:** give the job one repair attempt within its own scope. If it is still red, undo the job without losing
     history:
     - run `git revert --no-edit <start-hash>..HEAD` and check that the suite is green again;
     - set the job `Status: skipped on <date>: could not be made green; see batch report.`;
     - keep its partial Report, moving it into the batch report if the revert removed it;
     - commit and push.

     This is a **failure**: apply the skip rules.
   - Never use `git reset --hard`, `git push --force` or `--no-verify`.
5. **Review** (passed jobs only). Start a **new** sub-agent that has not seen the job's work, and give it this prompt,
   unchanged:

   > Review the test changes of `.agents/jobs/<file>` in this repository, commits `<start-hash>..HEAD`. Read
   > `_docs/tests.md` (§2.1, the Q1–Q10 checklist, and §6 for scenarios) and `_docs/tests_hygiene.md` §4 first. Do not
   > edit files. Report: (1) for every test added or rewritten, each failed "must" (Q1–Q6) with file and test name;
   > (2) for every test deleted, the test that now protects its behaviour according to the job's behaviour map, and
   > whether that test really asserts it (open it and check); list any deletion with no protecting test and no stated
   > reason; (3) any assertion that cannot fail; (4) any name or comment that claims something the test does not
   > assert. Be terse; facts only, with file and test name.

   If you cannot start a fresh agent, do the review yourself after re-reading only the diff, and write "self-review"
   in the batch report.
   - **No finding:** push. The job stays a pass.
   - **Findings on "must" rules or on unprotected deletions:** give the job **one** repair round in its own scope
     (restore the deleted test, or fix the failed rule), then run the gate-out again.
     - If it is green, push and list the findings and their fixes in the batch report.
     - If a finding cannot be fixed in scope, push what is green, set the job `Status: done, needs review on <date>.`,
       and list the finding under the job in the batch report.
   - **Findings on "should" rules only:** push, and list them in the batch report. They are debt, not blockers.
6. **Close the job.**
   - Move the job file to `_done/` (with `git mv`) and set its status as the README says.
   - Update its row in the queue table.
   - Run `npm run test:report` and save the output as the job's "after" indicators.
   - Fill in the job's section of the batch report.
   - Commit ("Close job NN") and push.

## Gates specific to these jobs

- **Job 41.** Before closing, check by hand that a new violation fails `npm test`: add an `it.skip` in a scratch test
  under `tests/_temp/job41/`, see the failure name rule H9, then delete the scratch file. Check also that a stale
  baseline line fails: remove one violation without its line. Record both in the batch report.
- **Job 42.** The unit tier's serial time must fall. If it is still above 30 s, the batch report names the slowest
  files from `npm run test:report`. Every area has a behaviour map in the job's Report. An area without one is a
  review finding.
- **Job 43.** `tests/render-contract/` no longer exists, and a grep for `render-contract` in `_docs/`, `.agents/jobs/`
  (outside `_done/` and `_reports/`) and `scripts/` finds nothing.
- **Job 44.**
  - Run `npm run test:release` three times in a row, and record the three results. A failure that does not repeat is
    a flake: list it in the batch report. Never add a retry inside a test to hide it.
  - Check that `tests/manual_smoke.md` exists with M1–M12, and that the "Headset smoke checklist" section of
    `_docs/acceptance-checklists.md` is now a pointer.

## At the end

1. Run the full set once more and record it:

   ```sh
   npm run typecheck
   npm test
   npm run test:release
   npm run docs:check
   npm run test:report
   ```

2. Finish the batch report: the indicator table (start, after each job, end), each review's findings and what happened
   to them, the questions for the maintainer, and the state of job 45.
3. Set this file's `Status` (`done on <date>.` if every job passed with empty `### Uncertain` and `### Not done`;
   otherwise `done, needs review on <date>.`), move it to `_done/`, update its queue row, commit and push.

## Batch report template

```markdown
# Batch report: jobs 41-44 (test rehaul)

Coordinator: [00_coordinate_jobs_41_44](../_done/00_coordinate_jobs_41_44.md).
Batch start: <hash>. Batch end: <hash>.

## Start state
git status, and the baseline check results (counts and durations).

## Summary
| Job | Result (pass / needs review / skipped / failed) | Commits | Review (fresh agent / self-review; findings) |
| --- | --- | --- | --- |

## Indicators
| Indicator | Start | After 41 | After 42 | After 43 | After 44 |
| --- | --- | --- | --- | --- | --- |
| Test lines / src lines | | | | | |
| Test files / tests (unit, process, release) | | | | | |
| Unit tier serial time; slowest file | | | | | |
| Baseline lines (total; per rule) | | | | | |
| Manual checks in tests/manual_smoke.md | | | | | |
| Scenarios in tests/app | | | | | |

## Job 41
Report summary, the H9 and stale-line proofs, deviations, uncertain, not done.
## Job 42
Report summary, the areas done, the behaviour maps (link to the job's Report), the review findings and fixes.
## Job 43
## Job 44
The three release runs, the class-A checks converted and not converted, flakes.

## Questions for the maintainer
Decisions the jobs could not make, new baseline lines that were needed, and the state of job 45.
```
