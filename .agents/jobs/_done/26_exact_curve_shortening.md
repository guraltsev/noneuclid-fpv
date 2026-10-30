# Job 26 - Exact curve shortening via the sleeve and funnel

Status: done, needs review on 2026-10-29 (commits 01fa320, 8e70ebd, acf450a, 571d8eb, f975c3b).
Split from issue 67 on 2026-10-28; rewritten on 2026-10-29 against commit `0b468e1` for a less capable implementing
model. Resolves: issue [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md).

## Goal

1. A curve-shortening pair (two arcs tied at a free end F, or one free loop on F) is resolved **in one tick** to the
   length-minimizing path in its homotopy class: the straight chord when it stays in the sleeve of the fused portal
   word, otherwise a taut string that wraps the forbidden-zone disks at portal junctions. Corners are represented by new
   pinned anchor objects, so the result is a chain of stable locked intervals.
2. A free loop whose holonomy is a translation stays as a stable loop; a free loop whose holonomy rotates (it encircles a
   cone point) is deleted with a notice.
3. The gradient descent and everything that only compensates for it are deleted: the descent step, the fuse-angle test,
   absorption of short arcs, monotonicity rollback, the forbidden-zone split.
4. The end-to-end tests that issues 31 and 32 left unwritten exist (list below).
5. The legacy emitter-connection / straightening model (`geodesic/legacyConnection.ts`, isolated by job 25) and its eight
   skipped tests are deleted.

## Depends on

[Job 25](25_split_geodesic_cannon_modules.md) (module split; all paths below are its modules). Batch order: job 37, then
25, then **26**, then [27](27_geodesic_rebuild_performance.md). Job 27 measures the code written here.

Line numbers in this job are at commit `0b468e1`, where everything was still in `src/world-objects/geodesicCannon.ts`.
Job 25 moved every function, unchanged, to a module of `src/world-objects/geodesic/` (its table says which); job 37 and
earlier Parts shift lines. **Search by name.**

## Before you start

| File (after job 25) | What to read |
| --- | --- |
| `geodesic/curveShortening.ts` | `tieAndDetachGeodesicEndpoints`, `advanceCurveShorteningPairs`, `fuseCurveShorteningPair`, `absorbShortCurveShorteningHalf`, `findEquivalentStableInterval`, `discardCurveShorteningPairInFavorOf`, `resolvePairIntervals`, `cleanupCurveShorteningFailure`, `restoreGeodesicIntervalsAndSegments`, `cleanupCurveShorteningPreviewFailure`, `removeDegenerateFreeLoop`, the `curveShortening*` constants |
| `geodesic/objects.ts` | `CurveShorteningPairObject`, `FreeGeodesicEndObject`, `createFreeGeodesicEndObject`, `canObjectAttachGeodesics`, `getAnchorBeamPoint` |
| `geodesic/intervals.ts` | `previewRebuildGeodesicInterval` (accepts `candidateAnchorsById`), `rebuildDerivedGeodesicSegments`, `previewGeodesicIntervalHitsForbiddenZone`, `previewGeodesicIntervalIsDegenerate` |
| `geodesic/endpoints.ts` | `liftGeodesicEndpointWithAnchors`, `removeUnusedFreeGeodesicEnds` |
| `geodesic/portalWord.ts`, `geodesic/development.ts` | `reduceAdjacentInversePortalTraversals`, `getPortalWordBetweenEndpointRoles`, `samePortalWord`, `inversePortalTransform` |
| `geodesic/lifecycle.ts` | `isGeodesicLocked` |
| `geodesic/legacyConnection.ts`, `geodesic/cannon.ts` | Part E |
| `src/cell-complex/prismCells.ts:18-65` | sides run counter-clockwise, `sides[i]` from `baseVertices[i]` to `baseVertices[(i+1) % n]`, `inwardNormal` |
| `src/cell-complex/prismCells.ts:150-169`, `forbiddenZones.ts` | junction ids `"<cellId>:vertex-<i>"`, radius `forbiddenPortalJunctionRadiusMeters = 0.15` at every endpoint of a portal side |
| `src/cell-complex/segmentWalk.ts` | `walkDevelopedSegment` (pieces, `crossings`, `cellFromStart`), `locateDevelopedPoint` |
| `src/render/three/createThreeApp.ts:1459-1483` | the frame loop's call of `advanceCurveShorteningPairs` with `onDebugMessage` |
| `tests/world-objects/geodesic/curveShortening.test.ts`, `fixtures.ts` | the tests and scenario helpers job 25 moved there (`compileTorusLoopWorld`, `compileLargePortalWorld`, `compileRotatedFreeLoopWorld`, `createTorusTiedPairScenario`, `createSymmetricPairScenario`, `createKinkPairScenario`, `runCurveShorteningUntilPairGone`, `createCarryPortalTraversal`, `totalGeodesicLength`) |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`. Record the counts.

## Background

### Today's descent (at `0b468e1`)

- **Tie.** `tieAndDetachGeodesicEndpoints` (:3492-3581) creates a free end F at the emitter's beam point, re-attaches the
  two chosen roles to it, marks the intervals `"moving"`, rebuilds them from their stored words and adds a
  `CurveShorteningPairObject` (:212) with `state: "moving"`. If a rebuild fails with a forbidden-zone hit it **deletes**
  the geodesics (:3555-3556, issue 41 item); other failures roll back.
- **Tick.** `advanceCurveShorteningPairs` (:3800-4080), per pair: fuse a pair flagged `"ready-to-fuse"` on the previous
  tick (:3809-3827, reverting to `"moving"` when fusion fails); compute the unit tangents u, v at F
  (`endpointDirectionAwayFromAnchor`, :4472); flag `"ready-to-fuse"` when \(|u+v|\le 10^{-7}\) or the angle is within
  `curveShorteningFuseAngleToleranceRadians` = 0.03 of \(\pi\) (:3855); delete a free loop shorter than 0.15 m
  (`removeDegenerateFreeLoop`, :4620) or absorb an arc shorter than `curveShorteningFuseStepToleranceMeters` = 0.165 m
  (`absorbShortCurveShorteningHalf`, :4220-4338); step F by
  \(\min(0.4\,\mathrm{m/s}\cdot\Delta t,\ \tfrac14\min(a,b),\ \delta/(1/a+1/b))\) along \(u+v\) with
  `moveDynamicObject(..., ignoreForbiddenZones: true)` (:3919-3925, arc-length floor `curveShorteningMinStepMeters` =
  0.002); fold any portal crossings of F into the words (`applyAnchorCrossingTraversals`); preview every arc
  (`previewRebuildGeodesicInterval`); on a failed preview absorb a degenerate arc, or, for a zone hit, run
  `cleanupCurveShorteningPreviewFailure` (:4538-4615), which **deletes the failing arc and turns the other into a stable
  free geodesic** (the "forbidden-zone split"); skip a step whose total length grows by more than
  `curveShorteningLengthIncreaseToleranceMeters` = 1e-4 (:4030-4041); otherwise commit.
- **Fuse.** `fuseCurveShorteningPair` (:4096-4211) composes the fused word
  `reduce(word(first: nonFree → free) · word(second: free → nonFree))` with `getPortalWordBetweenEndpointRoles` and
  `reduceAdjacentInversePortalTraversals`, takes the lexicographically smaller interval id, requires both non-free
  anchors to be emitters (`TODO(issue 67)` at :4145), previews only the **straight chord**, keeps an equivalent existing
  stable geodesic if there is one (`findEquivalentStableInterval` :4345, `discardCurveShorteningPairInFavorOf` :4371).
  A free loop (one interval with both roles on F) is just made stable.

Why it fails: when a cone point lies inside the developed triangle (Ã, F, B̃) the arcs sweep across its disk as F
descends, a preview reports `forbidden-zone-hit`, and the construction is split or deleted exactly when the correct
answer is a geodesic polygon with a corner at that disk (issue 67).

### The exact answer

For the fused word \(w = (p_1, \dots, p_k)\) from anchor A (cell \(C_0\)) to anchor B (cell \(C_k\)):

- **Development (sleeve).** \(M_0 = I\), \(M_i = M_{i-1} \circ T_{p_i}^{-1}\) maps cell \(C_i\)'s frame into \(C_0\)'s
  frame (\(T_p\) is `portal.transformToTarget`, source cell to target cell). Portal \(p_i\) leaves cell \(C_{i-1}\) through
  side \(s\). Seen from inside a counter-clockwise cell and facing out through side \(s\) (from `side.start` to
  `side.end`), `side.end` is on the **left** and `side.start` on the **right**. The developed aperture is
  \(L_i = M_{i-1}(\text{side.end})\), \(R_i = M_{i-1}(\text{side.start})\); its disks are the junctions
  `"<C_{i-1}>:vertex-<(s+1) mod n>"` (left) and `"<C_{i-1}>:vertex-<s>"` (right). \(\tilde B = M_k(B)\). The free part of an
  aperture is shorter than 0 when \(|L_i - R_i| < 2\rho\): the word is infeasible.
- **Taut string.** The shortest path from A to \(\tilde B\) that crosses every aperture between its two disks is straight
  pieces tangent to disks of radius \(\rho\) at some aperture endpoints, each wrapped on its own side (left disks keep the
  path on their right, so the path turns left around them). Found by the point funnel (Lee-Preparata) on the aperture
  endpoints, then replacing point turns by disk tangents, then a check-and-insert loop for disks the points missed.
- **Polyline with corners.** The string is drawn as a polyline: each wrap of turn \(\Phi\) is replaced by \(m\) corners
  (Decision 4). Length error per wrap: \(m\,\rho\,(2\tan(\Phi/2m) - \Phi/m)\); for \(\Phi = 0.1\) rad and
  \(\rho = 0.15\) m that is about 1.3e-5 m.
- **Free loop.** \(A = B = F\); the holonomy \(g_w = M_k\) has rotation angle \(\theta\). \(\theta = 0\) (every torus word):
  every point gives a closed geodesic of the same class, so the loop is resolved like a pair from F to \(\tilde F\). \(\theta \ne 0\):
  \(L(F) = 2|\sin(\theta/2)|\,|F - c|\) shrinks onto the enclosed cone point; the loop is deleted.

## Decisions

1. **Resolve in one tick; no animation.** Decided: `tieAndDetachGeodesicEndpoints` still creates the pair (so the user
   sees the detach), and the next `advanceCurveShorteningPairs` call with `deltaSeconds > 0` resolves every pair
   completely. No intermediate motion of F. Why: the descent is what fails; animation can be added later as pure
   interpolation of the final polyline.
2. **Pair state.** Decided: `CurveShorteningPairObject.state` becomes `"moving" | "unresolved"`. `"ready-to-fuse"` and
   `previousTotalLengthMeters` are deleted (Part C). A pair whose resolution fails (Decision 8) is set to
   `"unresolved"` and skipped by later ticks; it stays visible as the detached arcs. Why: no retry storm every frame, no
   stuck `"ready-to-fuse"`.
3. **Corner objects.** Decided: a new registry kind in `geodesic/objects.ts`:

   ```ts
   /** A pinned anchor at a corner of a taut geodesic polygon, next to the forbidden disk it wraps. */
   export interface GeodesicCornerObject extends RuntimeWorldObjectBase {
     readonly kind: "geodesic-corner";
     readonly canAttachGeodesics: true;
     /** Junction id ("<cellId>:vertex-<i>") of the disk this corner wraps, in the corner's own cell. */
     readonly junctionId: string;
     /** Side of the wrapped disk relative to the travel direction from the chain's start anchor to its end anchor. */
     readonly side: "left" | "right";
   }
   export function createGeodesicCornerObject(input: { id; cellId; point: Vec3; junctionId; side }): GeodesicCornerObject
   export function isGeodesicCornerObject(object: RuntimeWorldObject | undefined): object is GeodesicCornerObject
   ```

   `localPose = yawRigidTransform3(0, point)` with `point.z = geodesicRayBeamHeightMeters` above the floor (same z as a
   free end), `portalRenderable: false`, no collision, no tooltip. Add it to the `RuntimeWorldObject` union in
   `runtimeObjectRegistry.ts`. Why a new kind and not a flagged free end: free ends are "aimable" and are removed when one
   attachment is left; a corner is pinned and must count as locked.
4. **Corner geometry.** Decided: inflate the disk radius by `geodesicCornerClearanceMeters = 1e-6` (\(\rho = 0.15 + 10^{-6}\))
   so tangent pieces pass the real circle at distance \(10^{-6}\) and the open-disk zone test never reports them as hits.
   A wrap of turn \(\Phi\) gets \(m = \lceil \Phi / (2\pi/3) \rceil\) corners (\(\Phi < \pi\) always, so \(m \le 2\)). With
   \(\delta = \Phi/m\), \(n_{in}\) the unit vector from the disk centre to the incoming tangent point, corner \(j = 0..m-1\) is
   \(c + \frac{\rho}{\cos(\delta/2)}\,\mathrm{rot}(n_{in}, \pm(j + \tfrac12)\delta)\), with \(+\) (counter-clockwise) for a left
   disk and \(-\) for a right disk. Why \(2\pi/3\): a corner is then at most \(2\rho = 0.3\) m from the junction, and two
   corners of one disk are at least \(2\rho\tan(\pi/6) \approx 0.173\) m apart, above `GEODESIC_MIN_LENGTH_METERS` = 0.15.
5. **Locked means pinned at both ends.** Decided: `isGeodesicLocked` (lifecycle.ts) returns true for an interval whose two
   anchors are each a `geodesic-cannon` **or** a `geodesic-corner`. `removeUnusedFreeGeodesicEnds` (endpoints.ts) also
   removes corners with no attachment. Why: carrying an emitter, tie-and-detach and geometry commits treat only locked
   geodesics as persistent (`removeUnlockedGeodesicsFromCannon`, `collectLockedIncidentGeodesicIdsForEmitter`,
   `worldGeometryComputedObjects.ts`); a polygon with corners must survive those. A carried emitter rebuilds its
   emitter-to-corner interval with the corner fixed; the chain is **not** re-tautened (record as a limitation in the
   report).
6. **Any anchor kind at the non-free ends.** Decided: the resolution accepts any anchor that `canObjectAttachGeodesics`
   at the non-free ends (emitter, corner, free end). This removes `TODO(issue 67)` at :4145.
7. **Free loops.** Decided: compute \(\theta = \mathrm{atan2}(m_{10}, m_{00})\) of the sleeve's `startFromEnd` (Part A).
   \(|\theta| > 10^{-9}\): delete the loop, its free end and the pair (`cleanupCurveShorteningFailure`) and send a notice
   `"free-loop-collapsed"`. Otherwise resolve as a pair with A = B = F (the loop's base point stays where it is; corners
   are added if the chord from F to \(\tilde F\) is blocked). A loop or pair whose result has no corner and a chord shorter
   than `GEODESIC_MIN_LENGTH_METERS` (for example an empty word) is deleted with notice `"collapsed"`.
8. **Failure handling.** Decided: the resolution never deletes an arc because the path touches a disk. It fails only when:
   the word does not chain (`"word-mismatch"`), an aperture is narrower than \(2\rho\) (`"infeasible"`), the check-and-
   insert loop does not converge (`"no-convergence"`), a polyline piece is shorter than `GEODESIC_MIN_LENGTH_METERS`,
   the walked sub-words do not reduce to \(w\), or a sub-interval preview fails. Then **nothing changes** except
   `pair.state = "unresolved"`, and a notice `"unresolved"` with the reason is sent.
9. **Notices.** Decided: `AdvanceCurveShorteningPairsRequest` gets
   `readonly onNotice?: (notice: CurveShorteningNotice) => void` with

   ```ts
   export type CurveShorteningNotice =
     | { readonly kind: "free-loop-collapsed"; readonly geodesicId: string; readonly message: string }
     | { readonly kind: "collapsed"; readonly geodesicIds: readonly string[]; readonly message: string }
     | { readonly kind: "unresolved"; readonly pairId: string; readonly reason: string; readonly message: string };
   ```

   Messages: "The loop around a cone point shrank to a point and was removed.", "The tied geodesic shrank to a point and
   was removed.", "The tied geodesic could not be straightened (" + reason + ")." In `createThreeApp.ts` wire `onNotice` to
   `console.info("[noneuclid] " + notice.message)` and `runtimeDiagnostics().recordDebugEvent(notice.message, notice)`,
   **always** (not only when debug is on). There is no on-screen message system yet; showing it in the HUD is a separate
   UI job (record under `### Not done`).
10. **Tie never deletes.** Decided: in `tieAndDetachGeodesicEndpoints`, any rebuild failure rolls back (restore intervals,
    segments, remove the free end); delete the forbidden-zone branch (:3555-3556). Why: issue 41 item in issue 67; the
    geometry does not change at tie time, so a failure is a numerical problem, not a reason to delete.
11. **Identity of the result.** Decided: the first interval of the result keeps the lexicographically smaller of the two
    arc ids (as today; for a loop, the loop's id); further intervals get `"<thatId>:piece:<j>"` (j = 1, 2, ...), corners
    `"<pairId>:corner:<j>"` (j = 0, 1, ...). The chain runs from A (first arc's non-free anchor) to B. When the result is a
    single interval (no corner), keep today's duplicate check (`findEquivalentStableInterval`) and
    `discardCurveShorteningPairInFavorOf`. A free loop keeps its id and its free end F (F is its anchor A = B).
    `advanceCurveShorteningPairs` returns the new interval ids **and the ids of deleted arcs** (and the pair id when the
    pair was deleted or set unresolved), so that the shell's loop over the returned ids refreshes or removes
    measurements and protractor angles of the deleted arcs too. In `createThreeApp.ts`, after that loop, also call
    `removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry))` when the
    list is not empty (the tools do the same after tie-and-detach).
12. **Sleeve module is pure.** Decided: `src/world-objects/geodesic/sleeve.ts` imports only `math/`, `cell-complex/`,
    `geodesic/objects.ts` (types) and `geodesic/development.ts`. Add a `mayImportOnly` rule for it to
    `scripts/docs/lib.mjs#moduleImportRules` (job 25 Decision 6).

## Algorithms

### Sleeve development (Part A)

```text
developSleeve({ world, startCellId, start: Vec2xy, word, end: Vec2xy })
  M = identity (cell frame -> start frame); cell = world.cellsById.get(startCellId)
  apertures = []
  for i, t in word:
    if !cell or t.sourceCellId != cell.id: return { status: "word-mismatch", index: i }
    portal = cell.portalsById.get(t.sourcePortalId); side = cell.sides[portal.sideIndex]; n = cell.sides.length
    apertures.push({ left: xy(M(side.end)), right: xy(M(side.start)),
                     leftJunctionId: `${cell.id}:vertex-${(side.sideIndex + 1) % n}`,
                     rightJunctionId: `${cell.id}:vertex-${side.sideIndex}`, cellId: cell.id, wordIndex: i })
    M = compose(M, inversePortalTransform(portal))        // composeRigidTransform3(M, Tinv): apply Tinv first
    cell = world.cellsById.get(t.targetCellId)
  return { status: "ok", sleeve: { start, end: xy(M(end)), apertures, startFromEnd: M, endCellId: cell.id } }
```

`xy(M(p))` means `transformPoint3(M, vec3(p.x, p.y, 0))` restricted to x, y. Check the composition order against
`liftGeodesicEndpoint` (endpoints.ts), which already pulls a point back through a word; the two must agree (test A4).

### Point funnel (Part A)

Portals: index 0 is `(start, start)`, index i (1..k) is `(apertures[i-1].left, apertures[i-1].right)`, index k+1 is
`(end, end)`. `cross(u, v) = u.x v.y - u.y v.x` (> 0: v is counter-clockwise, i.e. left, of u). Points are "equal" when
they are within 1e-12 m.

```text
apex = start; apexPortal = 0; left = right = start; leftPortal = rightPortal = 0; apexes = []
i = 1
while i <= k + 1:
  (L, R) = portals[i]
  // right edge
  if cross(right - apex, R - apex) >= 0:                       // R does not widen the funnel on the right
    if equal(apex, right) or cross(R - apex, left - apex) > 0:  // R stays right of the left edge: tighten
      right = R; rightPortal = i
    else:                                                       // R crosses the left edge: left point is a corner
      apexes.push({ portal: leftPortal, side: "left" }); apex = left; apexPortal = leftPortal
      left = right = apex; leftPortal = rightPortal = apexPortal; i = apexPortal + 1; continue
  // left edge
  if cross(left - apex, L - apex) <= 0:                        // L does not widen the funnel on the left
    if equal(apex, left) or cross(right - apex, L - apex) > 0:  // L stays left of the right edge: tighten
      left = L; leftPortal = i
    else:
      apexes.push({ portal: rightPortal, side: "right" }); apex = right; apexPortal = rightPortal
      left = right = apex; leftPortal = rightPortal = apexPortal; i = apexPortal + 1; continue
  i = i + 1
return apexes   // aperture index = portal - 1; never 0 or k+1
```

### Tangents (Part A)

All with unit vectors; \(n(u) = (-u_y, u_x)\) is the left normal; `rot(u, a)` rotates counter-clockwise by a.

- **Point P to disk (c, \(\rho\)), disk on side s of the path P → t:** \(d = c - P\), \(D = |d|\) (fail if \(D \le \rho\)),
  \(u = d/D\), \(\beta = \arcsin(\rho/D)\). Direction \(e = \mathrm{rot}(u, -\beta)\) for a left disk,
  \(\mathrm{rot}(u, +\beta)\) for a right disk; length \(\ell = D\cos\beta\); tangent point \(t = P + \ell e\).
  Example: P = (0,0), c = (2,0), \(\rho\) = 1, left: \(e = (\sqrt3/2, -1/2)\), \(\ell = \sqrt3\), \(t = (1.5, -\sqrt3/2)\).
- **Disk to point B:** compute "point to disk" from B to c with the **opposite** side; the piece runs from that tangent
  point to B, direction \(-e\).
- **Disk (c1, s1) to disk (c2, s2), equal radius:** \(d = c_2 - c_1\), \(D = |d|\), \(u = d/D\), \(n = n(u)\).
  - Same side (outer tangent): direction u, length D; from \(c_1 - \rho n\) to \(c_2 - \rho n\) for left disks, from
    \(c_1 + \rho n\) to \(c_2 + \rho n\) for right disks. Example: c1 = (0,0), c2 = (3,0), \(\rho\) = 0.5, left: from
    (0, -0.5) to (3, -0.5).
  - Left then right (inner tangent; fail if \(D \le 2\rho\)): \(\beta = \arcsin(2\rho/D)\), \(e = \mathrm{rot}(u, +\beta)\),
    \(n_e = n(e)\), from \(c_1 - \rho n_e\) to \(c_2 + \rho n_e\), length \(D\cos\beta\). Right then left: \(e = \mathrm{rot}(u, -\beta)\),
    from \(c_1 + \rho n_e\) to \(c_2 - \rho n_e\). Example: c1 = (0,0) left, c2 = (3,0) right, \(\rho\) = 0.5:
    \(e = (2\sqrt2/3, 1/3)\), from (1/6, -0.4714045) to (17/6, 0.4714045), length \(2\sqrt2\).

### Taut path (Part A)

```text
solveTautPath(sleeve, rho, { maxTurnPerCornerRadians = 2*PI/3 } = {})
  for each aperture: if |left - right| < 2*rho: return { status: "infeasible", apertureIndex }
  nodes = [START] + funnel apexes (as { apertureIndex, side, center }) + [END]
  repeat at most 4 * (k + 2) times:
    pieces = tangent piece between each pair of consecutive nodes (rules above; point-to-point = chord)
    if a tangent fails (D <= rho, or inner tangent with D <= 2 rho): return { status: "infeasible", apertureIndex of the later node }
    // 1. lift-off: an apex whose turn has the wrong sign is removed
    for each apex node j: turn_j = atan2(cross(dirIn, dirOut), dot(dirIn, dirOut))
      if (side == left and turn_j <= 1e-12) or (side == right and turn_j >= -1e-12): remove it, restart the loop
    // 2. violations: every aperture between two consecutive nodes (and the other endpoint of a node's own aperture)
    worst = none
    for each piece (from node a to node b) and each aperture index q with a.apertureIndex <= q <= b.apertureIndex:
      for side in [left, right] (skip the endpoint that is node a or node b itself):
        c = aperture[q][side]
        clearance = distance from c to the piece segment - rho       (must be >= -1e-9)
        sd = cross(piece direction, c - piece start)                  (> 0: c is left of the piece's line)
        wrongSide = (side == left and sd < 0) or (side == right and sd > 0)
        penetration = wrongSide ? rho + |sd| : -clearance
        if penetration > 1e-9 and penetration > worst.penetration: worst = { q, side, penetration }
    if no worst: break with success
    insert { apertureIndex: worst.q, side: worst.side, center } into nodes, keeping nodes sorted by aperture index
  if not converged: return { status: "no-convergence" }
  lengthMeters = sum of piece lengths + sum over apexes of rho * |turn_j|
  corners per apex (Decision 4); points = [start, corners in order, end]
  polylineLengthMeters = sum of |points[i+1] - points[i]|
  return { status: "ok", apexes, points, cornerApexIndex (which apex each corner belongs to), lengthMeters, polylineLengthMeters }
```

The point funnel gives the right apexes in almost every case; the loop only corrects disks that the points missed or
that lift off. Apertures in the start and end cells and at intermediate cell vertices that are not portal endpoints are
not modelled; the sub-interval previews in Part B catch any such hit (it is then an `"unresolved"` failure).

### Resolution (Part B)

```text
resolveCurveShorteningPair({ world, registry, pairId, onNotice }): { status: "resolved", geodesicIds } | { status: "deleted" } | { status: "unresolved", reason }
  pair, owned = resolvePairIntervals(...)              // invalid -> remove the pair only (as today), return deleted
  if owned has 1 interval (free loop):
    A = B = F; w = loop.portalWord; firstId = loop.id
  else:
    A = first arc's non-free anchor, B = second arc's non-free anchor (any kind, Decision 6)
    w = reduce(word(first: nonFree -> free) . word(second: free -> nonFree)); firstId = min(first.id, second.id)
  aPoint = getAnchorBeamPoint(A); bPoint = getAnchorBeamPoint(B)
  dev = developSleeve(world, A.cellId, xy(aPoint), w, xy(bPoint))   // word-mismatch -> unresolved
  if loop and |theta(dev.startFromEnd)| > 1e-9: delete loop, F, pair; notice free-loop-collapsed; return deleted
  taut = solveTautPath(dev.sleeve, 0.15 + 1e-6)                        // failure -> unresolved
  if taut.apexes is empty:
    if |end - start| < GEODESIC_MIN_LENGTH_METERS: delete arcs, F, pair; notice collapsed; return deleted
    build one interval firstId from A to B with word w (motionState "stable"), preview it,
    duplicate check (Decision 11), commit exactly as fuseCurveShorteningPair does today
  else:
    corners: keep (prevCellId, prevFromDev) where prevFromDev maps the developed (start) frame into prevCellId's frame;
      start with (A.cellId, identity). For each corner point Q (developed frame), with P the previous polyline point:
      walk = walkDevelopedSegment({ world, cellId: prevCellId, start: xy(prevFromDev(P)),
                                    direction: xy(rotation of prevFromDev applied to (Q - P)), lengthMeters: |Q - P| })
      (status must be "end", else unresolved "walk-<status>")
      qFromDev = compose(last piece's cellFromStart, prevFromDev); Q's cell = last piece's cellId; Q local = qFromDev(Q)
      subWord_j = walk.crossings as traversals { sourceCellId, sourcePortalId: portalId, targetCellId, targetPortalId }
      (prevCellId, prevFromDev) = (Q's cell, qFromDev)
      junctionId: the junction of Q's cell whose position, mapped into the start frame, is within 1e-6 m of the apex centre
      (if none is found -> unresolved "corner-junction")
    last piece: walk from the last corner to B; its crossings give the last sub-word; its end must be B's cell
    check samePortalWord(reduce(concat(subWords)), w); every piece length >= GEODESIC_MIN_LENGTH_METERS
    candidates = new corner objects; intervals I_0..I_m (ids per Decision 11), I_j from anchor j to anchor j+1, word subWord_j
    preview each I_j with previewRebuildGeodesicInterval(candidateAnchorsById = corners); any failure -> unresolved
    commit: remove both arcs (or the loop) with derived objects, F (unless F is A/B of a loop) and the pair;
            add corners, add intervals, rebuildDerivedGeodesicSegments for each, syncLegacyEmitterGeodesicFields,
            updateGeodesicIntersectionObjects once
  return resolved with the new interval ids
```

## Steps

Run the named test file after each step and `npm run typecheck`. At the end of every Part: `npm run typecheck`,
`npm test`, `npm run docs:check` (`npm run docs:generate` when stale). Parts C and E also run `npm run build` and
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` (they change runtime wiring). **One commit per
Part** (`Job 26 part X: ...`).

### Part A: pure sleeve module

1. Create `src/world-objects/geodesic/sleeve.ts` (header: "Sleeve of a portal word and the taut string through it:
   developed apertures, the point funnel, disk tangents and the shortest path that wraps the forbidden-zone disks;
   pure.") exporting, each with JSDoc: `SleeveAperture`, `DevelopedSleeve`, `developSleeve`, `funnelPointApexes`,
   `tangentFromPointToDisk`, `tangentBetweenDisks`, `TautApex`, `TautPathResult`, `solveTautPath`,
   `geodesicCornerClearanceMeters`. Use `src/math/vec2.ts` (job 25) for 2-D arithmetic.
2. Add the `mayImportOnly` rule for `sleeve.ts` (Decision 12).
3. Write `tests/world-objects/geodesic/sleeve.test.ts` (tests A1-A9 below); `npx vitest run tests/world-objects/geodesic/sleeve.test.ts`.

### Part B: corner objects and the resolution function (not yet wired)

1. Add `GeodesicCornerObject`, `createGeodesicCornerObject`, `isGeodesicCornerObject` (Decision 3) and the union entry.
2. Decision 5: `isGeodesicLocked`, `removeUnusedFreeGeodesicEnds`.
3. Add `CurveShorteningNotice` and `export function resolveCurveShorteningPair(...)` to `curveShortening.ts`
   (pseudocode above). It is exported and used only by tests in this Part.
4. Tests B1-B6 in `tests/world-objects/geodesic/curveShortening.test.ts` (new `describe("exact resolution")`);
   `npx vitest run tests/world-objects/geodesic`.

### Part C: wire the resolution in, delete the descent

1. `advanceCurveShorteningPairs`: keep the signature (plus `onNotice`, minus `speedMetersPerSecond`); return `[]` when
   `deltaSeconds <= 0`; for every pair with `state === "moving"` call `resolveCurveShorteningPair` and collect the
   changed ids (new interval ids, or the pair id when deleted or set unresolved); skip `"unresolved"` pairs.
2. Decision 10 in `tieAndDetachGeodesicEndpoints`; Decision 2 on the pair type (also `createCurveShorteningPairObject`).
3. Delete: `fuseCurveShorteningPair`, `absorbShortCurveShorteningHalf`, `cleanupCurveShorteningPreviewFailure`,
   `removeDegenerateFreeLoop`, `endpointDirectionAwayFromAnchor`, `getPairFreeRoleForInterval`, `radiansToDegrees`,
   `previewGeodesicIntervalIsDegenerate` (intervals.ts) if nothing else uses it, and the constants
   `curveShorteningDefaultSpeedMetersPerSecond`, `curveShorteningFuseAngleToleranceRadians`,
   `curveShorteningFuseStepToleranceMeters`, `curveShorteningMinStepMeters`,
   `curveShorteningLengthIncreaseToleranceMeters`. Typecheck (`noUnusedLocals`) lists anything else that became unused;
   delete it if only the descent used it.
4. Wire `onNotice` in `createThreeApp.ts` (Decision 9).
5. Update the old tests in `tests/world-objects/geodesic/curveShortening.test.ts` exactly as listed under "Old tests" and
   record every change under `### Deviations`.
6. Docs: rewrite `_docs/MATHEMATICAL_MODEL.md` §6 "curve shortening" (today lines 264-294: the descent, fuse angle,
   monotonicity, absorb) to describe the sleeve, funnel, corners and free-loop rule; remove the constants-table rows for
   the deleted constants (lines 441-442); update the module header of `curveShortening.ts` and the "Curve shortening"
   paragraph of `objects.ts`'s header.
7. End-of-Part checks including build and smoke.

### Part D: carried-over end-to-end tests (issues 31 and 32)

Write tests D1-D8 in `tests/world-objects/geodesic/curveShortening.test.ts` (new `describe("issue 31/32 outcomes")`).
They test outcomes through `tieAndDetachGeodesicEndpoints` + `advanceCurveShorteningPairs`. `npx vitest run tests/world-objects/geodesic`.

### Part E: delete the legacy model

1. Delete `src/world-objects/geodesic/legacyConnection.ts` and its `moduleImportRules` entry.
2. `cannon.ts`: `rebuildConnectedGeodesicBetweenEmitters` returns `getGeodesicSegments(...)` for a non-interval id
   (instead of `rebuildLegacyConnectedGeodesic`); `connectGeodesicToEmitter` returns `getGeodesicSegments(...)` for a
   non-interval id (delete its legacy branch, which used `markGeodesicConnected`).
3. `render/three/geodesicCannonTools.ts`: drop the `isGeodesicStraightening` filters in `canTieAndDetachGeodesicsFromCannon`
   and `resolveTieAndDetachEndpointFromAim`, the `hasStraighteningIncidentGeodesic` guard in
   `prepareGeodesicCannonForLift`, and the non-interval branch of `updateCarriedGeodesicPortalWord` (from
   `const connection = getGeodesicConnection(...)` to the end of the function) together with `applyCarriedPortalTransition`
   and its tests in `tests/render-contract/geodesicCarryPortalTransition.test.ts` (only the tests that call it). Fix the
   factory's doc comment ("cannons with a straightening incident geodesic cannot be carried").
4. Delete `tests/world-objects/geodesic/legacyConnection.test.ts` (the 8 skipped tests). Rewrite
   "deleting a connected geodesic removes association from both emitters" (cannon.test.ts; it used the legacy branch of
   `connectGeodesicToEmitter`): create interval `g-a` from `cannon-a` to `cannon-b` with `createGeodesicIntervalObject`,
   `rebuildConnectedGeodesicBetweenEmitters`, then `removeGeodesic`; keep its three expectations.
5. Keep `GeodesicEmitterConnection`, `getGeodesicConnection`, `geodesicConnectionsById` readers and the segment
   `connectionState` (the renderer colours moving intervals with `"straightening"`); list them under `### Not done` as
   follow-up for job 33.
6. In issue 67's report and in job 33, note that the eight skipped legacy tests are removed (job 33 acceptance item).
7. End-of-Part checks including build and smoke.

## Tests and checks

### Part A: `sleeve.test.ts` (\(\rho\) as given; tolerance 1e-9 m unless stated)

- A1 tangent point to disk: P (0,0), c (2,0), \(\rho\) 1, left: point (1.5, \(-\sqrt3/2\)), direction (\(\sqrt3/2\), -1/2),
  length \(\sqrt3\); right: point (1.5, \(+\sqrt3/2\)).
- A2 disk to disk: c1 (0,0), c2 (3,0), \(\rho\) 0.5. Left-left: (0,-0.5) to (3,-0.5), length 3. Left-right: from
  (1/6, -0.47140452) to (17/6, 0.47140452), length \(2\sqrt2\). Left-right with c2 = (0.9, 0): fails (D ≤ 2\(\rho\)).
- A3 straight (issue acceptance a): A (0,0), B (4,0), one aperture left (2,1), right (2,-1), \(\rho\) 0.15: no apex,
  `points` = [A, B], `lengthMeters` = 4.
- A4 developSleeve on `compileLargePortalWorld()` (fixtures): start cell `a`, word `[a:ab]`, start (4, 0.1), end in `b`
  (2, 0.1): one aperture with left = (5,5), right = (5,0), `leftJunctionId` "a:vertex-2", `rightJunctionId`
  "a:vertex-1"; developed end (7, 0.1); and the developed end equals `liftGeodesicEndpoint`'s `targetPointInSourceCell`
  for an interval with the same anchors and word (within 1e-12).
- A5 one disk (issue acceptance b): A (-2,0), B (2,0), aperture left (0, 0.05), right (0, -5), \(\rho\) 0.15: one apex
  (aperture 0, left); `lengthMeters` = 4.005003130089842 (= \(2\sqrt{D^2-\rho^2} + \rho\Phi\), \(D^2 = 4.0025\),
  \(\Phi = 2(\arcsin(\rho/D) - \arctan 0.025)\) = 0.10010440958560399), within 1e-6; one corner at (0, -0.10018808806984288);
  `polylineLengthMeters` = 4.005015681862478.
- A6 alternating funnel (issue acceptance c): A (0,0), B (6,0), apertures [left (2,-0.5), right (2,-3)] and
  [left (4,3), right (4,0.5)], \(\rho\) 0.15: apexes [(0, left), (1, right)]; tangent points (1.953127849655967, -0.6424886013761324),
  (2.084475559418481, -0.6239511188369621), (3.915524440581519, 0.6239511188369621), (4.046872150344033, 0.6424886013761324)
  within 1e-9; `lengthMeters` = 6.602835373640863 within 1e-9.
- A7 infeasible (issue acceptance d): aperture left (2, 0.1), right (2, -0.1), \(\rho\) 0.15 → `{ status: "infeasible", apertureIndex: 0 }`.
- A8 corner subdivision: A5 with `maxTurnPerCornerRadians: 0.05` → 3 corners, each at distance \(\rho/\cos(\Phi/6)\) from
  (0, 0.05), `polylineLengthMeters` = \(2\sqrt{D^2-\rho^2} + 6\rho\tan(\Phi/6)\).
- A9 funnel vs brute force (property, fast-check, `numRuns: 100`): random corridors of 3-6 apertures that are vertical
  segments at x = 1, 2, ... with left endpoint y in [0.2, 2] and right endpoint y in [-2, -0.2], A = (0, a), B = (k+1, b)
  with a, b in [-0.1, 0.1], \(\rho\) = 0: the polyline through A, the funnel apexes and B has the same length (within
  1e-9) as the brute-force shortest path, computed in the test by dynamic programming over the nodes A, the 2k
  aperture endpoints and B, ordered by x: an edge from node p to a later node q is allowed when the segment pq crosses
  every aperture strictly between them at a y inside that aperture's [right.y, left.y]. Use \(\rho = 0\) so the brute
  force is this simple. (`solveTautPath` with \(\rho = 0\) must give the same length.)

### Part B: resolution (`curveShorteningTest`, describe "exact resolution")

- B1 one corner on a real world (issue acceptance b, end to end): `compileLargePortalWorld()`; cannons `e1` in `a` at
  (4, 0.1) and `e2` in `b` at (2, 0.1); free end `F` in `a` at (4.5, 2.5) (beam height); arcs `g1` (e1 → F, word []) and
  `g2` (F → e2, word [a:ab]), both `"moving"`, rebuilt; pair `pair` (g1 end, g2 start). Call
  `resolveCurveShorteningPair`. Expect: pair and F gone; exactly one `geodesic-corner` `pair:corner:0` in cell `a` with
  `junctionId` "a:vertex-1", `side` "right", local position (4.998114, 0.150095) within 1e-5; interval `g1` (e1 →
  corner, word []) and `g1:piece:1` (corner → e2, word [a:ab]), both stable and locked; total segment length
  3.0018830 within 1e-6 (taut length 3.0018777; straight chord 3.0, which would pass 0.1 m from the junction at (5,0)).
- B2 straight result: `createSymmetricPairScenario(1, 1)` → one stable interval `g1` from `e1` to `e2`, length 2
  (within 1e-9), no corner, `g2` gone.
- B3 torus pair (issue 66 scenario): `createTorusTiedPairScenario()` → `g1` stable loop at `e1`, word
  `[torus-room:right-left]`, length 15 within 1e-9, 3 segments.
- B4 rotated free loop: the setup of the old test "keeps moving a free loop at 240 Hz until it is resolved"
  (`compileRotatedFreeLoopWorld`, F at (4.9, 1), word [a:ab, b:b-bottom, b:ba]) → `{ status: "deleted" }`, loop, F and
  pair gone, `onNotice` called once with `kind: "free-loop-collapsed"`.
- B5 torus free loop (issue acceptance "stable in 1 tick"): `compileTorusLoopWorld()`, F at (1, 2.3), loop word
  [right-left], pair on both roles → resolved; the loop is stable, still on F, length 15 within 1e-9, no corner.
- B6 unresolved leaves everything unchanged. Add `compileNarrowPortalWorld()` to `fixtures.ts`: cell `a` with base
  vertices (0,0), (2,0), (2,0.25), (0,2) and portal `ab` on side 1 (length 0.25 m) to cell `b` with base vertices
  (0,0), (2,0), (2,2), (0,0.25) and portal `ba` on side 3; both 3 m high. Cannons `e1` in `a` at (1, 0.5), `e2` in `b` at
  (1, 0.5); free end `F` in `a` at (1, 1); intervals `g1` (e1 → F, word []) and `g2` (F → e2, word [a:ab]) added
  directly with `motionState: "moving"` (do **not** rebuild them; no zone-free chord exists through a 0.25 m aperture);
  pair `pair`. → `{ status: "unresolved", reason: "infeasible" }`; arcs, words, F and the segment list deep-equal their
  state before; `pair.state === "unresolved"`; one notice of kind `"unresolved"`; a second
  `advanceCurveShorteningPairs` call returns `[]`.

### Part C: old tests (in `curveShortening.test.ts` after job 25 Part D)

Keep unchanged and passing: "detaches the two endpoint roles of a same-emitter loop into one curve-shortening free end",
"names a free end by its object kind rather than by an id substring in a preview", "refuses to realize a lifted chord
that hits a wall and leaves the segments untouched", "deletes a degenerate free loop together with its derived objects",
"fuses the issue 66 torus pair into the same loop at 60 Hz and at 240 Hz", "does not 2-cycle next to the fuse angle on
0.2 m arcs", "reaches the fuse within ceil(distance / step) + 2 ticks at 240 Hz", "deletes a free loop below the minimum
length at 240 Hz", and the job 05 loop-word tests.

Edit (remove `state: "ready-to-fuse"` from the pair setup; expectations unchanged except as noted): "fuses a ready
curve-shortening pair into one stable locked interval using the lower geodesic id" (its `changed` expectation becomes
`["g-a", "g-b"]`: new interval ids first, then deleted arc ids, then the pair id when the pair itself is reported;
Decision 11) and the three tests of describe "fusing into an already existing geodesic". If any other kept test fails
only because the returned list now also contains deleted arc ids, update that one expectation the same way and list it.

Delete (descent behaviour that no longer exists): "conjugates a free loop's word when curve shortening moves its free end
through a portal", "emits a debug diagnostic when a shortening pair is marked ready by mobile angle", "does not use
monotonicity as a collapse criterion for non-straight pairs", "rolls back a shortening step whose total length would
increase beyond the tolerance", "records the new total length after a monotone shortening step", "does not report a pair
as changed when a non-forbidden preview failure commits nothing", "reverts a ready-to-fuse pair to moving when its fusion
preview fails without a forbidden zone", "moves a shortening free end through a portal and recomputes moved-start portal
words", "absorbs a very short incident half into the longer half instead of waiting for pi angle fusion", "absorbs a
near-minimum half when the next shortening preview would make it degenerate", "keeps moving a free loop at 240 Hz until
it is resolved" (B4 replaces it). If one of the "keep" tests fails, analyse why and record it; do not change its
expectations without recording the reason under `### Deviations`.

### Part D: carried over from issues 31 and 32

End-to-end tests from the Phase F plan (issue 32 "Test Slices", issue 31 "Required Tests") that are still missing.
They state outcomes and are written against the exact resolution.

- D1 Tie/release of two distinct locked intervals at one emitter creates two moving intervals and one pair (32 slice 3).
  The only direct `tieAndDetachGeodesicEndpoints` test is the same-emitter loop case. Setup: three cannons in
  `compileLargeWorld()` at (-2,0), (0,1), (2,0); intervals left → middle and middle → right; tie at the middle cannon.
- D2 The torus two-emitter scenario of issue 31: tie and release at E2 of `E1 -- G2 -- E2 -- G1 -- E1` ends as one stable
  locked loop at E1 with a nonempty word (32 slice 7): word `[right]`, length 15 m, 3 segments, after **one** tick
  (`createTorusTiedPairScenario` + one `advanceCurveShorteningPairs` with `deltaSeconds: 1/60`).
- D3 A nondegenerate free loop ends as one stable free loop (32 slice 8): B5 through `advanceCurveShorteningPairs`.
- D4 A pair whose straight chord crosses a junction disk wraps the disk (32 slice 10; the old outcome "the other half
  survives as a stable free geodesic" is replaced): B1 through `tieAndDetachGeodesicEndpoints` on a third emitter at
  (4.5, 2.5) in `a` with locked arcs to `e1` and `e2`, then one tick: no arc is deleted; the result has one corner.
- D5 Resolution never creates a segment that spans a portal (32 slice 11): after D2 and D4, every segment's start and end
  have signed distance ≥ -1e-6 to every side of its cell.
- D6 Length measurements, protractor angles and intersections refresh or are removed after pair deletion and after
  resolution (32 slice 12). Use B2's scenario plus a third stable geodesic `g3` from a cannon at (0.5, -1) to a cannon at
  (0.5, 2) (an interval rebuilt with `rebuildDerivedGeodesicSegments`) that crosses `g2` at (0.5, 0.5) and, after the
  resolution, `g1` at (0.5, 0); create a measured length on `g2` with `createMeasuredGeodesicLengthObject` and a protractor
  angle between `g2` and `g3` at their intersection with `createProtractorAngleObject` (see
  `tests/world-objects/measureLengthTool.test.ts` and `protractorTool.test.ts` for the arguments). After one tick: the
  returned ids contain `g2` (deleted) and `g1`; `refreshMeasuredGeodesicLengthObject` for the `g2` measurement and
  `refreshProtractorAngleObject` for the angle return a falsy value (so the shell removes them); no
  `geodesic-intersection` object names `g2`; one intersection names `g1` and `g3`. Repeat with B4 (deleted loop): the
  returned ids contain the loop id.
- D7 A failed (unresolved) resolution leaves the stored words unchanged (32 slice 13, adapted: there is no free-end motion
  any more): B6 with F placed in `b` at (1, 1), so `g1` = e1 → F with word [a:ab] and `g2` = F → e2 with word []; after a
  tick both words deep-equal the words before.
- D8 Resolution with a non-emitter anchor at a non-free end (formerly refused, `TODO(issue 67)`): pair whose first arc's
  non-free anchor is a `geodesic-corner` (from B1) or a free end → resolved, chain starts at that anchor.

### Every Part

`npm run typecheck`, `npm test`, `npm run docs:check` (after `npm run docs:generate` if stale). Parts C and E: `npm run
build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

Manual browser check (record if not run): in `?config=full` on `torus-moduli`, make two emitters with two geodesics
between them, tie-and-detach at one emitter: within one frame a single locked geodesic remains; on `cube`, tie two
geodesics so that the straight result would pass a cube corner: the result bends at the corner with an invisible corner
anchor, and carrying an emitter keeps the bend.

## Do not

- Do not animate the resolution (Decision 1).
- Do not change tracing, the open-disk rule, `liftGeodesicEndpoint` or the portal-word algebra.
- Do not delete arcs because a path touches a disk; the only deletions are Decision 7's.
- Do not render corners (they are invisible anchors); do not add a HUD message system.
- Do not remove `geodesicConnectionsById`, `GeodesicEmitterConnection` or `connectionState` (Part E step 5).
- Do not change the intersection algorithm or the registry indexes (job 27).

## Done when

- [ ] `sleeve.ts` exists, is pure (import rule in `docs:check`), and A1-A9 pass.
- [ ] `advanceCurveShorteningPairs` resolves every moving pair in one tick; no `ready-to-fuse` state, no descent
      constants, no absorb, no forbidden-zone split remain (`git grep -n "ready-to-fuse\|absorbShort\|FuseAngle" src` is empty).
- [ ] B1-B6 and D1-D8 pass; changed or deleted old tests are listed under `### Deviations`.
- [ ] `legacyConnection.ts` and the 8 skipped tests are gone; `git grep -n "Straightening" src` shows only the display
      state `"straightening"`.
- [ ] Five commits (Parts A-E); build and smoke green after C and E.
- [ ] Issue 67 is closed (moved to `_issues/_closed/` with Outcome and Closing evidence: test names and the B1 numbers),
      unless the report has `### Uncertain` or `### Not done` items; then leave it open with a pointer to the report.
- [ ] Report written per [README](README.md).


## Report

### Done

Commits (one per Part): A `01fa320`, B `8e70ebd`, C `acf450a`, D `571d8eb`, E `f975c3b`.

- **Part A.** New pure `src/world-objects/geodesic/sleeve.ts`: `developSleeve`, `funnelPointApexes`, `tangentFromPointToDisk`, `tangentFromDiskToPoint`, `tangentBetweenDisks`, `solveTautPath`, `geodesicCornerClearanceMeters` (+ types). `moduleImportRules` entry for it in `scripts/docs/lib.mjs`. `tests/world-objects/geodesic/sleeve.test.ts` (A1-A9 plus an A4b word-mismatch test; all the numbers of the job reproduce, A9 runs 100 fast-check cases).
- **Part B.** `GeodesicCornerObject` / `createGeodesicCornerObject` / `isGeodesicCornerObject` (+ union entry); `isGeodesicLocked` is true for emitter-or-corner at both ends; `removeUnusedFreeGeodesicEnds` also removes unattached corners; `resolveCurveShorteningPair`, `CurveShorteningNotice`, `CurveShorteningResolution` in `curveShortening.ts`; `compileNarrowPortalWorld` fixture; tests B1-B6 (B1 numbers match: corner `pair:corner:0`, junction `a:vertex-1`, side `right`, (4.998114, 0.150095), total 3.001883).
- **Part C.** `advanceCurveShorteningPairs` resolves every `"moving"` pair in one call (returns new interval ids, then deleted arc ids, then the pair id when the pair was deleted or set unresolved); pair state is `"moving" | "unresolved"`; `previousTotalLengthMeters` removed (type, factory, debug dump, `appDebugHelpers`); tie never deletes (forbidden-zone branch removed); deleted `fuseCurveShorteningPair`, `absorbShortCurveShorteningHalf`, `cleanupCurveShorteningPreviewFailure`, `removeDegenerateFreeLoop`, `endpointDirectionAwayFromAnchor`, `getPairFreeRoleForInterval`, `totalLengthForGeodesicIds`, `radiansToDegrees`, `previewGeodesicIntervalIsDegenerate` (intervals.ts) and the five descent constants. `createThreeApp.ts`: `onNotice` logs `console.info("[noneuclid] " + message)` and `recordDebugEvent(message, notice)` always; after the changed-ids loop it calls `removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(...))`. Docs: `_docs/MATHEMATICAL_MODEL.md` section "7. Curve shortening" rewritten (the job says §6; in this file the section is 7), constants rows replaced by a corner-clearance row, `_docs/ARCHITECTURE.md` module list, module headers of `curveShortening.ts` and `objects.ts`.
- **Part D.** D1-D8 in `describe("issue 31/32 outcomes")` (D6 has a second test for the deleted loop id).
- **Part E.** Deleted `legacyConnection.ts`, `legacyConnection.test.ts` (the 8 skipped tests) and its import rule; `cannon.ts` returns `getGeodesicSegments(...)` for non-interval ids in `rebuildConnectedGeodesicBetweenEmitters` and `connectGeodesicToEmitter`; `geodesicCannonTools.ts` lost the `isGeodesicStraightening` filters, the `hasStraighteningIncidentGeodesic` guards, the non-interval branch of `updateCarriedGeodesicPortalWord` and `applyCarriedPortalTransition`; the factory doc comment is fixed. Notes added in job 33 (the skipped legacy tests are gone) and in issue 67.
- Issues the Done-when says to close: **issue 67** (move to `_issues/_closed/` with Outcome and Closing evidence = tests B1-B6, D1-D8, B1 numbers above). See Uncertain/Not done: the job rule says to leave it open when those sections are non-empty; the coordinator decides. Issues 31/32 were already closed.

### Deviations

- Old tests deleted (as listed in the job): in `curveShortening.test.ts` "emits a debug diagnostic when a shortening pair is marked ready by mobile angle", "does not use monotonicity as a collapse criterion for non-straight pairs", "rolls back a shortening step whose total length would increase beyond the tolerance", "records the new total length after a monotone shortening step", "does not report a pair as changed when a non-forbidden preview failure commits nothing", "reverts a ready-to-fuse pair to moving when its fusion preview fails without a forbidden zone", "moves a shortening free end through a portal and recomputes moved-start portal words", "absorbs a very short incident half ...", "absorbs a near-minimum half ...", "keeps moving a free loop at 240 Hz until it is resolved" (replaced by B4); in `carry.test.ts` "conjugates a free loop's word when curve shortening moves its free end through a portal".
- Old tests edited: "fuses a ready curve-shortening pair ..." (state `ready-to-fuse` removed, `changed` is now `["g-a", "g-b"]`) and the `setup()` of "fusing into an already existing geodesic" (state removed). All other kept tests pass unchanged.
- Fixtures: `createKinkPairScenario` removed (only the deleted tests used it); `previousTotalLengthMeters` removed from `createSymmetricPairScenario`; `compileNarrowPortalWorld` added; `createCornerScenario` / `createNarrowPortalScenario` are hoisted to module level of `curveShortening.test.ts` so D tests can share them.
- Part E also removed the test "extends a carried connection word once per crossing, in order" (`tests/render-contract/geodesicCarryPortalTransition.test.ts`, it only called `applyCarriedPortalTransition`), and replaced the legacy-importers test in `tests/docs/moduleImportRules.test.ts` by a test of the sleeve import rule (the `allowedImporters` rule shape in `lib.mjs` is now unused by any rule but still supported).
- `AdvanceCurveShorteningPairsRequest` lost `onDebugMessage` as well as `speedMetersPerSecond` (nothing emits debug messages any more); `createThreeApp.ts` passes only `onNotice`.
- `resolveCurveShorteningPair` returns `{status: "resolved", geodesicIds, removedIds} | {status: "deleted", removedIds} | {status: "unresolved", reason}` (job: `{status:"deleted"}`); tests use `toMatchObject`.
- `resolveDerivedSegmentConnectionState` (segments.ts) now reports `"connected"` for a stable interval whose ends are emitter-or-corner (the job did not list it; without it a locked polygon would be drawn as "open").
- `funnelPointApexes`: the pseudocode needed two guards: it stops when the end point itself tightened the right edge and meets the left edge, and it never reports portal 0 / the end portal or the same point twice. `solveTautPath` counts the "wrong side" test only when the aperture endpoint projects onto the piece, and orders inserted apexes of equal aperture index by projection on the start-end chord.

### Uncertain

- Only synthetic worlds (large portal world, torus, narrow portal world, rotated free loop) test the resolution; no cube/icosahedron case with several corners at one vertex or `m = 2` corners per wrap was exercised. A manual run on `cube` (see below) would confirm the walk-based corner placement and the junction lookup (`corner-junction` failure would show as an `unresolved` notice).
- Corner `z` is the beam height of anchor A (`pointA.z`); correct when all anchors share a floor height.
- `geodesicDebugDumps` anchor list still shows only emitters and free ends (corners are not listed).
- The job says the math doc section is §6; it is "## 7. Curve shortening" in the file.
- `getGeodesicConnection` / `isGeodesicLocked` legacy fallbacks (connection state `straightening`) are untouched, as the job says.

### Not done

- On-screen message for the notices (no HUD message system; separate UI job). Notices go to `console.info` and `recordDebugEvent`.
- Carrying an emitter rebuilds its emitter-to-corner interval with the corner fixed; the chain is not re-tautened (known limitation, Decision 5).
- Kept for job 33: `GeodesicEmitterConnection`, `getGeodesicConnection`, `geodesicConnectionsById` readers and the segment `connectionState` (display state `"straightening"`).
- No animation of the resolution (Decision 1).

### Manual checks not run

1. `npm run dev`, open `?config=full&world=torus-moduli`; place two emitters, shoot two geodesics between them, use tie-and-detach at one emitter: within one frame a single locked geodesic must remain (console shows no `unresolved` notice).
2. Same on `?world=cube`: tie two geodesics whose straight result would pass a cube corner. The result must bend at the corner with no visible corner anchor, and carrying an emitter must keep the bend (the corner stays pinned). Check the console for `[noneuclid] The tied geodesic could not be straightened (...)` messages.

### Checks

- Baseline before changes: `npm run typecheck` clean; `npm test` 123 files passed + 1 skipped, 900 passed, 8 skipped.
- Final: `npm run typecheck` clean; `npm test` 124 files passed, 913 tests passed, 0 skipped; `npm run docs:check` all ok (after `npm run docs:generate`); `npm run build` ok (chunk-size warning only); `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` SMOKE OK (4 pages), run after Part C and after Part E (no loading-screen flake seen).
- `git grep -n "ready-to-fuse\|absorbShort\|FuseAngle" src` is empty; `git grep -n "Straightening" src` shows only `geodesicSegmentStraighteningArchetypeKey` in `geodesicCannonRenderer.ts` (display state).