# 56 - The static cull is not provably conservative

Status: open; implemented by job 20, which ended "done, needs review" (manual check not run); see the Report in `.agents/jobs/_done/20_exact_static_cull.md`. Re-verified 2026-10-28.

Priority: P1 (correctness / design). This proposes the fix for the "static visibility cull is not provably conservative"
item in issue 41. It does not file that defect again.

Jobs: [20](../.agents/jobs/20_exact_static_cull.md).

## Status update 2026-10-29

Re-checked at `0b468e1`: unchanged, all `staticPortalPathCull.ts` line references below still hold. Stale references:
the budget constant is now `createThreeApp.ts:788` (`portalPathOptions`, not `:767`) and `cellRenderArchetypes.ts:179`
(not `:176`). Job 20 was rewritten with the full design (cone module, measure floor 1e-9 m, best-first budget, unequal
heights out of scope).

## Status update 2026-10-28

Nothing in the proposal is implemented. `src/cell-complex/staticPortalPathCull.ts` (1639 lines) still uses the
aperture-plane tests plus the tau/sigma transversal: interval branch-and-bound with at most 8 splits, then the
projective-chart polygon clipping. Every evidence item below still holds; line numbers have been updated to the
current file. One small item is already done: the unused `outside-ancestor-portal-slab` reason is gone, so
`StaticPortalPathRejectReason` now has four members, `outside-ancestor-portal-plane`,
`outside-ancestor-vertical-range`, `no-static-line-transversal` and `static-path-budget`. The acceptance item asks
for two. There is still no property test with random prism chains. Two culling paths share the same logic and both
need replacing: `buildStaticallyCulledPortalPathTables` (`:184`) and `staticallyCullPortalPathTables` (`:354`).

## Summary

`staticPortalPathCull.ts` checks a portal word in two ways: aperture slack tests, and an unordered, unoriented
"segment PQ meets every window" test. The second test is solved in two stages: interval branch-and-bound, then a
projective chart. That chart loses every sight line that crosses the line sent to infinity (issue 41).

Within a convex cell the true condition is linear. Once each portal carries its crossing direction, "a plan-view
line crosses portals 1..k in order" is a homogeneous linear feasibility problem in 3 variables. It is exact, needs no
charts, and can be updated one portal at a time along the BFS. It also makes the aperture-plane test redundant. That
removes the 0.075 m slack, which rejects more paths as it grows (issue 41).

## Evidence

- `staticPortalPathCull.ts:514` (`rejectByTauSigmaTransversal`; the length check is at `:523`): words of length 2 or less are never tested. This is
  right, but only because of convexity, and the code never uses that fact.
- `staticPortalPathCull.ts:814` (`projectedRayIntersectsWindow`) and `:994` (`clipDomainsByOppositeSigns`): each window
  is a disjunction ("opposite signs"), so the feasible set is a union of up to 2^(2(k-2)) convex pieces, held down only
  by `pruneTauSigmaDomains`. Neither orientation nor order is used.
- `staticPortalPathCull.ts:694-735`: the chart restriction (`clipDomainsBySameSigns`, `clipDomainsToWindowChart`) drops
  lines that cross the critical line. This is non-conservative, as recorded in issue 41.
- `staticPortalPathCull.ts:201` (and `:378`): `cullTolerance = max(tol, r_junction/2)`. Then `:1548` rejects a path when every
  corner satisfies `distance > -cullTolerance`. A destination that reaches up to 7.5 cm past an ancestor plane is
  dropped, which is the wrong direction for a tolerance.
- `staticPortalPathCull.ts:246-261`: budget truncation. When `maxKeptPathsPerRoot` (50 000, `createThreeApp.ts:767`; also `cellRenderArchetypes.ts:176`)
  runs out partway through a depth level, the paths kept at that level are a prefix of `cell.portals` order. Deep
  visibility then becomes direction-biased: whichever directions come first in the array see deepest.

Why the oriented test is exact. Develop the portal segments s_i = [L_i, R_i] into the root plan. Label the endpoints so
that L_i is on the left of a direction that leaves C_{i-1} through s_i, that is, `cross(-n_in, L_i - mid_i) > 0`. A
directed line ℓ = (a, b, c) has direction (b, -a) and left side {a x + b y + c > 0}. Impose:

    ℓ·(L_i, 1) >= 0,   ℓ·(R_i, 1) <= 0,   i = 1..k.

These inequalities say that ℓ crosses s_i in the C_{i-1} -> C_i sense. Within the convex cell C_i, a line that enters
through s_i must leave through the next face it meets. So, by induction, the crossing parameters satisfy
t_1 < t_2 < ... < t_k, and the order comes for free. Any line that crosses s_1 also passes through R just before s_1,
so some camera position in R lies on it. The conditions are therefore necessary and sufficient for a plan-view sight
line along the word. With equal cell heights, any horizontal line at eye height in (0, h) gets through every aperture,
so the plan test is exact in 3D as well. The test also implies the aperture-plane test: s_k lies beyond the plane of
p_i, so C_k cannot lie entirely on its inner side.

## Fix

Tracked as job [20](../.agents/jobs/20_exact_static_cull.md). This issue is resolved when that job's acceptance criteria hold.

## Merged from issue 41 (2026-10-28)

Issue 41's P1 item "static visibility cull is not provably conservative" is tracked here. The current code has these
defects; the LP in this issue replaces all of them:

- The aperture slack (at least 0.075 m, `max(toleranceMeters, junction radius / 2)`) makes rejection *more*
  aggressive as it grows (`TODO(issue 56)` at `staticPortalPathCull.ts:199` and `:376`).
- The projective tau/sigma stage never tests sight lines that cross the line sent to infinity
  (`TODO(issue 56)` at `:702`).
- `toleranceMeters` is compared against dimensionless quantities.
- Projection construction and the intersection test use different parallelism thresholds.

Needs rendering comparisons before and after, not a blind change.
