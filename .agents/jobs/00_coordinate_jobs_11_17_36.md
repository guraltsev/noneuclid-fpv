# Job 00 - Coordinate jobs 11-17 and 36

Status: queued.
Coordinates: jobs [11](11_property_tests_for_geometry_core.md) to [17](17_multi_hop_ghosts_and_eye_rerooting.md) and
[36](36_creatures_detour_and_resume_geodesic.md) (geometry and movement core). Resolves no issue itself.

## Goal

Carry out jobs 11, 12, 13, 14, 15, 16, 17 and 36 one at a time, in that order. Keep `main` green: every commit that is
pushed passes `npm run typecheck`, `npm test` and `npm run docs:check`. Never stop to ask. When a job cannot be
finished, record it and move on to the next job that does not depend on it. At the end, write one batch report that a
more capable model can review.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, bookkeeping
and the batch report.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read this whole file, then skim the "Goal", "Depends on" and "Decisions" sections of all eight jobs once, so you know
   which later job relies on which earlier result.
3. Check the starting state:

   ```sh
   git status --short          # must be empty (an empty untracked tests/scratch/ folder is harmless)
   git log --oneline -1        # note the hash: this is the batch start
   npm run typecheck
   npm test                    # about 56 s on 2026-10-29: 706 passed, 8 skipped
   npm run docs:check
   ```

   If the tree is not clean, do not discard anything. Record the files in the batch report under "Start state" and
   continue; never commit files you did not change.
4. Create the batch report `.agents/jobs/_reports/batch_11_17_36.md` from the template at the end of this file. Fill
   "Start state".

## Order and dependencies

Run the jobs in this order. "Needs" means the job (or the named part) must be **done** (in `_done/`, either status)
before it starts.

| Order | Job | Needs | Notes |
| --- | --- | --- | --- |
| 1 | 11 | - | Installs `fast-check` and `@vitest/coverage-v8` (network). Adds `tests/support/arbitraries.ts`, used by every later job. |
| 2 | 12 | 11 | Adds `segmentWalk.ts`, `developedDisk.ts` and three tolerances. Changes no caller. |
| 3 | 13 | 12 | Three parts, one commit each (A mover, B bodies, C multi-crossing callers). The largest job. |
| 4 | 14 | 13 Part A | Re-projection helper; also edits job 12's modules and job 13's mover. |
| 5 | 15 | 12 | Geodesic tracing. Must land before job 25 (not in this batch). |
| 6 | 16 | 12 | Aim picking. Changes `AimTarget` and the aim request (compile errors in other files are expected and listed in the job). |
| 7 | 17 | 12 | Ghosts and XR eye roots. |
| 8 | 36 | 13 Parts A and B | Creatures follow a leader. Uses job 14's helper if job 14 is done, otherwise plain composition (the job says how). |

Job 36 runs **before** jobs 18-35 on purpose: it belongs to this batch. Do not start any job numbered 18-35.

Skip rules:

- Job 11 failed only because the packages cannot be installed (no network): **stop the batch** and report; every later
  job needs `fast-check`.
- Job 12 skipped: skip 13, 14, 15, 16, 17 and 36.
- Job 13 Part A could not be made green: skip 14 and 36. Part B failed: skip 36. Part C failed alone: jobs 14 and 36
  still run (see "Gates for job 13").
- Any other skip affects only that job.

## Files several jobs touch

Line numbers in a job file are for commit `0d86165`. Earlier jobs in this batch shift them. Always search for the
quoted code rather than trusting a line number. If the code a job quotes is gone or different, follow the job's intent
and record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `src/math/tolerances.ts` | 12, 13, 14 | 12 adds three constants, 13 adds `collisionSkinMeters`, 14 names the rest. Never change a value. |
| `src/math/rigidTransform3.ts` | 14 | Adds `orthonormalizeYawRigidTransform3`; 36 uses it. |
| `src/cell-complex/segmentWalk.ts`, `developedDisk.ts` | 12 creates; 14 edits; 13, 15, 16, 17, 36 use | 14 adds re-projection inside them; later jobs must not change their behaviour. |
| `src/movement/moveDynamicObject.ts`, `movePlayer.ts`, `collision.ts` | 13, 14 | 13 rewrites the mover and adds `crossings` and `cellFromStart`; 14 must keep both. |
| `src/movement/sweptCollision.ts`, `developedObstacles.ts` | 13 creates | |
| `src/movement/depenetrateDynamicObject.ts` | 14, 36 | 14 names literals only; 36 changes the creature call site, not this file. |
| `src/render/three/createThreeApp.ts` | 13 (B, C), 16, 17 | Large file. Edit only the functions the job names. 13 removes `blockPlayerMoveAgainstRuntimeObjects` and adds the transition log; 16 adds a frame serial; 17 passes the eye anchor. |
| `src/render/three/geodesicCannonTools.ts` | 13 (C), 16 | 13 changes the carry bookkeeping and the released-cannon re-homing; 16 only fixes compile errors from the aim API. |
| `src/world-objects/geodesicCannon.ts` | 13 (C6), 15 | 13 changes one curve-shortening loop near the free-end move; 15 rewrites the tracing loop. Different functions. |
| `src/world-objects/simpleGeoCreature.ts` | 13 (B4), 36 | 36 rewrites `update` on top of 13's version. |
| `src/render/three/aimTarget.ts`, `aimInteraction.ts`, `rootAimRay.ts` | 16 | |
| `src/render/three/runtimeObjectGhostRecords.ts`, `renderPortalInstances.ts`, `xrPortalEye.ts` | 17 | |
| `tests/movement/moveDynamicObject.test.ts` | 11 (reads helpers), 13, 14 | 13 lists the only old tests it may change. |
| `_docs/MATHEMATICAL_MODEL.md` | 12 (§4, §10), 13 (§5, §11), 14 (§5, §10), 15 (§6), 17 (§8), 36 (§5) | Each job edits its own paragraphs; do not rewrite others. |
| `_issues/62_*`, `_issues/63_*` | 12, 13, 17 | Shared issues: see "Issue bookkeeping". |
| `.agents/jobs/README.md` (queue table) | all | Update only the row of the job just finished. |

## For each job

1. **Gate in.**
   - The tree is clean apart from the start-state files, and the job's "Needs" are in `_done/` (for job 13 parts, see
     below).
   - If a need is missing, mark the job **skipped**: set its `Status: skipped on <date>: needs job NN.`, leave it in
     place, add the row to the batch report, and go to the next job.
2. **Start.** Set the job's `Status: in progress.` (do not commit this alone). Record the current commit hash as the
   job's start hash in the batch report.
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to
   one sub-agent at a time, never two in parallel (they share files). Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository. First read `.agents/jobs/README.md` ("Rules for the
   > implementing model" and "Report") and follow them. Never stop to ask: make your best choice and record anything
   > uncertain in the job's `## Report`. Do only this job. Finish with typecheck, tests, docs:check, the Report, the
   > job's "Done when" checklist, and the commits the job asks for (do not push). Reply with the commit hashes and the
   > Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out.** After the job's last commit, run:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   git status --short
   ```

   - All green and tree clean: push with `git push`. The pre-push hook runs the checks again. This is a **pass**.
   - Red: give the job one repair attempt, within its own scope. If it is still red, undo the job without losing
     history: `git revert --no-edit <start-hash>..HEAD`. Check that the suite is green again, then set the job
     `Status: skipped on <date>: could not be made green; see batch report.`. Keep its partial Report (move it into the
     batch report if the revert removed it). Commit and push. This is a **failure**: apply the skip rules.
   - Never use `git reset --hard`, `git push --force` or `--no-verify`.
5. **Record** the job's row in the batch report: status, commit hashes, test count, `npm test` duration, and every
   item from its `### Deviations`, `### Uncertain` and `### Not done` (copy them; do not summarise them away).

### Gates for job 13

Job 13 commits once per part. Run the gate-out checks after **each** part's commit, and push after each green part.

- A part that cannot be made green after one repair attempt: revert only that part's commits
  (`git revert --no-edit <part-start-hash>..HEAD`), do not start the later parts, set job 13 to
  `done, needs review` if Part A passed (otherwise `skipped`), and apply the skip rules above.
- Record one hash per part in the batch report.

### Manual checks

Jobs 13, 16, 17 and 36 end with a manual browser or headset check. If you cannot run a browser or headset, write the
check under a subsection `### Manual checks not run` in the job's Report. For this batch, that subsection does **not**
count as `### Not done` or `### Uncertain`: the job can still be `done` and close its issues. The exception is job 17,
whose own text says to set "done, needs review" when its headset check was not run; follow the job. Collect every
unrun manual check in one list in the batch report ("Manual checks for the maintainer").

The automated smoke tests the jobs name (`npm run smoke -- ...`) are **not** manual checks: run them.

## Issue bookkeeping

The jobs carry their own closing instructions. Check that they happened:

| Issue | Closed when | Closed by |
| --- | --- | --- |
| 61 | Job 13 done with no uncertainty. | Job 13 |
| 62 | Job 13 done with no uncertainty. | Job 13 (job 12 only adds a status line) |
| 63 | Job 13 done with no uncertainty. Its "Ghosts" item is recorded as moved to job 17. | Job 13; job 17 adds a pointer line |
| 65 | Job 14 done with no uncertainty. | Job 14 |
| 69 | Job 15 done with no uncertainty. | Job 15 |
| 72 | Job 16 done with no uncertainty. | Job 16 |
| 73 | Job 17 done (not "needs review"). | Job 17 |

Status lines only (no closing): issue 55 (job 12), issue 70 (job 15), issue 71 (job 16), issue 50 rows 61-63, 65, 69,
72, 73 (the closing job).

A job marked `done, needs review` does **not** close its issue: the issue gets a one-line pointer to the job's Report
instead (README, "Report").

After the last job, check that every closed issue is in `_issues/_closed/` with `## Outcome` and `## Closing evidence`,
and that no link points to an old location:

```sh
grep -rn "_issues/\(61\|62\|63\|65\|69\|72\|73\)_" --include=*.md . | grep -v node_modules
```

Every hit for a closed issue must contain `_closed/`. Fix stale links in one bookkeeping commit.

## Final checks

1. `npm run typecheck`, `npm test` and `npm run docs:check` all pass. Record the `npm test` duration and compare it with
   the start (job 11 allows at most +15 s for its own tests; flag any total growth above 30 s in "Cross-job problems").
2. `npm run test:coverage` passes (if job 11 passed). Record the line coverage of `src/math`, `src/cell-complex`,
   `src/movement`.
3. Smoke test on a fresh `npm run build`: `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.
   Record the summary line.
4. Update the queue table in `.agents/jobs/README.md`: every row 11-17 and 36 shows done, done (needs review) or
   skipped, and add this coordinator's row.
5. Set this job's `Status:` to `done on <date>.` if every job passed with no uncertainty, otherwise
   `done, needs review on <date>.`. Move this file to `_done/`.
6. Commit the batch report, this file and the README, then push.

## Do not

- Do not run two jobs at once, or start a job before the previous one is committed and green.
- Do not start jobs 18-35.
- Do not edit a job file's instructions to make it easier. If a job is wrong, follow its intent and record it under
  `### Deviations`.
- Do not change tests that a job does not name, to make the suite pass.
- Do not discard uncommitted work you did not create.

## Batch report template

Create `.agents/jobs/_reports/batch_11_17_36.md` with:

```markdown
# Batch report: jobs 11-17 and 36

Coordinator: <model name>. Started <date> at commit <hash>; finished <date> at commit <hash>.

## Start state
Checks at the start (typecheck / tests / docs:check, test duration), and any files that were already modified.

## Jobs
| Job | Result | Commits | Tests (passed/skipped) | Test time | Issues closed |
| --- | --- | --- | --- | --- | --- |
| 11 | ... | ... | ... | ... | ... |
| 13 | ... | A: ..., B: ..., C: ... | ... | ... | ... |

## For review
One subsection per job that is not a clean pass: copy its Deviations, Uncertain and Not done items verbatim, and add
what you, the coordinator, noticed (for example a job quoting code that no longer existed).

## Manual checks for the maintainer
Every manual browser or headset check that was not run, with the job number and the exact steps from the job.

## Cross-job problems
Conflicts between jobs, repairs you made between jobs, stale links, anything that did not fit one job.

## Final checks
Commands run at the end and their results, including coverage and the smoke test summary.
```
