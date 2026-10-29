# Development Guide

This is the living overview for building the NonEuclidean FPV experience.

## Project Purpose

Build a private VR/FPS-style exploration environment for discrete non-Euclidean
geometry models. Middle-school students should be able to move through glued
cell worlds, shoot locally straight rays, leave markers, trace paths, compare
measurements, and notice mathematical patterns with limited instructor guidance.

The software provides the environment. It does not teach theorems directly.

## Teaching Stance

The application is a playground, not a tutor. The instructor and course
materials are responsible for interpretation. The software is responsible for a
coherent world and reliable tools.

Initially provide:

- Walkable glued cells.
- Stable portals.
- Collision rules.
- Locally straight ray shooting.
- Markers and path traces.
- Length and angle measurement tools when requested.
- Reset, save, and load support.
- Teacher-authored worlds.
- Simple debug views.

Do not initially provide:

- Automatic theorem explanations.
- Curvature computation.
- Gauss-Bonnet computation.
- Holonomy computation.
- Euler characteristic computation.
- Global point-to-point geodesic solving.
- Adaptive lesson logic.

## First Runtime Model

The runtime should be 3D-cell aware from the beginning, but the first implemented
cell type is a vertical prism over a 2D polygonal base. Students walk inside the
prism. Floors and ceilings are ordinary barriers. Selected vertical side faces
are portals.

The player and placed tools must never intersect the forbidden zone or object
clearance around a portal junction.
Treat this as a movement and collision safety rule, not as a curvature
calculation.

## Stack

Use a single Vite TypeScript project with Three.js rendering, WebXR through
Three.js when VR is added, and Vitest for unit and contract tests. Playwright is
reserved for later browser smoke tests.

Do not use React, Next.js, A-Frame, Unity, Godot, a backend, or a monorepo in the
first implementation.

Useful commands:

```sh
npm run dev
npm run typecheck
npm test
npm run build
npm run build:pages
```

For local classroom serving:

```sh
npm run dev -- --host 0.0.0.0
```

For GitHub Pages, use [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
and set the repository Pages source to `GitHub Actions`. The workflow runs the
test suite, builds the site with the correct Pages base path, publishes
`.nojekyll` so underscore-prefixed asset folders survive deployment, and
deploys the built `dist/` output.

`npm run build:pages` is the local verification build for that deployment path.
Set `VITE_BASE` explicitly for the target Pages repository. The checked-in
helper still has a legacy package-name fallback; its removal is tracked in
[issue 37](../.agents/jobs/03_pages_deployment_configuration.md). See the
[deployment guide](DEPLOYMENT.md) for the current release procedure.

## Repository Map

- `src/main.ts` is the small browser entrypoint.
- `src/appState.ts` holds app-level state contracts.
- `src/math` holds low-level geometry primitives and tolerances.
- `src/cell-complex` holds cell, portal, compiler, transform, portal-path, and
  forbidden-zone rules.
- `src/movement` holds player body, collision, movement, and portal-crossing
  behavior.
- `src/world-objects` holds placeable runtime objects (flags, geodesic emitters,
  measurement tools, creatures) and the object library.
- `src/world-assets` holds floor-texture and other world asset descriptors.
- `src/runtime` holds the runtime menu state, command dispatch, and the
  geometry session, worker, and deformation families.
- `src/ui` holds renderer-neutral palette, help, and input-intent definitions
  shared by the desktop and VR front ends.
- `src/render/three` holds Three.js rendering glue, including the in-scene
  palette and WebXR support; `src/render/dom` holds the few remaining DOM
  overlays. `createThreeApp.ts` is the application shell (scene, shared state,
  frame loop); tool, aim, and debug behavior lives in `create*(deps)` factory
  modules beside it (see the header comment in that file).
- `src/authoring` holds the world builder, world-script compiler, validation,
  and world catalog; `src/examples` holds the authored world scripts.
- `src/glue` holds launch options, debug settings, asset URLs, and other
  browser-facing helpers.
- `public/assets` holds static assets; every asset must be listed in
  [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).
- `tests` mirrors the `src` layout and holds behavior and contract tests.

## Import Direction

Keep mathematically meaningful runtime rules out of renderer files.

Use this dependency direction:

```text
math -> no project imports
cell-complex -> math
movement -> math + cell-complex
world-objects -> math + cell-complex + movement public types
runtime -> math + cell-complex + movement + world-objects + ui definitions
ui -> renderer-neutral definitions only
render/three, render/dom -> all of the above
authoring -> cell-complex specs and validation
glue -> browser APIs, URLs, launch/debug settings
```

`math`, `cell-complex`, `movement`, `world-objects`, and `runtime` must not
import from `render`.

## Focused Guides

- [coding_style.md](coding_style.md) covers code organization, naming, comments,
  public modules, and import boundaries.
- [documentation_style.md](documentation_style.md) covers public docs, JSDoc,
  and in-code narration.
- [testing.md](testing.md) covers testing philosophy, layout, scripts, and stage gates.
- [design/001-stack.md](design/001-stack.md) explains the stack decision.
- [design/002-cell-complex-first.md](design/002-cell-complex-first.md) explains
  the prism-cell-first decision.
- [design/003-no-curvature-engine.md](design/003-no-curvature-engine.md)
  explains the no-curvature-engine boundary.
