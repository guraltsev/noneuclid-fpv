# Job 06 - Stop curve shortening from stalling

Status: queued.
Resolves: issue [66](../../_issues/66_curve_shortening_stalls_at_high_frame_rate.md).

## Goal

Curve shortening must converge at any frame rate. It must also not 2-cycle (livelock) next to the fuse angle, and a
free loop must keep moving until it fuses or is deleted. This is a small, safe change to the gradient-descent tick
(`advanceCurveShorteningPairs`): no new solver, no new state. [Job 26](26_exact_curve_shortening.md) later replaces
the solver.

## Depends on

[Job 05](05_conjugate_loop_word_on_anchor_crossing.md) must be done. Test 4 below reuses its fixture
`compileRotatedFreeLoopWorld`, and the free loop in that test only moves correctly across the portal once job 05 has
landed. If job 05 is not done, stop after Step 4. Do tests 1-3 and 5, skip test 4, and record this under `### Not done`.

## Before you start

Line numbers are for commit `e094b82`; job 05 shifts some by a few lines. Search for the quoted code if a line does not
match.

Read:

- `src/world-objects/geodesicCannon.ts`
  - `:36-67`: the module header, the "Curve shortening" and "Constants" sections.
  - `:575-591`: the curve-shortening constants.
  - `:3597-3890`: `advanceCurveShorteningPairs`. Read its docstring (`:3599-3627`) and the step block (`:3705-3742`).
  - `:4023-4148`: `absorbShortCurveShorteningHalf`. Note the early `return undefined` at `:4055-4064`.
  - `:4427-4448`: `removeDegenerateFreeLoop`.
- `src/render/three/createThreeApp.ts:1266-1268` and `:1432-1446`: the frame loop passes the raw `clock.getDelta()`
  (not clamped) as `deltaSeconds`. Read only.
- `tests/world-objects/geodesicCannon.test.ts`
  - `:1688-1735`: `tieAndDetachGeodesicEndpoints` on the torus.
  - `:1979-2023`: monotone-descent tests.
  - `:2025-2073`: a free loop deleted for being degenerate.
  - `:2218-2357`: the two absorb tests. They must keep passing unchanged.
  - `:2850-2870`: `createKinkPairScenario`.
  - `:2918-2921`: `totalGeodesicLength`.
  - `:3000-3016`: `compileLargeWorld`.
  - `:3090-3111`: `compileTorusLoopWorld`.
  - `createCarryPortalTraversal` and `compileRotatedFreeLoopWorld`, which job 05 added near the end of the file.
- `_docs/MATHEMATICAL_MODEL.md` §7 "Curve shortening" (lines 234-268), the §10 table (lines 363-374), and the §11
  "Curve shortening" bullet (lines 397-401).

Baseline, in Windows Git Bash from the repository root:

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. If they do not, record the failures under `### Checks` in the Report and
continue. To run one file: `npx vitest run tests/world-objects/geodesicCannon.test.ts`.

## Background

### What the tick does

A pair has a free vertex F. Its two arcs run from F to fixed ends A and B. A free loop is a single interval with both
ends on F. Each tick, `advanceCurveShorteningPairs` does the following:

1. It computes the unit tangents u, v of the two arcs at F, pointing away from F. Their sum u + v is minus the gradient
   of the total length.
2. If the angle between u and v is within `curveShorteningFuseAngleToleranceRadians` = 0.03 rad of π, it flags the
   pair `ready-to-fuse`. The pair is fused on the next call.
3. Otherwise it moves F by `stepMeters` along normalize(u + v), previews both arcs, and commits if the total length
   did not grow.

The step block today (`geodesicCannon.ts:3705-3729`):

```ts
// Cap the step by a quarter of the shortest incident arc so a step never overshoots the opposite endpoint's neighbourhood.
const shortestIncidentLength = Math.max(
  curveShorteningMinStepMeters,
  Math.min(...owned.intervals.map((interval) => totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, interval.id)))),
);
const stepMeters = Math.min(
  (request.speedMetersPerSecond ?? curveShorteningDefaultSpeedMetersPerSecond) * request.deltaSeconds,
  0.25 * shortestIncidentLength,
);
if (stepMeters < curveShorteningMinStepMeters) {
  const absorbed = absorbShortCurveShorteningHalf({ ... });
  if (absorbed) {
    changed.push(absorbed.id);
  } else if (removeDegenerateFreeLoop(request.registry, pair, owned.intervals)) {
    changed.push(pair.id);
  }
  // TODO(issue 66): a free loop whose length lies between GEODESIC_MIN_LENGTH_METERS and 4 * curveShorteningMinStepMeters stalls here forever.
  continue;
}
```

### Defect 1: the step size is used as a geometry test

The code reads "this tick's step is below `curveShorteningMinStepMeters` (0.002 m)" as "one arc is almost gone".
The step is `v·dt` with v = 0.4 m/s, and `v·dt < 0.002` exactly when dt < 5 ms, that is, above 200 fps. On a 240 Hz
display, every tick goes into the branch above:

- In a two-arc pair, `absorbShortCurveShorteningHalf` refuses, because the short arc is longer than
  `curveShorteningFuseStepToleranceMeters` = 0.165 m (`:4055-4064`).
- In a free loop, it refuses because there is only one interval, and `removeDegenerateFreeLoop` refuses because the
  loop is longer than 0.15 m.

Then `continue` skips the move. The pair stays `moving` forever.

About the `TODO(issue 66)`: the length range it names is empty. `0.25 · max(0.002, L) < 0.002` holds only when
L < 0.008 m. Every such loop is shorter than `GEODESIC_MIN_LENGTH_METERS` = 0.15 m, so `removeDegenerateFreeLoop`
deletes it. The free loop that really stalls is any loop at more than 200 fps (Defect 1). This job fixes that stall, so
the TODO goes away with it.

### Defect 2: the fixed step 2-cycles next to the chord

Near the straight position, F moves by a fixed `s = v·dt` along u + v, which is close to the chord's normal. Let F be
at distance h from the chord ÃB̃, and let the arcs have lengths a and b. Then the angle deficit is
δ = |π − angle| ≈ h·(1/a + 1/b). For a = b = 0.2 m and s = 0.4/60 = 6.7 mm, F jumps from h = +3.3 mm to h = −3.3 mm
and back. Each time δ ≈ 0.033 > 0.03, so the pair never fuses.

The fix: also cap the step by the estimated distance to the chord,

```text
hEstimate = δ / (1/a + 1/b)          (meters; δ in radians, a and b the two arc lengths)
stepMeters = min(v·dt, a quarter of the shorter arc, hEstimate)
```

This is one Newton step on the distance to the chord. It lands F within O(h²) of the chord instead of overshooting,
so δ falls below 0.03 within a few ticks. It never moves F past the minimum, so the total length keeps decreasing. Far
from straight, hEstimate is large and does not bind; there the step is still `v·dt`. For a free loop, both "arcs" are
the same interval, so a = b = L.

### Reproduction (measured on commit `e094b82`)

A scratch vitest run on these scenarios (the code is given in Tests and checks) gave:

| scenario | `dt` | today | after Steps 1-3 (+ job 05) |
| --- | --- | --- | --- |
| 1. torus pair (issue 66): E1 (−3, 0), E2 (3, 2); `g1` E1→E2 word `[]`, `g2` E2→E1 word `[px]`; tied and released at E2; start total 15.544100 | 1/60 | fuses after 286 ticks into `g1`: E1→E1, stable, `[right-left]`, 15.000000 | the same (286 ticks) |
| | 1/144 | 684 ticks, the same loop | 684 ticks, the same loop |
| | 1/240 | still `moving` after 20,000 ticks; total stuck at 15.544100 | fuses after 1138 ticks into the same loop |
| | 1/1000 | still `moving` after 20,000 ticks | fuses after 4734 ticks into the same loop |
| 2. short pair: E1 (−0.2, 0), E2 (0.2, 0), F (0, 0.01); arcs 0.20025 m | 1/60 | 2-cycles: still `moving` after 2000 ticks | fuses after 4 ticks into `g1` E1→E2, 0.400000 |
| | 1/240 | still `moving` after 2000 ticks (stalled) | fuses after 7 ticks |
| 3. long pair: E1 (−1, 0), E2 (1, 0), F (0, 1); arcs √2 | 1/60 | 150 ticks | 150 ticks |
| | 1/240 | still `moving` after 20,000 ticks | 593 ticks (bound ⌈1/(0.4/240)⌉ + 2 = 602) |
| 4. rotated free loop (job 05 world), F (4.9, 1) in `a`, word `[a:ab, b:b-bottom, b:ba]`, L = 7.349830 | 1/240 | (with job 05) F never moves: still (4.9, 1.0) after 4000 ticks | first tick: F (4.9016, 0.9997), L = 7.347473; F crosses into `b` and the loop shrinks toward the corner; after 2991 ticks the pair, loop and free end are gone |

In every "after" run, the total length never increased from one tick to the next (the largest increase was 0). The
"after" column was measured on a patched copy of `geodesicCannon.ts` that implements exactly Steps 1-3 (and job 05).
With that copy, the full `npm test` suite passed (625 tests). That includes the two absorb tests and the kink tests,
which use `deltaSeconds: 1`.

## Decisions

1. **Decided:** decide absorption from geometry, not from the step. A two-arc pair whose shorter arc is below
   `curveShorteningFuseStepToleranceMeters` (0.165 m) calls `absorbShortCurveShorteningHalf`. If that returns
   `undefined`, the tick carries on with a normal step; it does not `continue`. **Why:** 0.165 m is exactly the length
   that `absorbShortCurveShorteningHalf` accepts, so it never refuses for length reasons. Falling through means a
   refusal can no longer freeze the pair. **Alternative considered:** absorb when the shorter arc is below
   `4 * curveShorteningMinStepMeters` (0.008 m). That is closer to today's behaviour at 60 fps, but the absorb would
   then almost never trigger; it would rely only on the preview-degenerate path.
2. **Decided:** for a free loop (one interval), call `removeDegenerateFreeLoop` first; it deletes a loop shorter than
   0.15 m. Otherwise, step normally. **Why:** absorption needs two intervals, and the old branch had no other way out
   for a loop.
3. **Decided:** `stepMeters = min(v·dt, 0.25 · shorter arc, hEstimate)`, with no lower bound and no fixed sub-steps.
   **Why:** the step then scales smoothly with dt, and the tick does the same thing at any frame rate. Sub-steps would
   run several previews per frame for no benefit. **Alternative considered:** accumulate dt until `v·dt_acc ≥ 0.002`,
   or run fixed 1/60 s sub-steps.
4. **Decided:** do not add a hysteresis band at the fuse threshold, and keep the angle test as it is. The hEstimate cap
   removes the 2-cycle at its source (scenario 2 fuses in 4 ticks). **Why:** smallest change; job 26 replaces the test
   anyway. **Alternative considered:** issue 66's "project X onto the developed chord ÃB̃ and fuse at
   |X − X*| ≤ 1 mm". It is exact, but it needs both arcs developed into F's frame. For a free loop, the minimiser is
   not a projection, because both ends move.
5. **Decided:** keep the exported constant `curveShorteningMinStepMeters` (0.002). It is linked from
   `_docs/MATHEMATICAL_MODEL.md` and listed in the generated API reference. Its new role is the floor applied to the
   arc lengths inside hEstimate, so that a vanishing arc cannot divide by zero. Rewrite its JSDoc. **Why:** removing an
   exported constant creates doc churn for no gain. **Alternative considered:** delete it.
6. **Decided:** do not clamp `deltaSeconds` in `createThreeApp.ts`. **Why:** the `0.25 · shorter arc` cap and the
   hEstimate cap already bound a long frame's step. **Alternative considered:** clamp dt to 0.1 s in the frame loop.
7. **Decided:** a free loop that shrinks onto a cone point (scenario 4) ends by deletion through the existing
   preview-failure rules. **Why:** a loop around an excluded vertex has no closed geodesic; that is existing behaviour
   once the loop moves.

## Steps

### Step 1 - Replace the step block

In `advanceCurveShorteningPairs`, replace everything from the comment
`// Cap the step by a quarter of the shortest incident arc ...` (`:3705`) down to, but not including,
`// Steepest-descent direction of total length.` (`:3731`) with:

```ts
    // Arc lengths as seen from the pair's two attachments (for a free loop both name the same interval, so a = b = L).
    const firstArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.first.geodesicId));
    const secondArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.second.geodesicId));
    const shortestIncidentLength = Math.min(firstArcLengthMeters, secondArcLengthMeters);
    // Geometry, not the step size, decides when an arc is gone: a free loop below the minimum length is deleted; a two-arc pair
    // whose shorter arc is below the absorb tolerance is absorbed. A refused absorption does not stall the tick.
    if (owned.intervals.length === 1) {
      if (removeDegenerateFreeLoop(request.registry, pair, owned.intervals)) {
        changed.push(pair.id);
        continue;
      }
    } else if (shortestIncidentLength < curveShorteningFuseStepToleranceMeters) {
      const absorbed = absorbShortCurveShorteningHalf({
        world: request.world,
        registry: request.registry,
        pair,
        intervals: owned.intervals,
        onDebugMessage: request.onDebugMessage,
      });
      if (absorbed) {
        changed.push(absorbed.id);
        continue;
      }
    }
    // Step = min(speed * dt, a quarter of the shorter arc, estimated distance to the straight position). The last term is
    // delta / (1/a + 1/b), from delta ~ h (1/a + 1/b) for a vertex at distance h from the chord: it stops the fixed step from
    // jumping back and forth across the chord. No lower bound, so the tick behaves the same at any frame rate.
    const distanceToStraightEstimateMeters = angleDeltaFromPiRadians / (
      1 / Math.max(firstArcLengthMeters, curveShorteningMinStepMeters) +
      1 / Math.max(secondArcLengthMeters, curveShorteningMinStepMeters)
    );
    const stepMeters = Math.min(
      (request.speedMetersPerSecond ?? curveShorteningDefaultSpeedMetersPerSecond) * request.deltaSeconds,
      0.25 * shortestIncidentLength,
      distanceToStraightEstimateMeters,
    );
    if (!(stepMeters > 0)) {
      continue;
    }

```

`angleDeltaFromPiRadians` already exists, a few lines above (`:3682`). This removes the `TODO(issue 66)` line.

Run `npx vitest run tests/world-objects/geodesicCannon.test.ts`. All existing tests must pass. Risky point: if one of
the absorb tests (`:2218`, `:2300`) fails, check first that the replacement kept the angle test **before** the new
block. Do not reorder it. If it still fails, record the failure under `### Uncertain`, with the debug messages of the
failing tick (pass `onDebugMessage`).

### Step 2 - Docstrings in the source

- `curveShorteningMinStepMeters` (`:585-586`). New JSDoc: "Floor (meters) applied to the arc lengths in the
  curve-shortening step's distance-to-straight estimate, so that a vanishing arc cannot divide by zero. It no longer
  gates the step."
- `curveShorteningFuseStepToleranceMeters` (`:583-584`). New JSDoc: "Length tolerance (meters): a two-arc pair whose
  shorter arc is below this is absorbed into one geodesic (`absorbShortCurveShorteningHalf`); slightly above the
  minimum geodesic length."
- The docstring of `advanceCurveShorteningPairs`, item (4) (`:3610-3611`). Replace
  "(4) step length = min(speed times `deltaSeconds`, a quarter of the shortest incident arc); a step below
  `curveShorteningMinStepMeters` instead tries `absorbShortCurveShorteningHalf`;" with:
  "(4) a free loop shorter than `GEODESIC_MIN_LENGTH_METERS` is deleted, and a two-arc pair whose shorter arc is below
  `curveShorteningFuseStepToleranceMeters` is absorbed (`absorbShortCurveShorteningHalf`; if that is refused the tick
  goes on). Step length = min(speed times `deltaSeconds`, a quarter of the shorter arc, `delta / (1/a + 1/b)` with
  `delta` the angle deficit), with no lower bound;"
- Module header, "Constants" (`:65-66`): replace "minimum step 0.002 m" with "arc-length floor 0.002 m".

### Step 3 - Mathematical model

In `_docs/MATHEMATICAL_MODEL.md`:

- §7 item 2: replace "Otherwise $X$ moves by $\min(v\,\Delta t,\ \tfrac14\,\ell_{\min})$" with
  "Otherwise $X$ moves by $\min\big(v\,\Delta t,\ \tfrac14\,\ell_{\min},\ \delta/(1/a+1/b)\big)$, where $\delta$ is the
  angle deficit and $a, b$ are the arc lengths. The last term estimates the distance to the straight position, so the
  step never jumps across it, and there is no lower bound, so the result does not depend on the frame rate." Keep the
  rest of the item.
- §7 item 4: replace the item with: "4. Geometry decides when an arc is gone. A two-arc pair whose shorter arc is below
  `src/world-objects/geodesicCannon.ts#curveShorteningFuseStepToleranceMeters` (0.165 m) is absorbed into one
  geodesic (`absorbShortCurveShorteningHalf`), and a free loop shorter than
  `src/world-objects/geodesicCannon.ts#GEODESIC_MIN_LENGTH_METERS` is deleted. A refused absorption does not stop the
  descent."
- §11 bullet "Curve shortening": delete "a free loop shorter than the minimum geodesic length is deleted, but one
  between that length and four minimum steps still stalls." (Job 05 already removed the "free loop crossing a portal"
  clause.)

`curveShorteningMinStepMeters` is then no longer linked from `MATHEMATICAL_MODEL.md`. That is fine.

### Step 4 - Tests

Add the tests below. Then run everything (see Commands).

## Tests and checks

Add to `tests/world-objects/geodesicCannon.test.ts` a block
`describe("curve shortening at any frame rate (job 06)", () => { ... })`, placed after the test "absorbs a near-minimum
half when the next shortening preview would make it degenerate" (`:2300`). All needed functions are already imported.
Add these helpers at the end of the file. Use exactly these ids: the measured numbers depend on which id survives a
fusion.

```ts
// Advances until the pair is gone or `maxTicks` is reached. Fails if the pair's total length ever grows by more than 1e-9 m.
function runCurveShorteningUntilPairGone(
  world: ReturnType<typeof compileCellComplex>,
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  options: { readonly pairId: string; readonly geodesicIds: readonly string[]; readonly deltaSeconds: number; readonly maxTicks: number },
): number {
  const total = () => [...new Set(options.geodesicIds)].reduce((sum, id) => sum + totalGeodesicLength(registry, id), 0);
  let previous = total();
  let ticks = 0;
  while (ticks < options.maxTicks && registry.get(options.pairId)) {
    advanceCurveShorteningPairs({ world, registry, deltaSeconds: options.deltaSeconds });
    ticks += 1;
    if (registry.get(options.pairId)) {
      const next = total();
      expect(next).toBeLessThanOrEqual(previous + 1e-9);
      previous = next;
    }
  }
  return ticks;
}

// Issue 66: two emitters on the 15 m torus, a straight arc E1 -> E2 and an arc E2 -> E1 that wraps once to the right,
// tied and released at E2.
function createTorusTiedPairScenario() {
  const world = compileTorusLoopWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -3, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 3, y: 2, z: 0 }) }));
  registry.add(createGeodesicIntervalObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "torus-room" }));
  registry.add(createGeodesicIntervalObject({
    id: "g2",
    startAnchorObjectId: "e2",
    endAnchorObjectId: "e1",
    startCellId: "torus-room",
    portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
  }));
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g1" });
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g2" });
  tieAndDetachGeodesicEndpoints({
    world,
    registry,
    detachedEmitterId: "e2",
    first: { geodesicId: "g1", role: "end", anchorObjectId: "e2" },
    second: { geodesicId: "g2", role: "start", anchorObjectId: "e2" },
    createPairId: () => "pair",
    createFreeEndId: () => "free",
  });
  return { world, registry };
}

// A two-arc pair in the 6 m single cell: emitters at (-halfWidth, 0) and (halfWidth, 0), free end at (0, height).
function createSymmetricPairScenario(halfWidth: number, height: number) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: -halfWidth, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "a", localPose: yawRigidTransform3(0, { x: halfWidth, y: 0, z: 0 }) }));
  registry.add(createFreeGeodesicEndObject({ id: "free", cellId: "a", point: { x: 0, y: height, z: geodesicRayBeamHeightMeters } }));
  registry.add(createGeodesicIntervalObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "free", startCellId: "a", motionState: "moving" }));
  registry.add(createGeodesicIntervalObject({ id: "g2", startAnchorObjectId: "free", endAnchorObjectId: "e2", startCellId: "a", motionState: "moving" }));
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" });
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" });
  registry.add(createCurveShorteningPairObject({
    id: "pair",
    first: { geodesicId: "g1", role: "end", anchorObjectId: "free" },
    second: { geodesicId: "g2", role: "start", anchorObjectId: "free" },
    freeEndAnchorId: "free",
    previousTotalLengthMeters: totalGeodesicLength(registry, "g1") + totalGeodesicLength(registry, "g2"),
    lastGoodFreeEndCellId: "a",
    lastGoodFreeEndPoint: { x: 0, y: height, z: geodesicRayBeamHeightMeters },
  }));
  return { world, registry };
}
```

If `compileCellComplex` is not imported under that name in the test file, use the imported name; it is imported at
`:2`. `createCarryPortalTraversal` is typed for two specific worlds, but all compiled worlds have the same type.

Tests. Use `toBeCloseTo(x, 6)` unless stated otherwise.

1. `"fuses the issue 66 torus pair into the same loop at 60 Hz and at 240 Hz"`
   - For `deltaSeconds` of `1 / 60` (`maxTicks` 300) and `1 / 240` (`maxTicks` 1200), each with a fresh
     `createTorusTiedPairScenario()`, call
     `runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds, maxTicks })`.
   - Expect: `registry.get("pair")` is `undefined`. `registry.get("g2")` is `undefined`. `registry.get("g1")` matches
     `{ motionState: "stable", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e1" } }`, and its `portalWord`
     equals `[createCarryPortalTraversal(world, "torus-room", "right-left")]`. `totalGeodesicLength(registry, "g1")` ≈ 15.
   - Measured: 286 and 1138 ticks. Today the 240 Hz run never fuses.
2. `"does not 2-cycle next to the fuse angle on 0.2 m arcs"`
   - `createSymmetricPairScenario(0.2, 0.01)`. For `deltaSeconds` of `1 / 60` and `1 / 240`, use `maxTicks` 10.
   - Expect: the pair is gone. `g1` matches `{ motionState: "stable", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e2" } }`,
     and its length ≈ 0.4. `g2` is `undefined`.
   - Measured: 4 and 7 ticks. Today: still `moving` after 2000 ticks.
3. `"reaches the fuse within ceil(distance / step) + 2 ticks at 240 Hz"`
   - `createSymmetricPairScenario(1, 1)`, `deltaSeconds: 1 / 240`, `maxTicks: Math.ceil(1 / (0.4 / 240)) + 2` (= 602).
   - Expect: the pair is gone, `g1` is stable from `e1` to `e2`, and its length ≈ 2. Also assert that the returned
     tick count is `<= 602`.
   - Measured: 593 ticks. Today: still `moving` after 20,000 ticks.
4. `"keeps moving a free loop at 240 Hz until it is resolved"` (needs job 05)
   - Set up the same free loop as job 05's test "conjugates a free loop's word when curve shortening moves its free end
     through a portal". World `compileRotatedFreeLoopWorld()`; free end `free-loop` at (4.9, 1) in `a`; interval
     `g-loop` with word `[a:ab, b:b-bottom, b:ba]`, `motionState: "moving"`; pair `pair-loop` with
     `previousTotalLengthMeters` = its length (7.349830).
   - One tick with `deltaSeconds: 1 / 240`. The free end is still in `a`, with x ≈ 4.9016 and y ≈ 0.9997
     (`toBeCloseTo(_, 4)`). The length is ≈ 7.347473 (`toBeCloseTo(_, 5)`).
   - Then `runCurveShorteningUntilPairGone(world, registry, { pairId: "pair-loop", geodesicIds: ["g-loop"], deltaSeconds: 1 / 240, maxTicks: 3100 })`.
     Expect `registry.get("pair-loop")`, `registry.get("g-loop")` and `registry.get("free-loop")` to all be
     `undefined`.
   - Measured: gone after 2991 ticks in total. The loop shrinks onto the cone corner of `b` and is removed by the
     existing preview-failure rules.
   - Today (with job 05): the free end never moves.
   - Risky point: if the loop instead ends `stable` (fused), or the count exceeds 3100, the descent changed in a way
     these measurements did not see. Do not raise `maxTicks` blindly. Record the final state (pair state, free-end
     position, length) under `### Uncertain`, and assert only that the pair is no longer `moving` after 3100 ticks.
5. `"deletes a free loop below the minimum length at 240 Hz"`
   - Copy the setup of "deletes a degenerate free loop together with its derived objects" (`:2025`), but call
     `advanceCurveShorteningPairs` with `deltaSeconds: 1 / 240`.
   - Expect the same results: `changed` contains `"pair-loop"`, and the loop, free end and pair are gone. (This passes
     today too; it guards the new free-loop branch.)

All existing tests must pass unchanged. Do not edit them. If one fails, see the risky point in Step 1.

If a measured number above differs from what you observe by more than the tolerance, check the setup against this file
first. If the setup matches and the behaviour is right (fused into the stated loop, length non-increasing, within the
tick bound), assert on the observed number. Record the old and new numbers under `### Uncertain`.

Commands:

```sh
npx vitest run tests/world-objects/geodesicCannon.test.ts
npm run typecheck
npm test
npm run docs:check     # if it reports stale generated files: npm run docs:generate, then docs:check again
```

The JSDoc of the exported constants changes, so `_docs/generated/API_REFERENCE.md` changes: run
`npm run docs:generate`.

## Do not

- Do not start job 26 (exact funnel/sleeve solver) or job 25 (module split). Do not move code to other files.
- Do not add new fields to `CurveShorteningPairObject`. No accumulated time, no previous direction.
- Do not change `fuseCurveShorteningPair`, `absorbShortCurveShorteningHalf`, the preview or the monotone-length check.
- Do not change `curveShorteningFuseAngleToleranceRadians`, `curveShorteningDefaultSpeedMetersPerSecond` or the frame
  loop in `createThreeApp.ts`.
- Do not "fix" the stall by adding a lower bound to the step (for example `Math.max(step, curveShorteningMinStepMeters)`).
  That reintroduces the frame-rate dependence and the overshoot.
- Do not weaken the absorb tests at `:2218` and `:2300`.
- Do not commit anything under `tests/scratch/`, if that folder exists.

## Done when

- [ ] The five new tests exist and pass (or four, with test 4 recorded under `### Not done` if job 05 is missing),
  and all existing tests pass. `npm run typecheck`, `npm test` and `npm run docs:check` pass.
- [ ] `grep -n "TODO(issue 66)" src/world-objects/geodesicCannon.ts` finds nothing.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §7 items 2 and 4 and §11 are updated as in Step 3. `npm run docs:generate` was run,
  and the changed `_docs/generated/API_REFERENCE.md` is committed.
- [ ] If `### Uncertain` and `### Not done` are empty: close issue 66.
  - `git mv _issues/66_curve_shortening_stalls_at_high_frame_rate.md _issues/_closed/`.
  - Set its `Status:` to `Status: closed on <date>.`, and its `Jobs:` link to
    `../../.agents/jobs/_done/06_curve_shortening_stalls.md`.
  - Directly under the `Jobs:` line, add `## Outcome` (2-4 sentences: absorption decided by arc length, a step with no
    lower bound capped by δ/(1/a+1/b), the free-loop branch, and the note that the TODO's length range was empty) and
    `## Closing evidence` (the five test names with their file and the measured tick counts, and the commit hash), in
    the style of `_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md`.
  - Note in the Outcome that issue 66's "Proposed change 2" (projection onto the developed chord) was not done; job 26
    supersedes it.
  - Fix links to the old path: `_issues/50_deep_code_audit_2026_10_09_index.md:87` becomes `_closed/66_...md`,
    `_issues/67_exact_curve_shortening_via_sleeve_funnel.md:84` becomes `_closed/66_...md`, and
    `_issues/_closed/41_documentation_audit_findings.md:18` (`../66_...md`) becomes `66_...md`. Run
    `grep -rn "66_curve_shortening_stalls" --exclude-dir=node_modules .` to find any other.

  Otherwise, leave issue 66 open, and add under its `Status:` line the line
  `Job 06 landed on <date>; see its Report for open points.`
- [ ] The job file is moved with `git mv .agents/jobs/06_curve_shortening_stalls.md .agents/jobs/_done/`. In the moved
  file, fix the relative links (`../../_issues/...` becomes `../../../_issues/...` or `../../../_issues/_closed/...`;
  `05_...md` becomes `05_...md` if job 05 is also in `_done/`, otherwise `../05_...md`; `26_...md` becomes `../26_...md`).
- [ ] The queue row in `.agents/jobs/README.md` becomes
  `| [06](_done/06_curve_shortening_stalls.md) | ~~Stop curve shortening from stalling~~ (done) | [66](../../_issues/_closed/66_curve_shortening_stalls_at_high_frame_rate.md) |  |`.
  Use `../../_issues/66_...` if the issue stays open.
- [ ] The job file's `Status:` is `Status: done on <date>.` if `### Uncertain` and `### Not done` are empty; otherwise
  it is `Status: done, needs review on <date>.`. A `## Report` section is appended at the end, with these subsections:
  - `### Done`: what changed, with files, functions, test names and commit hashes.
  - `### Deviations`: where the work differs from the Steps, and why.
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them.
  - `### Not done`: anything skipped, and why.
  - `### Checks`: the commands you ran and their results, including failures.
- [ ] One commit, with a subject such as "Make curve shortening converge at any frame rate (job 06)" and a body in the
  style of `git log -1 e094b82`, ending with the co-author line the repository uses.

Never stop to ask. If something in this job turns out to be wrong (a line number, a name, an expected number), do the
closest correct thing, and record it under `### Deviations` or `### Uncertain`.
