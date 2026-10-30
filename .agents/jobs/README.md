# Jobs

A **job** is a work order: carry out this change, in this scope, and verify it like this. An **issue**
(`_issues/`) describes something that is wrong: the defect, the evidence and the impact. Small fixes and mitigation
sketches may live in an issue; anything that is mainly "carry out this change" is a job.

- Jobs are numbered in the order they should be carried out. Take the lowest-numbered queued job whose dependencies
  are done.
- A coordinator job (`00_coordinate_...`) runs a batch of jobs in order, gates each one on green checks, and writes a
  batch report to `_reports/`. When a coordinator job covers the next jobs, start with it.
- Each job names the issues it resolves. When a job lands, close those issues (move them to `_issues/_closed/` with an
  Outcome and Closing evidence) and move the job to `_done/` with `Status: done on <date>` and the commit hashes.
- A job that turns out to be wrong is edited or split, not silently skipped. Renumber only when the order changes.
- Every job ends with verification; `git push` runs `npm run typecheck` and `npm test` through the pre-push hook.

## Rules for the implementing model

Jobs are written to be carried out by a model working alone. A more capable model reviews the reports afterwards.

1. **Never stop to ask.** Every decision a job needs is recorded under its `## Decisions`. If something is still
   unclear, make your best choice, carry on, and record it in the report under `### Uncertain`.
2. **One job at a time,** in queue order. Do only what the job says. If you notice something else that is wrong, write
   it in the report (`### Not done` or `### Uncertain`); do not fix it.
3. **Baseline first.** Run `npm run typecheck` and `npm test` before changing anything. If the baseline fails, record
   the failure under `### Checks` and continue only if the failure is unrelated to the job.
4. **Small steps.** After each step, run the tests named for it (`npx vitest run <file>`). Do not move on while they
   fail. If you cannot make a step pass, record what you tried under `### Not done`, revert that step, and continue
   with the steps that do not depend on it.
5. **Do not weaken tests to make them pass.** Change an existing test only when the job says so, and record every
   such change under `### Deviations`.
6. **Finish:** run `npm run typecheck`, `npm test` and `npm run docs:check`. If `docs:check` reports stale generated
   documents, run `npm run docs:generate`. Then commit, end the message with the co-author line the repository uses,
   and push. The pre-push hook runs the checks again.
7. **Windows shell:** `npm run smoke -- "<url>"` and the Volta `node` shim go through cmd.exe, which cuts URLs at
   `&`. Call `node.exe` directly when a URL has several parameters. `npm run smoke` now takes `--world`/`--config` flags, so no URL with `&` is needed.

## Report

Every finished job gets a `## Report` section, appended to the job file before it moves to `_done/`:

```markdown
## Report

### Done
What changed: files, functions, tests added, commit hashes.
### Deviations
Where the work differs from the steps, and why.
### Uncertain
Decisions or results you are not sure of, and what would confirm them.
### Not done
Anything skipped or left failing, and why.
### Checks
Commands run and their results, including failures.
```

Set `Status: done on <date>.` when `### Uncertain` and `### Not done` are empty. Otherwise set
`Status: done, needs review on <date>.` and do not close the resolved issues: leave them open with a one-line pointer
to the report. Mark the job's row in the queue below either way.

## Template

```markdown
# Job NN - <imperative title>

Status: queued | in progress | done on <date> | done, needs review on <date> | skipped on <date>: <reason>.
Resolves: issue [NN](../../_issues/NN_....md).

## Goal
## Depends on
## Before you start
## Background
## Decisions
## Steps
## Tests and checks
## Do not
## Done when
```

## Queue

| Job | Title | Resolves issues | Former issue |
| --- | --- | --- | --- |
| [00](_done/00_coordinate_jobs_01_10.md) | ~~Coordinate jobs 01-10: order, gates, batch report~~ (done, needs review) | - |  |
| [01](_done/01_frame_loop_error_containment_and_dispose.md) | ~~Contain frame-loop errors and release everything on dispose~~ (done) | [74](../../_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md) |  |
| [02](_done/02_asset_footprint_and_provenance.md) | ~~Shrink the deployed assets and resolve unverified ones~~ (done) | [40](../../_issues/_closed/40_resolve_unverified_public_assets.md) | 34 |
| [03](_done/03_pages_deployment_configuration.md) | ~~Make Pages deployment repository-name agnostic~~ (done, needs review) | - | 37 |
| [04](_done/04_local_browser_smoke_coverage.md) | ~~Local browser smoke coverage~~ (done, needs review) | - | 36 |
| [05](_done/05_conjugate_loop_word_on_anchor_crossing.md) | ~~Conjugate a loop's portal word when its shared anchor crosses a portal~~ (done) | [68](../../_issues/_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md) |  |
| [06](_done/06_curve_shortening_stalls.md) | ~~Stop curve shortening from stalling~~ (done) | [66](../../_issues/_closed/66_curve_shortening_stalls_at_high_frame_rate.md) |  |
| [07](_done/07_forward_heading_convention.md) | ~~One forward-heading convention: marmot heading and deformation transport~~ (done) | [64](../../_issues/_closed/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md), [53](../../_issues/_closed/53_torus_deformation_commit_transport_defects.md) |  |
| [08](_done/08_xr_slide_replay_and_object_trap.md) | ~~XR slide replay and the player trapped by objects~~ (done) | [64](../../_issues/_closed/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) |  |
| [09](_done/09_deformation_commit_safety.md) | ~~Make torus deformation commits safe~~ (done) | [53](../../_issues/_closed/53_torus_deformation_commit_transport_defects.md) |  |
| [10](_done/10_floor_texture_in_lattice_coordinates.md) | ~~Floor texture in lattice coordinates~~ (done) | [81](../../_issues/_closed/81_floor_texture_slides_under_objects_during_deformation.md) |  |
| [00](_done/00_coordinate_jobs_11_17_36.md) | ~~Coordinate jobs 11-17 and 36: order, gates, batch report~~ (done, needs review) | - |  |
| [11](_done/11_property_tests_for_geometry_core.md) | ~~Property-based tests for the geometry core~~ (done, needs review) | - | 79 |
| [12](_done/12_segment_walk_kernel.md) | ~~Shared segment-walk kernel and developed-disk atlas~~ (done) | [62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) |  |
| [13](_done/13_swept_collide_and_slide.md) | ~~Swept collide-and-slide on the segment-walk kernel~~ (done, needs review) | [62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md), [61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md), [63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md) |  |
| [14](_done/14_movement_numerics.md) | ~~Movement numerics: crossing at rest, pose drift, tolerances~~ (done) | [65](../../_issues/_closed/65_movement_numerics_boundary_hysteresis_and_pose_drift.md) |  |
| [15](_done/15_geodesic_tracing_on_kernel.md) | ~~Geodesic tracing on the segment-walk kernel~~ (done, needs review) | [69](../../_issues/69_geodesic_tracing_kernel_numerics.md) |  |
| [16](_done/16_aim_picking_by_portal_ray_walk.md) | ~~Aim picking by portal ray walk~~ (done, needs review) | [72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md) |  |
| [17](_done/17_multi_hop_ghosts_and_eye_rerooting.md) | ~~Multi-hop portal ghosts and XR eye re-rooting~~ (done, needs review) | [73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md) |  |
| [00](00_coordinate_jobs_19_23_25_29_37.md) | Coordinate jobs 37, 38, 25-29 and 19-23 in four phases (phase commits and tags) | - |  |
| [18](18_vertex_classes_and_gluing_validation.md) | Compile-time vertex classes, cone angles and gluing validation | [52](../../_issues/52_compile_time_vertex_classes_and_gluing_validation.md) |  |
| [19](19_vr_palette_and_in_headset_debug.md) | Fix the XR input defects and add an in-headset debug panel | - | 20 |
| [20](20_exact_static_cull.md) | Exact static cull by oriented line stabbing | [56](../../_issues/56_exact_static_cull_by_oriented_line_stabbing.md) |  |
| [21](21_per_frame_visibility_funnel.md) | Per-frame visibility: visible-parent traversal and the exact funnel | [57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md) |  |
| [22](22_gpu_portal_clip_planes.md) | GPU portal clipping with clip planes | [58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md) |  |
| [23](23_stereo_split_root_correctness.md) | Correct stereo rendering with split eye roots | [59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md) |  |
| [24](24_lazy_path_trie.md) | Replace per-root path tables with a lazy path trie | - | 60 |
| [25](_done/25_split_geodesic_cannon_modules.md) | ~~Split geodesicCannon.ts into modules under src/world-objects/geodesic/~~ (done, needs review) | - | 76 |
| [26](_done/26_exact_curve_shortening.md) | ~~Exact curve shortening via the sleeve/funnel~~ (done, needs review) | [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md) |  |
| [27](27_geodesic_rebuild_performance.md) | Per-frame cost of geodesic rebuilds | [70](../../_issues/70_geodesic_module_performance_and_split.md) |  |
| [28](28_frame_snapshot_instance_sync.md) | Sync runtime-object instances once per frame against the rendered root | [71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md) |  |
| [29](29_frame_loop_allocation_and_draw_calls.md) | Frame-loop allocation and per-object draw calls | [75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md) |  |
| [30](30_deformation_rebuild_pipeline.md) | Incremental deformation rebuild pipeline | [55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md), [82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md) |  |
| [31](31_app_shell_state_holder.md) | One state holder and one command path for the app shell | - | 77 |
| [32](32_layer_dag.md) | Make the layer rule a real DAG | [78](../../_issues/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md) |  |
| [33](33_decompose_runtime_monoliths.md) | Decompose runtime monoliths and retire legacy paths | - | 38 |
| [34](34_type_strictness_lint_bundle.md) | Type strictness, linting and bundle configuration | - | 80 |
| [35](35_torus_family_as_teichmuller_space.md) | Treat the torus family as TeichmÃ¼ller space | - | 54 |
| [36](_done/36_creatures_detour_and_resume_geodesic.md) | ~~Creatures detour around obstacles and resume their geodesic~~ (done, needs review) | - |  |
| [37](_done/37_object_owners_and_place_at.md) | ~~Objects own their position; `placeAt` moves any positioned object~~ (done, needs review) | - |  |
| [38](38_draw_assets_from_registry.md) | Draw static assets from their registry record | - |  |
