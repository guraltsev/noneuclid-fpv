# Documentation Style

Documentation should make future implementation sessions safer, not create a
second product.

## Public Documentation

Use public docs for durable project context:

- What the project is for.
- What the project is explicitly not doing yet.
- Which architectural boundaries matter.
- Which decisions should not be relitigated without new evidence.
- How to run, test, build, and deploy the app.

Do not create a documentation site during the first implementation.

## Enforced rules

`npm run docs:check` (also run by `npm test`) fails when:

- a module under `src/` has no header comment: a leading `/** ... */` block,
  before the imports, of at least one full sentence saying what the module is
  for, where it sits in the pipeline, and its key invariants;
- an exported declaration has no JSDoc; the **first sentence** must be a
  self-contained summary because it is copied into the generated API reference;
- `_docs/generated/*` is out of date (`npm run docs:generate` rewrites it);
- a module imports across layers in a way that is not allowed and not in
  `scripts/docs/layering-baseline.json`;
- a backticked `src/<dir>/<file>.ts#<symbol>` reference in a hand-written
  document points at something that no longer exists.

State units (meters, radians), coordinate frames (cell-local x right, y forward,
z up), preconditions, and failure behavior (throws or returns `undefined`) in
JSDoc. Put mathematics that spans modules in
[MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md) with symbol references instead of
repeating it in code comments.

## JSDoc

Public JSDoc should document contracts, intended use, observable behavior,
guarantees, limitations, inputs, outputs, side effects, and intentional errors.

Do not use JSDoc as a source-code tour. If a function has a dense algorithm,
put narration in block comments inside the function instead.

## In-Code Narration

Code should read like an explained calculation. Use short comments before
nontrivial blocks to explain what the next block establishes, preserves,
constructs, or rejects.

Good:

```ts
// Reject a portal that touches a forbidden junction too closely. The player
// must always cross through the interior of a portal face.
if (distanceToPortalJunction < forbiddenRadiusMeters) {
  return blockedByForbiddenZone(...);
}
```

Avoid comments that merely restate syntax:

```ts
// Check distance.
if (distance < radius) {
  // ...
}
```

## Decision Notes

Use tiny private decision notes when a choice could otherwise be relitigated by
future sessions. Decision notes live in `_docs/design` and should answer:

- What did we decide?
- Why now?
- What are we explicitly not deciding?
- What would cause us to revisit this?

Closed one-off work belongs in `_issues/_closed` with a closing note and
evidence, but closed issue files should not be the main source of living project
context.
