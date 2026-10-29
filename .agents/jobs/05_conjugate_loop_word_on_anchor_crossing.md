# Job 05 - Conjugate a loop's portal word when its shared anchor crosses a portal

Status: queued.
Resolves: issue [68](../../_issues/68_loop_endpoint_crossing_must_conjugate_portal_word.md).

## Goal

Moving the anchor that both ends of one interval share (a same-emitter locked loop, or a free loop in curve
shortening) across portal p must map the word w to p⁻¹wp, so the loop keeps its homotopy class.

## Steps

1. At the three word-update sites listed in [issue 68](../../_issues/68_loop_endpoint_crossing_must_conjugate_portal_word.md) (Evidence), detect "both roles attached to the moved anchor"
   before the single-end branches, and apply the conjugation, then reduce.
2. Add the chain check to `liftGeodesicEndpoint`.
3. Remove the `TODO(issue 68)` comment at `src/world-objects/geodesicCannon.ts:3755`.

## Verification

- The acceptance criteria of [issue 68](../../_issues/68_loop_endpoint_crossing_must_conjugate_portal_word.md), as unit tests in `tests/world-objects/`.
- `npm test` passes.
