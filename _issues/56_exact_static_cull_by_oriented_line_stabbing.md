# 56 - Exact static cull: oriented line stabbing replaces the tau/sigma machinery

Status: open as of 2026-10-08.

Priority: P1 (correctness / design). This proposes the fix for the "static visibility cull is not provably conservative"
item in issue 41. It does not file that defect again.

## Summary

`staticPortalPathCull.ts` checks a portal word in two ways: aperture slack tests, and an unordered, unoriented
"segment PQ meets every window" test. The second test is solved in two stages: interval branch-and-bound, then a
projective chart. That chart loses every sight line that crosses the line sent to infinity (issue 41).

Within a convex cell the true condition is linear. Once each portal carries its crossing direction, "a plan-view
line crosses portals 1..k in order" is a homogeneous linear feasibility problem in 3 variables. It is exact, needs no
charts, and can be updated one portal at a time along the BFS. It also makes the aperture-plane test redundant. That
removes the 0.075 m slack, which rejects more paths as it grows (issue 41).

## Evidence

- `staticPortalPathCull.ts:509` (`rejectByTauSigmaTransversal`): words of length 2 or less are never tested. This is
  right, but only because of convexity, and the code never uses that fact.
- `staticPortalPathCull.ts:801` (`projectedRayIntersectsWindow`) and `:974` (`clipDomainsByOppositeSigns`): each window
  is a disjunction ("opposite signs"), so the feasible set is a union of up to 2^(2(k-2)) convex pieces, held down only
  by `pruneTauSigmaDomains`. Neither orientation nor order is used.
- `staticPortalPathCull.ts:616-668`: the chart restriction (`clipDomainsBySameSigns`, `clipDomainsToWindowChart`) drops
  lines that cross the critical line. This is non-conservative, as recorded in issue 41.
- `staticPortalPathCull.ts:229`: `cullTolerance = max(tol, r_junction/2)`. Then `:1525` rejects a path when every
  corner satisfies `distance > -cullTolerance`. A destination that reaches up to 7.5 cm past an ancestor plane is
  dropped, which is the wrong direction for a tolerance.
- `staticPortalPathCull.ts:266-273`: budget truncation. When `maxKeptPathsPerRoot` (50 000, `createThreeApp.ts:763`)
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

## Proposed change

1. Store with each kept path its feasible cone K_p in R^3 = {ℓ satisfying the 2k inequalities}. Represent K_p by its
   extreme rays in cyclic order (typically 3 to 6 rays).
   - Depth 2: take the four endpoint-pair lines X × Y (homogeneous cross product) for X in {L1, R1} and Y in {L2, R2}.
     Orient each so that d·(-n_in,1) > 0, keep those that satisfy all four constraints, and sort them by the angle of d.
   - Child step: clip K_parent by the two half-spaces h·ℓ >= 0 using homogeneous Sutherland-Hodgman. On a sign change
     between consecutive rays r_a (inside) and r_b (outside), insert r = (h·r_a) r_b - (h·r_b) r_a. Both coefficients
     are positive and h·r = 0.
   - Reject the child when no ray remains. Cost is O(|K|) per child, with no search, branch-and-bound or charts.
2. Conservative tolerance: widen every segment by δ along its own direction (L <- L - δu, R <- R + δu, with δ around
   1e-6 times the world scale) before clipping, and count a ray as inside when h·r >= -ε|h||r|. Both choices only
   enlarge K.
3. Delete the following: `rejectGeometrically` (subsumed), the interval B&B, the projective stage,
   `debugTauSigmaDisagreements`, and the unused `outside-ancestor-portal-slab` reason. Together with their helpers this
   is about 900 lines of `staticPortalPathCull.ts`.
4. Budget: replace BFS-prefix truncation with best-first expansion, using a priority queue keyed on the Crofton measure
   μ(K_p) of the set of lines in K_p. In (θ, p) line coordinates, μ = ∫ (min upper_i(θ) - max lower_j(θ))^+ dθ with
   upper/lower = x cosθ + y sinθ at the constraining endpoints, integrated over the θ-range of the cone's rays. For
   depth 2 this reduces to the crossed-strings formula μ = |L1R2| + |R1L2| - |L1L2| - |R1R2|. Because μ never increases
   from parent to child, best-first still lists parents before children, and the budget then drops the least visible
   words in every direction rather than one arbitrary direction.
5. Unequal heights (issue 41): if they become supported, add the vertical constraint as a second 2D LP in (distance,
   height) over the crossing parameters, or fall back to keeping the path.

## Acceptance criteria

- A property test over random convex-prism chains, including cone points with angle sum above and below 2π, finds no
  word with a sampled sight line (camera in R, random direction, exact ray walk) that the cull rejects.
- The old and new culls agree on every example world except where the old one rejected a word that has a witness line.
  Each such word is listed in the PR as a fixed false rejection.
- `StaticPortalPathRejectReason` is reduced to `no-static-line-transversal | static-path-budget`.
- Build time for the default worlds at depth 10 does not regress. The expectation is that it improves, since O(|K|)
  replaces up to 8 B&B splits plus clipping of a union of polygons.
