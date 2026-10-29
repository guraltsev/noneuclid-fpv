# 67 - Curve shortening by gradient descent does not find the taut string

Status: open; re-verified 2026-10-28.

Priority: P1 (correctness + design). Supersedes the "Tick Geometry" and "Monotonicity" sections of issue 32 and
resolves the issue-41 items "failed fusion leaves a stuck ready-to-fuse pair", "degenerate free loop never deleted"
and "failed previews retried forever", which are all symptoms of the problem below. Issue 66 covers the immediate
stall bug.

Jobs: [26](../.agents/jobs/26_exact_curve_shortening.md).

## Status update 2026-10-28

Not started: there is no `src/world-objects/geodesics/` directory and no sleeve or funnel code. Curve shortening is
still the free-vertex descent in `advanceCurveShorteningPairs` (`src/world-objects/geodesicCannon.ts:3628`), with
`curveShorteningFuseAngleToleranceRadians`, `curveShorteningMinStepMeters` (`:582-586`), `absorbShortCurveShorteningHalf`
(`:4030-4152`) and `cleanupCurveShorteningPreviewFailure` (`:4348-4425`) all in place.

Changes since the issue was written:

- The ray–disk test now reports a hit at `t = 0` when the start is inside or on the disk (`intersectRayWithForbiddenZone`,
  `:5897-5899`; test "stops immediately when a segment starts inside a forbidden zone"). The third evidence bullet below is
  therefore stale: an arc whose `start` role sits inside a disk now fails its preview like the reversed arc. The
  descent still moves X with `ignoreForbiddenZones: true` (`:3738`), so the delete/split outcome described in the first
  bullet is unchanged.
- A failed non-zone fusion no longer stays `ready-to-fuse`: `advanceCurveShorteningPairs` reverts the pair to `moving`
  (test "reverts a ready-to-fuse pair to moving when its fusion preview fails without a forbidden zone"). This removes the
  stuck object but not the cause: the pair can cycle between `moving` and `ready-to-fuse` while the chord of `w` stays
  outside the sleeve.
- Fusion now checks for an already existing stable geodesic with the same anchors and the same word, in either direction
  (`findEquivalentStableInterval`, `discardCurveShorteningPairInFavorOf`; tests under "fusing into an already existing
  geodesic"). The exact solution must keep this check.

Issues 31 and 32 (closed 2026-10-28) left a set of end-to-end Phase F tests unwritten. They test outcomes, not the
descent, so they apply to the exact solution as well; they are listed under "Carried over from issues 31 and 32" below.

Remaining: everything under "Proposed change" and "Acceptance criteria".

## Summary

The answer the descent approximates can be computed exactly. For a pair (A ← X → B) with arc words `w_A` and `w_B`,
the length-minimizing path in the class of the fused word `w = reduce(w_A^{-1} · w_B)` is:

- the straight chord `Ã B̃` in the development, if that chord stays inside the sleeve of `w`; otherwise
- the taut string through the sleeve: straight pieces joined by wraps around the exclusion disks
  (r = 0.15 m, `src/cell-complex/forbiddenZones.ts:9`) at the portal junction vertices.

The current code finds neither reliably. When the taut string should wrap a disk, the descent drives an arc into the
disk, and the code then deletes or splits the construction.

## Evidence

- Free-vertex move ignores zones: `src/world-objects/geodesicCannon.ts:3733-3739` (`ignoreForbiddenZones: true`).
  When a cone point lies inside the developed triangle (Ã, X, B̃), the arcs sweep across its disk as X descends. The
  preview of an arc that ends at X then reports `forbidden-zone-hit`. `cleanupCurveShorteningPreviewFailure`
  (`:4348-4425`) deletes that arc and turns the other into an ordinary free geodesic on a new free end at the last
  good point. The user's tied construction falls apart exactly when the correct answer is a geodesic polygon with a
  corner at that cone point.
- Fusion previews only the straight chord of `w` (`:3990-3998`). If the chord leaves the sleeve (wall hit or a
  different word) the pair stayed `ready-to-fuse` forever; it now reverts to `moving` and is flagged again on a later
  tick (see the status update). Same mechanism as above, seen at the end of the flow.
- ~~An arc whose *start* role is X does not notice the zone at all once X is inside the disk. The ray–disk test treats
  a start inside the disk as no hit (`:5769-5771`). The outcome therefore depends on how the roles are oriented; see
  issue 69.~~ Fixed: a start inside or on the disk is now a hit at `t = 0` (`:5897-5899`).
- Free loops (one interval with both roles on F; `fuseCurveShorteningPair`, `:3921-3946`). The loop length is
  `L(F) = |g_w^{-1}(F) - F|`, where `g_w = (R_θ, t)` is the holonomy of the loop word. If `θ = 0` (every torus
  word), L is constant: every F on the cylinder gives a closed geodesic and nothing should move. If `θ ≠ 0`,
  `L(F) = 2|sin(θ/2)|·|F - c|` with `c = (I - R_θ)^{-1} t` (the developed enclosed cone point). The loop always
  collapses into that disk. The descent cannot reach either outcome cleanly.

## Fix

Tracked as job [26](../.agents/jobs/26_exact_curve_shortening.md). This issue is resolved when that job's acceptance criteria hold.

## Merged from issue 41 (2026-10-28)

Curve-shortening defects from issue 41 that the exact solution must not reproduce. Each needs a test.

- Several helpers assume the emitter sits at the non-free `start` end; an emitter at `end`, or another anchor kind, is
  rejected (`TODO(issue 67)` at `geodesicCannon.ts:3955`, also `absorbShortCurveShorteningHalf`).
- `tieAndDetachGeodesicEndpoints` deletes geodesics when a forbidden-zone rebuild fails, instead of rolling back.
- A rejected (lengthening) step is skipped, not rolled back to a fused geodesic.

The other curve-shortening items of issue 41 are tracked in [66](_closed/66_curve_shortening_stalls_at_high_frame_rate.md) (the short free loop stall, `TODO(issue 66)` at
`geodesicCannon.ts:3727`) and [68](_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md) (a free loop whose free end crosses a portal, `TODO(issue 68)` at `:3755`).
