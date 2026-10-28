# Implementation Reading Order

This document replaces the old non-stage `_docs/llm-handoff` index and keeps the rebuild packet readable without mixing long-term design docs with stage tickets.

Read the materials in this order when working through the flattened cube rebuild. The audience remains an LLM-assisted implementation workflow where the human developer is a professional mathematician and lower-intermediate programmer. The documents are intentionally concrete, but they are scaffolding for implementation rather than a final frozen spec.

## Ordered reading map

1. `_docs/implementation-reading-order.md` - this reading map.
2. `_issues/_closed/01_project_brief.md` - closed; project purpose, audience, non-goals, and corrected teaching stance.
3. `_issues/_closed/02_development_principles.md` - closed; code style, testing philosophy, and LLM behavior rules.
4. `_issues/_closed/03_tech_stack_and_deployment.md` - closed; TypeScript, Vite, Three.js, WebXR, tests, and GitHub Pages branch deployment.
5. `_issues/_closed/04_repository_scaffold.md` - closed; target directory structure and import boundaries.
6. `_docs/design/004-domain-model.md` - shared vocabulary for cells, portals, rays, tools, and forbidden zones.
7. `_docs/design/007-authoring-model.md` - TypeScript world specs now, compiler and QR authoring later.
8. `_docs/design/008-runtime-contracts.md` - public data contracts the implementation should stabilize early.
9. `_docs/testing.md` - behavior tests, test layout, stage gates, and forbidden implementation-locking tests.
10. `_docs/llm-implementation-workflow.md` - how future LLM sessions should work in this codebase, plus reusable prompt templates.
11. `_issues/_closed/10_stage_00_bootstrap.md` - closed; initial empty project and tooling scaffold.
12. `_issues/_closed/16_stage_01_math_primitives.md` - closed; vectors, transforms, planes, polygons, tolerances.
13. `_issues/_closed/17_stage_02_prism_cell_compiler.md` - closed; first implemented cell type and portal validation.
14. `_issues/_closed/18_stage_03_movement_collision_portals.md` - closed; player movement, collision, portal crossing, and forbidden zones.
15. `_issues/_closed/16_stage_04_renderer_completion.md` - closed; renderer meshes, debug state, and renderer-contract coverage are in place.
16. `_docs/llm-handoff/15_stage_05_portal_viewing.md` - one-hop and recursive portal visibility.
17. `_docs/llm-handoff/16_stage_06_straight_ray_tool.md` - shoot locally straight rays through portals.
18. `_docs/llm-handoff/17_stage_07_environment_tools.md` - markers, path traces, rulers, angle tools, and non-teaching data capture.
19. `_docs/llm-handoff/18_stage_08_webxr_vr_controls.md` - VR entry, controllers, comfort, and fallback behavior.
20. `_docs/llm-handoff/19_stage_09_classroom_hardening.md` - resets, preflight checks, teacher workflow, and static deployment checks.
21. `_docs/llm-handoff/20_stage_10_authoring_compiler_and_qr.md` - optional next-year compiler and QR marker authoring app.
22. `_docs/llm-handoff/21_stage_11_general_volume_cells_later.md` - later true 3D cells without pretending they exist now.
23. `_docs/llm-handoff/22_stage_12_cleanup_pass.md` - second user-initiated cleanup and documentation pass.
24. `_docs/acceptance-checklists.md` - compact global and stage-specific exit criteria.

## Core design correction

The software is not a theorem tutor. It should provide a reliable explorable environment.

Do not build a theorem engine. Do not compute curvature effects. Do not compute Gauss-Bonnet, holonomy values, Euler characteristic, or point-to-point geodesics as part of the first implementation. Those ideas may be discovered by students using the environment, physical discussion, instructor guidance, and later optional tools.

The first mathematical tool is a locally straight ray tool: aim, shoot, cross portals by rigid transforms, stop at a wall, forbidden zone, maximum distance, or maximum portal count.

## First implemented world model

The runtime should be 3D-cell aware from the beginning, but the first implemented cell type is a vertical prism over a 2D polygonal base.

A prism cell has:

- a floor,
- a ceiling,
- vertical side faces,
- ordinary walls on non-portal side faces,
- portal faces on selected side faces,
- decorations and markers placed in local cell coordinates.

The floor and ceiling are ordinary collision surfaces and have no portals in the first implementation.

## Absolute rule about singular-looking places

A player or placed tool must never intersect the forbidden zone or object clearance around a portal junction.

A portal junction is a codimension-2 place where two or more portal faces meet. In a prism cell, this is usually a vertical edge where two portal walls meet. The code should treat this as a movement and collision safety rule, not as a curvature calculation.
