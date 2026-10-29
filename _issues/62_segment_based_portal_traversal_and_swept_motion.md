# 62 - Replace the anchor-point exit guess with segment traversal plus swept collide-and-slide

Status: open; re-verified 2026-10-28; fix designed 2026-10-29.

Priority: P1 (correctness and robustness). This is a concrete design for the issue 41 items "a step that crosses a portal
returns before floor/ceiling/forbidden-zone tests" and "`portalCrossingMode` ignored", plus new failures listed below.

Jobs: [12](../.agents/jobs/12_segment_walk_kernel.md), [13](../.agents/jobs/13_swept_collide_and_slide.md).

## Status update 2026-10-29

- Item 5 (framerate dependence) is partly done: the per-frame simulation step is capped at 0.1 s
  (`maxSimulationStepSeconds`, commit `98a99af`). The slide itself is designed to be step-size independent.
- Design decided in [job 12](../.agents/jobs/12_segment_walk_kernel.md) (kernel) and
  [job 13](../.agents/jobs/13_swept_collide_and_slide.md) (mover); not implemented yet:
  - The centre slides through obstacles collected in the start cell's developed frame (the developed disk of job 12);
    then the anchor's polyline is walked with the segment-walk kernel. This replaces the per-cell loop sketched in
    "Proposed change"; the result is the same for steps below 0.5 m and needs less code.
  - Vertex rule: a segment through a vertex exits through the side that starts at that vertex (an infinitesimal shift
    to the left). Prototype: the cube-vertex walk goes `front → right (zero length) → bottom` and ends 6.64 m inside
    `bottom`.
  - A zero horizontal displacement never walks, so it never crosses.
  - `PortalCrossingMode` is narrowed to `"anchor"`; the field stays (five callers), the `"bounds"` throw is removed.
  - The merged issue-41 item (target-wall overlap at a crossing) is decided: neighbour walls are obstacles of the slide,
    so the question no longer arises.
  - Results report every crossing (`crossings`) and the start-to-final transform (`cellFromStart`);
    `crossedPortalId` stays the first crossing. Callers that assumed one crossing per move (cannon carry, curve
    shortening, cell-transition recording) are fixed in job 13 Part C.

## Status update 2026-10-28

Done (small parts only):

- Failure 4, partly: the crossing branch of `moveDynamicObject` (`src/movement/moveDynamicObject.ts:96-124`) now runs
  `testCellCollision` in the target cell (ignoring the reciprocal portal side) and refuses the crossing on a floor,
  ceiling or forbidden-zone block. Test: "refuses to cross when the object would violate the target cell ceiling"
  (`tests/movement/moveDynamicObject.test.ts`). Target walls are still deliberately ignored (comment at line 112).
- `portalCrossingMode: "bounds"` now throws instead of being silently ignored (`moveDynamicObject.ts:83-85`, test
  "throws for the unimplemented bounds crossing mode"). The field and the enum value are not deleted yet.

Still open (bug still reproduces):

- `findMostProbablePortalExit` (`moveDynamicObject.ts:199-247`) still decides the exit from the end point only. Re-ran the
  cube vertex repro (throwaway vitest file, current code): body `r = 0.2` at the center `(0, 0)` of `front`, 0.05 m
  steps toward `(7.5, -7.5)`. With `ignoreForbiddenZones: true` it stays in `front` with 0 crossings and 0 blocks and
  keeps walking away (at `(14.14, -14.14)` after 400 steps, min side distance -6.64 m). With zones enabled it stops at
  `(7.248, -7.248)`, 0.252 m clearance, as before.
- One crossing per step, no swept walls, no `dt` clamp (`src/render/three/createThreeApp.ts:1211`,
  `const deltaSeconds = clock.getDelta();`), and the test "teleports an out-of-domain endpoint through only one most
  probable portal per frame" (now `tests/movement/moveDynamicObject.test.ts:147`) still encodes failure 3.

## Summary

`findMostProbablePortalExit` (`src/movement/moveDynamicObject.ts:199-247`, was 170-218) decides which portal a body crossed by looking
only at the end point `q = p + δ`: the most-negative side, with a fallback to a portal side whose projection contains `q`.
It never looks at the path `p → q`. The consequences:

1. **Loss into the vertex void.** If `q` lies in the wedge beyond a vertex (outside two sides, with both projections out of
   range), the function returns `undefined`. The collision test finds no walls (all sides are portals) and the body is
   accepted *outside its cell*. From there it never crosses again while it keeps moving away.
2. **Wrong portal / through walls.** At an obtuse corner (β > 90°) between wall W and portal P, the region outside both
   lines contains points whose projection onto P is in range. A step whose segment crosses W first is then sent through P.
3. **One crossing per step.** `g(q)` can land beyond another side of the target cell. The body is rendered for a frame from
   a cell it is not in, and near a cone point the developed `g(q)` is not even the right sheet.
4. **No checks after crossing.** ~~The crossing step skips the zone, floor and ceiling checks (issue 41)~~ done: the target cell is now tested for these and the crossing is refused on a hit. It still skips every target
   wall, so the body can land with its center inside a target wall.
5. **Framerate dependence.** The step length is `speed · dt` and `dt` is not clamped
   (`src/render/three/createThreeApp.ts:1211`, `clock.getDelta()`; `desktopControls.ts:265` `consumeFrame`; creatures `update(world, dt)`).
   After a tab switch or GC pause, `dt` of several seconds gives 2.5 m/s · 4 s = 10 m single steps, which is half a cube
   face. Failures 1-4 scale with `|δ|`.

## Evidence

- Reproduced in the bundled `cube` world (scratch script): body `r = 0.2` placed at the center of cell `front`, with steps of
  0.05 m toward vertex `(7.5, -7.5)` and `ignoreForbiddenZones: true` (as used by mice and butterflies,
  `src/world-objects/simpleGeoCreature.ts:242`). Result: still in `front` at `(9.65, -9.65)`, 2.15 m outside the cell,
  with 0 crossings and 0 blocks. With zones enabled it stops at 0.25 m clearance.
- A path does not have to hit the vertex exactly. A straight path that exits within `|δ|·cot θ` of a vertex leaves `q` with
  an out-of-range projection, and at most one other side reports negative clearance. The probability per crossing is about
  `|δ| / side length`, which a 10 m `dt` spike makes certain.
- `tests/movement/moveDynamicObject.test.ts:147` ("teleports an out-of-domain endpoint through only one most probable
  portal per frame") encodes failure 3 as intended behavior.

## Proposed change

Treat the motion of the center as a polyline traced through the complex, the same way geodesics are traced.

```
move(state, δ):                      // δ in current cell frame
  remaining = δ; contacts = []
  for iter in 0..7:
    if |remaining| < 1e-9: break
    cell = state.cell; p = center(state)
    // 1. earliest portal crossing of the CENTER segment p→p+remaining
    sP, P = min over portal sides i of segment/segment intersection
            with s∈(0,1], u∈[0,L_i], strict sign change d_i(p) >= 0 > d_i(p+remaining)
    // 2. earliest contact (swept disk) against obstacles developed into this frame
    sC, n = min TOI over: wall capsules (segment ⊕ r), zone discs (radius r+r_z),
            other bodies (radius r+r_o), using issue 63's neighborhood
    if sP < sC:
        state = advance(state, sP·remaining); state = cross(state, P)
        remaining = R_P · ((1-sP)·remaining); continue
    if sC <= 1:
        state = advance(state, max(0, sC - skin/|remaining|)·remaining)
        v = (1-sC)·remaining; v -= (v·n)n
        for n' in contacts: if v·n' < 0: v = 0   // 2-D crease
        contacts.push(n); remaining = v; continue
    state = advance(state, remaining); break
```

- TOI of a ray `p + s·v` against a capsule `{x : dist(x, [a,b]) <= ρ}`: take the minimum over the two end caps (ray-circle
  quadratic `|p + s v - a|^2 = ρ^2`, smallest root in `[0,1]`) and the slab (`n·(p + s v - a) = ρ`, accepted only if the hit
  point projects into `[0,L]`). Accept only approaching hits (`v·n < 0`). A start that is already penetrating gets `s = 0`
  with the depenetration normal.
- Floor and ceiling are 1-D: clamp `z` and clip `v_z`. They are no longer a whole-step rejection.
- The loop handles any number of crossings per step and corners. It is framerate-independent up to the iteration cap; also
  clamp `dt <= 0.1 s` at the caller as a gameplay guard.
- `PortalCrossingMode` becomes meaningful: "anchor" means the segment test above uses the anchor; "bounds" is dropped (a
  body straddling a portal is handled by issue 63, not by moving its owning cell early). Delete the dead field and enum value
  in the same change.

## Acceptance criteria

- The cube vertex repro ends inside some cell (min signed side distance >= 0) whether or not zones are ignored. With zones
  enabled it stops at the zone.
- One call with `|δ| = 30 m` through a chain of cells gives the same final `(cellId, pose)` as 600 calls of `δ/600`, to
  within 1e-6.
- The center never ends a call outside its cell: assert `min_i d_i(center) >= -1e-9` in a debug build.
- The test at `moveDynamicObject.test.ts:147` is rewritten to expect full traversal.

## Merged from issue 41 (2026-10-28)

- Wall overlap at a portal crossing is not tested in the target cell (floor, ceiling and zones are). It is documented
  as deliberate in `movement/moveDynamicObject.ts:112` (corner straddling). The swept slide here, with the obstacle
  set from issue 63, should decide it; until then, either accept it explicitly or test target walls.
