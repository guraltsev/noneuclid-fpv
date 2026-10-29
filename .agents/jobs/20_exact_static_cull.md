# Job 20 - Exact static cull by oriented line stabbing

Status: queued.
Split from issue 56 on 2026-10-28: the defect stays in the issue, the design is here.
Resolves: issue [56](../../_issues/56_exact_static_cull_by_oriented_line_stabbing.md).

## Context

The defect, evidence and current state are in issue [56](../../_issues/56_exact_static_cull_by_oriented_line_stabbing.md).

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
   and `debugTauSigmaDisagreements` (~~the unused `outside-ancestor-portal-slab` reason~~ already removed). Together with their helpers this
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
