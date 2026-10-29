# Testing

Tests should make refactoring safe by checking public behavior and contracts,
not private implementation details.

## Commands

```sh
npm run typecheck
npm test
npm run build
```

Use `npm run test:watch` during active implementation.

## Philosophy

Good tests describe observable behavior:

```text
Moving through a portal transforms the player position and facing direction by
the portal transform.
```

Avoid tests that freeze private structure:

```text
compilePrismCells calls makePortalMap exactly once.
```

Tests must not depend on private function names, internal loop structure,
renderer pass counts, incidental object layout, or helper-call counts.

## What To Test

Prioritize behavior tests for:

- Geometry primitives and explicit tolerances.
- Cell and portal spec validation.
- Prism-cell compilation.
- Portal transforms.
- Forbidden-zone rejection near portal junctions.
- Player movement, collision, and portal crossing.
- Geodesic and straight-ray tracing through portals.
- Runtime object behavior (flags, emitters, measurement tools).
- Runtime menu state and command dispatch.

Renderer tests should be contract or smoke tests. They should prove that the app
can build and that public render functions accept the expected domain outputs,
not that Three.js internals have a particular object layout.

## Test Layout

`tests/` mirrors `src/`:

```text
tests/math/            tests/cell-complex/     tests/movement/
tests/authoring/       tests/runtime/          tests/ui/
tests/world-objects/   tests/render-contract/  tests/fixtures/
```

`tests/typecheck/` holds compile-time-only assertions checked by
`npm run typecheck`.

## Tests That Must Not Be Written

Do not write tests that assert private helper names, exact source organization,
exact renderer pass counts (unless a public debug-mode contract), identity of
generated Three.js meshes, large snapshots, or implementation-only tolerances
not exposed as behavior.

## Failing Tests

If a test fails, decide whether it expresses a public contract. Fix the
behavior if it does; revise the test only if it does not. Never delete a
failing test merely because the implementation changed. A skipped test needs a
tracking issue.

## Browser Smoke Tests

Browser smoke tests are `scripts/smoke/browser-smoke.mjs` (Chrome DevTools Protocol, no Playwright). They check start-up and integration only, never mathematical correctness, and run by hand (see `DEVELOPMENT.md`).

## Stage Gates

Before closing implementation work for a stage, run:

```sh
npm run typecheck
npm test
npm run build
```

If a command cannot be run, record that explicitly in the closing note or final
handoff.
