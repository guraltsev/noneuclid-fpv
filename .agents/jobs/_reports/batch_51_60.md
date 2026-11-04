# Batch report: jobs 51-60 (derived state, then the geodesic and flow modules)

Coordinator: [00_coordinate_jobs_51_60](../00_coordinate_jobs_51_60.md).
Continues: [batch_48_55](batch_48_55.md).
Branch: batch-48-55. Batch start: 5d7b803. Batch end: (open).

## Start state
Worktree `../noneuclid-batch-48-55`, branch batch-48-55. The queued files (design 014, issue 86, jobs 51-60) were uncommitted and
were committed as 5d7b803 "Queue jobs 51 to 60 on design 014". Tree clean afterwards.
Baseline: typecheck ok; `npm test` 158 files / 1332 tests passed (the job text said 155 files; 158 counts the process files too);
docs:check ok; smoke cube,torus-moduli ok; test:release 7 files / 15 tests all passed (appCommands.release did not fail at the start);
test:report: unit 155 files / 1206 tests, process 3 / 18, release 7 / 11, hygiene 0.

## Summary
| Job | Result | Commits | Review |
| --- | --- | --- | --- |

## Indicators
| Indicator | Start | After each job (51, 56, 57, 58, 59, 60, 52, 53, 54, 55) |
| --- | --- | --- |
| Test files / tests (unit, process, release) | 155/1206, 3/18, 7/11 | |

## Manual checks for the maintainer

## Questions for the maintainer
