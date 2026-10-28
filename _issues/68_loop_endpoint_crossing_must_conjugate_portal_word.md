# 68 - Moving the shared anchor of a loop across a portal must conjugate the word

Status: open as of 2026-10-08.

Priority: P1 (correctness; silent change of homotopy class).

## Summary

When an anchor is attached to both roles of one interval (a same-emitter locked loop, or a free loop in curve
shortening), crossing a portal `p` moves both ends. The correct new word is the conjugate
`reduce(p^{-1} · w · p)`. The code appends `p` only (carry), or prepends `p^{-1}` only (curve shortening). On the
single-cell torus the result passes the cell-chain check, so the loop silently jumps to another homotopy class and
length. On multi-cell worlds the check fails and the loop falls into the legacy path or is deleted.

## Evidence

- `src/world-objects/geodesicCannon.ts:2093-2100` (`updateLockedGeodesicPortalWordForCarriedAnchorTraversal`): the
  `end` test comes first, so a loop with both roles on the carried emitter takes the append branch. The docstring at
  `:2074-2075` states this as intended.
- `:2336-2346` (`resolveCarriedIntervalPortalWord`): same ordering.
- `:3733-3738` (`advanceCurveShorteningPairs`): a free loop gets `movedRole = "start"` only. This is the known gap in
  the comment at `:3728` and in issue 41 ("free loop crossing a portal probably stalls").
- Caller: `src/render/three/geodesicCannonTools.ts:924-962` feeds the result into the rebuild as `carriedPortalWord`.
- Concrete case, torus (`src/examples/torus.world.js`, one square cell of side s = 15 m). Take a locked loop at
  emitter E near the top edge with `w = [py, px]` (heading up and right, holonomy `τ_x + τ_y`, length `s√2 ≈ 21.2 m`).
  Carry E up through `py`.
  - Correct: `p^{-1}·w·p = [py^-1, py, px, py] → [px, py]`, which is the same closed geodesic read from the new base
    point, length 21.2 m.
  - Code: `[py, px, py]`, holonomy `τ_x + 2τ_y`, length `s√5 ≈ 33.5 m`. The single-cell chain check passes. During
    carry, `allowOutOfBoundsCarriedEndpoint` (`geodesicCannonTools.ts:885`) relaxes the word check, so a 33.5 m
    loop is drawn. On release the strict rebuild either keeps that wrong class or deletes the loop.
- Multi-cell case: `w·p` begins in the old cell while the start anchor is in the new one, so
  `portalWordMatchesCurrentEndpointCells` (`:2486`) rejects it and the code falls back to the legacy word path at
  `geodesicCannonTools.ts:974`.
- `liftGeodesicEndpoint` (`:918-959`) never checks that `word[0].sourceCellId === sourceAnchor.cellId`. A
  mismatched word mixes frames silently instead of failing.

## Proposed change

- One helper, used by all three sites:
  ```ts
  function wordAfterAnchorCrossing(interval, anchorId, p): Word {
    let w = interval.portalWord;
    if (interval.end.anchorObjectId === anchorId)   w = [...w, p];
    if (interval.start.anchorObjectId === anchorId) w = [inverse(p), ...w];
    return reduceAdjacentInversePortalTraversals(w);   // both => conjugation
  }
  ```
  Note: the `if`s are not `else if`.
- Also call `reduce` on every stored word at the interval-creation boundary (`createGeodesicIntervalObject`). Words
  coming from traces are already reduced, but `fuse`/`absorb`/carry words should be asserted reduced.
- Make `liftGeodesicEndpoint` return `undefined` when the word does not chain from the source anchor's cell to the
  target anchor's cell (reuse `portalWordMatchesEndpointCellsWithAnchors`).
- Background: vertices are excluded, so the surface deformation-retracts onto the dual graph (cells and glued
  portal pairs). Homotopy classes rel endpoints are therefore exactly the freely reduced words. Conjugation is the
  only correct base-point change, and a reduced word is a canonical key for duplicate detection.

## Acceptance criteria

- Torus test: locked loop `[py, px]`; carry its emitter across `py`. The word becomes `[px, py]` and the length stays
  within 1e-6 m of `15√2`.
- Torus test: a horizontal loop `[px]` with its emitter carried across `py` becomes `[py^-1, px, py]`, which has no
  straight representative (taut around the corner disk). It is reported as a rebuild failure, not as a diagonal loop.
- Two-cell world test: a same-emitter loop survives a portal crossing of its emitter, and the word chain check passes.
- Free loop in curve shortening that crosses a portal: the word is conjugated and the preview succeeds.
