# Job 00 - Coordinate jobs 51-60 (derived state, then the geodesic and flow modules)

Status: done, needs review on 2026-11-04.
Coordinates: jobs [51](51_geodesic_model_module_and_renames.md), [56](56_bench_counters_and_ab_gate.md), [57](57_change_ring.md),
[58](58_derived_cache.md), [59](59_arc_index.md), [60](60_materialized_state_is_a_function_of_real_state.md),
[52](52_derived_state_through_the_journal.md), [53](53_curve_shortening_module.md), [54](54_tools_from_modules.md) and
[55](55_destroy_policy.md), which implement designs [013](../../_docs/design/013-world-engine-clients-and-modules.md) and
[014](../../_docs/design/014-derived-state-and-caches.md). Job 55 resolves issues
[84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) and
[86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

The batch of jobs 48-55 stopped at job 51, on a timing failure that does not reproduce. Continue it: carry out the ten jobs above, one at
a time, in the order below, on the same branch, keeping it green. After each job have its work reviewed by a second agent with a fresh
context. Never stop to ask. At the end, write one batch report that a more capable model can review.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, reviews, indicators, bookkeeping
and the batch report.

## What went wrong last time

Read this before anything else; every rule below follows from it.

- Job 51 deleted a stored field and asked a query instead, and that query scanned every arc on every rebuild. That was a real cost.
- The gate that noticed was a timing check whose limit sat inside the machine's noise. On unchanged code flow+dependents ranges from 27.6
  to 31.9 microseconds, and the limit is 32.2.
- The clock also drifts between sessions: the same commit measured 16 and then 23 microseconds on the same day, above its own limit. Only a
  comparison run in one session means anything.
- So nobody could see what was wrong, the repair rounds guessed, and the stop rule reverted good work and skipped four jobs.
- The fix: count, do not time. A counter is exact, repeats, and names the cost.

## Decisions

- **One branch, one worktree.** All jobs run on the existing branch `batch-48-55` in `../noneuclid-batch-48-55`. Do not create another. This
  replaces any worktree line in a job file.
- **No push.** Commit only. This replaces rule 6 of the README ("and push"). The maintainer reviews the branch and merges it.
- **Design 014 wins over 013** where they differ (014 section 9 lists where). If a job file and a design disagree, follow the job file, which
  is newer, and record it under `### Deviations`.
- Do not edit 012, 013 or 014, except the one row of 013 that job 55 marks as implemented. A design question goes in the batch report.
- **The timing baseline `moduleStep.json` is never re-recorded.** The counter baseline `moduleStepCounters.json` is re-recorded only as each
  job's Decisions and Steps allow.
- **Timing alone never reverts a job and never stops the batch** (the rule in "Gate out").
- Design 014 is marked proposed. The maintainer started this batch, so treat it as the specification.
- "Connected" means an arc with an emitter at each end, as today (014 section 10, question 8). Do not build a curve-level rule.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read this whole file. Then read design 014 sections 1, 2, 3, 4 and 8, and skim "Goal", "Depends on" and "Decisions" of the ten jobs.
3. Read the [batch report of jobs 48-55](_reports/batch_48_55.md), the sections "Job 51" and "Questions for the maintainer".
4. Go to the worktree. `node_modules` is already linked there. Check it is on `batch-48-55`:

   ```sh
   cd ../noneuclid-batch-48-55
   git branch --show-current
   git log --oneline -1
   git status --short
   ```

5. **The queued files may not be committed yet.** If `git status --short` lists only design 014, issue 86, and files under `.agents/jobs/`,
   commit them all as "Queue jobs 51 to 60 on design 014". If it lists anything else, **stop**: report what you found and do nothing else.
6. Check the starting state:

   ```sh
   npm run typecheck
   npm test
   npm run docs:check
   npm run smoke -- --world cube,torus-moduli
   npm run test:release
   npm run test:report
   ```

   Expect 155 test files and 1332 tests in `npm test`. `tests/app/appCommands.release.test.ts` is a known occasional failure on this machine:
   record which of its tests fail at the start, so a later failure there is compared with this run.
7. Create the batch report `.agents/jobs/_reports/batch_51_60.md` from the template at the end of this file, and fill in "Start state".

## Order and dependencies

"Needs" means the job must be **done** (in `_done/`, either status) before it starts. The order is not the numeric order.

| Order | Job | Needs | Notes |
| --- | --- | --- | --- |
| 1 | 51 | 50 | Restores tested code with one patch, then a small change. Must come first: the patch applies only to the tree as it stands now. |
| 2 | 56 | 51 | From here on the gate is exact. It settles job 51's timing by A/B. |
| 3 | 57 | 56 | The ring. Some tick test assertions change, by decision. |
| 4 | 58 | 57 | The cache primitive. Nothing uses it yet except tests and the bench. |
| 5 | 59 | 58 | The first real cache. The expected effect is large: arc scans fall to almost nothing. |
| 6 | 60 | 59 | Display numbers move to the arc; the oracle for stored segments. |
| 7 | 52 | 60 | Deletes the follow-up lists. |
| 8 | 53 | 52 | Deletes the pair object. Some test assertions change, by decision. |
| 9 | 54 | 53 | Its tool test needs the flow as a module. |
| 10 | 55 | 54 | Closes issues 84 and 86. |

Stop rule: each job needs the one before it. If a job fails, mark the remaining jobs `skipped on <date>: needs job NN.`, leave them in place, and
go to "At the end". A job that passes with `### Not done` or `### Uncertain` is a pass: continue, unless what is missing is something the next job
needs. Then treat it as a failure.

Do not start any job outside this list, including job 45 and any job numbered below 48.

## Files several jobs touch

Always search for the quoted code instead of trusting a line number. If the code a job quotes is gone or different, follow the job's intent and
record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 52, 53, 54, 56, 58 | Factories are `const`s built in order; use before the line is a runtime error that `tsc` does not report. Run the smoke test after every change here. |
| `src/render/three/geodesicCannonTools.ts` | 51, 52, 53, 54 | Only 54 moves the tie tool. Carry, rotate and aim stay in the shell. |
| `src/world-objects/runtimeObjectRegistry.ts` | 51, 56, 57, 58 | Every write path goes through `add`, `remove` or `replaceObject`. Keep `changes` a plain property: `guardRegistry` copies with a spread. |
| `src/world-objects/geodesic/endpoints.ts` | 51, 59 | Keep function signatures. `arcIndex.ts` must not import it, or `docs:check` reports a cycle. |
| `src/world-objects/geodesic/` | 51, 59, 60, 52, 53 | Stays in place in this wave; `geodesicModel` is a facade. |
| `src/engine/moduleTicks.ts`, `worldEngine.ts` | 57 | Bare engine allocation must stay at most 16 bytes per step. |
| `scripts/docs/lib.mjs` | 51 | `legacyWorldWriters` only shrinks: no job adds a line. No job adds a layer. |
| `scripts/bench/baselines/moduleStep.json` | none | Never written again. |
| `scripts/bench/baselines/moduleStepCounters.json` | 56, 58, 59, 60, 52, 53 | A rise is allowed only where the job's text names it. |
| `scripts/bench/moduleStep.bench.ts` | 56, 58, 52, 53 | Each moves or adds one scene, as its job says. |
| `_docs/MATHEMATICAL_MODEL.md` | 51, 53, 55 | Update only what the job names. |
| `.agents/jobs/README.md` (queue table) | all | Update only the row of the job just finished. |

## For each job

1. **Gate in.**
   - The tree must be clean.
   - The job's "Needs" must be in `_done/`.
2. **Start.**
   - Set the job's `Status: in progress.` Do not commit this alone.
   - Record the current commit hash as the job's start hash in the batch report.
   - Save the output of `npm run test:report` as the job's "before" indicators.
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to one sub-agent at a time, never
   two in parallel, because they share files. Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository, in this worktree, on the current branch. Ignore any worktree line in the job. First read
   > `.agents/jobs/README.md` ("Rules for the implementing model" and "Report") and the design sections the job names, and follow them. Never stop to
   > ask: make your best choice and record anything uncertain in the job's `## Report`. Do only this job. Do exactly what the Decisions say, even if
   > you can think of something better; write the better idea under `### Uncertain`. Finish with typecheck, tests, docs:check, smoke, the bench check,
   > the Report, the job's "Done when" list, and commits (do not push). Reply with the commit hashes and the Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out.** After the job's last commit, run:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   npm run smoke -- --world cube,torus-moduli
   npm run test:release
   npm run bench -- moduleStep --check
   git status --short
   ```

   Run the greps of the job's "Done when" too. Then read the result of the bench check by its **exit code**:

   | Exit | Meaning | What to do |
   | --- | --- | --- |
   | 0 | All good | Go on. |
   | 1 | A counter rose | **Red.** The printed line names the scene and the kind. This is a real cost and the job must find it. |
   | 3 | Only timing is over its limit | **Not red yet.** Wait 60 seconds and rerun once, because the machine is hot after the test suite. If it is still 3, run `npm run bench:ab -- <job start hash>`. |

   If `bench:ab` exits 0, the gate passes: record its numbers. If it exits 1, compare the job's counters with the start: a counter that rose under
   permission may explain it. Give the job **one** look for the cause. Whatever comes of it, the job **stays a pass**, its status becomes
   `done, needs review on <date>.`, and the numbers go under "Questions for the maintainer".

   Job 51 runs before these tools exist; its own text says what to do about timing.

   - **Pass:** all green and the tree clean. Go to the review.
   - **Red** (a test, a type, `docs:check`, smoke, a release test, a counter, or a "Done when" grep): give the job up to **two** repair attempts, within its
     own scope. Pass the failure text to the repair, unchanged. If it is still red, undo the job without losing history:
     - run `git revert --no-edit <start-hash>..HEAD` and check that the suite is green again;
     - set the job `Status: skipped on <date>: could not be made green; see batch report.`;
     - keep its partial Report, moving it into the batch report if the revert removed it;
     - commit.

     This is a **failure**: apply the stop rule.
   - Never use `git reset --hard`, `git push --force` or `--no-verify`.
5. **Review** (passed jobs only). Start a **new** sub-agent that has not seen the job's work, and give it this prompt, unchanged:

   > Review `.agents/jobs/<file>` in this repository, commits `<start-hash>..HEAD`, against the sections of
   > `_docs/design/013-world-engine-clients-and-modules.md` and `_docs/design/014-derived-state-and-caches.md` it names. Do not edit files. Report:
   > (1) each decision in the job's `## Decisions` the code does not follow; (2) every changed or deleted test assertion, and whether the job allows it
   > and the Report records it; (3) any client write to the world other than a command, a control slot or `publishBody`, outside `legacyWorldWriters`;
   > (4) any new stored "moving", "stable" or "locked" state, or any derived value stored on the object it is derived from (014 D1); (5) any per-step
   > allocation added to the idle path; (6) any `getObjectsOfKind` or `getAll` scan added to code that runs every step, outside a cache's `compute`; (7) any
   > `relevant` function that could answer false for a change that alters the cache's result; (8) any cached list that is edited instead of replaced;
   > (9) code that only tests reach (the project treats it as stale); (10) anything the job did that it did not ask for. Be terse; facts only, with
   > file and line.

   If you cannot start a fresh agent, do the review yourself after re-reading only the diff, and write "self-review" in the batch report.
   - **No finding:** the job stays a pass.
   - **Findings on 1 to 9:** give the job **one** repair round in its own scope, then run the gate-out again. If a finding cannot be fixed in scope, set the
     job `Status: done, needs review on <date>.` and list it in the batch report.
   - **Findings on 10 only:** list them in the batch report.
6. **Close the job.**
   - Move the job file to `_done/` (with `git mv`) and set its status as the README says.
   - Update its row in the queue table.
   - Save the output of `npm run test:report` and of `npm run bench -- moduleStep --check` as the job's "after" indicators.
   - Fill in the job's section of the batch report.
   - Commit ("Close job NN").

## Gates specific to these jobs

- **Job 51.** After its first commit, `git diff --stat 869024b -- . ':(exclude).agents'` is empty and `npm test` shows 161 files and 1360 tests.
- **Job 56.** A scratch scan in the flow makes `--check` exit 1 and name the kind; the scratch line is then gone. Two runs of the counters are identical.
  `npm run bench:ab -- ee65c50` has run. If it exits 1, rerun it once, then apply the timing rule of "Gate out": job 51's timing goes under "Questions for
  the maintainer" and the batch goes on.
- **Job 57.** `tests/world-objects/runtimeObjectChangeJournal.test.ts` is unchanged: check with `git diff <start-hash> -- <that file>`. In
  `tests/engine/worldEngine.test.ts` only the assertions the job lists changed. `writes` in the counters did not change.
- **Job 58.** The fuzz harness fails on a wrong `relevant`: the test that shows this exists and passes. The hit allocation is under 1 byte per read.
- **Job 59.** No existing test assertion changed: `git diff <start-hash> -- tests/` shows only added lines. Arc scans are at most 6 in each bench scene (a prototype measured 3 computes in 839 reads).
- **Job 60.** Only the one numbering test the job names changed. `writes` did not change.
- **Job 52.** Only `flow+dependents` counters rose, each named under `### Deviations`. Do not touch `moduleStep.json`.
- **Job 53.** Every changed test assertion is about the pair object, and each is under `### Deviations`. Assertions on motion, lengths, merging and notices
  are unchanged: compare with `git diff <start-hash> -- tests/`. No `reset` or `transformGeometry` was added to `ModuleInstance`.
- **Job 54.** `createThreeApp.ts` names no module's tool.
- **Job 55.** Only `src/modules/curveShortening/`, the experience, docs and tests changed. Anything else is a review finding: the module boundary should
  have made it unnecessary.

**Manual checks.** Jobs 51, 54 and 55 ask for checks in the app, job 54 also in VR, and job 59 asks for a session with the `derived-verify` debug option. Do
what you can in a browser; a hidden debug window needs one attached CDP session with focus emulation. List every check you could not do under "Manual
checks for the maintainer". An undone manual check does not fail a job, but the job's status is `done, needs review on <date>.`, and issues 84 and 86 stay
open until the maintainer has done it.

## At the end

1. Run the full set once more and record it:

   ```sh
   npm run typecheck
   npm test
   npm run test:release
   npm run docs:check
   npm run bench -- moduleStep --check
   npm run test:report
   ```

2. Finish the batch report: the indicator table, each review's findings and what happened to them, the manual checks, and the questions for the
   maintainer.
3. Set this file's `Status` (`done on <date>.` if every job passed with empty `### Uncertain` and `### Not done` and no manual check is left; otherwise
   `done, needs review on <date>.`), move it to `_done/`, update its queue row, and commit.
4. Do not push and do not merge. Do not remove the worktree.

## Batch report template

```markdown
# Batch report: jobs 51-60 (derived state, then the geodesic and flow modules)

Coordinator: [00_coordinate_jobs_51_60](../_done/00_coordinate_jobs_51_60.md).
Continues: [batch_48_55](batch_48_55.md).
Branch: batch-48-55. Batch start: <hash>. Batch end: <hash>.

## Start state
git status, the baseline check results, and which release tests failed at the start.

## Summary
| Job | Result (pass / needs review / skipped / failed) | Commits | Review (fresh agent / self-review; findings) |
| --- | --- | --- | --- |

## Indicators
| Indicator | Start | After each job, in order 51, 56, 57, 58, 59, 60, 52, 53, 54, 55 |
| --- | --- | --- |
| Arc scans per flow+dependents run (from job 56) | | |
| Arc index computes and reads per flow run (from job 59) | | |
| Writes per flow+dependents run (from job 56) | | |
| Bench: idle, flow, flow+dependents (median) and idle bytes per step | | |
| Lines in createThreeApp.ts | | |
| Lines in `legacyWorldWriters` | | |
| Test files / tests (unit, process, release) | | |

## Job 51
Report summary, deviations, uncertain, not done. The same for each job, in the order run.
## Job 56
The `bench:ab -- ee65c50` output.
## Job 57
The changed assertions, one line each.
## Job 58
## Job 59
Counters before and after.
## Job 60
## Job 52
The counters that rose, one line each.
## Job 53
The changed assertions, one line each.
## Job 54
## Job 55

## Manual checks for the maintainer
Each check not done, with the steps to do it.

## Questions for the maintainer
Decisions the jobs could not make, any disagreement between a job and a design, and any timing alarm that `bench:ab` did not clear.
```
