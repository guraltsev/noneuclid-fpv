# Batch report: jobs 48-55 (world engine, clients and modules)

Coordinator: [00_coordinate_jobs_48_55](../_done/00_coordinate_jobs_48_55.md).
Branch: batch-48-55. Batch start: ffde730. Batch end: see git log (job 51 reverted; jobs 52-55 skipped).

## Start state
- Worktree `../noneuclid-batch-48-55`, branch `batch-48-55` from `design/012-engine-api` (ffde730), tree clean.
- typecheck ok; `npm test` 153 files / 1259 tests pass; docs:check ok; smoke cube,torus-moduli ok.
- `npm run test:release`: 6 files / 13 tests, ALL PASS at start (appCommands.release did not fail on this run).
- test:report: unit 150 files/1136 tests, process 3/18, release 6/9; test lines/src lines 30821/51363; hygiene baseline 0.
- createThreeApp.ts: 1739 lines.

## Outcome
Batch stopped after job 51: jobs 48-50 done (needs review), job 51 reverted for a bench regression, jobs 52-55 skipped. Issue 84 stays open.

## Summary
| Job | Result | Commits | Review |
| --- | --- | --- | --- |
| 48 | needs review | 067d74d, ea729cd, c375e0e, 2aa6739 | fresh agent; 1 finding (toolObjectRuntimes.ts missing from legacyWorldWriters) + recorded deviations |
| 49 | needs review | 9bb697b, b3c83d2, 9cc6299, 0171312 | fresh agent; findings 1 (id families, order check) repaired; rest recorded |
| 50 | needs review | af0e892, faf0e6d | fresh agent; test-coverage gap and unrecorded deviations repaired; behaviour changes recorded |
| 51 | **FAILED (reverted)** | eccd27c, 35befce, 97190ef, a142b9d, 35e19b6, 869024b; reverted by f6cb09c, fa583ec, 85983d6 and the revert of the rest | fresh agent: no wrong assertions, flagged allocation in the flow step, many unrecorded changes (all recorded in the partial report) |
| 52 | skipped: needs job 51 | - | - |
| 53 | skipped: needs job 52 | - | - |
| 54 | skipped: needs job 53 | - | - |
| 55 | skipped: needs job 54 | - | - |

## Indicators
| Indicator | Start | After each job, 48 to 55 |
| --- | --- | --- |
| Bench: idle, flow, flow+dependents (median) and idle bytes per step | recorded baseline in job 48: 0.22 / 17.03 / 28.74 us, 743.6 B | 48: 0.05-0.06 / 15.7-17.1 / 31.3-31.9 us, 728 B (check ok x3); 49: 0.10 / 16.4-17.8 / 30.6-33.3 us, 640 B (check ok after cooldown; bare engine step+endFrame ~0.3 B); 50: 0.11 / 15.9 / 30.3-32.0 us, 681 B (ok after cooldown; bare engine 0.9 B) |
| Lines in createThreeApp.ts | 1739 | 48: 1741; 49: 1780; 50: 1783 |
| Lines in `legacyWorldWriters` | (see job 48) | |
| Test files / tests (unit, process, release) | 150/1136, 3/18, 6/9 | 48: 151/1151, 3/18, 6/9; 49: 154/1199, 3/18, 7/10; 50: 155/1206, 3/18, 7/11 |

## Final run (batch end)
typecheck ok; `npm test` 155 files / 1332 tests; `npm run test:release` 7 files / 15 tests; docs:check ok; `bench moduleStep --check` ok (idle 0.12 us, flow 17.9 us, flow+dependents 31.3 us, 680 B idle via the legacy driver); test:report: unit 155/1206, process 3/18, release 7/11; createThreeApp.ts 1783 lines.

## Job 48
Report: see `_done/48_module_bench_change_journal_layers.md`. Baseline commit 067d74d changes nothing under src/. Journal, RuntimeObjectReader, engine/modules layers, legacyWorldWriters (14 files) added.
Gate-out: all green. One bench `--check` failed (flow and flow+dependents) when run right after the full test suite (load noise); three reruns passed. Flow timing is noise-sensitive; the baseline is the slowest of 3 rounds.
Deviations (recorded by job): vitest stubbed for bench; idle-allocation limit is baseline*1.05+16 B (legacy driver allocates ~730 B/step, 16 B kept as target for job 49); baseline = slowest of 3 rounds and check passes if any of 3 rounds is within tolerance; journal generic in record type; src/engine and src/modules not created.
Review findings: (a) `src/render/three/toolObjectRuntimes.ts` writes the registry directly (remove/update, lines ~199-343) but is not in `legacyWorldWriters`, because the detection rule only sees imports of world-objects mutator files. Not fixed (needs a rule change; the list may only shrink). (b) Unrecorded extras: `prefixImportRuleViolations`, `generatedModuleDirectoryRules`, `pathMatchesEntry`; a missing baseline makes `--check` exit 1; baseline `recordedOn` is 2026-11-04 (UTC).
## Job 49
Report: `_done/49_world_engine_and_client_session.md`. Engine in src/engine/, appSession -> clientSession, local player = participant "local", palette asks `world/requestTool`, `api.world`, bench idle scene runs an empty engine step.
Gate-out: all green. Bench `--check` fails on flow+dependents (32.7-33.3 us vs limit ~31.6) when run right after the release suite (machine hot); passes after a ~40 s cooldown (30.6-32.0 us). The tolerance sits at the machine's noise floor; consider a wider flow+dependents tolerance or more rounds.
Review findings and outcome: (1) createPairId/createFreeEndId used ids.next("geodesic"), breaking the id families and the includes("free-end") fallback in intervals.ts:839 -> FIXED in 0171312. (2) "cancels an open menu before teleporting home" lost its order check -> RESTORED. (3) Recorded, not fixed: `enter-tool-mode` (geodesicCannonTools.ts 430/457/480/585) still bypasses world/requestTool; phases 3/7 are only comments; no geometryVersion on WorldReadView; api.world.submit validates only `kind`; write-guard option named module-write-guard; throwing handler skips afterStep; per-frame closure from runPhase; two journal records per publishBody in XR; ids/forEachEvent expose functions.
Changed test assertions (all in Report): applyRuntimeCommand (player-pose and serial tests removed, moved to engine tests), scenePaletteCommands, runtimeObjectActions, geometryCommit; ~20 mechanical session->client-session/engine changes.
## Job 50
Report: `_done/50_carry_as_world_attachment.md`. Carry is now `src/modules/carry/` (commands carry/attach, carry/detach, module-only carry/drop; slot carry/offset; "bodies" step phase before simulate ticks); `CarryRecord`/`session.carry` removed; `src/runtime/experience.ts` lists default modules.
Gate-out: all green (1332 unit, 15 release, smoke ok, bench ok after cooldown).
**"Existing carry tests pass with no assertion changed" is met for `expect` lines only.** Fixtures changed: player positions moved in 3 tests ('another face' (0,0)->(-2.4,-3) with new hands, 'drag across two faces' (0,0)->(-2.4,-3), policies 'junction zone' (3.5,2.5)->(4.5,3.5)) because pickup is now refused out of reach (reach limit = pickup range + ~0.67 m leash slack, an invented number); the first two now take a different route; harness `driveCarryTools` steps the engine per call (no time arg = 1000 s step). 9 `applyRuntimeCommand: carrying` tests removed; the Report maps each to a replacement (repair round added missing ones: tool-leave detaches, repeated pickup, vanished object).
Behaviour changes (recorded, not authorized by the job): second pickup refused (was replace); leaving the tool runs the final rebuild; vanished object ends carry; glide budget 20 m/s*dt (reset frame allows zero glide); leash decision runs in the engine module; pickup takes effect one step after click, carry moves after the creature loop.
Deviations from 013: no junction drop (junction zone is a wall since job 47; drop reasons are leash / missing); bodies phase, writesCoreKinds and carry/drop are additions; `modules/carry/` is exempted in docs rule from "reach geodesic only through the geodesic model"; legacyWorldWriters could not shrink.
Not done: release scenario and in-app manual check of carrying through a portal (public API cannot place an emitter; job 45 blocked).
## Job 51
**Why it failed.** The bench gate `npm run bench -- moduleStep --check` stayed red after two repair rounds. The first review found a real regression: at a142b9d, flow was 19.3-19.8 us and flow+dependents 34.5-36.1 us (baseline 17.03 / 28.74, limits +10%), failing 5/5, while job 50's commit ee65c50 passed under the same conditions (flow ~17.4, flow+dependents 29.8-32.4). Repairs (allocation-free `isTied`, no closure in the stale check, array-free line-search slope) brought flow back to job 50's level, but an A/B run of 869024b against ee65c50 (3 alternating runs each, 30 s cooldowns) gave flow+dependents 32.9 / 33.2 / 33.3 us for 869024b (FAILED 3/3) against 31.8 / 31.4 / 29.8 us for ee65c50 (ok 3/3): a consistent ~5% cost, about 1.5 us per step, that the job's author could not locate. Per the coordinator rule (red after one repair attempt: revert, mark skipped, stop), the commits eccd27c..869024b were reverted with `git revert` (history kept). After the revert the tree is identical to ee65c50 and green (1332 unit tests, bench ok).
What was done is in `_reports/job_51_partial_report.md` (the job's own Report as it stood at the end, including all deviations). Everything else passed at 869024b: typecheck, 1360 unit tests, docs:check, smoke, 15 release tests; the rename commit eccd27c passed `npm test` alone (1332 tests, same count, no assertion values changed).
**Recommendation to the maintainer:** the regression is small and at the tolerance edge (flow+dependents limit is +10% of a baseline that was itself the slowest of 3 rounds on a noisy machine). Re-apply the commits (`git revert` the reverts, or cherry-pick eccd27c..869024b) and either accept ~5% on flow+dependents with a re-recorded baseline, or find the remaining cost; the suspect is the end-node/stale logic per vertex in the flow step or the measured-length/protractor refresh in the bench's legacyStep. Jobs 52-55 were not started.
## Job 52 to 55
Skipped (stop rule: each job needs the one before). Their files stay in `.agents/jobs/` with `Status: skipped`.

## Manual checks for the maintainer
- Job 50: carry an emitter through a portal in the app (pick up, drag across faces, release, leash release, leave tool by another route); not done, no API to place an emitter.

## Questions for the maintainer
- Job 51 (reverted): accept the ~5% flow+dependents cost (re-record the bench baseline) and re-apply eccd27c..869024b? Or should the 10% flow+dependents tolerance be widened/measured with more rounds first? The bench flakes on this machine even on unchanged code (job 48, 49, 50 also saw spurious failures right after heavy runs).
- Job 50: accept the invented reach limit (pickup range + 0.67 m) and "second pickup refused"? Both changed user-visible carry behaviour and forced test position changes.
- Bench flow+dependents tolerance (10%) sits at the machine's noise floor (30.3-33.3 us vs limit ~31.6 us); `--check` flakes when the machine is hot. Widen it or add rounds?
- Job 48: is "legacy writer" meant to include files that call registry writers directly (e.g. toolObjectRuntimes.ts), not only files importing a world-objects mutator? Confirm the 14-file list and the geometry-tool allow-list (portalWord, development, trace, objects).
- Job 48: the 16 B idle-allocation ceiling is not met by the legacy driver (~730 B); accepted as baseline*1.05+16 until job 49.
