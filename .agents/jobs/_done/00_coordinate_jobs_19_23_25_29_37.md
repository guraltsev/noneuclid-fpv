# Job 00 - Coordinate jobs 37, 38, 25-29 and 19-23 in four phases

Status: done, needs review on 2026-10-30 (all twelve jobs done, each needing review; see `_reports/batch_19_23_25_29_37.md`).
Written on 2026-10-29. Coordinates: jobs [37](37_object_owners_and_place_at.md),
[25](25_split_geodesic_cannon_modules.md), [26](26_exact_curve_shortening.md),
[27](27_geodesic_rebuild_performance.md), [28](28_frame_snapshot_instance_sync.md),
[38](38_draw_assets_from_registry.md), [29](29_frame_loop_allocation_and_draw_calls.md), [20](20_exact_static_cull.md),
[21](21_per_frame_visibility_funnel.md), [22](22_gpu_portal_clip_planes.md),
[19](19_vr_palette_and_in_headset_debug.md) and [23](23_stereo_split_root_correctness.md). Resolves no issue itself.

## Goal

Carry out twelve jobs one at a time, grouped into four **phases**. Keep `main` green: every pushed commit passes
`npm run typecheck`, `npm test` and `npm run docs:check`. Never stop to ask. When a job cannot be finished, record it
and move on to the next job that does not depend on it.

**Every phase ends with its own phase commit and tag** (see "Closing a phase"). These are the rollback points: the
maintainer must be able to undo phase 3 alone, or everything after phase 1, with one `git revert` range. Never start a
phase before the previous phase commit is pushed.

You are the coordinator. You do not invent work. Each job file says what to do. Your job is order, gates, phase
boundaries, bookkeeping and the batch report.

## Before you start

1. Read [README.md](README.md), especially "Rules for the implementing model" and "Report". They apply to every job.
2. Read this whole file. Then skim "Goal", "Depends on", "Decisions" and the Part/commit structure of all twelve jobs
   once, so you know which later job relies on which earlier result.
3. Check the starting state:

   ```sh
   git status --short          # see note below
   git log --oneline -1        # note the hash: this is the batch start (expected 0b468e1 or a later bookkeeping commit)
   npm run typecheck
   npm test                    # on 2026-10-29: 116 files, 883 passed, 8 skipped, about 66 s
   npm run docs:check
   npm run build
   npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus   # expected: SMOKE OK (4 page(s))
   ```

   On 2026-10-29 the tree had uncommitted maintainer changes in `.githooks/pre-push`, `_docs/DEPLOYMENT.md`,
   `_docs/DEVELOPMENT.md` and `scripts/setup-git-hooks.mjs`. If they (or any other files) are still modified: **do not
   discard, stage or commit them.** Record them under "Start state" and stage only the files each job changes
   (`git add <paths>`, never `git add -A` or `git commit -a`). Note that the pre-push hook is one of these files; if
   `git push` fails inside the hook for a reason unrelated to the job, record the hook output and push nothing further
   until the checks pass when run by hand.
4. Create the batch report `.agents/jobs/_reports/batch_19_23_25_29_37.md` from the template at the end of this file.
   Fill "Start state".
5. Tag the start: `git tag batch3-start` (local; push it with `git push origin batch3-start`).

## Phases, order and dependencies

Run the jobs in exactly this order. "Needs" means the job must be **done** (in `_done/`, either done status) before it
starts.

| Phase | Order | Job | Needs | Notes |
| --- | --- | --- | --- | --- |
| 1 | 1 | 37 | - | Objects own their position; `placeAt`. Small and self-contained; first so jobs 28/29 and the later restructuring jobs (31, 33) work from clean object boundaries. |
| 2 | 2 | 25 | - | Mechanical split of `geodesicCannon.ts` into `src/world-objects/geodesic/` (Parts A-E). Behaviour-preserving. The cannon tool reducer is **not** in scope (left for job 31/33). |
| 2 | 3 | 26 | 25 | Exact curve shortening (sleeve/funnel), Parts A-E; Part E deletes the legacy connection code. |
| 2 | 4 | 27 | 25, 26 | Per-frame cost of geodesic rebuilds, Parts A-C; benchmark `tests/world-objects/geodesic/performance.test.ts`. One intended behaviour change: a rebuilt geodesic keeps its display number. |
| 3 | 5 | 28 | 37 | Frame snapshot; instance sync once per frame against the rendered root; registry version counter (must also be bumped by job 37's owner publishers). |
| 3 | 6 | 38 | 37, 28 | Static assets drawn from their registry record (completes job 37 for asset models). Needs job 28's per-object record reuse so static assets cost nothing per frame. |
| 3 | 7 | 29 | 28 | Frame-loop allocation and per-object draw calls. Sees assets as ordinary runtime objects after job 38. |
| 4 | 8 | 20 | - | Exact static cull by oriented line stabbing. |
| 4 | 9 | 21 | 20 | Per-frame visibility traversal and funnel. |
| 4 | 10 | 22 | 21 | GPU portal clipping with clip planes. |
| 4 | 11 | 19 | - | XR input defects and the in-headset debug panel. |
| 4 | 12 | 23 | 19 | Stereo split roots; its headset checks use job 19's readout. |

Do not start any other job (18, 24, 30-35). Jobs 31 and 33 are planned for after this batch.

Skip rules (a skipped job's dependants are skipped; nothing else is):

- 37 skipped: skip 28, 38 and 29 (28 needs the owner publishers to bump its registry version).
- 25 skipped: skip 26 and 27. 26 skipped: skip 27.
- 28 skipped: skip 38 and 29.
- 38 skipped: 29 still runs.
- 20 skipped: skip 21 and 22. 21 skipped: skip 22.
- 19 skipped: 23 still runs, but its headset checks are recorded as not run and 23 ends `done, needs review`.
- A job that ends `done, needs review` counts as done for its dependants.

## Files several jobs touch

Line numbers in every job file are for commit `0b468e1`. Earlier jobs in this batch shift them. Always search for the
quoted name or code rather than trusting a line number. If the code a job quotes is gone or different, follow the job's
intent and record it under `### Deviations`.

| File | Jobs | Watch out for |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 37, 25, 26, 28, 38, 29, 21, 22, 19, 23 | Very large. Edit only the functions the job names. Declaration order matters at runtime: a `const` read by setup code above its declaration crashes only in the browser (the job 17 temporal-dead-zone crash, fixed in `1fa9ebc`). This is why the smoke test is part of every gate. |
| `src/world-objects/runtimeObjectRegistry.ts` | 37, 26, 27, 28, 38 | 37 adds ownership and one private write helper; 26 adds the `geodesic-corner` kind; 27 adds indexes by kind and by geodesic, which must be maintained inside 37's write helper (so owner publishers keep them right); 28 adds a version counter that **every** write path, including 37's publishers, must bump; 38 makes every asset a portal-renderable record. |
| `scripts/docs/lib.mjs`, `_docs` references `geodesicCannon.ts#symbol` | 25, 26, 27 | 25 adds a per-file import rule and moves symbols; docs:check validates `file#symbol` links, so every part of 25 updates them. 25 Part E deletes the `geodesicCannon.ts` facade; later jobs import from `src/world-objects/geodesic/`. |
| Legacy geodesic connection code and the 8 skipped geodesic tests | 25, 26 | 25 isolates it in `geodesic/legacyConnection.ts`; 26 Part E deletes it. |
| `src/world-objects/worldObjectOwner.ts` | 37, 38 | 37 creates it; 38 adds `reset` to `PlainWorldObject` (not to `WorldObjectOwner`). |
| `buildCellMesh.ts`, `cellRenderArchetypes.ts`, `runtimeObjectInstanceSync.ts` | 38, 29, 20, 21 | 38 removes decorations and the `static-object` kind from cell meshes and adds asset roots to the runtime-object path that 28 created; later jobs must not reintroduce assets into cell archetypes. |
| `src/world-objects/geodesicCannon.ts`, `src/render/three/geodesicCannonTools.ts` | 25, 26, 27 | 25 moves code into `src/world-objects/geodesic/` behind a facade; 26 and 27 edit the new modules, not the facade. |
| `tests/world-objects/geodesicCannon.test.ts` | 25, 26, 27 | 25 splits it to mirror the new modules. Later jobs add tests to the split files. |
| `src/render/three/renderPortalInstances.ts`, `runtimeObjectGhostRecords.ts` | 28, 29, 21, 22, 23 | 28/29 change per-frame sync and allocation; 21-23 change which paths are visible and how they are clipped. |
| Static cull and path tables (`staticPortalPathCull.ts` and callers) | 20, 21 | 21 reuses 20's oriented-portal representation. |
| Portal clip shader / clip uniforms | 22, 23 | 22 switches to plane rows (texture; `gl_ClipDistance` when available) and provides always-inside / always-outside rows; 23 must use those for split-root slots (an all-zero row **accepts** every fragment). 22 also sizes clip slots `maxVisiblePaths × eyes`, which covers 23's clip-slot union item; only 23's archetype-capacity part remains. Check both at 23's gate-in. |
| `staticPortalPathCull.ts`, new `orientedPortal.ts`, `staticLineCone.ts`, `portalFunnel.ts` | 20, 21 (and later 24) | 21 reuses 20's `OrientedPortalSegment` and `PortalRenderPath.newestPortalInRoot`. |
| `transformVisiblePortalResultToRenderFrame`, archetype `onBeforeRender` hooks, viewport scratch | 28, 29, 21, 22 | 21/22 must keep 28/29's changes (their jobs say so). 29 (phase 3) optimises the clip-viewport function; 22 (phase 4) may later delete it. That is expected, not a conflict. |
| `runtimeObjectGhostRecords.ts` dedupe | 28, 29, 23 | 23 groups job 17's dedupe by root so split-root clipping does not hide objects in one eye. |
| XR input and palette files (`xrControls.ts`, `xrScenePaletteInput.ts`, `vrPaletteLibraryAdapter.ts`, `scenePaletteController.ts`) | 19, 29 | 29 replaces per-frame palette serialisation with a version counter; 19 then fixes XR input defects in the same files. |
| Renderer debug state (`DebugOverlayState` and the new XR debug panel) | 19, 23 | 19 shows the stereo path counts that 23 adds; field names are fixed in both jobs. |
| `_docs/MATHEMATICAL_MODEL.md`, `_docs/ARCHITECTURE.md` | 37, 26, 20, 21 | Each job edits its own paragraphs; do not rewrite others. |
| `.agents/jobs/README.md` (queue table) | all | Update only the row of the job just finished (and this coordinator's row at the end). |

## For each job

1. **Gate in.**
   - The tree has no changes apart from the start-state files, and the job's "Needs" are in `_done/`.
   - If a need is missing, mark the job **skipped**: set `Status: skipped on <date>: needs job NN.`, leave the file in
     place, add the row to the batch report, and go to the next job.
2. **Start.** Set the job's `Status: in progress.` (do not commit this alone). Record the current commit hash as the
   job's start hash in the batch report.
3. **Execute** the job file exactly, following the README rules. If you can delegate to a sub-agent, give one job to
   one sub-agent at a time, never two in parallel (they share files). Use this prompt, unchanged:

   > Carry out `.agents/jobs/<file>` in this repository. First read `.agents/jobs/README.md` ("Rules for the
   > implementing model" and "Report") and follow them. Never stop to ask: make your best choice and record anything
   > uncertain in the job's `## Report`. Do only this job. Stage only the files you changed (never `git add -A`; the
   > tree may hold unrelated maintainer edits). Commit once per Part as the job says, with messages that start
   > `Job NN Part X:` (or `Job NN:` for a job without parts). Finish with typecheck, tests, docs:check, build and the
   > smoke test, the Report, and the job's "Done when" checklist. Do not push. Reply with the commit hashes and the
   > Report.

   If you cannot delegate, do the job yourself in the same way.
4. **Gate out, after every commit that ends a Part** (and after the job's last commit):

   ```sh
   npm run typecheck && npm test && npm run docs:check
   npm run build && npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus
   git status --short
   ```

   - All green and no unexpected files: `git push`. The pre-push hook runs the checks again. This is a **pass** for
     that part.
   - A single smoke failure right after a checkout or build ("loading screen still present") has been a flake before:
     rebuild and rerun once before treating it as red.
   - Red: give the part one repair attempt, within the job's scope. If it is still red, undo that part without losing
     history: `git revert --no-edit <part-start-hash>..HEAD`. Check that the suite is green again. Do not start the
     job's later parts. If at least one part passed, the job ends `done, needs review`; if none did, set
     `Status: skipped on <date>: could not be made green; see batch report.`. Keep the partial Report (move it into
     the batch report if the revert removed it). Commit and push. Apply the skip rules.
   - Never use `git reset --hard`, `git push --force`, `git commit --amend` on pushed commits, or `--no-verify`.
5. **Finish the job.** Append the Report, set the status, move the file to `_done/`, update its README queue row, close
   or annotate its issues (see "Issue bookkeeping"), and commit this as `Job NN: report and bookkeeping`. Push.
6. **Record** the job's row in the batch report: status, commit hashes (one per part), test count, `npm test`
   duration, and every item from its `### Deviations`, `### Uncertain` and `### Not done` (copy them; do not summarise
   them away).

## Closing a phase

After the last job of a phase (whether it passed, needs review or was skipped):

1. Run the full check set on a clean build:

   ```sh
   npm run typecheck && npm test && npm run docs:check
   npm run build && npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus
   ```

   If anything is red here although each job was green, the jobs conflict. Repair once, in its own commit
   (`Phase N: repair <what>`); if that fails, revert the phase's last job (as in "Gate out") and record it under
   "Cross-job problems".
2. Fill the phase section of the batch report: jobs, results, first and last commit of the phase, checks.
3. Make the **phase commit**. It contains the batch report update (and nothing that changes behaviour). Use exactly
   this message form:

   ```text
   Phase N complete: <phase title> (jobs A, B, C)

   Job A: done. Job B: done, needs review (see batch report). Job C: skipped: <reason>.
   Rollback: git revert --no-edit batch3-phase-<N-1>..batch3-phase-N

   Co-Authored-By: <the co-author line the repository uses>
   ```

   For phase 1 the rollback range starts at `batch3-start`.
4. Tag it and push both: `git tag batch3-phase-N`, `git push`, `git push origin batch3-phase-N`.
5. Only now start the next phase.

| Phase | Title for the commit | Jobs | Tag |
| --- | --- | --- | --- |
| 1 | Object owners and placeAt | 37 | `batch3-phase-1` |
| 2 | Geodesic cannon split, exact curve shortening, rebuild cost | 25, 26, 27 | `batch3-phase-2` |
| 3 | Frame-loop sync, assets drawn from the registry, allocation | 28, 38, 29 | `batch3-phase-3` |
| 4 | Visibility culling and clipping; VR palette and stereo roots | 20, 21, 22, 19, 23 | `batch3-phase-4` |

A phase in which every job was skipped still gets its phase commit and tag, so the tags always exist in order.

Rollback reference for the maintainer (write it into the batch report as well):

```sh
git revert --no-edit batch3-phase-2..batch3-phase-3   # undo phase 3 only
git revert --no-edit batch3-phase-1..HEAD             # undo everything after phase 1
```

Phase 4 contains two independent chains. Its job commits (`Job 20 Part A: ...`, `Job 19 Part A: ...`) let the
maintainer revert one chain alone if needed; list each chain's first and last commit in the phase section.

## Manual checks

Jobs 26, 29, 22, 19 and 23 may list manual browser or headset checks. If you cannot run a browser or headset, the job
writes them under `### Manual checks not run` in its Report. That subsection does **not** count as `### Not done` or
`### Uncertain`, except where the job's own text says otherwise (job 23: issue 59 stays open until the headset check
passes, so it ends `done, needs review`). Follow the job. Collect every unrun manual check in one list in the batch
report ("Manual checks for the maintainer"), with job number and exact steps.

The automated smoke test is **not** a manual check: run it.

## Issue bookkeeping

The jobs carry their own closing instructions. Check that they happened:

| Issue | Closed when | Closed by |
| --- | --- | --- |
| 67 | Job 26 done with no uncertainty. | Job 26 |
| 70 | Job 27 done with no uncertainty. | Job 27 |
| 71 | Job 28 done with no uncertainty. | Job 28 |
| 75 | Job 29 done with no uncertainty. | Job 29 |
| 56 | Job 20 done with no uncertainty. | Job 20 |
| 57 | Job 21 done with no uncertainty. | Job 21 |
| 58 | Job 22 done with no uncertainty. | Job 22 |
| 59 | Job 23 done, including its headset check. | Job 23 |

Jobs 37, 25 and 19 resolve no open issue. Also add a status line to issue 50 (the audit index) for each issue closed.
A job marked `done, needs review` does **not** close its issue: the issue gets a one-line pointer to the job's Report.

After the last phase, check that every closed issue is in `_issues/_closed/` with `## Outcome` and `## Closing
evidence`, and that no link points to an old location:

```sh
grep -rn "_issues/\(56\|57\|58\|59\|67\|70\|71\|75\)_" --include=*.md . | grep -v node_modules
```

Every hit for a closed issue must contain `_closed/`. Fix stale links in one bookkeeping commit **before** the phase 4
commit, so the phase 4 commit stays the last commit of the batch.

## Final checks (part of closing phase 4)

1. `npm run typecheck`, `npm test` and `npm run docs:check` pass. Record the `npm test` duration and compare it with
   the start; flag total growth above 30 s in "Cross-job problems".
2. `npm run test:coverage` passes. Record the line coverage of `src/world-objects/geodesic` and `src/render/three`.
3. `npm run build` and the four-world smoke test pass. Record the summary line.
4. Record job 27's benchmark result and job 20's depth-10 build time (before and after), as the jobs describe.
5. Update the queue table in `.agents/jobs/README.md`: every row of this batch shows done, done (needs review) or
   skipped; add this coordinator's row.
6. Set this job's `Status:` to `done on <date>.` if every job passed with no uncertainty, otherwise
   `done, needs review on <date>.`. Move this file to `_done/`. These edits go into the phase 4 commit.

## Do not

- Do not run two jobs at once, or start a job before the previous one is committed, green and pushed.
- Do not start a phase before the previous phase commit and tag are pushed.
- Do not mix two jobs, or a job and a phase commit, in one commit.
- Do not start jobs 18, 24 or 30-35.
- Do not edit a job file's instructions to make it easier. If a job is wrong, follow its intent and record it under
  `### Deviations`.
- Do not change tests that a job does not name to make the suite pass.
- Do not discard, stage or commit uncommitted work you did not create.

## Batch report template

Create `.agents/jobs/_reports/batch_19_23_25_29_37.md` with:

```markdown
# Batch report: jobs 37, 25-29, 19-23 (four phases)

Coordinator: <model name>. Started <date> at commit <hash> (tag batch3-start); finished <date> at commit <hash>.

## Start state
Checks at the start (typecheck / tests / docs:check / build / smoke, test duration), and files already modified.

## Phase 1: Object owners and placeAt
| Job | Result | Commits (per part) | Tests (passed/skipped) | Test time | Issues closed |
| --- | --- | --- | --- | --- | --- |
Phase range: batch3-start..batch3-phase-1 (<first hash>..<phase commit hash>). Phase checks: ...

## Phase 2: Geodesic cannon split, exact curve shortening, rebuild cost
(same table; jobs 25, 26, 27; benchmark result of job 27)

## Phase 3: Frame-loop sync, assets drawn from the registry, allocation
(same table; jobs 28, 38, 29)

## Phase 4: Visibility culling and clipping; VR palette and stereo roots
(same table; jobs 20, 21, 22, 19, 23; first and last commit of chain 20-22 and of chain 19-23)

## Rollback
The tag list with hashes, and the revert commands from "Closing a phase".

## For review
One subsection per job that is not a clean pass: copy its Deviations, Uncertain and Not done items verbatim, and add
what you, the coordinator, noticed.

## Manual checks for the maintainer
Every manual browser or headset check that was not run, with the job number and the exact steps from the job.

## Cross-job problems
Conflicts between jobs, repairs between jobs, stale links, anything that did not fit one job.

## Final checks
Commands run at the end and their results, including coverage, benchmark, build time and the smoke summary.
```
