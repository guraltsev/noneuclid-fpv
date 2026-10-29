# Job 00 - Coordinate jobs 01-10

Status: queued.
Coordinates: jobs [01](_done/01_frame_loop_error_containment_and_dispose.md) to
[10](10_floor_texture_in_lattice_coordinates.md). Resolves no issue itself.

## Goal

Carry out jobs 02-10 one at a time, in numeric order. Job 01 is already done (commit `e094b82`). Keep `main` green:
every commit that is pushed passes `npm run typecheck`, `npm test` and `npm run docs:check`. Never stop to ask. When a
job cannot be finished, record it and move on to the next job that does not depend on it. At the end, write one batch
report that a more capable model can review.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, bookkeeping
and the batch report.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read this whole file.
3. Check the starting state:

   ```sh
   git status --short          # must be empty (an empty untracked tests/scratch/ folder is harmless)
   git log --oneline -1        # note the hash: this is the batch start
   npm run typecheck
   npm test
   npm run docs:check
   ```

   If the tree is not clean, do not discard anything. Record the files in the batch report under "Start state" and
   continue; never commit files you did not change.
4. Create the batch report `.agents/jobs/_reports/batch_01_10.md` from the template at the end of this file. Fill
   "Start state".

## Order and dependencies

Run the jobs in this order. "Needs" means a job must be **done** (in `_done/`, either status) before it starts.

| Job | Needs | Notes |
| --- | --- | --- |
| 01 | - | Already done. Do not redo it. |
| 02 | - | Assets. Removes files from `public/`. |
| 03 | 02 | Both edit `scripts/build-pages.mjs`; keep job 02's size check. |
| 04 | 03 | Uses `npm run build:pages -- --base <name>` from job 03. |
| 05 | - | Geodesic words. |
| 06 | 05 | Test 4 reuses job 05's fixture. Without 05, the job says how to run without test 4. |
| 07 | - | Heading convention. Leaves issues 53 and 64 open, with status notes. |
| 08 | - | Closes issue 64 only if job 07 is in `_done/`. |
| 09 | - | Closes issue 53 only if job 07 is in `_done/`. |
| 10 | 09 | Must not start unless `_done/09_deformation_commit_safety.md` exists. |

The numeric order already satisfies every "Needs". Do not reorder. If a job is **skipped** (see below), skip every
later job that needs it, and record the skip with its reason.

## Files several jobs touch

Line numbers in a job file are for commit `e094b82`. Earlier jobs in this batch shift them. Always search for the
quoted code rather than trusting a line number, and if the code a job quotes is gone or different, follow the job's
intent and record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 04, 06, 07, 08, 09, 10 | Large file. Edit only the functions the job names. |
| `src/world-objects/geodesicCannon.ts` | 05, 06 | Job 06 assumes job 05's helpers exist. |
| `src/movement/moveDynamicObject.ts`, `movePlayer.ts`, `collision.ts` | 07, 08, 09 | Job 08 adds `appliedDisplacement` to move results; job 09's new code must keep it. |
| `src/runtime/worldGeometryDeformations.ts`, `src/runtime/deformations/torusSkewDeformation.ts` | 07, 09, 10 | Job 07 changes heading transport; 09 the footprint check and width step; 10 the floor frame. |
| `src/render/three/buildCellMesh.ts`, `preloadWorldAssets.ts` | 02, 10 | Job 02 replaces the portal-wall texture; job 10 the floor UVs. |
| `scripts/build-pages.mjs`, `package.json`, `_docs/DEPLOYMENT.md` | 02, 03, 04 | Keep earlier jobs' additions when editing. |
| `_docs/MATHEMATICAL_MODEL.md` | 05-10 | Each job edits its own section; do not rewrite others. |
| `_issues/53_*`, `_issues/64_*` | 07, 08, 09 | Shared issues: see "Issue bookkeeping". |
| `.agents/jobs/README.md` (queue table) | all | Update only the row of the job just finished. |

## For each job (02 to 10)

1. **Gate in.**
   - The tree is clean apart from the start-state files, and the job's "Needs" are in `_done/`.
   - If a need is missing, mark the job **skipped**: set its `Status: skipped on <date>: needs job NN.`, leave it in
     place, add the row to the batch report, and go to the next job.
2. **Start.** Set the job's `Status: in progress.` (do not commit this alone). Record the current commit hash as the
   job's start hash in the batch report.
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to
   one sub-agent at a time, never two in parallel (they share files). Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository. First read `.agents/jobs/README.md` ("Rules for the
   > implementing model" and "Report") and follow them. Never stop to ask: make your best choice and record anything
   > uncertain in the job's `## Report`. Do only this job. Finish with typecheck, tests, docs:check, the Report, the
   > job's "Done when" checklist, and one commit (do not push). Reply with the commit hash and the Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out.** After the job's commit, run:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   git status --short
   ```

   - All green and tree clean: push with `git push`. The pre-push hook runs the checks again. This is a **pass**.
   - Red: give the job one repair attempt, within its own scope. If it is still red, undo the job without losing
     history: `git revert --no-edit <start-hash>..HEAD`. Check that the suite is green again, then set the job
     `Status: skipped on <date>: could not be made green; see batch report.`. Keep its partial Report (move it into the
     batch report if the revert removed it). Commit and push. This is a **failure**: skip later jobs that need it.
   - Never use `git reset --hard`, `git push --force` or `--no-verify`.
5. **Record** the job's row in the batch report: status, commit hashes, test count, and every item from its
   `### Deviations`, `### Uncertain` and `### Not done` (copy them; do not summarise them away).

## Issue bookkeeping

The jobs carry their own closing instructions. Check that they happened:

| Issue | Closed when | Closed by |
| --- | --- | --- |
| 40 | Job 02 done with no uncertainty. | Job 02 |
| 68 | Job 05 done with no uncertainty. | Job 05 |
| 66 | Job 06 done with no uncertainty (test 4 ran). | Job 06 |
| 64 | Jobs 07 and 08 both done. | Job 08 (07 only adds a status note) |
| 53 | Jobs 07 and 09 both done. | Job 09 (07 only adds a status note) |
| 81 | Job 10 done with no uncertainty. | Job 10 |

A job marked `done, needs review` does **not** close its issue: the issue gets a one-line pointer to the job's
Report instead (README, "Report"). If a later job would close a shared issue but the other job is `needs review`,
leave the issue open with that pointer too.

After job 10, check that every closed issue is in `_issues/_closed/` with `## Outcome` and `## Closing evidence`. Also
check that no link points to an old location:

```sh
grep -rn "_issues/\(40\|53\|64\|66\|68\|81\)_" --include=*.md . | grep -v node_modules
```

Every hit for a closed issue must contain `_closed/`. Fix stale links in one bookkeeping commit.

## Final checks

1. `npm run typecheck`, `npm test` and `npm run docs:check` all pass.
2. If job 04 passed, run its smoke test on a fresh `npm run build:pages -- --base noneuclid-fpv` for the worlds
   `cube`, `dodecahedron`, `torus-moduli` and `genus-2-torus`. Use the command form job 04 documents. Record the
   output summary. If job 04 was skipped, use the old script with `node.exe` directly (README rule 7) and say so.
3. Update the queue table in `.agents/jobs/README.md`: every job row 02-10 shows done, done (needs review) or
   skipped.
4. Set this job's `Status:` to `done on <date>.` if every job passed with no uncertainty, otherwise
   `done, needs review on <date>.`. Move this file to `_done/`.
5. Commit the batch report, this file and the README, then push.

## Do not

- Do not run two jobs at once, or start a job before the previous one is committed and green.
- Do not start jobs 11 and later. They are not written for this batch.
- Do not edit a job file's instructions to make it easier. If a job is wrong, follow its intent and record it under
  `### Deviations`.
- Do not change tests that a job does not name, to make the suite pass.
- Do not discard uncommitted work you did not create.

## Batch report template

Create `.agents/jobs/_reports/batch_01_10.md` with:

```markdown
# Batch report: jobs 01-10

Coordinator: <model name>. Started <date> at commit <hash>; finished <date> at commit <hash>.

## Start state
Checks at the start (typecheck / tests / docs:check), and any files that were already modified.

## Jobs
| Job | Result | Commits | Tests (passed/skipped) | Issues closed |
| --- | --- | --- | --- | --- |
| 01 | done (before this batch) | e094b82 | 625/9 | 74 |
| 02 | ... | ... | ... | ... |

## For review
One subsection per job that is not a clean pass: copy its Deviations, Uncertain and Not done items verbatim, and add
what you, the coordinator, noticed (for example a job quoting code that no longer existed).

## Cross-job problems
Conflicts between jobs, repairs you made between jobs, stale links, anything that did not fit one job.

## Final checks
Commands run at the end and their results, including the smoke test summary.
```
