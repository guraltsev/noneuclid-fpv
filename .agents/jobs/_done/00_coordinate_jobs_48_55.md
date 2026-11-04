# Job 00 - Coordinate jobs 48-55 (world engine, clients and modules)

Status: done, needs review on 2026-11-03.
Coordinates: jobs [48](48_module_bench_change_journal_layers.md), [49](49_world_engine_and_client_session.md),
[50](50_carry_as_world_attachment.md), [51](51_geodesic_model_module_and_renames.md),
[52](52_derived_state_through_the_journal.md), [53](53_curve_shortening_module.md), [54](54_tools_from_modules.md) and
[55](55_destroy_policy.md), which implement design
[013](../../_docs/design/013-world-engine-clients-and-modules.md). Job 55 resolves issue
[84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md).

## Goal

Carry out jobs 48 to 55 one at a time, in that order, on one branch that stays green. After each job, have its work
reviewed by a second agent with a fresh context, against the design. Never stop to ask. The jobs form a chain, so when one
cannot be finished, stop the batch cleanly and report. At the end, write one batch report that a more capable model can
review.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, reviews,
indicators, bookkeeping and the batch report.

## Decisions

- **One branch, one worktree.** All jobs run on branch `batch-48-55` in `../noneuclid-batch-48-55`. This replaces each job
  file's own worktree line under "Before you start".
- **No push.** Commit only. This replaces rule 6 of the README ("and push") for this batch. The maintainer reviews the
  branch and merges it.
- **The bench baseline is recorded once**, in job 48. A later job that fails `--check` has a failed gate, not a stale
  baseline.
- Design 013 is the specification. If a job file and 013 disagree, follow 013 and record it under `### Deviations`.
- Do not edit 013 or 012, except the one row job 55 marks as implemented. A design question goes in the batch report.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read this whole file. Then read design 013 sections 1 to 6, and skim the "Goal", "Depends on" and "Decisions" sections of
   the eight jobs.
3. Find the branch holding design 013: `git log --all --oneline -- _docs/design/013-world-engine-clients-and-modules.md`.
   If nothing is found, **stop**: the design is not committed. Report that and do nothing else.
4. Create the worktree: `git worktree add ../noneuclid-batch-48-55 -b batch-48-55 <that branch>`. Link `node_modules` into it
   (a directory junction on Windows) or run `npm install` there.
5. Check the starting state in the worktree:

   ```sh
   git status --short          # must be empty
   git log --oneline -1        # note the hash: this is the batch start
   npm run typecheck
   npm test
   npm run docs:check
   npm run smoke -- --world cube,torus-moduli
   npm run test:release
   npm run test:report
   ```

   `tests/app/appCommands.release.test.ts` is a known failure on this machine. Record which of its tests fail at the start,
   so a later failure there is compared with the base commit, not with one green run.
6. Create the batch report `.agents/jobs/_reports/batch_48_55.md` from the template at the end of this file, and fill in
   "Start state".

## Order and dependencies

"Needs" means the job must be **done** (in `_done/`, either status) before it starts.

| Order | Job | Needs | Notes |
| --- | --- | --- | --- |
| 1 | 48 | - | The baseline commit comes first. Every later job relies on it, the journal and the layers. |
| 2 | 49 | 48 | The largest job. It touches the shell and the session everywhere. |
| 3 | 50 | 49 | Needs participants, commands and slots. |
| 4 | 51 | 50 | The rename commit is large and must stay behaviour-free. |
| 5 | 52 | 51 | Deletes the follow-up lists. |
| 6 | 53 | 52 | Deletes the pair object. Some test assertions change, by decision. |
| 7 | 54 | 53 | Its tool test needs the flow as a module. |
| 8 | 55 | 54 | Closes issue 84. |

Stop rule: each job needs the one before it. If a job fails, mark the remaining jobs `skipped on <date>: needs job NN.`, leave
them in place, and go to "At the end". A job that passes with `### Not done` or `### Uncertain` is a pass: continue,
unless what is missing is something the next job needs. Then treat it as a failure.

Do not start any job outside this list, including job 45 and any job numbered below 48.

## Files several jobs touch

Always search for the quoted code instead of trusting a line number. If the code a job quotes is gone or different, follow
the job's intent and record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 48, 49, 52, 53, 54 | Factories are `const`s built in order; use before the line is a runtime error that `tsc` does not report. Run the smoke test after every change here. |
| `src/render/three/geodesicCannonTools.ts` | 50, 51, 52, 53, 54 | Only 54 moves the tie tool. Carry, rotate and aim stay in the shell. |
| `src/world-objects/geodesic/` | 51, 52, 53 | Stays in place in this wave; `geodesicModel` is a facade. |
| `scripts/docs/lib.mjs` | 48, 51 | `legacyWorldWriters` only shrinks: no job adds a line. |
| `scripts/bench/baselines/moduleStep.json` | 48 | Written once. |
| `scripts/bench/moduleStep.bench.ts` | 48, 49, 52, 53 | Each moves one scene onto the new path, as its job says. |
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
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to one
   sub-agent at a time, never two in parallel, because they share files. Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository, in this worktree, on the current branch. Ignore the job's own
   > worktree line. First read `.agents/jobs/README.md` ("Rules for the implementing model" and "Report") and the design
   > sections the job names, and follow them. Never stop to ask: make your best choice and record anything uncertain in
   > the job's `## Report`. Do only this job. Finish with typecheck, tests, docs:check, smoke, the bench check, the
   > Report, the job's "Done when" list, and commits (do not push). Reply with the commit hashes and the Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out.** After the job's last commit, run:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   npm run smoke -- --world cube,torus-moduli
   npm run bench -- moduleStep --check
   npm run test:release
   git status --short
   ```

   Run the greps of the job's "Done when" too.
   - **Pass:** all green and the tree clean. Go to the review.
   - **Red:** give the job one repair attempt within its own scope. If it is still red, undo the job without losing history:
     - run `git revert --no-edit <start-hash>..HEAD` and check that the suite is green again;
     - set the job `Status: skipped on <date>: could not be made green; see batch report.`;
     - keep its partial Report, moving it into the batch report if the revert removed it;
     - commit.

     This is a **failure**: apply the stop rule.
   - Never use `git reset --hard`, `git push --force` or `--no-verify`.
5. **Review** (passed jobs only). Start a **new** sub-agent that has not seen the job's work, and give it this prompt,
   unchanged:

   > Review `.agents/jobs/<file>` in this repository, commits `<start-hash>..HEAD`, against the sections of
   > `_docs/design/013-world-engine-clients-and-modules.md` it names. Do not edit files. Report: (1) each decision in the job's
   > `## Decisions` the code does not follow; (2) every changed or deleted test assertion, and whether the job allows it and
   > the Report records it; (3) any client write to the world other than a command, a control slot or `publishBody`, outside
   > `legacyWorldWriters`; (4) any new stored "moving", "stable" or "locked" state; (5) any per-step allocation added to
   > the idle path; (6) anything the job did that it did not ask for. Be terse; facts only, with file and line.

   If you cannot start a fresh agent, do the review yourself after re-reading only the diff, and write "self-review" in the
   batch report.
   - **No finding:** the job stays a pass.
   - **Findings on 1 to 5:** give the job **one** repair round in its own scope, then run the gate-out again. If a finding
     cannot be fixed in scope, set the job `Status: done, needs review on <date>.` and list it in the batch report.
   - **Findings on 6 only:** list them in the batch report.
6. **Close the job.**
   - Move the job file to `_done/` (with `git mv`) and set its status as the README says.
   - Update its row in the queue table.
   - Save the output of `npm run test:report` and of `npm run bench -- moduleStep --check` as the job's "after" indicators.
   - Fill in the job's section of the batch report.
   - Commit ("Close job NN").

## Gates specific to these jobs

- **Job 48.** The first commit of the job is the baseline, and it changes no file under `src/`. Check this with
  `git show --stat`. Add a scratch sleep to the flow scene, see `--check` exit 1, then remove it.
- **Job 49.** Start the app and check that it loads: this job is where a factory-order error appears. A tool disabled by
  configuration is refused with its message.
- **Job 50.** The existing carry tests pass with no assertion changed.
- **Job 51.** The rename commit changes no behaviour: `npm test` passes on that commit alone, with only names changed. The
  bench `--check` passes.
- **Job 52.** The bench **flow+dependents** scene passes without touching the baseline.
- **Job 53.** Every changed test assertion is about the pair object, and each is under `### Deviations`. Assertions on
  motion, lengths, merging and notices are unchanged: compare with `git diff <start-hash> -- tests/`.
- **Job 54.** `createThreeApp.ts` names no module's tool.
- **Job 55.** Only `src/modules/curveShortening/`, the experience, docs and tests changed. Anything else is a review finding:
  the module boundary should have made it unnecessary.

**Manual checks.** Jobs 50, 51, 54 and 55 ask for checks in the app, and job 54 also in VR. Do what you can in a browser; a
hidden debug window needs one attached CDP session with focus emulation. List every check you could not do under "Manual
checks for the maintainer". An undone manual check does not fail a job, but the job's status is
`done, needs review on <date>.`, and issue 84 stays open until the maintainer has done it.

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

2. Finish the batch report: the indicator table, each review's findings and what happened to them, the manual checks, and
   the questions for the maintainer.
3. Set this file's `Status` (`done on <date>.` if every job passed with empty `### Uncertain` and `### Not done` and no manual
   check is left; otherwise `done, needs review on <date>.`), move it to `_done/`, update its queue row, and commit.
4. Do not push and do not merge. Do not remove the worktree.

## Batch report template

```markdown
# Batch report: jobs 48-55 (world engine, clients and modules)

Coordinator: [00_coordinate_jobs_48_55](../_done/00_coordinate_jobs_48_55.md).
Branch: batch-48-55. Batch start: <hash>. Batch end: <hash>.

## Start state
git status, the base branch, the baseline check results, and which release tests failed at the start.

## Summary
| Job | Result (pass / needs review / skipped / failed) | Commits | Review (fresh agent / self-review; findings) |
| --- | --- | --- | --- |

## Indicators
| Indicator | Start | After each job, 48 to 55 |
| --- | --- | --- |
| Bench: idle, flow, flow+dependents (median) and idle bytes per step | | |
| Lines in createThreeApp.ts | | |
| Lines in `legacyWorldWriters` | | |
| Test files / tests (unit, process, release) | | |

## Job 48
Report summary, the `--check` proof, deviations, uncertain, not done.
## Job 49
## Job 50
## Job 51
## Job 52
## Job 53
The changed assertions, one line each.
## Job 54
## Job 55

## Manual checks for the maintainer
Each check not done, with the steps to do it.

## Questions for the maintainer
Decisions the jobs could not make, and any disagreement between a job and design 013.
```
