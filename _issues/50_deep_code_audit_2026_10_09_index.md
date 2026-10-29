# 50 - Deep code audit, 2026-10-09: index, cross-cutting themes, and order of work

Status: open; re-verified 2026-10-28.

Priority: P1 (tracking issue). Close it when every issue listed below is closed or moved on.

## Status update 2026-10-28

Every issue from 51 to 80 was re-checked against the current code. None is closed. Each open issue now has its own
dated status section.

- Partly fixed:
  - 61: a blocked push-out now keeps the original pose, so bodies no longer escape through a corner. They stop short
    instead of sliding, and a large step can still exit through a portal.
  - 62: a crossing into a zone, floor or ceiling is now refused. The cube-vertex loss still reproduces.
  - 69: a ray that starts inside a disk now hits at t = 0.
  - 78: `VrComfortOptions` moved to `src/glue`, which removes two layer edges. All 5 import cycles remain.
- Reproduced again: 62, 65 and 66. Issue 66 is still `moving` after 20,000 ticks at 240 Hz.
- Unchanged: all the others.
- Older issues touched by this audit:
  - Closed on 2026-10-28: [17](_closed/17_stage_08_webxr_vr_locomotion_collision_and_controllers.md),
    [29](_closed/29_live_torus_skew_geometry_deformation.md),
    [31](_closed/31_geodesic_end_model_and_curve_shortening_rehaul.md),
    [32](_closed/32_phase_f_curve_shortening_algorithm_note.md),
    [33](_closed/33_repository_issue_and_risk_audit_2026_08_03.md) and
    [35](_closed/35_remove_committed_shared_tls_private_key.md) (the owner discarded the certificate).
  - Merged and closed on 2026-10-28:
    - [21](_closed/21_vr_stereo_portal_visibility_union_and_hot_loop_allocation.md): traversal and allocation went
      to 57; split-root defects, stereo counts and headset checks to 59; the in-headset debug readout to 20.
    - [41](_closed/41_documentation_audit_findings.md): each open item went to the issue that owns its area (52, 56,
      60, 62, 64, 66-68, 70, 74, 75, 20, 38 and 78). The `TODO(issue 41)` comments in the source were renamed to
      match.
  - Still open: 38.
- Other merges on 2026-10-28:
  - The module split proposed by both 70 and 76 now lives only in 76. 70 keeps the performance work.
  - The marmot heading (64) and the heading transport after a deformation commit (53) cross-reference each other.
    Both must use forward = R·e_y.
- The suggested order below still applies. Nothing from themes 1 (the shared segment-walk kernel) or 7 (frame
  snapshots) has landed, and those two block most of 62, 69 and 71-73.

## Summary

Six parallel reviews covered the code: math core and gluing, portal visibility, movement, geodesics, the frame loop, and
architecture. They produced issues 51-80. Items already recorded in
[41](_closed/41_documentation_audit_findings.md), [38](../.agents/jobs/33_decompose_runtime_monoliths.md),
[21](_closed/21_vr_stereo_portal_visibility_union_and_hot_loop_allocation.md) and
[MATHEMATICAL_MODEL.md §11](../_docs/MATHEMATICAL_MODEL.md#11-assumptions-and-known-gaps) were not filed again. Where this
audit has a concrete fix design for one of those items, the new issue says so.

Evidence levels differ between issues. The audit ran scratch scripts to confirm 51 (example invariants), 61 (escaping
through a corner) and 62 (lost past a vertex). The other issues come from reading the code and working through the
math. Re-check them before fixing, because the code was changing while the audit ran: for example, the validator moved
to `src/cell-complex/validateCellComplexSpec.ts`.

## Issues by area

### Complex, gluing, deformation (51-55)
| # | Pri | Title |
| --- | --- | --- |
| [51](_closed/51_dodecahedron_example_is_a_genus_6_surface.md) | P1 | Closed 2026-10-28: the dodecahedron gluing is fixed and per-world invariants are tested |
| [52](52_compile_time_vertex_classes_and_gluing_validation.md) | P2 | Compile-time vertex classes, cone angles, Gauss–Bonnet, endpoint-matching validation |
| [53](53_torus_deformation_commit_transport_defects.md) | P1 | Deformation commit can trap the player in an exclusion zone; headings transported by the wrong vector |
| [54](../.agents/jobs/35_torus_family_as_teichmuller_space.md) | P3 | Torus family as Teichmüller space; lattice reduction; GL(2,ℝ) family for translation surfaces |
| [55](55_live_deformation_rebuild_cost_and_se2_transforms.md) | P2 | ~100 ms rebuild per deformation step; worker pipeline; `Iso2` planar transform type |

### Portal visibility and rendering through portals (56-60)
| # | Pri | Title |
| --- | --- | --- |
| [56](56_exact_static_cull_by_oriented_line_stabbing.md) | P1 | Exact static cull as a 3-variable LP (oriented line stabbing); replaces the tau/sigma code |
| [57](57_per_frame_portal_visibility_funnel_and_traversal.md) | P2 | Per-frame visibility: traverse only visible parents; exact 2.5D funnel; no background holes |
| [58](58_gpu_portal_clip_overflow_and_clip_planes.md) | P2 | Paths with more than 8 clip vertices silently vanish; 32 texture fetches per fragment; `discard` disables early-Z |
| [59](59_stereo_split_root_unclipped_roots_and_union_budget.md) | P2 | Split-root stereo draws the other eye's root cell unclipped |
| [60](../.agents/jobs/24_lazy_path_trie.md) | P2 | Replace eager per-root path tables with a lazy shared trie |

### Movement and collision (61-65)
| # | Pri | Title |
| --- | --- | --- |
| [61](61_wall_response_lets_bodies_escape_through_corners.md) | P1 | Single-wall push-out lets bodies walk out of a room through any corner (reproduced) |
| [62](62_segment_based_portal_traversal_and_swept_motion.md) | P1 | Segment traversal plus swept collide-and-slide; bodies are lost past vertices (reproduced) |
| [63](63_collision_ignores_cells_a_straddling_body_overlaps.md) | P2 | A body straddling a portal is not tested against the neighbor cell's obstacles |
| [64](64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) | P2 | XR slide replay (~3 m/s glide), marmot heading mirrored, player trapped by objects |
| [65](65_movement_numerics_boundary_hysteresis_and_pose_drift.md) | P3 | Boundary ping-pong, pose drift, mixed-unit tolerances |

### Geodesics and curve shortening (66-70)
| # | Pri | Title |
| --- | --- | --- |
| [66](66_curve_shortening_stalls_at_high_frame_rate.md) | P1 | Curve shortening stalls above ~200 fps; near-fuse livelock |
| [67](67_exact_curve_shortening_via_sleeve_funnel.md) | P1 | Exact taut-string solution via the sleeve/funnel algorithm replaces gradient descent |
| [68](68_loop_endpoint_crossing_must_conjugate_portal_word.md) | P1 | Moving a loop's shared anchor across portal p must map w ↦ p⁻¹wp (currently changes homotopy class) |
| [69](69_geodesic_tracing_kernel_numerics.md) | P2 | Nudge drift k·10⁻⁴ m, disk test from inside, missed self-intersections |
| [70](70_geodesic_module_performance_and_split.md) | P2 | Rebuild cost (registry copies, repeated all-pairs intersections); the module split moved to 76 |

### Frame loop, aiming, objects (71-75)
| # | Pri | Title |
| --- | --- | --- |
| [71](71_runtime_object_instance_sync_runs_twice_with_stale_root.md) | P2 | Object instance sync runs twice per frame, once against the wrong root's table |
| [72](72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md) | P1 | VR aim gated by head-camera clip polygons, not by the controller ray; walls never occlude |
| [73](73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md) | P2 | Ghosts and XR eye re-rooting only look one portal hop away |
| [74](_closed/74_frame_loop_error_containment_and_dispose_leaks.md) | P2 | Closed 2026-10-28 by job 01: frame errors are contained and `dispose` frees the runtime families |
| [75](75_frame_loop_allocation_and_per_object_draw_calls.md) | P2 | Per-frame allocations; ~13 draw calls per creature |

### Architecture, tooling, tests (76-80)
| # | Pri | Title |
| --- | --- | --- |
| [76](../.agents/jobs/25_split_geodesic_cannon_modules.md) | P1 | Concrete seams for `geodesicCannon.ts` (5,942 lines) and `geodesicCannonTools.ts` |
| [77](../.agents/jobs/31_app_shell_state_holder.md) | P2 | One state holder and one command path for `createThreeApp` |
| [78](78_enforce_layer_dag_and_move_domain_logic_out_of_render.md) | P2 | Make the layer rule a real DAG; 5 import cycles; move domain logic out of `render/three` |
| [79](../.agents/jobs/11_property_tests_for_geometry_core.md) | P2 | Property-based invariants (fast-check) for the geometry core |
| [80](../.agents/jobs/34_type_strictness_lint_bundle.md) | P2/P3 | `noUncheckedIndexedAccess` (353 errors), lint, bundle chunking (1.44 MB single chunk) |

## Cross-cutting themes

1. **One developed-segment walk kernel.** The same primitive appears under four names: walking a segment through
   convex cells in the developed frame of its start, crossing portal edges by exact segment–edge tests, and returning
   the cells and portals crossed. The four uses are geodesic tracing (69), body motion (62), aim picking (72) and eye
   re-rooting and ghosts (73). Each now has its own approximation: the 10⁻⁴ m nudge, the anchor-side guess, the camera
   clip polygon, and first-side-in-array-order. Build the kernel once, in `src/math` or `src/cell-complex`, on the
   `Iso2` type from 55, then migrate the four callers. The kernel must handle a segment that passes exactly through a
   vertex (see theme 3).

2. **Visibility is plane arithmetic, not polygon clipping.** Apertures are vertical and gluing preserves z. The static
   question (56: does any line cross portals 1..k in order?) is therefore a small LP. The per-frame region (57) is a
   cone bounded by at most 4 planes through the eye, and GPU clipping (58) can use those planes directly. Do 56-58
   together, sharing one oriented-portal representation. 60 (the lazy trie) then becomes the storage layer that 56
   memoizes into, and it removes the path-id inconsistencies of 41 and 71.

3. **Vertex classes are first-class data (52).** Several fixes depend on knowing each vertex's cone angle θ_v:
   - Dropping exclusion cylinders at flat vertices removes the trap in 53. Every torus corner is flat.
   - 63 needs to know when a body's disk contains a cone point.
   - The funnel in 67 wraps disks only at singular vertices.
   - Caveat: 69 notes that segments hitting an edge exactly at its end vertex are harmless *only because every portal
     endpoint has a disk*. Removing the disks at flat vertices (52) therefore **requires** the robust tie handling of
     the theme-1 kernel first.

4. **Replace iterative approximations with exact constructions where the geometry is flat.** Exact solutions exist for
   all of these:
   - curve shortening (67: taut string in the sleeve; closed form for free loops by holonomy type);
   - wall response (61: project the center onto the cell inset by r, which is convex);
   - the static cull (56);
   - the torus moduli (54: reduced basis, Teichmüller step).

   The current heuristics fail at the edges of their domains. Examples: 66 at high frame rates, 61 at corners, 67
   near cone points, 41's cull-soundness gap.

5. **Word algebra is the homotopy invariant; keep it in one module.** Words are already freely reduced at every update
   site. With vertices excluded, reduced words represent exactly the homotopy classes, so the following can rely on
   that:
   - conjugation when a loop's basepoint moves (68);
   - composition at fusion;
   - reversal.

   Put these operations in the `portalWord` module proposed in 70 and 76, and property-test them (79).

6. **Content needs invariant tests (51, 79).** Every bundled world should assert its expected (V, E, F, χ, cone
   angles). The static-cull benchmark currently profiles the genus-6 surface by mistake.

7. **Frame-loop hygiene (71, 74, 75, 77).** Contain errors per frame. Compute every derived quantity once per frame
   from one state snapshot, keyed by the root actually used to render. This removes duplicate work and the stale-root
   bug together.

## Order of work

Superseded on 2026-10-28 by the numbered job queue in [`.agents/jobs`](../.agents/jobs/README.md). Issues 54, 60, 76,
77, 79 and 80 were mainly "carry out this change", so they became jobs 35, 24, 25, 31, 11 and 34; their rows above
link to the jobs. Issues 52, 56, 67 and 78 were split: the defect stays here, and the design moved to jobs 18, 20, 26
and 32.

## Acceptance criteria

- Each of issues 51-80 is closed, converted into a job, merged into another issue with a link, or explicitly deferred
  with a reason.
- `MATHEMATICAL_MODEL.md` §11 is updated as each listed gap is closed.
