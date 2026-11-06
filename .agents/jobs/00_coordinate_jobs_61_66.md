# Job 00 - Coordinate jobs 61-66 (time, emitters, public API, measurement tools and flags)

Status: started 2026-11-05 at the maintainer's word.
Coordinates: jobs [61](_done/61_simulation_ticks.md), [62](_done/62_client_write_check.md), [63](_done/63_geodesic_emitters_module.md),
[64](_done/64_emitter_edits_and_length.md), [65](_done/65_module_public_api.md) and [66](_done/66_measurement_tools_and_flags.md), which implement
the next batch of design [013](../../_docs/design/013-world-engine-clients-and-modules.md), section 16.

## Goal

Carry out jobs 61 to 66 one at a time, in that order, on one branch that stays green. Have each reviewed by a second agent with a
fresh context. Never stop to ask. At the end, write one batch report that a more capable model can review.

## Decisions

- Follow [the coordinator of jobs 51 to 60](_done/00_coordinate_jobs_51_60.md) for the steps of each job (gate in, execute, gate out,
  review, close) and for the report template, except as stated here.
- **One branch, one worktree:** `batch-61-66` in `.worktrees/batch-61-66`, from `design/012-engine-api`. Link `node_modules` as a
  junction. Remove the junction by hand before anyone removes the worktree: it points into the main checkout.
- **No push, no merge.** The maintainer reviews the branch.
- Design 013 is the specification. A design question goes in the batch report; do not edit 012, 013 or 014.
- **Timing is an alarm, not a gate.** The exact counters of `npm run bench -- moduleStep --check` are the gate. When timing fires, run
  `npm run bench:ab -- <start hash>`, and only when both sides have the same `moduleStep.bench.ts`: a bench file with more scenes
  changes the numbers of the others.
- Run the bench when nothing else is loading the machine: straight after the release tier, it reads about a third slow.

## Order

| Order | Job | Needs | Notes |
| --- | --- | --- | --- |
| 1 | 61 | - | Touches the frame loop: run smoke after each change to `createThreeApp.ts`. |
| 2 | 62 | - | Makes the migration measurable before the emitters move. |
| 3 | 63 | 61, 62 | The rename commit is large and must stay behaviour-free. |
| 4 | 64 | 63 | Closes issues 88, 89, 93. |
| 5 | 65 | 63 | Writes the release scenarios earlier batches could not. |
| 6 | 66 | 64 | Closes issue 92. |

Stop rule: if a job fails, mark the jobs that need it `skipped on <date>: needs job NN.` and go to the batch report.

## Gates specific to these jobs

- **61:** the `flow` and `flow+dependents` counters may change only as the job says.
- **63:** the rename commit passes `npm test` alone, with only names changed.
- **64:** `grep -rn "enter-tool-mode" src tests` is empty; the carry tests' assertions on motion are unchanged; carry and aim run on the fast channel, with no `dispatch` on their per-frame path.
- **Every job:** the count of direct client writes from job 62's check only falls.
