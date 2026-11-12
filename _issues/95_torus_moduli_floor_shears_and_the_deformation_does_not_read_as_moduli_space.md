# 95 - The torus-moduli floor shears with the marking, and the deformation does not read as moduli space

Status: open. Parts 1 to 3 landed with job 67 on 2026-11-06 and wait for the maintainer's check of the look (job 67's Report);
part 4 is job 35, rewritten 2026-11-11. Re-verified 2026-11-11.

Reported by the maintainer on 2026-11-05 ("the texture deforms terribly"). Analysed from the code at `f9aa317`; the design below
was prototyped numerically outside the repository (see "How the design was checked").

Priority: P1 (the maintainer called the torus moduli experience a very significant job).

Jobs: [67](../.agents/jobs/_done/67_rigid_floor_patches_and_moduli_readout.md) (parts 1 to 3 below);
[35](../.agents/jobs/35_torus_family_as_teichmuller_space.md) (part 4 and the GL2R generalization, after a rewrite).
Related: closed issue [81](_closed/81_floor_texture_slides_under_objects_during_deformation.md), which this issue partly reverses on purpose;
[55](55_live_deformation_rebuild_cost_and_se2_transforms.md) and [82](82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md) (commit cost).

## Status update 2026-11-11

Correction to part 4. "The new footprint may stay centred at the origin" is wrong. Every corner of the room is one point of the
torus, and the app puts a forbidden-zone cylinder there. The corners of a parallelogram centred at the origin with basis (f1, f2)
are congruent mod the lattice to (f1 + f2)/2. Which half-lattice point that is depends on the new basis mod 2, so a re-marking
centred at the origin can move the corner zone to another point of the torus. Job 35 keeps the corner where it was by offsetting
the room by a half-lattice vector (its decision 3). The rest of part 4 was confirmed from the code: a reduced parallelogram with
the same portal ids passes `validateTopologyPreservingSnapshot`, provided it is counter-clockwise.

The headless-sweep problem from job 67's Report (a headless tab did not advance a deformation) is job 30's first step.

## Summary

`torus-moduli` is meant to teach that a flat torus has a shape, and that different parallelograms can be the same torus.
Today it teaches the opposite, in four ways:

1. **The floor shears.** The floor texture is pinned to the lattice coordinates of the *marked* basis (u, v). Pebbles become
   slivers: 10:1 at the corner of the parameter box.
2. **The floor shows the marking, which is not a property of the torus.** At a = w the torus is exactly the square torus
   again (one Dehn twist), yet its floor is sheared 2.6:1. The same flat torus looks different depending on how it was reached.
3. **Nothing says what just happened.** The computer shows (a, b) and a parallelogram. It never says that (15, 15) is the
   square torus, or that a sweep returned to the start.
4. **The marked cell becomes a sliver.** At (30, 7.5) the cell is 3.64 m wide, so the fixed portal depth buys much less view
   distance across it than along it, although the torus is a plain 15 x 7.5 rectangle.

Steps are also uneven: they are a fixed 0.04 m in (a, b), which is twice the distortion per commit at b = 7.5 as at b = 15, and
a 30 m sweep takes about 750 commits, around 75 s at the measured ~10 commits per second.

## Evidence

### The floor

`src/cell-complex/floorUv.ts#floorLatticeUv` gives a floor point the UV (nU alpha, nV beta), and
`src/cell-complex/deformations/torusSkewDeformation.ts#floorUvFrames` passes the frame of the current state. So the map from
the rest floor to the deformed floor is the whole affine map A with u' = A u, v' = A v. Job 10 accepted this ("the tiles shear
and stretch with the lattice ... that is honest").

The stretch of a tile is the dilatation K of A, from K + 1/K = |A|^2 / det A. With w = 15:

| (a, b) | Which torus | K of the floor today | What the floor should look like |
| --- | --- | --- | --- |
| (0, 15) | square | 1.00 | rest floor |
| (4, 15) | oblique | 1.30 | undistorted |
| (15, 15) | **square again**, one Dehn twist | **2.62** | **the rest floor** |
| (0, 30) | 2:1 rectangle | 2.00 | undistorted |
| (20, 12) | oblique | 4.02 | undistorted |
| (30, 7.5) | 2:1 rectangle | **10.40** | undistorted |

Row (15, 15) is the core of the defect: K measures the path taken, not the shape reached.

Sampling makes it worse. No code sets `texture.anisotropy` (a search of `src` finds nothing), so a 10:1 sheared floor is
filtered isotropically and turns to streaks.

### Why a single texture map cannot work

Three wishes for the floor conflict:

- (S) **seamless**: the same colour at p and p + u and p + v, on every torus;
- (R) **rigid**: pebbles keep their shape and size;
- (C) **carried**: the floor under an object stays with the object.

C for every point of the floor means the floor moves by A, and A is not an isometry, so C and R exclude each other as a global
map. S and R also exclude each other for one global periodic image: a rigid image with period T cannot have period u and v when
the lattice is not a sublattice of T Z^2. Issue 81 chose S and C and gave up R. Every option below gives up something:

| Option | S | R | C | Problem |
| --- | --- | --- | --- | --- |
| Marked lattice UVs (today) | yes | no | yes | K up to 10.4 |
| Reduced-basis lattice UVs | yes | partly (K up to about 1.73) | no | The floor pops whenever the reduced basis or a tile count changes |
| Metric UVs | no | yes | no | Seams at every portal; the floor slides by (A - I) p, up to 30 m |
| **Rigid patches (this issue)** | **yes** | **yes, inside a patch** | **at patch level** | Narrow blend bands between patches |

### The experience around the floor

- `src/ui/paletteDefinition.ts#createGeometryComputerActionsContent` reports only (a, b) in whole metres.
- `src/cell-complex/deformations/torusSkewDeformation.ts#nextTorusSkewStep` steps a fixed Euclidean length. In Teichmuller terms
  a step of s metres at depth b has length s / (2b), so today's 0.04 m is 0.0013 at b = 15 and 0.0027 at b = 7.5.
- Cell widths at (30, 7.5): marked 3.64 m, reduced 7.50 m. At (23, 9): 5.47 m against 11.21 m.

## Design

### Part 1: rigid floor patches

**Idea.** Treat the floor the way the world already treats objects. An object is carried by the deformation as a *position* and
stays rigid as a *shape*. So give the floor a lattice of anchors that move like objects, and let each anchor carry a rigid
patch of the texture.

Let nU, nV be the tile counts (unchanged from job 10). The anchors are the points

    A(i, j) = o + i (u / nU) + j (v / nV),    i, j integers,

with u, v, o from the current state. An anchor keeps its lattice coordinates (i/nU, j/nV), so it moves exactly like an object
placed there. Let G be the **constant** linear map from metres to UV taken from the base state, the inverse of the matrix with
columns u0/nU and v0/nV. Patch A paints

    uv_A(p) = G (p - A).

Each anchor sits on a whole number of tiles, so its UV offset is an integer and the repeating texture needs no per-anchor offset.
Because G never changes, every patch has the rest-state shape and scale: **zero shear inside a patch at every deformation**.

The floor colour is a normalized blend of nearby patches:

    k_A(p) = max(1 - |p - A|^2 / R^2, 0)^16
    w_A(p) = max(k_A(p) - 0.02 max_B k_B(p), 0)
    colour(p) = sum_A w_A(p) texture(uv_A(p)) / sum_A w_A(p)

with R = 1.25 rho, where rho is the covering radius of the anchor lattice.

**Why each property holds.**

- *Rest state unchanged.* At rest all anchors agree: G (p - A) differs from G (p - o) by an integer. So all patches show the same
  colour and the blend is exactly today's floor, with no blur and no visible first commit.
- *Seamless on every torus.* Adding u to p and to A leaves p - A unchanged and maps anchors to anchors, so colour(p + u) =
  colour(p). The same holds for v. No special case exists at portals.
- *Continuous in the deformation.* The weights depend only on distances to the anchor set, and the anchor set moves continuously.
  The reduced basis below is used only to enumerate nearby anchors, so a change of reduced basis changes nothing that is drawn.
- *A Dehn twist closes up.* At (15, 15) the anchor set is the rest anchor set, so **the floor is the rest floor**, pixel for pixel.
  The floor now depends on the torus and its anchors, not on the path. This is the most useful property for teaching: sweep to
  a = 15 and the room looks exactly as it did.
- *Carried at patch level.* A patch centre stays with an object at the same lattice coordinates. Inside a patch the floor can slide
  against an object by at most (A - I) d for an offset d from the anchor, and patches hand over to one another as the lattice
  shears. This is a deliberate partial reversal of issue 81: the slide is bounded by the patch size instead of the room size, and
  in exchange the pebbles stay pebbles. Metric UVs would slide by up to 30 m.

**Finding nearby anchors.** Enumerate anchors in a Lagrange-Gauss reduced basis of the anchor lattice. The marked basis cannot be
used: at (30, 7.5) it is so skewed that the nearest anchors have large indices. In a reduced basis a 3 x 3 neighbourhood of the
rounded coordinates contains every anchor within R for all of a in [0, 2w], b in [w/2, 2w] with nU = nV.

**Weights: two traps.** The `0.02 max` term matters. With exponent 16 the largest kernel value can be as small as 8e-8, so an
absolute cut-off such as `k > 1e-4` leaves pixels with no sample at all (the prototype's first attempt did). Subtracting a fraction
of the maximum keeps the weights continuous, drops them to exactly zero, and always keeps the largest one. Exponent 16 was
chosen over 6 by eye: 6 leaves wide double-image bands, 16 leaves a narrow transition.

**Gradients.** Patch UVs differ by constants, so all patches share one screen-space gradient, computed once from the uniform map G.
Samples use `textureGrad` so that skipping zero-weight patches in non-uniform control flow is legal and does not break mipmapping.

**Cost.** One floor program with a handful of uniforms; 1.1 to 1.4 texture fetches per pixel on average and at most 4, with 9
weight evaluations. One program serves every state including rest, so the first commit compiles nothing.

**Known limits.**

- Blended bands remain visible on close inspection when the anchor lattice is far from square (at (30, 7.5) contrast falls to 0.94).
- Patches all show the same image, so at some states the repetition reads as a quilt. The texture already repeats every tile at rest.
- This suits organic textures. On `tile_grid` or `wood_floor` the patch boundaries would cut straight lines. Both torus worlds use
  `river_pebbles`, so this is accepted; a torus world with a regular floor would need another answer.
- 3 x 3 is enough only while the reduced anchor lattice has an aspect ratio of about 2 or less. A base footprint with nU != nV can
  exceed that, and the floor would then show gaps in the blend. The shipped worlds are 15 m squares; a test pins the range.

### Part 2: steps in the Teichmuller metric

Bound each commit by a Teichmuller length delta instead of metres. The Teichmuller metric is ds = |d tau| / (2 Im tau), so with
fixed width a step of s metres at depth b has length s / (2b), and the allowed step is **s = 2 b delta**. That bounds every commit's
map by K <= e^(2 delta) to first order.

Choose **delta = 1/375**, today's worst case (0.04 m at b = 7.5). Then no commit distorts more than today's worst commit, and no
sweep is slower than today: 0.08 m at b = 15 halves a sweep there, and 0.16 m at b = 30 quarters it.

This job keeps the straight segment in (w, a, b) and only rescales the step. Job 35 proposed moving along the hyperbolic geodesic,
but the parameter box is not hyperbolically convex (the geodesic from (0, 30) to (30, 30) leaves the box: it rises to Im tau = 2.24,
and the box ends at Im tau = 2) and a straight segment is what the diagram shows.

### Part 3: say what the torus is

Compute tau = (a + ib)/w, reduce it to the fundamental domain, and show on the computer page, for the current state and the target:

- the shape (square, hexagonal, rectangular, rhombic, oblique) and the reduced modulus;
- the relation to the start: "the starting torus", "same flat torus, 1 Dehn twist", "same flat torus, marked differently", or
  "a different flat torus".

The target line is the useful one: the user sees "same flat torus, 1 Dehn twist" before pressing GO, then watches the floor confirm it.

Sameness ignores orientation (it compares |Re tau*|), because two mirror-image flat tori are isometric. Text stays in Latin letters:
the palette font has not been checked for Greek.

### Part 4: reduced footprint (job 35, not job 67)

Use the reduced basis as the cell. This fixes the sliver and the view distance. The analysis below corrects job 35.

- **No combinatorial change.** A reduced parallelogram still has 4 sides paired 0-2 and 1-3 by translations. So
  `validateTopologyPreservingSnapshot` already accepts it: it checks cell ids, side counts, heights, portal ids, pairing and side lengths,
  and all of these survive. Job 35's claim that validation must accept a declared re-marking is wrong.
- **No half-lattice shift.** Keep cell-local coordinates and only change the fundamental domain. A point keeps its p and is wrapped by a
  lattice vector into the new parallelogram. The new footprint may stay centred at the origin because any fundamental domain of the
  same lattice works.
- **The floor needs nothing.** Rigid patches are a function of the lattice and p, not of the cell. This is one more reason to do part 1 first.
- **The hard part is words.** `rebuildConnectedGeodesicBetweenEmitters` rebuilds a locked geodesic with its stored portal word, and
  a re-marking changes what a word means. The fix is to develop the old displacement, apply A, trace that chord in the new cell, and pass the
  resulting word as `carriedPortalWord`. A wrap of either endpoint must be folded into the displacement first.
- **That is why it is a separate job.** Jobs 63 to 66 are rewriting the emitter and geodesic code it would touch (`src/world-objects/geodesic/`).
  It should be designed against their result.

## How the design was checked

A Python prototype (not in the repository) evaluated the formulas of part 1 with w = 15 and nU = nV = 6, on a synthetic periodic pebble tile:

| Check | Result |
| --- | --- |
| Rest floor against today's lattice floor, max colour difference | 1e-13 |
| Floor at (15, 15) and (30, 15) against the rest floor | exactly 0 |
| Seam across u and v at six deformed states | at most 3e-13 |
| Change across a reduced-basis switch (a = 7.5, 22.5), for a step of 2e-5 m | 4.5e-4, smooth; in a separate run a switch matched a generic state (mean 0.00085 against 0.00087) |
| RMS floor change per commit at delta = 1/375, measured with exponent 6 (not repeated at 16) | 0.067 to 0.078, about the same as lattice UVs (0.074 to 0.076) |
| Neighbour range needed over the whole box | 1 (3 x 3) |
| Fetches per pixel | average 1.13 to 1.39, at most 4, never 0 |
| Contrast against the source tile | 0.94 to 0.99 |

Not checked: the real `river_pebbles` texture (the KTX2 file was not decoded), GPU cost, the look in a headset, and the GLSL itself.

## Done when

Parts 1 to 3 (job 67):

- At every state of the box, floor patches have the rest shape: UV gradients do not depend on the state.
- The floor is seamless across every portal, and at rest and at (15, 15) it equals the rest floor. Tests pin all of this.
- A commit's map has K <= e^(2 delta), with delta = 1/375.
- The computer page shows shape and relation to the start for the current state and the target.
- A browser sweep to (15, 15) and (30, 7.5) in `torus-moduli` shows undistorted pebbles and no seams, confirmed by the maintainer.

Part 4 stays with job 35.
