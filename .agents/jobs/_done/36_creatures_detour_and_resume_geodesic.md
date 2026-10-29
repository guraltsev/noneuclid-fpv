# Job 36 - Creatures detour around obstacles and resume their geodesic

Status: done, needs review on 2026-10-29.
Written on 2026-10-29 for a less capable implementing model. Approved by the maintainer on 2026-10-29, with the
requirement that **a detour around a forbidden zone passes the vertex on the same side as the creature's geodesic**.
Resolves: no open issue. It replaces job 13 Decision 12 ("creatures keep ignoring zones").

## Goal

Mice and butterflies (`simpleGeoCreature`) respect forbidden zones, walk around zones, the player and other bodies,
and then return to **the same geodesic** they were on, with the same heading, as if they had never left it.

Mechanism: every creature owns an invisible **leader** that walks the geodesic exactly (no obstacles). Each tick the
creature tries to move to the leader's position (plus today's wobble and bob). With nothing in the way the creature
*is* the leader, so the path is unchanged from today. When something is in the way, job 13's slide carries the
creature around it and the leader pulls it back onto the line.

## Depends on

[Job 13](13_swept_collide_and_slide.md) (mover with developed obstacles and `cellFromStart`),
[job 12](12_segment_walk_kernel.md) (`walkDevelopedSegment`). Uses `orthonormalizeYawRigidTransform3` from
[job 14](14_movement_numerics.md) if it has landed; otherwise use plain composition and record that. Nothing depends on
this job.

## Before you start

Line numbers are from commit `0d86165`; jobs 13 and 14 change some of these files, so search by name.

| File | What to look at |
| --- | --- |
| `src/world-objects/simpleGeoCreature.ts` | `createSimpleGeoCreatureRuntime` (:166-310): `state`, `initialState`, `update` (:217-252), `transformGeometry` (:262-286), `reset` (:287-300); oscillation helpers (:380-460); `forbiddenZoneLateralOscillationScale` |
| `src/world-objects/geodesicMarmot.ts` | `update` (:140-160) and `turnAwayFromNearestForbiddenZone` (:274): **not** used here, for comparison only |
| `src/movement/moveDynamicObject.ts` | after job 13: `bodiesInCell`, `crossings`, `cellFromStart`, `blocked` |
| `src/movement/developedObstacles.ts`, `src/movement/sweptCollision.ts` | after job 13 |
| `src/cell-complex/segmentWalk.ts` | `walkDevelopedSegment`, the vertex tie rule |
| `src/movement/depenetrateDynamicObject.ts` | the `ignoreForbiddenZones` option |
| `tests/world-objects/simpleGeoCreature.test.ts` | existing creature tests and helpers |
| `_docs/MATHEMATICAL_MODEL.md` §1 | forward = R·e_y; yaw = atan2(R10, R00) |

Baseline: `npm run typecheck`, `npm test`.

## Background

### Why a leader and a relative transform

The creature and the leader live in cells of their own, possibly different cells, possibly on opposite sides of a
portal. To pull the creature toward the leader we need the leader's position **in the creature's frame**. There are two
ways to get it:

- Search the developed disk around the creature for the leader's cell (job 12 atlas). That uses the *straight ray*
  from creature to leader. Near a cone vertex that ray can pass the vertex on the other side from the leader's own path,
  so the creature would go round the wrong side. **Rejected** (maintainer requirement).
- Keep an explicit transform `creatureFromLeader` (leader-cell frame → creature-cell frame) and update it whenever
  either one crosses a portal. It is the developing map along "the creature's path back to the start, then the
  leader's path forward". It therefore always describes the side of every vertex on which the two paths actually ran.
  **Chosen.**

Update rules (`compose(a, b)` = a after b):

- leader crosses portal g (leader frame becomes g ∘ old): `creatureFromLeader = compose(creatureFromLeader, invert(g))`;
- creature moves with result `cellFromStart = h` (creature frame becomes h ∘ old):
  `creatureFromLeader = compose(h, creatureFromLeader)`.

Initially (creation, reset, after a deformation commit) the leader is put on the creature and the transform is the
identity.

### The side rule at a forbidden zone

Let, in the creature's frame: `L` = leader position, `dL` = leader forward direction (both mapped with
`creatureFromLeader`), `v` = the developed zone centre the creature touches, `c` = the creature's collision centre.
The geodesic passes v on a definite side:

```text
side = sign(cross(dL, v − L))    // +1: v lies to the LEFT of the geodesic; −1: to the RIGHT
if |cross(dL, v − L)| ≤ 1e-9: side = −1      // line through v: job 12's tie rule passes v with v on the right
```

The creature must pass v with v on the same side. When it is touching the zone disc
(`|c − v| ≤ r + r_zone + 1e-5`) and its desired displacement `δ` points into the disc (`δ·(v − c) > 0`), replace δ by
an orbit step of the same length along the tangent `t` that keeps v on the required side:

```text
n = (c − v)/|c − v|                 // outward normal of the disc
t = side > 0 ? (−n.y, n.x)          // n turned +90°: v stays on the LEFT  of t
             : (n.y, −n.x)          // n turned −90°: v stays on the RIGHT of t
δ = |δ| · t
```

Sign check: "v on the left of t" means `cross(t, v − c) > 0`. Since `v − c = −|c − v|·n`, that is `cross(t, n) < 0`,
i.e. `cross(n, t) > 0`, i.e. t is n turned counterclockwise by 90°: `t = (−n.y, n.x)`
(`cross(n, t) = n.x² + n.y² = 1`). Physically: the geodesic passes with v on its left, so the creature goes round the
disc on the disc's right-hand side, where n points to the creature's right, and n turned +90° is "forward". Step 2's
unit test must confirm this on numbers: v = (0, 0), c = (0, −0.2), geodesic along +x with v on its left (side = +1)
gives t = (1, 0).

The slide of job 13 then keeps the body on the disc boundary. As soon as δ no longer points into the disc (the leader is
past the zone), the normal pull takes over and the creature rejoins the line on the correct side.

### The leash

If the creature cannot follow (the player stands on the geodesic), the leader must not run away: it advances only
while the creature is close to it. Then the creature waits behind the obstacle like today, and the slide lets it go
around the player when it can.

## Decisions

1. **Leader state.** Decided: `leader: { cellId: string; localPose: RigidTransform3 }` (no collision), plus
   `creatureFromLeader: RigidTransform3`, both private to the runtime closure.
2. **Leader step.** Decided: each tick the leader advances `speed · dt` along its forward `R·e_y` with
   `walkDevelopedSegment` (zones and walls ignored; status `wall` cannot happen in shipped worlds; on any status other
   than `end`, keep the leader where it is and record a `console.warn` once). Apply each crossing to the leader pose and to
   `creatureFromLeader`, re-project with `orthonormalizeYawRigidTransform3`.
3. **Leash.** Decided: the leader advances only if the creature's lag `|L + offset − c|` (developed, horizontal) is below
   `creatureLeashMeters = 0.5`. If the lag exceeds `creatureLostMeters = 3`, re-seed the leader on the creature
   (identity transform, the creature's current heading). Constants in `simpleGeoCreature.ts` with JSDoc.
4. **Target.** Decided: target = `L + lateralOffset · rightL + (0, 0, verticalOffset)` where `rightL` is the leader's
   right vector `R·e_x` in the creature frame and the offsets are today's oscillation values (not increments). The
   desired displacement is `target − anchor_of_creature`, horizontally capped at `1.5 · speed · dt` (catch-up speed),
   vertical part uncapped. Then apply the side rule. With nothing in the way the creature reaches the target exactly each
   tick, so the path equals today's "geodesic plus bounded oscillation".
5. **Zones on.** Decided: call `moveDynamicObject` **without** `ignoreForbiddenZones`, with `bodiesInCell` as job 13
   set it up. In `transformGeometry`, depenetrate with zones on (remove `{ ignoreForbiddenZones: true }`).
   `forbiddenZoneLateralOscillationScale` stays (it keeps the wobble small near zones).
6. **Heading.** Decided: when the lag is below 1e-4 m, the creature's rotation is the leader's rotation mapped into
   the creature frame (`creatureFromLeader.rotation · leader.rotation`); otherwise its yaw is the direction of its last
   applied horizontal displacement (unchanged if that was below 1e-6 m).
7. **Reset and commits.** Decided: `reset` and `transformGeometry` put the leader on the creature's new pose with the
   identity transform.
8. **Other obstacles.** Decided: the side rule applies to forbidden zones only. Walls and bodies lie in flat regions,
   where the side does not change the route's homotopy class; the plain slide handles them.

## Steps

1. Add the leader state, constants and the two update rules (Decisions 1-3, 7). Keep `state` as the creature's
   physical pose.
2. Write the side rule as an exported pure function in `simpleGeoCreature.ts` (JSDoc), for example
   `applyForbiddenZoneSideRule(desired: Vec2xy, center: Vec2xy, zoneCenter: Vec2xy, contactRadius: number, side: 1 | -1): Vec2xy`,
   and a helper `geodesicSideOfPoint(L, dL, v): 1 | -1`. Unit-test the sign convention first (Background: the test is
   authoritative).
3. Rewrite `update` (Decisions 4-6): advance the leader (if within the leash), compute the target and δ, find the zone
   the creature is touching (the nearest `singularityColumns` centre of its own cell within `r + r_zone + 1e-5`;
   neighbour-cell zones are developed copies of the same vertex, so the own cell is enough while the anchor is near it;
   if none, skip the rule), apply the side rule, call `moveDynamicObject`, then update `creatureFromLeader` with
   `result.cellFromStart` and set the heading.
4. Update `transformGeometry` and `reset` (Decisions 5, 7).
5. Update the module header comment and `_docs/MATHEMATICAL_MODEL.md` (a short paragraph in §5: "Creatures follow a
   leader on their geodesic").

## Tests

New `describe("leader and detour")` in `tests/world-objects/simpleGeoCreature.test.ts`. Use a creature with oscillation
magnitude 0 unless stated, and drive `update` with a fixed `dt = 1/60`.

1. Unobstructed equals the geodesic: on `icosahedron`, 2 000 ticks without obstacles; at every tick the creature's pose
   equals a reference pose advanced by `walkDevelopedSegment` alone, within 1e-9 (translation) and 1e-12 (rotation
   entries), including across several portal crossings.
2. Side compatibility, zone on the left: on `cube`, aim a creature (radius 0.05) so that its geodesic passes a vertex v
   at 0.12 m with v on its **left** (closer than 0.05 + 0.15, so it must detour). At every tick while the creature is
   within 1 m of v (developed in the creature frame), `cross(dL, v − c) ≥ −1e-9` holds, i.e. v stays on the creature's
   left. After the creature is 1 m past v, its pose equals the leader's within 1e-6 and its lag is below 1e-6 within
   300 ticks.
3. The same with v on the **right**.
4. Geodesic exactly through v: the creature passes with v on its right, and the leader's walk (vertex tie rule) also
   leaves v on its right; afterwards the creature and the leader coincide within 1e-6.
5. Wrong-side start: put the creature touching the zone on the side opposite to the geodesic's side (simulate a wobble
   that went wrong). It orbits the zone toward the required side (the side condition of test 2 holds from the first tick
   after it reaches the line's side) and rejoins the leader; it never passes v on the wrong side (track the developed
   angle of `c − v`, unwrapped: its total change has the sign the geodesic's side requires).
6. Leash: a fixed body obstacle (radius 0.3) placed on the geodesic in front of the creature for 120 ticks, then
   removed. While blocked, the leader's lag stays ≤ 0.5 + speed·dt; after removal the creature rejoins the leader.
   The creature may slide around the body if there is room; record what you observe.
7. Lost leader: force a lag above 3 m (teleport the creature with a commit-like call), check the leader is re-seeded.
8. Reset and `transformGeometry`: the leader is back on the creature and the next unobstructed tick moves both together.
9. The existing creature tests still pass; list any whose expectations changed under `### Deviations` (for example a
   test that expected a creature to pass through a zone).

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`; smoke test once (`npm run smoke -- --world cube`). Manual check
(record if not run): in `cube`, watch a mouse approach a vertex; it walks around the invisible zone on the side its
straight path was on and continues in a straight line.

## Bookkeeping

Job 13's Decision 12 already points here. When this job lands, mark job 36 done in the queue table of
`.agents/jobs/README.md`.

## Do not

- Do not use the developed-disk atlas to locate the leader (Background: it can pick the wrong side of a cone vertex).
- Do not change marmots; they keep their turn-away behaviour.
- Do not change the oscillation formulas.

## Done when

- Creatures move with zones on, follow their leader, and tests 1-9 pass.
- The side rule is a tested pure function, and test 5 shows a creature never passes a vertex on the wrong side.

## Report

### Done
Commit d57aaf4.
- `src/world-objects/simpleGeoCreature.ts`: each creature owns a private leader (`leader`, `creatureFromLeader`, identity at creation, `reset` and `transformGeometry`). `update` advances the leader with `walkDevelopedSegment` while the creature lags it by less than `creatureLeashMeters` (0.5; exported), re-seeds it when the lag exceeds `creatureLostMeters` (3; exported), targets leader + wobble (offset values, not increments; butterfly bob measured from its start value), caps the horizontal step at 1.5 x speed x dt, applies the side rule, and calls `moveDynamicObject` with zones on. `creatureFromLeader` is updated by both rules with `orthonormalizeYawRigidTransform3` (job 14 helper). `transformGeometry` depenetrates with zones on. New exported pure functions `geodesicSideOfPoint` and `applyForbiddenZoneSideRule`; new runtime method `leaderForDebug()` (for tests). Module header and JSDoc updated.
- `_docs/MATHEMATICAL_MODEL.md`: paragraph "Creatures follow a leader on their geodesic" at the end of section 5; generated docs regenerated.
- `tests/world-objects/simpleGeoCreature.test.ts`: `describe("side rule")` (sign convention on numbers, v=(0,0), c=(0,-0.2), side +1 gives t=(1,0)) and `describe("leader and detour")` with tests 1-6 and 8.
### Deviations
- Side rule trigger. The job fires the rule only when touching the disc. I also fire it when the step would reach the disc: the creature walks to the contact point and spends the rest of the step along the tangent there (the straight move to that end point stays outside the disc). Without this the slide itself would choose the side when the creature approaches from a distance. A creature touching a zone on the wrong side (zone centre on the other side of the geodesic than required) orbits toward the required side by one step regardless of where the target is (`applyForbiddenZoneSideRuleToColumns`, private).
- Heading (Decision 6). The leader's rotation is used when the lag is below 1e-4 m or when the move was neither blocked nor altered by the side rule; otherwise the yaw of the applied displacement. The second condition keeps the heading constant while the wobble pulls the creature sideways of the leader (the lag is then never below 1e-4).
- Step cap (Decision 4): the cap is 1.5 x speed x dt plus the change of the (scaled) lateral offset in that tick, so a speed-0 wobbling creature still wobbles (existing test).
- Lag in the leash and lost rules is measured to the target (leader plus wobble), horizontally.
- Test 5 reaches the wrong-side branch with a fixed body at (7.1, 7.1), radius 0.4 for 150 ticks (placement found by scanning; the branch was confirmed entered with a temporary counter, since removed). A creature cannot otherwise start on the wrong side because the leader is seeded on it.
- Existing tests: none changed.
### Uncertain
- Heading while detouring jumps from the leader's yaw to the displacement yaw; since the collision centre is offset from the anchor (mouse), the centre moves slightly when the yaw changes. Not seen to cause trouble.
- Near a zone the lateral wobble value is now scaled to 0 (previously its increments were scaled and the offset froze), so the creature returns to the geodesic there instead of keeping a frozen sideways offset.
- Only the creature's own cell columns are tested for zones (as the job says).
### Not done
- Test 7 (lost leader). The re-seed branch is unreachable through the public API: the leash caps the lag at about 0.5 m + one step, and `transformGeometry`/`reset` re-seed anyway; the runtime does not read teleports from the registry. The branch is a defensive guard and is untested.
### Checks
- Baseline: `npm run typecheck` ok; `npm test` 875 passed, 8 skipped.
- After: `npm run typecheck` ok; `npm test` 883 passed, 8 skipped (116 files); `npm run docs:check` ok after `npm run docs:generate`; `npm run smoke -- --world cube` SMOKE OK.
### Manual checks not run
- Watching a mouse approach a cube vertex in a browser (it should walk round the invisible zone on its geodesic's side and continue straight).