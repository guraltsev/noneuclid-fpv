# Documentation

This folder holds the living project context. Closed handoff issues remain in
`_issues/_closed`, but future work should consult these active documents
first.

## Start here

- [ARCHITECTURE.md](ARCHITECTURE.md) explains how the program is organised:
  the pipeline from world script to rendered frame, the layers, state
  ownership, the frame loop and live geometry deformation.
- [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md) states the mathematics
  precisely (cells, gluing maps, developing maps, motion, geodesics, curve
  shortening, visibility) and where the code realises each statement.
- [generated/ARCHITECTURE_REFERENCE.md](generated/ARCHITECTURE_REFERENCE.md)
  and [generated/API_REFERENCE.md](generated/API_REFERENCE.md) are produced from
  the source (`npm run docs:generate`): module index, dependency graph,
  layering debt, and every exported symbol.

Both hand-written documents contain machine-checked references to the code
(`npm run docs:check`), so a rename or removal cannot silently leave them wrong.

## Living Guides

- [DEVELOPMENT.md](DEVELOPMENT.md) gives a new contributor the install, run,
  verification, and issue-tracking workflow.
- [DEPLOYMENT.md](DEPLOYMENT.md) records GitHub Pages, HTTPS, WebXR, and release
  checks without placing them in the learner-facing README.
- [Development_guide.md](Development_guide.md) gives the project overview,
  repository map, stack summary, deployment notes, and links to the focused
  guides.
- [coding_style.md](coding_style.md) records code organization, naming, import
  boundaries, and implementation style.
- [documentation_style.md](documentation_style.md) records public documentation
  and in-code explanation rules.
- [testing.md](testing.md) records the testing philosophy, scripts, and what
  each kind of test should prove.
- [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) is the canonical record of
  third-party asset origins, licenses, required credits, and release status.

## Design Records

- [design/001-stack.md](design/001-stack.md) records the Vite, TypeScript,
  Three.js, and Vitest choice.
- [design/002-cell-complex-first.md](design/002-cell-complex-first.md) records
  the prism-cell-first runtime direction.
- [design/003-no-curvature-engine.md](design/003-no-curvature-engine.md)
  records the no-theorem-engine boundary for the first runtime.
- [design/004-domain-model.md](design/004-domain-model.md) fixes the shared
  vocabulary for cells, portals, rays, tools, and forbidden zones.
- [design/005-stage-01-math-primitives-guide.md](design/005-stage-01-math-primitives-guide.md)
  and [design/006-non-euclidean-renderer-general-01.md](design/006-non-euclidean-renderer-general-01.md)
  hold the math-primitive and renderer background notes.
- [design/007-authoring-model.md](design/007-authoring-model.md),
  [design/008-runtime-contracts.md](design/008-runtime-contracts.md), and
  [design/009-asset-system.md](design/009-asset-system.md) describe authoring,
  runtime contracts, and the asset pipeline.
- [design/010-webxr-vr-runtime.md](design/010-webxr-vr-runtime.md) and
  [design/011-vr-hand-tools-palette.md](design/011-vr-hand-tools-palette.md)
  cover WebXR and the shared tool palette (011 is a historical record).

## Other Records

- [testing.md](testing.md), [acceptance-checklists.md](acceptance-checklists.md),
  and [llm-implementation-workflow.md](llm-implementation-workflow.md) cover
  verification and LLM-assisted workflow.
- Open work lives in `_issues`; closed work in `_issues/_closed`.

## Handoff Packet

The staged handoff packet now begins at
[implementation-reading-order.md](implementation-reading-order.md). The
non-stage design and workflow notes were promoted into stable docs, while the
remaining stage-specific handoff files stay in `_docs/llm-handoff`. Parts `01`
through `04` were completed as bootstrap work and archived in
`_issues/_closed` with closing notes and evidence.
