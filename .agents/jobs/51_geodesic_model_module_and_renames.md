# Job 51 - Restore the geodesic model module and abolish the "moving" state

Status: in progress.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 2, 5, 6), part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

Job 51 was written, reverted over a bench result, and is good code. Put it back exactly, then make the one change that removes
the cost: a tied arc no longer has a "moving" display state, so the segment display state stops asking whether an arc is tied.

## Depends on

Job 50. Run this job **first** in the batch, before jobs 56 to 60.

## Before you start

- Work in the batch worktree on the current branch. Ignore any other worktree instruction.
- Read design 014 sections 1.1 and 2 (D2), and [the partial report](_reports/job_51_partial_report.md): it lists everything the
  restored code does.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

The code tree at the start of this job equals commit `ee65c50`, because the job 51 commits were reverted. So the difference
`ee65c50..869024b`, without `.agents`, applies with no conflict. This was tested: the result equals `869024b` exactly outside
`.agents`. Do **not** use `git cherry-pick`: it conflicts on the job file's status line.

Job 51 replaced the stored `motionState` with `isTied`, and `resolveDerivedSegmentConnectionState` calls `isTied` on every arc
rebuild. That is 477 full scans of the arcs in one flow run. D2 (**Agreed** by the maintainer) deletes the "moving" colour and
the "moving" aiming rule, so that call has no reason to exist.

## Decisions

- Everything under "Decisions" of the old job stands, and it is in the restored code. The ones that change:
- A segment's `connectionState` is `"open" | "connected"`. `"connected"` means both ends of the **arc** are on emitters, today's
  rule. A tied arc is drawn open. Do not add a curve-level rule (014 section 10, question 8).
- The aim picker skips no segment for its display state.
- The tie-detach selection highlight stays.
- `pair.state` of `CurveShorteningPairObject` keeps its value `"moving"` until job 53 deletes the pair. It is not a display state.
- `isTied` stays, for its other callers (`cannon.ts`, `carryEnd.ts`, `geodesicDebugDumps.ts`, the module query). Do not optimise it:
  job 59 does that.

## Steps

1. **Restore the code.** In the batch worktree, with a clean tree:

   ```sh
   git diff --binary ee65c50 869024b -- . ':(exclude).agents' > ../job51.patch
   git apply --index ../job51.patch
   git diff --cached --stat 869024b -- . ':(exclude).agents'
   ```

   The last command must print nothing. Commit: "Re-apply job 51 (eccd27c..869024b, without .agents)". Delete `../job51.patch`. Run
   `npm run typecheck` and `npm test`: expect 161 files, 1360 tests, all green. If not, stop and record it.

2. **`src/world-objects/geodesic/segments.ts`.** In `resolveDerivedSegmentConnectionState`, delete the `isTied` branch, change the
   return type to `"open" | "connected"`, drop the `isTied` import if unused, and fix the comment above the function.

3. **`src/world-objects/geodesic/objects.ts`.** `connectionState?: "open" | "connected"`; fix its comment.

4. **`src/interaction/aimTarget.ts`.** Delete the block that skips a segment with `connectionState === "moving"`.

5. **`src/render/three/geodesicCannonRenderer.ts`.** Delete the moving branch of the archetype choice, the constant
   `geodesicSegmentMovingArchetypeKey`, its archetype entry, and anything only it used (a colour, a material). Fix the header
   comment ("selection beats moving, which beats connected") and the comment at the choice.

6. **Tests.**
   - `tests/render/geodesicCannonRenderer.test.ts`: delete the test "publishes moving geodesic segments with the orange archetype"
     and the import.
   - Add to `tests/interaction/aimTarget.test.ts` a test that a segment of a tied arc can be aimed at (nothing tested the old skip).
   - Add to `tests/world-objects/geodesic/segments.test.ts` (create it if missing) a test that a tied arc's segments are `"open"`,
     and that an arc with an emitter at each end is `"connected"`.
   - Any other test that expects display state `"moving"`: change it to `"open"` and record it under `### Deviations`.

7. **Docs.** `_docs/MATHEMATICAL_MODEL.md` line about "the display state `"moving"` (drawn in the moving colour)": remove the
   sentence. Touch nothing else in that file. Commit: "Abolish the moving display state and aiming rule (design 014 D2)".

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check` (run `npm run docs:generate` if it reports stale generated files),
`npm run smoke -- --world cube,torus-moduli`, `npm run test:release`, `npm run bench -- moduleStep --check`.

**The bench in this job.** Counters do not exist yet. If `--check` fails on timing, wait 60 seconds and rerun, up to three times.
If it is still red, record the numbers under `### Checks` and **continue**: job 56 compares this commit with `ee65c50` by A/B and
decides. A timing failure alone does not fail this job.

## Do not

- Do not re-record the bench baseline.
- Do not hand-edit the restored files beyond the steps above, and do not try to make `isTied` faster.
- Do not cherry-pick, and do not `git revert` the reverts.
- Do not move the flow here; job 53 does that.

## Done when

- `grep -rn "geodesic-interval\|free-geodesic-end\|\"geodesic-segment\"\|geodesic-intersection" src tests` is empty.
- `grep -rn "motionState\|isGeodesicLocked" src tests` is empty.
- `grep -n "isTied" src/world-objects/geodesic/segments.ts` is empty.
- `grep -rn "connectionState === \"moving\"\|MovingArchetype" src tests` is empty.
- All checks are green, apart from timing as described above.

## Report

The first attempt is in [job_51_partial_report.md](_reports/job_51_partial_report.md); its `### Deviations` and `### Uncertain` still
apply to the restored code. Add this attempt's report below it, as the README describes.

### Second attempt (restore and abolish "moving")

#### Done
- Commit 2a52924 re-applies `ee65c50..869024b` (without `.agents`) with `git apply --index`. `git diff --cached --stat 869024b` printed only `_docs/design/014-...md` and issue 86, which post-date 869024b; no source difference. Baseline after it: typecheck clean, 161 files, 1360 tests green.
- Commit 64e14f1 (D2): `resolveDerivedSegmentConnectionState` returns `"open" | "connected"` (no `isTied`, import dropped); `connectionState?: "open" | "connected"`; the aim picker no longer skips segments; the renderer lost the moving archetype key, its source (colour 0xf59e0b) and branch; comments fixed; the MATHEMATICAL_MODEL.md sentence removed; generated docs regenerated.
- Tests: removed the "moving ... orange archetype" renderer test; added an aim test for a tied arc's segment; created `tests/world-objects/geodesic/segments.test.ts` (tied arc is `"open"`, emitter-to-emitter arc is `"connected"`).

#### Deviations
- None to existing expectations beyond deleting the renderer test the job names (and the word "moving" in that test file's header comment).

#### Uncertain
- The job's first "Done when" grep matches archetype-key strings such as `"geodesic-segment:ribbon-cross"` and mesh names like `selectable-hitbox:geodesic-segment`, plus a comment in `src/interaction/aimTarget.ts`; none is an object kind. No object kind matches. The second grep also finds nothing in code, but `src/modules/geodesicModel/api.ts:43` has a comment mentioning `motionState: "moving"` (restored text; the grep for `motionState` in the job is strictly non-empty because of this one comment). I left it, as the steps do not name it.
- `isTied` was left unoptimised as ordered. `pair.state === "moving"` is unchanged.

#### Not done
- Nothing skipped. The bench timing check is red (see Checks); job 56 decides.

#### Checks
- `npm run typecheck`: clean. `npm test`: 162 files, 1362 tests green (after `docs:generate`; before it, the documentation test reported the two stale generated files). `npm run docs:check`: all ok. `npm run smoke -- --world cube,torus-moduli`: SMOKE OK (2 pages). `npm run test:release`: 7 files, 15 tests green.
- `npm run bench -- moduleStep --check`, three runs 60 s apart, all `check: FAILED (flow+dependents step time, flow step time)`: flow 19.42, 19.58, 23.40 us/step; flow+dependents 36.94, 38.09, 41.71 us/step; idle 0.13 to 0.15 us/step; idle allocation 640 bytes/step. Recorded, not fixed; the baseline was not re-recorded.
