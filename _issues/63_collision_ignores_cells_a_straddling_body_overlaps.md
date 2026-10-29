# 63 - Bodies that straddle a portal are tested only against their own cell

Status: open; re-verified 2026-10-28; fix designed 2026-10-29.

- Kernel landed in job 12 (`segmentWalk.ts`, `developedDisk.ts`); callers move in job 13.

Priority: P2 (correctness). Category: design. The fix supplies the obstacle set used by issue 62.

Jobs: [13](../.agents/jobs/13_swept_collide_and_slide.md).

## Status update 2026-10-29

Design decided in [job 12](../.agents/jobs/12_segment_walk_kernel.md) (atlas) and
[job 13](../.agents/jobs/13_swept_collide_and_slide.md) (obstacles); the ghost item is
[job 17](../.agents/jobs/17_multi_hop_ghosts_and_eye_rerooting.md). Not implemented yet.

- The local atlas is built as described, with wedges seen from the body centre. A prototype (2026-10-29) showed that
  the copies tile the disk exactly once in cube, icosahedron, torus-moduli, dodecahedron, genus-2 torus and tetrahedron,
  **also when the disk contains a cone point** (the atlas is the straight-ray chart from the centre). So the
  "Creatures" concern does not require turning zones on: creatures keep `ignoreForbiddenZones: true`.
- Runtime bodies become discs in the same swept slide (radius r + r_o, only with vertical overlap); the player's
  "revert if the overlap grows" check and the creatures' same-cell obstacle test are replaced by it.
- The area acceptance test is done as a sampled tiling test in job 12.

## Status update 2026-10-28

Nothing is done; every query is still single-cell.

- `testCellCollision` (`src/movement/collision.ts:120-131`) loops over `candidate.cell.sides` only; the module header
  says "Collision is only evaluated against the object's own cell, never against neighboring cells."
- Player vs runtime objects: `playerIntersectsRuntimeObject` calls
  `runtimeObjectRegistry.getPlayerBlockingObjectsInCell(pose.cellId)` (`src/render/three/createThreeApp.ts:3266`).
- Creature vs player: `creatureIntersectsObstacle` still skips `obstacle.cellId !== state.cellId`
  (`src/world-objects/simpleGeoCreature.ts:366`), and creatures still pass `ignoreForbiddenZones: true` (line 242).
- Ghosts: `runtimeObjectGhostRecords.ts:80-83` still uses the `[-r, L+r]` projection window and the 1-ring only.
- No local atlas, no neighbor obstacle collection, no atlas test. Line numbers in the body below are corrected.

## Summary

A body is a disk of radius `r` in a flat surface. When its center is within `r` of a portal side, part of the disk lies in
the neighbor cell. Every collision query uses only the owning cell:

- walls and zones: `testCellCollision` loops over `candidate.cell` only (`src/movement/collision.ts:100-131`, unchanged);
- player vs runtime objects: `getPlayerBlockingObjectsInCell(pose.cellId)` (`src/render/three/createThreeApp.ts:3266`);
- creature vs player: `if (obstacle.cellId !== state.cellId) return false` (`src/world-objects/simpleGeoCreature.ts:366`);
- render ghosts are emitted into the 1-ring only, using a loose `[-r, L+r]` projection window
  (`src/render/three/runtimeObjectGhostRecords.ts:70-83`).

## Evidence

- **Player and creature on opposite sides of a portal interpenetrate.** Take a player at 0.1 m before a portal and a mouse
  at 0.1 m beyond it, both `r = 0.25`. Their developed centers are 0.2 m apart, which is less than `0.5`, yet neither
  blocks. The ghost renderer draws the mouse's ghost inside the player's view, so the overlap is visible.
- **Neighbor walls.** Let the glued vertex make interior angle `α` between the portal side and a wall in the neighbor. A
  center on the portal line at distance `s` from the vertex overlaps that wall iff `s·sin α < r`. The zone forces
  `s >= r + 0.15`, so for the player (`r = 0.25`) the overlap happens iff `α < arcsin(0.25/0.40) = 38.7°`. Creatures run
  with `ignoreForbiddenZones: true` (`simpleGeoCreature.ts:242`), where `s` is unbounded below, so any `α < 180°` overlaps.
  After the anchor crosses, the neighbor-wall push along `n_W` (which has a component `-cos α` *back across the portal*)
  moves the anchor back out, and the body ping-pongs between cells (see issue 61 for the missing re-test).
- **Cone points inside the body.** With zones ignored, a creature's disk can contain a vertex of angle sum
  `θ ≠ 2π`. There, "the disk" is not a flat disk at all: it is a cone of angle `θ`. No single-chart test can be right. The
  zone radius is what guarantees flatness: `|c - v| >= r + r_z > r` keeps every cone point out of the body.

## Proposed change

**Local atlas per query.** Given `(cell C, center c, reach ρ = r + |δ| + skin)`, build the list of cell *copies* overlapping
the disk `B(c, ρ)`, each with a developing map `h_k` into C's frame:

```
atlas = [(C, I, aperture = whole plane)]
queue = [(C, I, aperture)]
while queue:
  (D, h, A) = pop
  for portal side P of D (excluding the one we came through):
    seg = h(P.segment) clipped to A
    if dist(c, seg) >= ρ: continue
    h' = h ∘ g_P^{-1};  A' = A ∩ wedge(c, seg)        // star-shaped from c
    push (target(P), h', A') to atlas and queue
```

Because zones keep the disk flat, the pieces `h_k(D_k) ∩ A_k ∩ B(c, ρ)` tile `B(c, ρ)` without overlap. Depth is bounded
by the number of cells around a vertex (for example 5 for the icosahedron). Clip with the aperture wedge `A` so that,
around a cone point of angle `< 2π`, copies that overlap in the plane but belong to different sheets are not mixed.

From the atlas, collect obstacles in C's frame:

- wall segments `h_k(W)` (clipped to `A_k`) → capsules of radius `r`;
- zone discs `h_k(v)` → discs of radius `r + r_z`;
- runtime bodies registered in `D_k`, with center `h_k(c_o)` → discs of radius `r + r_o`.

Feed these to the swept test of issue 62.

**Caching.** Portal-path tables already enumerate developed neighbors for rendering. Precompute per cell the copies whose
developed polygon lies within `R_max` (max body radius + max step) of the cell, and filter per query by `dist < ρ`.

**Creatures.** Either stop passing `ignoreForbiddenZones: true` for bodies (keep it for zero-radius tool points such as
`geodesicCannonTools.ts:606`), or clamp creature radius into the zone test, so that the flat-disk invariant holds for
every body.

**Ghosts.** Use the same atlas, so a body near a vertex ghosts into every overlapping copy and not only the 1-ring. Replace
the `[-r, L+r]` window with `dist(c, segment) < r`.

## Acceptance criteria

- The player-vs-mouse straddle above blocks (player reverts or slides) in both orders of cell ownership.
- In a test complex where a wall meets a portal at `α = 30°` in the neighbor, a body sliding along the portal never
  overlaps that wall and never changes cell more than once.
- Atlas unit test: around each vertex of `icosahedron` and `cube`, the copies collected for `B(c, 0.25)` with
  `|c - v| = 0.4` have total clipped area `π·0.25²` (±1e-6).
