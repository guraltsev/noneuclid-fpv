# 04 - Repository scaffold

## Top-level shape

Use a single Vite TypeScript project.

Do not create a monorepo for the first implementation. The proof of concept had package boundaries, but the ground-up rebuild should avoid package overhead until the architecture proves it needs it.

Target structure:

```text
flattened-cube/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  scripts/
    deploy-pages.sh
  public/
    assets/
      README.md
  docs/
    llm-handoff/
      ...this packet...
    design/
      001-stack.md
      002-cell-complex-first.md
  src/
    main.ts
    appState.ts

    math/
      vec3.ts
      rigidTransform3.ts
      planes.ts
      polygons.ts
      intersections.ts
      tolerances.ts

    cell-complex/
      specs.ts
      prismCells.ts
      compileCellComplex.ts
      portalTransforms.ts
      forbiddenZones.ts
      examples/
        twoPrismLoop.ts
        prismTorusLikeRoom.ts
        cubeInspiredPrisms.ts

    movement/
      playerBody.ts
      movePlayer.ts
      collision.ts
      portalCrossing.ts

    tools/
      traceStraightRay.ts
      markers.ts
      pathTrace.ts
      measurements.ts

    render/
      three/
        createThreeApp.ts
        buildCellMesh.ts
        buildPortalMesh.ts
        buildDecorationMesh.ts
        desktopControls.ts
        xrControls.ts
        portalView.ts
        debugOverlay.ts
        renderState.ts

    classroom/
      discoveryLog.ts
      teacherReset.ts
      preflightChecks.ts

    authoring/
      worldSpecs.ts
      validateAuthoringSpec.ts
      qrFutureNotes.ts

    glue/
      browserStorage.ts
      assetUrls.ts

  tests/
    math/
    cell-complex/
    movement/
    tools/
    render-contract/
    e2e/
```

## Import direction

Use this dependency direction:

```text
math
  -> no project imports

cell-complex
  -> math

movement
  -> math + cell-complex

tools
  -> math + cell-complex + movement public types

render/three
  -> math + cell-complex + movement + tools public outputs

classroom
  -> public app/tool state only

authoring
  -> cell-complex specs and validation

glue
  -> browser APIs, storage, URLs, deployment-specific helpers
```

Do not let `math`, `cell-complex`, `movement`, or `tools` import from `render`.

Do not let renderer code become the source of truth for portals, collision, movement, forbidden zones, or ray behavior.

## Public modules versus glue modules

Mathematically and physically meaningful code belongs in:

```text
src/math/
src/cell-complex/
src/movement/
src/tools/
```

Skippable glue belongs in:

```text
src/render/three/
src/glue/
src/classroom/
```

A future reader should be able to audit the world rules without opening `src/render/three`.

## Naming conventions

Prefer files named after public behavior:

```text
compileCellComplex.ts
movePlayer.ts
traceStraightRay.ts
buildCellMesh.ts
```

Avoid generic containers:

```text
engine.ts
manager.ts
system.ts
services.ts
utils.ts
helpers.ts
```

A file named `utils.ts` is allowed only as a temporary placeholder during the first pass, and it must be split during the cleanup pass.

## One app entrypoint

`src/main.ts` should stay small.

It should:

1. select a world spec,
2. compile it,
3. create initial app state,
4. create the Three app,
5. connect controls/tools/debug UI.

It should not contain compiler logic, collision logic, ray logic, or portal math.

## Decision records

Use tiny private decision notes when a choice could otherwise be relitigated by future LLM sessions.

Examples:

```text
docs/design/001-stack.md
docs/design/002-cell-complex-first.md
docs/design/003-no-curvature-engine.md
```

Each decision note should answer:

- What did we decide?
- Why now?
- What are we explicitly not deciding?
- What would cause us to revisit this?

Do not create a documentation site.

## Closing note

Closed as a one-off repository scaffold issue.

The target single-project Vite structure now exists, with the design-note folder
renamed to `docs/design` by user request. Placeholder contracts are intentionally
thin; they establish import boundaries and names without pretending the later
math, movement, collision, portal, or ray behavior is complete.

## Evidence for closing

- Top-level project files now exist: `index.html`, `package.json`,
  `package-lock.json`, `tsconfig.json`, and `vite.config.ts`.
- The requested source directories now exist under `src/`: `math`,
  `cell-complex`, `movement`, `tools`, `render/three`, `classroom`,
  `authoring`, and `glue`.
- `src/main.ts` is a small app entrypoint that wires together world selection,
  compilation, initial app state, and rendering.
- Design notes live in `docs/design/001-stack.md`,
  `docs/design/002-cell-complex-first.md`, and
  `docs/design/003-no-curvature-engine.md`.
- `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` passed after
  the scaffold was added.
