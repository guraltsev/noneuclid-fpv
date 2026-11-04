# Batch report: jobs 48-55 (world engine, clients and modules)

Coordinator: [00_coordinate_jobs_48_55](../00_coordinate_jobs_48_55.md).
Branch: batch-48-55. Batch start: ffde730. Batch end: (pending).

## Start state
- Worktree `../noneuclid-batch-48-55`, branch `batch-48-55` from `design/012-engine-api` (ffde730), tree clean.
- typecheck ok; `npm test` 153 files / 1259 tests pass; docs:check ok; smoke cube,torus-moduli ok.
- `npm run test:release`: 6 files / 13 tests, ALL PASS at start (appCommands.release did not fail on this run).
- test:report: unit 150 files/1136 tests, process 3/18, release 6/9; test lines/src lines 30821/51363; hygiene baseline 0.
- createThreeApp.ts: 1739 lines.

## Summary
| Job | Result | Commits | Review |
| --- | --- | --- | --- |
| 48 | needs review | 067d74d, ea729cd, c375e0e, 2aa6739 | fresh agent; 1 finding (toolObjectRuntimes.ts missing from legacyWorldWriters) + recorded deviations |

## Indicators
| Indicator | Start | After each job, 48 to 55 |
| --- | --- | --- |
| Bench: idle, flow, flow+dependents (median) and idle bytes per step | recorded baseline in job 48: 0.22 / 17.03 / 28.74 us, 743.6 B | 48: 0.05-0.06 / 15.7-17.1 / 31.3-31.9 us, 728 B (check ok x3) |
| Lines in createThreeApp.ts | 1739 | 48: 1741 |
| Lines in `legacyWorldWriters` | (see job 48) | |
| Test files / tests (unit, process, release) | 150/1136, 3/18, 6/9 | 48: 151/1151, 3/18, 6/9 |

## Job 48
Report: see `_done/48_module_bench_change_journal_layers.md`. Baseline commit 067d74d changes nothing under src/. Journal, RuntimeObjectReader, engine/modules layers, legacyWorldWriters (14 files) added.
Gate-out: all green. One bench `--check` failed (flow and flow+dependents) when run right after the full test suite (load noise); three reruns passed. Flow timing is noise-sensitive; the baseline is the slowest of 3 rounds.
Deviations (recorded by job): vitest stubbed for bench; idle-allocation limit is baseline*1.05+16 B (legacy driver allocates ~730 B/step, 16 B kept as target for job 49); baseline = slowest of 3 rounds and check passes if any of 3 rounds is within tolerance; journal generic in record type; src/engine and src/modules not created.
Review findings: (a) `src/render/three/toolObjectRuntimes.ts` writes the registry directly (remove/update, lines ~199-343) but is not in `legacyWorldWriters`, because the detection rule only sees imports of world-objects mutator files. Not fixed (needs a rule change; the list may only shrink). (b) Unrecorded extras: `prefixImportRuleViolations`, `generatedModuleDirectoryRules`, `pathMatchesEntry`; a missing baseline makes `--check` exit 1; baseline `recordedOn` is 2026-11-04 (UTC).
## Job 49
## Job 50
## Job 51
## Job 52
## Job 53
## Job 54
## Job 55

## Manual checks for the maintainer

## Questions for the maintainer
- Job 48: is "legacy writer" meant to include files that call registry writers directly (e.g. toolObjectRuntimes.ts), not only files importing a world-objects mutator? Confirm the 14-file list and the geometry-tool allow-list (portalWord, development, trace, objects).
- Job 48: the 16 B idle-allocation ceiling is not met by the legacy driver (~730 B); accepted as baseline*1.05+16 until job 49.
