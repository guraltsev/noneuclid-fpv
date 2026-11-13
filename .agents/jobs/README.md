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
- Every job ends with verification; `git push` runs no checks, so run `npm run typecheck` and `npm test` yourself.

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
   and push.
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
to the report. Set the job's `Status` column in the queue below to match, either way.

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

**Priority override (maintainer, 2026-10-31):** the local server is top priority. Jobs 39 and 40 come before every other
queued job, despite their numbers (they were numbered after the existing queue to avoid renumbering it).

**Priority (maintainer, 2026-11-03):** the coordinator of jobs 48-55 comes before every other queued job, despite the
lower numbers of jobs 18, 24, 30, 34 and 35.

**Priority (maintainer, 2026-11-05):** the coordinator of jobs 61-66 comes before every other queued job. Jobs 18, 24, 30, 34 and
35 wait; their text is stale and each says why.

**Priority (maintainer, 2026-11-11):** job 30, then job 35, come before every other queued job. Both were rewritten on 2026-11-11 and
can run as written. Job 68 (split from job 30) waits for the maintainer.

**Order of jobs 51-60 (2026-11-04):** the coordinator [00_coordinate_jobs_51_60](_done/00_coordinate_jobs_51_60.md) runs them in the order 51, 56, 57, 58,
59, 60, 52, 53, 54, 55, despite their numbers: the new jobs 56 to 60 lay the foundation the older ones need. It comes before every other queued job.

| Job | Title | Status | Resolves issues | Former issue |
| --- | --- | --- | --- | --- |
| [00](_done/00_coordinate_jobs_01_10.md) | Coordinate jobs 01-10: order, gates, batch report | done, needs review | - |  |
| [01](_done/01_frame_loop_error_containment_and_dispose.md) | Contain frame-loop errors and release everything on dispose | done | [74](../../_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md) |  |
| [02](_done/02_asset_footprint_and_provenance.md) | Shrink the deployed assets and resolve unverified ones | done | [40](../../_issues/_closed/40_resolve_unverified_public_assets.md) | 34 |
| [03](_done/03_pages_deployment_configuration.md) | Make Pages deployment repository-name agnostic | done, needs review | - | 37 |
| [04](_done/04_local_browser_smoke_coverage.md) | Local browser smoke coverage | done, needs review | - | 36 |
| [05](_done/05_conjugate_loop_word_on_anchor_crossing.md) | Conjugate a loop's portal word when its shared anchor crosses a portal | done | [68](../../_issues/_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md) |  |
| [06](_done/06_curve_shortening_stalls.md) | Stop curve shortening from stalling | done | [66](../../_issues/_closed/66_curve_shortening_stalls_at_high_frame_rate.md) |  |
| [07](_done/07_forward_heading_convention.md) | One forward-heading convention: marmot heading and deformation transport | done | [64](../../_issues/_closed/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md), [53](../../_issues/_closed/53_torus_deformation_commit_transport_defects.md) |  |
| [08](_done/08_xr_slide_replay_and_object_trap.md) | XR slide replay and the player trapped by objects | done | [64](../../_issues/_closed/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) |  |
| [09](_done/09_deformation_commit_safety.md) | Make torus deformation commits safe | done | [53](../../_issues/_closed/53_torus_deformation_commit_transport_defects.md) |  |
| [10](_done/10_floor_texture_in_lattice_coordinates.md) | Floor texture in lattice coordinates | done | [81](../../_issues/_closed/81_floor_texture_slides_under_objects_during_deformation.md) |  |
| [00](_done/00_coordinate_jobs_11_17_36.md) | Coordinate jobs 11-17 and 36: order, gates, batch report | done, needs review | - |  |
| [11](_done/11_property_tests_for_geometry_core.md) | Property-based tests for the geometry core | done, needs review | - | 79 |
| [12](_done/12_segment_walk_kernel.md) | Shared segment-walk kernel and developed-disk atlas | done | [62](../../_issues/_closed/62_segment_based_portal_traversal_and_swept_motion.md) |  |
| [13](_done/13_swept_collide_and_slide.md) | Swept collide-and-slide on the segment-walk kernel | done, needs review | [62](../../_issues/_closed/62_segment_based_portal_traversal_and_swept_motion.md), [61](../../_issues/_closed/61_wall_response_lets_bodies_escape_through_corners.md), [63](../../_issues/_closed/63_collision_ignores_cells_a_straddling_body_overlaps.md) |  |
| [14](_done/14_movement_numerics.md) | Movement numerics: crossing at rest, pose drift, tolerances | done | [65](../../_issues/_closed/65_movement_numerics_boundary_hysteresis_and_pose_drift.md) |  |
| [15](_done/15_geodesic_tracing_on_kernel.md) | Geodesic tracing on the segment-walk kernel | done, needs review | [69](../../_issues/_closed/69_geodesic_tracing_kernel_numerics.md) |  |
| [16](_done/16_aim_picking_by_portal_ray_walk.md) | Aim picking by portal ray walk | done, needs review | [72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md) |  |
| [17](_done/17_multi_hop_ghosts_and_eye_rerooting.md) | Multi-hop portal ghosts and XR eye re-rooting | done, needs review | [73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md) |  |
| [00](_done/00_coordinate_jobs_19_23_25_29_37.md) | Coordinate jobs 37, 38, 25-29 and 19-23 in four phases (phase commits and tags) | done, needs review | - |  |
| [18](18_vertex_classes_and_gluing_validation.md) | Compile-time vertex classes, cone angles and gluing validation | queued | [52](../../_issues/52_compile_time_vertex_classes_and_gluing_validation.md) |  |
| [19](_done/19_vr_palette_and_in_headset_debug.md) | Fix the XR input defects and add an in-headset debug panel | done, needs review | - | 20 |
| [20](_done/20_exact_static_cull.md) | Exact static cull by oriented line stabbing | done, needs review | [56](../../_issues/56_exact_static_cull_by_oriented_line_stabbing.md) |  |
| [21](_done/21_per_frame_visibility_funnel.md) | Per-frame visibility: visible-parent traversal and the exact funnel | done, needs review | [57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md) |  |
| [22](_done/22_gpu_portal_clip_planes.md) | GPU portal clipping with clip planes | done, needs review | [58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md) |  |
| [23](_done/23_stereo_split_root_correctness.md) | Correct stereo rendering with split eye roots | done, needs review | [59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md) |  |
| [24](24_lazy_path_trie.md) | Replace per-root path tables with a lazy path trie | queued | - | 60 |
| [25](_done/25_split_geodesic_cannon_modules.md) | Split geodesicCannon.ts into modules under src/world-objects/geodesic/ | done, needs review | - | 76 |
| [26](_done/26_exact_curve_shortening.md) | Exact curve shortening via the sleeve/funnel | done, needs review | [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md) |  |
| [27](_done/27_geodesic_rebuild_performance.md) | Per-frame cost of geodesic rebuilds | done, needs review | [70](../../_issues/70_geodesic_module_performance_and_split.md) |  |
| [28](_done/28_frame_snapshot_instance_sync.md) | Sync runtime-object instances once per frame against the rendered root | done, needs review | [71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md) |  |
| [29](_done/29_frame_loop_allocation_and_draw_calls.md) | Frame-loop allocation and per-object draw calls | done, needs review | [75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md) |  |
| [30](30_deformation_rebuild_pipeline.md) | Smooth deformation: cheap commits, a step per frame, a worker only for the cull | queued (rewritten 2026-11-11) | [55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md) (items 1-3), [82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md), [90](../../_issues/90_portal_wall_textures_pile_up_during_deformation.md) |  |
| [31](_done/31_app_shell_state_holder.md) | Shell cleanups: dead field, one portal sync, split the palette adapter | done, needs review | - | 77 |
| [32](_done/32_layer_dag.md) | Make the layer rule a real DAG | done, needs review | [78](../../_issues/_closed/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md) |  |
| [33](_done/33_decompose_runtime_monoliths.md) | Decompose runtime monoliths and retire legacy paths | done | - | 38 |
| [34](34_type_strictness_lint_bundle.md) | Type strictness, linting and bundle configuration | queued | - | 80 |
| [35](35_torus_family_as_teichmuller_space.md) | Cut the torus room from a reduced basis (re-marking) | queued (rewritten 2026-11-11) | [95](../../_issues/95_torus_moduli_floor_shears_and_the_deformation_does_not_read_as_moduli_space.md) (part 4) | 54 |
| [36](_done/36_creatures_detour_and_resume_geodesic.md) | Creatures detour around obstacles and resume their geodesic | done, needs review | - |  |
| [37](_done/37_object_owners_and_place_at.md) | Objects own their position; `placeAt` moves any positioned object | done, needs review | - |  |
| [38](_done/38_draw_assets_from_registry.md) | Draw static assets from their registry record | done, needs review | - |  |
| [39](_done/39_local_node_https_server.md) | Local Node server: serve the built app over HTTPS on the local network | done, needs review | - |  |
| [40](_done/40_state_api_object_and_server_channel.md) | The public API object, the server channel, and `npm run cdp` for any device | done, needs review | - |  |
| [00](_done/00_coordinate_jobs_41_44.md) | Coordinate jobs 41-44 (test rehaul): order, gates, fresh-context reviews, indicators, batch report | done, needs review | - |  |
| [41](_done/41_test_tiers_and_hygiene_checks.md) | Test tiers, hygiene checks, baseline and indicators | done, needs review | - |  |
| [42](_done/42_clean_test_areas.md) | Clean every test area except render | done, needs review | - |  |
| [43](_done/43_clean_render_tests_and_shared_fakes.md) | Clean the render tests and share the boundary fakes | done, needs review | - |  |
| [44](_done/44_api_scenario_runner_and_manual_checklist.md) | API scenario runner, first scenarios, and the manual checklist | done, needs review | - |  |
| [45](45_api_functions_for_scenarios.md) | API functions that scenarios need, and the checks they convert | blocked on the maintainer (012) | - |  |
| [46](_done/46_shell_session_and_command_path.md) | One shell-side state holder and one command path | done, needs review | - | 77 |
| [47](_done/47_carry_contract.md) | The carry contract: an emitter that can be carried reacts to a stream of displacement steps | done, needs review | - |  |
| [00](_done/00_coordinate_jobs_48_55.md) | Coordinate jobs 48-55 (world engine, clients and modules): order, gates, fresh-context reviews, batch report | done, needs review | [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) |  |
| [48](_done/48_module_bench_change_journal_layers.md) | Record the performance baseline, add the change journal, and add the engine and module layers | done, needs review | - |  |
| [49](_done/49_world_engine_and_client_session.md) | Build the world engine and split the client session from it | done, needs review | - |  |
| [50](_done/50_carry_as_world_attachment.md) | Make carrying a world attachment | done, needs review | - |  |
| [00](_done/00_coordinate_jobs_51_60.md) | Coordinate jobs 51-60 (derived state, then the geodesic and flow modules): order, gates, fresh-context reviews, batch report | done, needs review | [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md), [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md) |  |
| [51](_done/51_geodesic_model_module_and_renames.md) | Restore the geodesic model module and abolish the "moving" state | done, needs review | - |  |
| [52](_done/52_derived_state_through_the_journal.md) | Derive crossings, lengths and angles from the change ring | done, needs review | - |  |
| [53](_done/53_curve_shortening_module.md) | Move curve shortening into a module with no lifecycle | done, needs review | - |  |
| [54](_done/54_tools_from_modules.md) | Build tools from module descriptors | done, needs review | - |  |
| [55](_done/55_destroy_policy.md) | Add the "destroy" policy for blocked curves | done, needs review | [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md), [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md) |  |
| [56](_done/56_bench_counters_and_ab_gate.md) | Make the performance gate exact: scan counters, a many-arcs scene and an A/B tool | done, needs review | - |  |
| [57](_done/57_change_ring.md) | Keep every change readable: a ring behind the journal, cursors that survive endFrame | done, needs review | - |  |
| [58](_done/58_derived_cache.md) | Add the derived cache, cached kind lists and their guards | done, needs review | - |  |
| [59](_done/59_arc_index.md) | Answer every arc-end question from one cache, the arc index | done, needs review | - |  |
| [60](_done/60_materialized_state_is_a_function_of_real_state.md) | Make stored segments a function of real state, and test that | done, needs review | - |  |
| [00](_done/00_coordinate_jobs_61_66.md) | Coordinate jobs 61-66 (time, emitters, public API, measurement tools and flags) | done, needs review | - |  |
| [61](_done/61_simulation_ticks.md) | Run the world in ticks owned by the simulation | done, needs review | - |  |
| [62](_done/62_client_write_check.md) | Make the client write check measure writes | done, needs review | [91](../../_issues/91_legacy_world_writers_list_does_not_measure_writes.md) |  |
| [63](_done/63_geodesic_emitters_module.md) | Create the geodesic emitters module: renames, place, shoot, extend, delete | done, needs review | - |  |
| [64](_done/64_emitter_edits_and_length.md) | Rotate, aim and carry through the world; a free geodesic keeps its length | done, needs review | [88](../../_issues/88_carry_changes_the_world_before_the_world_answers.md), [89](../../_issues/89_rotate_aim_and_carry_bypass_the_tool_gates.md), [93](../../_issues/93_a_free_geodesic_forgets_its_length_when_the_tool_ends.md) |  |
| [65](_done/65_module_public_api.md) | Give modules a public API and write the scenarios that were waiting for it | done, needs review | - |  |
| [66](_done/66_measurement_tools_and_flags.md) | Move the measurement tools and the flags into modules | done, needs review | [92](../../_issues/92_measurement_kinds_are_declared_transient.md) |  |
| [67](_done/67_rigid_floor_patches_and_moduli_readout.md) | Rigid floor patches, Teichmuller steps and a moduli readout for the torus | done, needs review | [95](../../_issues/95_torus_moduli_floor_shears_and_the_deformation_does_not_read_as_moduli_space.md) |  |
| [68](68_deformation_commit_in_the_step.md) | Commit a deformation inside the engine step (phase 7) | blocked on the maintainer (013 API rows) | - |  |
| [69](_done/69_vr_palette_scale_at_new_distance.md) | Scale the VR palette to its new distance and remove the unused auto-close check | done, needs review (branch `dev`) | - |  |
| [00](00_coordinate_jobs_70_82.md) | Coordinate jobs 70-82 (design 017: discoverable UI and sandbox level design): order, gates, batch report | queued (branch `dev`) | - |  |
| [70](70_student_vocabulary.md) | One student vocabulary: the vocabulary module, the renames and the retired-terms check | queued | - |  |
| [71](71_toast_queue.md) | Toasts: a renderer-neutral message queue shown on desktop and in VR | queued | - |  |
| [72](72_tools_stay_in_hand.md) | Tools stay in hand until put away | queued | - |  |
| [73](73_guarded_start_over_and_undo.md) | Guarded "Start over", undo, and no reset on the VR stick press | queued | - |  |
| [74](74_pause_card_and_crosshair.md) | Pause card (the desktop main menu) and an always-on crosshair | queued | - |  |
| [75](75_desktop_tool_belt_and_verbs.md) | The tool belt and the input verbs on desktop | queued | - |  |
| [76](76_hint_strip_and_targeting.md) | Hint strip, focus outline, angular picking and sticky focus | queued | - |  |
| [77](77_vr_hand_roles_one_controller_and_belt.md) | VR: hand roles, one-controller layout, the belt on the wrist or the waist, the VR main menu | queued | - |  |
| [78](78_self_explaining_menus.md) | Self-explaining menus: text labels, disabled reasons, readable beam rows, one way to delete | queued | - |  |
| [79](79_help_that_teaches.md) | Help that teaches: three pages, generated How to, "Try it", first-use tips, Settings | queued | - |  |
| [80](80_shape_machine_panel.md) | Shape machine panel: one picture, Shift and Height, direct entry, presets | queued | - |  |
| [81](81_spawn_tool_stand_and_demo.md) | Spawn framing, a help cube that says "click me", the tool stand and the demo | queued | - |  |
| [82](82_discoveries.md) | Discoveries, curiosity markers and "Show edges" | queued | - |  |
