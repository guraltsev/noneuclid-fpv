# Job 35 - Cut the torus room from a reduced basis (re-marking)

Status: queued (rewritten 2026-11-11 against `aab3ff5`; the text before that date predated the engine wave and job 67, and is replaced).
Former issue: 54. Resolves: issue [95](../../_issues/95_torus_moduli_floor_shears_and_the_deformation_does_not_read_as_moduli_space.md),
part 4.

Priority: P1 (with issue 95; the maintainer called the torus moduli experience a very significant job).

## Goal

In `torus-moduli` the room is always a reasonable parallelogram. Today the room is the parallelogram of the *marked* basis
\(u = (w, 0)\), \(v = (a, b)\), so at \((a, b) = (30, 7.5)\) it is a 14 degree sliver 3.6 m wide, although that torus is a plain
15 m by 7.5 m rectangle. After this job the room is cut from a short, nearly orthogonal basis of the same lattice, and the cut changes
("re-marking") when the deformation makes the current cut too skewed. Nothing a person can see in the world changes at a re-marking:
same torus, same positions, same geodesics, same floor. Only the room's walls (the fundamental domain) move.

### What a re-marking is (read this first)

A flat torus is the plane divided by a lattice \(\Lambda\) of translations. Any basis \((f_1, f_2)\) of \(\Lambda\) cuts the plane into
parallelograms, and any one of them, with opposite sides glued, is the same torus. The family state \((w, a, b)\) fixes one basis, the
marked one, and the deformation moves it continuously; the readout (job 67) already reduces it to tell which torus it is. A
*re-marking* replaces the room's basis by \(\gamma \cdot (u, v)\) for an integer matrix \(\gamma\) of determinant 1. The lattice, and so the
torus, is unchanged; what changes is which portal side translates by which lattice vector, so every point is re-expressed in the new
room (wrapped by a lattice vector) and every stored portal word is re-derived. The deformation itself (the map \(p \mapsto A p\) from one
state to the next) is untouched.

## Depends on

Job [30](30_deformation_rebuild_pipeline.md): its main-thread steps and kept-table refresh are the commit path this job changes.
Job 67 (done): `src/math/latticeReduction.ts`, `src/cell-complex/torusModuli.ts`, the floor patch field.
Not on job 68: if job 68 lands first, put the word re-derivation of decision 6 in the geodesic emitters module's `transformGeometry`
instead of the commit policy; the rest is unchanged.

## Before you start

Read issue 95 (all of it, including part 4 and its status update of 2026-11-11, which corrects part 4 on corners), then:

- `src/cell-complex/deformations/torusSkewDeformation.ts`: `buildTorusParallelogramVertices`, `applyToSpec`,
  `createTorusSkewCellDeformationMaps`, `nextTorusSkewStep`, `normalizeTorusSkewState`, `floorUvFrames`;
- `src/cell-complex/worldGeometryDeformations.ts`: the state type, `validateTopologyPreservingSnapshot`, `defaultMaxTeichmullerStep`;
- `src/math/latticeReduction.ts`; `src/cell-complex/torusModuli.ts`;
- `src/cell-complex/compilePortalTransforms.ts` (`derivePortalTransform`) and `prismBase.ts` (side \(i\) runs from vertex \(i\) to
  \(i + 1\); the footprint must be counter-clockwise);
- `src/render/three/geometryCommit.ts` and `src/runtime/worldGeometryComputedObjects.ts`
  (`applyGeometryCommitComputedObjectPolicy`);
- `src/world-objects/geodesic/`: `cannon.ts` (`rebuildConnectedGeodesicBetweenEmitters`), `intervals.ts`
  (`rebuildConnectedGeodesicFromEndpointsAndPortalWordDetailed`, `resolveCarriedIntervalPortalWord`), `endpoints.ts`
  (`liftGeodesicEndpoint`), `portalWord.ts`; `src/cell-complex/segmentWalk.ts` (`walkDevelopedSegment`);
- `src/render/three/palette/latticeDiagram.ts`.

## Background

- **Portals today.** Ids `side-0` to `side-3`, paired 0 with 2 and 1 with 3, glued by translations: through side 0 a point gains \(+v\),
  side 2 \(-v\), side 1 \(-u\), side 3 \(+u\). `validateTopologyPreservingSnapshot` checks ids, pairing, side counts, heights and side
  lengths, not vertices, so a reduced parallelogram with the same ids passes (issue 95 was right).
- **Transport today.** Every positioned thing (player, creatures, static assets, flags, emitters, the spec's start position and objects)
  is carried by `CellDeformationMap.mapPoint` / `mapDirection` in cell-local metres. For the torus this is \(p \mapsto A p\) with
  \(A u = u'\), \(A v = v'\). Each object stores `cellId` and `localPose`; on the one-cell torus, wrapping is adding a lattice vector to the
  translation.
- **Geodesics today.** A commit deletes every arc that does not connect two emitters (free geodesics, tied curves, loops without an
  emitter). An emitter-to-emitter arc is rebuilt from its stored `portalWord` and kept only if the trace reproduces that word. Under a
  re-marking the stored word is wrong, so every such arc would be deleted. `carriedPortalWord` on the rebuild request overrides the stored
  word, even with no carried emitter.
- **The floor needs nothing.** `floorPatchField` comes from `floorUvFrames(state)`, built from the marked basis, not from the footprint.
- **Corners are physical.** Every corner of the room is one point of the torus (one vertex class). The app puts a forbidden-zone
  cylinder there and treats it as a vertex for traces. The corners of a parallelogram centred at the origin with basis \((f_1, f_2)\) are
  \(\pm(f_1 + f_2)/2, \pm(f_1 - f_2)/2\), all equal mod \(\Lambda\) to \((f_1 + f_2)/2\). Which of the three half-lattice points that is depends on
  \(\gamma\) mod 2, so a re-marking centred at the origin can **move the corner zone** to another point of the torus. Issue 95's "the new
  footprint may stay centred at the origin" is wrong for this reason; decision 3 fixes it.
- `reduceLatticeBasis` may return a basis of negative orientation, and has no tie-break.

## Decisions

1. **The marking is state.** Add to the torus state `marking: { gamma: [[p, q], [r, s]], cornerOffset: [i, j] }`, with integer entries,
   \(ps - qr = 1\), and `cornerOffset` explained in decision 3. The base state has the identity and \([0, 0]\). `normalizeTorusSkewState` validates
   it. The marking is plain data, so it crosses the worker boundary and appears in `geometry.state()`.
2. **When to re-mark (hysteresis).** Let \((f_1, f_2) = \gamma \cdot (u, v)\) for the state after a step, and \(\tau_f = f_2 / f_1\) as complex
   numbers. Keep \(\gamma\) while \(|\mathrm{Re}\,\tau_f| \le 1/2 + \eta\) and \(|\tau_f| \ge 1 - \eta\), with \(\eta = 0.05\). Otherwise replace it by the
   reduced basis: `reduceLatticeBasis`, then flip the sign of \(f_2\) if \(\det(f_1, f_2) < 0\), then, if \(\mathrm{Re}\,\tau_f < -1/2\), replace
   \(f_2\) by \(f_2 + f_1\) (one fixed tie-break). Derive the new \(\gamma\) from the new basis by solving in integers and check \(\det \gamma = 1\).
   `nextTorusSkewStep` computes the next marking with the next \((w, a, b)\). With \(\eta = 0.05\) every corner angle is at least
   \(\arccos(0.55 / 0.95) \approx 54.6\) degrees.
3. **The corner stays on the same point of the torus.** The room is the parallelogram with basis \((f_1, f_2)\), counter-clockwise,
   vertex 0 at \(c - (f_1 + f_2)/2\), where the centre \(c\) is chosen so that the vertices are congruent mod \(\Lambda\) to the previous
   vertices. Store \(c\) as `cornerOffset`, in half-integer coordinates of the marked basis times 2 (so it is an integer pair and moves with
   \(A\) as every lattice point does). At the identity marking \(c = 0\), which is today's room. Reduce \(c\) to the smallest such vector.
4. **Commit = deform, then wrap.** `createTorusSkewCellDeformationMaps(prev, next)` returns `mapPoint(p) = wrap(A p)`, where `wrap`
   subtracts the lattice vector that brings a point into the next room (coordinates in \((f_1, f_2)\) about \(c\) in \([-1/2, 1/2)\)). `mapDirection`
   stays \(A\). Add `mapDisplacement(d) = A d`, the linear part, to `CellDeformationMap` (optional; families without it keep today's
   behaviour). The same maps serve `applyToSpec` (start position, spec objects), so these land inside the room too.
5. **A re-marking waits for its cull.** Job 30's kept table names portals, and their meaning changes at a re-marking. When a step changes
   the marking, the session requests a full cull of that state and commits the step only when it arrives (the sweep pauses for one
   build, a few times per sweep). Steps that keep the marking re-develop the table as in job 30.
6. **Re-derive emitter-to-emitter words on every commit of a family that provides `mapDisplacement`.** In `geometryCommit.commit`,
   **before** anything is moved, compute for each emitter-to-emitter arc its developed chord \(D\) in the old world (lift the end into
   the start's frame with the stored word, `liftGeodesicEndpoint`; \(D\) = lifted end minus start). After moving, trace the straight
   segment from the new start \(s' = \)`mapPoint`\((s)\) by \(A D\) through the new world with `walkDevelopedSegment`, turn its crossings into
   a word, and rebuild the arc with that word as `carriedPortalWord`. Pass the chords to `applyGeometryCommitComputedObjectPolicy` as a new
   input. Assert in a test that the traced end equals `mapPoint` of the old end within \(10^{-9}\) m. A trace that hits a vertex keeps today's
   behaviour for a blocked chord.
7. **The diagram shows both.** The geometry computer keeps the marked parallelogram and its labels (it is what the parameters
   describe) and adds the room's outline, dashed, labelled "room". The readout text of job 67 is unchanged. No on-screen message on a
   re-marking (the maintainer may ask for one later).
8. **Not in this job:** the Dirichlet hexagon (it changes the combinatorics, so validation would reject it); a GL(2, R) family for
   translation surfaces (see "Later"); any change to the floor, the Teichmuller step or the forbidden zones themselves (issue 52).

## Steps

1. **Marking math** in `src/cell-complex/deformations/torusMarking.ts`: the marking type, `nextTorusMarking(state, nextBasis)` (decision
   2), the room vertices (decision 3), `wrapIntoRoom`. Tests `tests/cell-complex/torusMarking.test.ts`: identity at rest; \(\det \gamma = 1\)
   always; along the sweeps \((0, 15) \to (30, 15)\) and \((0, 15) \to (30, 7.5)\) the marking changes a bounded number of times and
   never flips back and forth across a boundary; all corners stay congruent mod \(\Lambda\) to the start corner; corner angle at least 54 degrees
   and diameter at most 1.3 times the reduced room's at 200 sampled states of the box.
2. **State and footprint.** Add `marking` to the state; `buildTorusParallelogramVertices` builds the room; `nextTorusSkewStep` advances
   the marking. Tests in `tests/cell-complex/torusSkewDeformation.test.ts`: a re-marked snapshot passes `validateSnapshot`; at \((30, 7.5)\)
   the room is the 15 by 7.5 rectangle (up to the corner offset); the floor patch field is identical before and after a re-marking.
3. **Maps** (decision 4), including `applyToSpec`. Tests: `mapPoint` lands inside the next room; a re-marking map is an isometry of the
   torus (distances between mapped points, taken mod \(\Lambda\), are unchanged); the start position and spec objects are inside the room.
4. **Cull refresh at a re-marking** (decision 5) in `worldGeometrySession.ts`. Test: a step that changes the marking is not committed
   before its cull arrives.
5. **Words** (decision 6). Tests in `tests/runtime/worldGeometryComputedObjects.test.ts`: an emitter-to-emitter arc and a loop on one
   emitter survive a sweep through two re-markings, with the same developed chord (mapped by \(A\)) and the same length; the traced end
   matches `mapPoint`; without `mapDisplacement` the policy behaves as today.
6. **Commit of everything else.** Tests in `tests/render/geometryCommit.test.ts` across a re-marking: the player, a creature, a flag,
   an emitter and a carried emitter all end inside the room at the same torus point (mod \(\Lambda\)) as \(A\) applied to their old point.
7. **Diagram** (decision 7). Test in `tests/ui/paletteDefinition.test.ts` or the diagram's own test.
8. Release scenario: sweep to \((30, 7.5)\) and back to \((0, 15)\) with an emitter-to-emitter geodesic: it exists at the end, with
   its length, and `geometry.state()` shows the identity marking again.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, the release tier, `npm run smoke -- --world torus-moduli`, `npm run bench`.
Update `_docs/MATHEMATICAL_MODEL.md` (torus family) and the docs of the geometry computer.

## Do not

- Do not change `validateTopologyPreservingSnapshot`; if a re-marked snapshot fails it, the room is built wrong.
- Do not touch the floor patch shader or `floorUvFrames`.
- Do not move the commit into the engine step (job 68).

## Done when

- At \((30, 7.5)\) the room is a rectangle; over the whole box, corner angles are at least 54 degrees.
- Across a re-marking nothing visible moves: player view, objects, emitter geodesics and floor are the same (tests above), and the
  corner zones stay at the same point of the torus.
- Every commit's deformation is still bounded by job 67's \(K \le e^{2\delta}\); a re-marking adds no distortion.
- Manual check, for the maintainer: sweep in `torus-moduli` to \((30, 7.5)\) on desktop and see that the walls of the room jump to a
  better cut while nothing else changes, and that the view distance is even in all directions.

## Later (not in this job)

From the former issue 54, change 4: for every translation surface (every gluing a pure translation; both torus worlds qualify,
`genus-2-torus.world.js` does not), any \(M \in GL^+(2, \mathbb{R})\) applied to all base vertices keeps the complex valid, which would give a
deformation family for any authored translation surface, for example a regular octagon with opposite sides glued. No translation-surface
detection exists in `src` today. Write a job only if the maintainer wants this family.
