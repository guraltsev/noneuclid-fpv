# 61 - Single-wall push-out lets bodies walk out of a room through any corner

Status: open; re-verified 2026-10-28.

Priority: P1 (correctness). Extends the issue 41 bullet "wall sliding resolves only the first blocking side and does
not re-test". The consequence is worse than "a corner can still violate a second wall": the body leaves the cell without
any limit.

Jobs: [13](../.agents/jobs/13_swept_collide_and_slide.md).

## Status update 2026-10-28

Done (partial fix, not the projection proposed below):

- `moveDynamicObject` (`src/movement/moveDynamicObject.ts:133-155`) now re-tests the pushed position with
  `testCellCollision` against the start cell. If the push out of one wall leaves the body in another wall, a floor,
  ceiling or zone, it returns the original pose ("convex corner" fallback). Covered by
  `tests/movement/moveDynamicObject.test.ts` "falls back to the original pose when pushing out of one wall leaves the
  body inside another (convex corner)" and "still slides along a single wall when moving diagonally into it".
- Re-ran the four-corner repro (throwaway vitest file, current code): the body no longer escapes. All four corners end
  at `(±0.72, ±0.72)`. Shallow diagonals `(0.03, 0.01)` and `(0.01, 0.03)` end at `(0.749999, 0.74)` and
  `(0.74, 0.749999)`, inside the room.

Still open:

- The corner response is "stop", not a slide into the inset corner. The four-corner repro stops 0.03 m (one step) short
  of the acceptance target `(±0.75, ±0.75)`, and any step whose single-wall push lands in a second wall is lost whole.
  The projection onto `K` (or the swept slide of issue 62) is not implemented.
- The re-test covers only walls of the start cell. The "push lands outside the cell across a portal" case still
  reproduces exactly: in a room with a north portal, `δ = (3, 6)` from the origin returns `(0.749999, 6)` in the start
  cell (`blocked: true`), and the next call with zero displacement crosses to the neighbor at `(0.749999, 4)`, which is
  3 m outside the neighbor `[-1,1]^2`.
- No property test of random walks in convex wall-only polygons.

## Summary

`testCellCollision` returns the first non-portal side, in side order, with `d_i(c) < r`. `moveDynamicObject` pushes the
candidate out of that side only and keeps the tangential component. Suppose the motion points into a corner between walls
A and B, and A comes first in side order. Then every step resolves A, and the slide along A carries the body straight
through B, because B is never tested while A is still being hit. No bundled example world has walls (all sides are
portals), so the main exposure today is authored worlds and the test rooms. Issue 64 shows that XR room-scale walking
makes it much worse.

## Evidence

- `src/movement/collision.ts:120-131`: the wall loop returns on the first hit.
- `src/movement/moveDynamicObject.ts:133-155` (was 116-125): resolves `collision.sideIndex` only. (2026-10-28: the pushed
  position is now re-tested and the move is dropped if it is still blocked.)
- `src/movement/moveDynamicObject.ts:252-276` (`resolveBlockedWallPosition`, was 223-247): push along `n_A` by
  `r - d_A + 1e-6`. ~~no re-test~~ re-test added in the caller (2026-10-28).
- Reproduced (scratch script, `vite-node`): square room `[-1,1]^2` with 4 walls, body `r = 0.25`, 200 steps of
  `δ = (±0.03, ±0.03)` from the origin. Final positions:
  `(0.749999, 6.0)`, `(-6.0, 0.749999)`, `(6.0, -0.749999)`, `(-6.0, -0.749999)`. In all four corners the body ends
  5 m outside the room. The escape needs no large step: it happens at 60 fps at 2.5 m/s (`δ ≈ 0.042 m`).
- Second-order effect: `findMostProbablePortalExit` only reports a portal when the most-negative side is a portal. If the
  escaped body later lies more deeply outside a portal side, it "crosses" at a point far outside the glued side and is
  re-expressed outside the target cell too (see issue 62).
- A related failure when the push lands outside the cell: in a room with a north portal, `δ = (3, 6)` from the origin gives
  a candidate outside the east wall (`d = -1`) and outside the portal (`d = -4`, projection out of range). The east-wall push
  returns `(1.75, 6)`, which is 4 m beyond the portal line. The next frame then crosses with zero input and lands 4 m deep in
  (or beyond) the neighbor.

## Proposed change

Replace the single push with a projection onto the admissible set. For a convex cell, the admissible centers with respect to
walls only are

`K = { c : n_i · (c - a_i) >= r  for every wall side i }`

which is the cell polygon inset by `r` along wall sides only, a convex polygon (possibly unbounded across portal sides).
The physically correct non-penetrating "slide" target is the Euclidean projection `Π_K(q)` of the candidate `q`. In 2-D:

1. If every wall constraint holds, return `q`.
2. Otherwise, for each violated wall `i`, project `q` onto the line `n_i·c = n_i·a_i + r` and keep the projection if it
   satisfies all other constraints. Then, for each pair of adjacent violated walls, take the line intersection (the
   inset corner) if it is feasible. Return the feasible candidate nearest to `q`. This is O(k^2) with `k <= 3` in practice.
3. Add a skin `ε = 1e-6` by using `r + ε` in `K`.

Better still, fold this into the swept collide-and-slide loop of issue 62: earliest time of impact on the capsule
(segment ⊕ disk of radius `r`), clip the velocity `v ← v - (v·n)n`, and repeat at most 4 times. If two contacts with
non-parallel normals are both active, set `v ← 0` (crease in 2-D). This also handles the case where a step jumps across a
thin cell.

Precompute `K` per cell and per distinct body radius (cache key `cellId|r`) in `compileCellComplex` or lazily. It is also
the fast path: if `q ∈ K` and `q` is inside every portal half-plane, no further work is needed.

## Acceptance criteria

- The four-corner repro ends with the center inside the room at distance `>= r` from both walls, which for this room is
  `(±0.75, ±0.75)`.
- Property test: random walks (random `δ`, `|δ| <= 0.5`, 10^4 steps) in random convex wall-only polygons never leave
  `K` (by more than 1e-9).
- Sliding along one wall still keeps the full tangential speed (existing tests in `tests/movement/moveDynamicObject.test.ts`:
  "still slides along a single wall when moving diagonally into it" and "resolves blocked non-portal exits back to an
  in-bounds pose near the wall"; both pass today).
