# LLM Implementation Workflow

These instructions are for future LLM sessions working on the codebase.

## Before changing code

Read:

1. `_docs/implementation-reading-order.md`.
2. The stage file for the current task.
3. Any public contract file touched by the task.
4. Relevant tests.

Then state the current behavior being changed in one or two sentences.

Do not start by reorganizing files.

## Missing information

If a required design detail is missing and the code cannot safely proceed, stop and ask the human developer.

If a needed shell tool, project command, local instruction file, or ordinary developer context is reasonably unavailable in the sandboxed shell, ask to escalate for access to the normal environment instead of silently skipping the step or treating the sandbox limitation as authoritative.

If a reasonable local choice is safe and reversible, make the smallest choice and document it in the relevant stage notes or a tiny decision note.

Never invent mathematical facts, hidden requirements, or unsupported claims.

## Work in small vertical slices

For each change:

1. Name the public behavior.
2. Add or update a behavior test when the behavior is logical rather than visual.
3. Implement the smallest code needed.
4. Run typecheck and tests.
5. Summarize files changed and behavior added.

Do not batch unrelated features.

## Testing discipline

When the task involves cells, portals, movement, forbidden zones, rays, markers, or measurements, prefer behavior tests before implementation.

When the task is purely visual glue, add a small render-contract test or a manual debug checklist.

Do not lock in private helper structure.

## Architecture discipline

Do not introduce:

- service classes,
- dependency injection,
- plugin systems,
- generic registries,
- global event buses,
- complex state machines,
- hidden singleton state.

Use plain functions and plain data until behavior requires more.

## Renderer discipline

Renderer code may read compiled cells, movement results, and tool outputs.

Renderer code must not own:

- portal validation,
- movement collision rules,
- forbidden-zone construction,
- straight-ray traversal logic,
- authoring validation.

## Mathematics discipline

Do not compute curvature effects in the first implementation.

Do not implement point-to-point geodesic solving in the first implementation.

Do not add theorem explanations to the environment layer.

If a UI label for students uses informal mathematical language, keep the code contract precise. For example, code should say `traceStraightRay`, not `solveGeodesic`, until a real geodesic solver is implemented.

## Documentation discipline

Public functions and modules should have concise JSDoc when they are substantive public APIs.

Docstrings should describe observable contracts, not source-code order.

Dense logic should be narrated with block comments inside functions.

## Dependency discipline

Before adding a dependency, explain:

- what current requirement it satisfies,
- why plain TypeScript or Three.js is not enough,
- whether it affects GitHub Pages static deployment,
- whether it makes the code harder for the target developer to inspect.

If the answer is unclear, do not add the dependency.

## End-of-session summary

Every implementation session should finish with:

```text
Implemented:
Tested:
Not implemented:
Known risks:
Next suggested stage:
```

Be honest about failures or untested behavior.

## Example prompts

These prompts are meant for implementation sessions after the human developer has revised the final specs.

### Stage 00 prompt

```text
Read _docs/implementation-reading-order.md and _issues/_closed/10_stage_00_bootstrap.md. Create the initial Vite TypeScript scaffold with Vitest, strict typecheck, the requested source folders, and scripts/deploy-pages.sh. Do not implement geometry, rendering, movement, or VR. End by running typecheck, test, and build.
```

### Stage 01 prompt

```text
Read 11_stage_01_math_primitives.md and implement the math primitives only. Add behavior tests for vector operations, rigid transform inverse/composition, polygon classification, and segment-plane intersection. Do not import Three.js from math modules.
```

### Stage 02 prompt

```text
Read 12_stage_02_prism_cell_compiler.md. Implement CellComplexSpec, PrismCellSpec, portal specs, compileCellComplex, portal transform compilation, and forbidden-zone construction. Add behavior tests for valid and invalid specs. Do not implement movement or rendering.
```

### Stage 03 prompt

```text
Read 13_stage_03_movement_collision_portals.md. Implement PlayerPose, PlayerBody, movePlayer, collision against prism walls, floor, ceiling, portal crossing, and forbidden-zone blocking. Add behavior tests. Do not add renderer code.
```

### Stage 04 prompt

```text
Read 14_stage_04_three_desktop_scene.md. Render compiled prism cells in Three.js and connect desktop controls to movePlayer. Add a debug overlay. Keep renderer code out of compiler and movement modules. Add only small render-contract tests.
```

### Stage 05 prompt

```text
Read 15_stage_05_portal_viewing.md. Implement one-hop portal views first, then limited recursive portal views if one-hop is stable. Expose public debug data for visible portal images. Do not implement ray tools yet.
```

### Stage 06 prompt

```text
Read 16_stage_06_straight_ray_tool.md. Implement traceStraightRay as a locally straight ray traversal through portals. Add tests for wall hits, portal crossings, max distance, max crossings, and forbidden-zone stops. Do not call this a geodesic solver.
```

### Stage 07 prompt

```text
Read 17_stage_07_environment_tools.md. Add marker placement, path tracing, simple distance and angle measurement, and local discovery log events. The UI should show raw measurements only and must not explain theorems.
```

### Stage 08 prompt

```text
Read 18_stage_08_webxr_vr_controls.md. Add WebXR entry and controller input using Three.js. Keep desktop fallback. Controller input should create movement and tool requests, not duplicate tool algorithms.
```

### Stage 09 prompt

```text
Read 19_stage_09_classroom_hardening.md. Add reset flows, preflight checks, readable error screens, local discovery log export, and GitHub Pages deployment checks. Do not add accounts, analytics, cloud storage, or multiplayer.
```

### Stage 10 prompt

```text
Read 20_stage_10_authoring_compiler_and_qr.md. Add optional JSON authoring import and export that compiles through the existing compiler. Do not implement QR scanning unless explicitly asked. Ensure invalid authoring input cannot bypass compiler validation.
```

### Stage 11 prompt

```text
Read 21_stage_11_general_volume_cells_later.md. Design but do not implement general polyhedron cells unless explicitly requested. If requested, add them as a new cell kind with full validation, collision, portal crossing, straight ray tracing, rendering, and forbidden-zone support.
```

### Stage 12 prompt

```text
Read 22_stage_12_cleanup_pass.md. Perform a cleanup-only pass. Improve names, split mixed-concept files, add public JSDoc to stable APIs, and replace implementation-locking tests with behavior tests. Do not add features.
```

### Bug-fix prompt template

```text
A behavior is wrong: <describe behavior>. Read the relevant stage file and tests. Add a failing behavior test that reproduces the issue without asserting private implementation details. Fix the smallest amount of code needed. Run typecheck, tests, and build. Summarize the behavior fixed and any remaining risk.
```

### World-authoring prompt template

```text
Create a new TypeScript world spec using the existing PrismCellSpec contract. The world should contain <describe rooms and portals>. Do not change compiler or movement behavior unless the current public contract cannot express the requested world. Add a compile test for the world.
```

### Refactor prompt template

```text
Refactor <file or module> for readability only. Preserve public behavior and tests. Do not add features. Do not introduce service classes, registries, or broad abstraction layers. Improve names and comments where they clarify the domain model.
```
