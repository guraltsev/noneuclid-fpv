# 32 - Phase F curve-shortening algorithm note

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: active; partially implemented and insufficiently verified.

Priority: P1 domain correctness.

Current tests cover same-emitter detach, ready-pair fusion, angle readiness,
portal crossing with moved-start word updates, and short-half absorption. The
document still reads as a pre-implementation note and its 15 test slices are
not tracked as completed/pending. Convert them to a checklist. Direct coverage
is still needed for one-half forbidden-zone survival, wall-hit failure,
monotonicity rollback including candidate portal words, computed-object cleanup,
final no-portal-spanning fusion, free-loop outcomes, and role-aware word
composition. Merge this issue into issue 31 after those contracts are verified,
or archive it as the final algorithm record.

## Goal

Make Phase F of `31_geodesic_end_model_and_curve_shortening_rehaul.md`
implementable without reviving the old same-cell straightening model.

This note greenlights the whole Phase F direction as small vertical slices:
endpoint-role tie/release, curve-shortening ownership, monotone advancement,
final fusion, free-loop support, and cleanup. It does not greenlight a global
shortest-path solver or arbitrary homotopy minimization.

## Greenlight Status

Phase F is greenlit for implementation as the vertical slices listed in this
note. The implementation should proceed from tests and should retire, not
extend, the old same-cell straightening path.

The implementation must satisfy the role-aware portal-word, rollback-safe
retracing, wall-hit failure, and cleanup contracts in this note before enabling
the tie/detach palette action in normal play.

## Key Decision

Curve shortening is owned by one `CurveShorteningPairObject`, but the pair owns
endpoint roles, not necessarily two distinct geodesic ids.

This matters for same-emitter loops. If a locked geodesic has both endpoint
roles attached to one emitter, untying that emitter keeps the geodesic interval
in place and replaces both endpoint attachments with one shared
`FreeGeodesicEndObject`. The result is a valid free loop:

```text
G1.start -> shared free end
G1.end   -> shared free end
```

No separate `CurveShorteningLoopObject` is needed. The same pair object can own
the two free-end endpoint roles:

```text
first  = (G1, start)
second = (G1, end)
```

For ordinary tie/release of two incident geodesics, the pair owns endpoint roles
on two different moving intervals:

```text
first  = (G1, detached role)
second = (G2, detached role)
```

## Runtime Model

Add `CurveShorteningPairObject` to the runtime object union:

```ts
interface CurveShorteningPairObject extends RuntimeWorldObjectBase {
  readonly kind: "curve-shortening-pair";
  readonly first: GeodesicEndpointAttachment;
  readonly second: GeodesicEndpointAttachment;
  readonly freeEndAnchorId: string;
  readonly previousTotalLengthMeters?: number;
  readonly lastGoodFreeEndCellId: string;
  readonly lastGoodFreeEndPoint: Vec3;
  readonly state: "moving" | "ready-to-fuse";
}
```

The pair object is invisible, noncollidable, noninteractive, and
`portalRenderable: false`.

Pair invariants:

- `first` and `second` are different endpoint roles;
- both endpoint roles attach to `freeEndAnchorId`;
- `first.geodesicId` and `second.geodesicId` may be the same id;
- every referenced interval has `motionState === "moving"`;
- the shared free end has exactly the pair's two attached endpoint roles;
- each moving interval has exactly two endpoint attachments;
- the non-free endpoint of an ordinary moving half is usually an emitter;
- a free loop is represented by one interval whose `start` and `end` both
  attach to `freeEndAnchorId`;
- `previousTotalLengthMeters` is updated only after a successful monotone tick.

## Constants

Use named constants near the geodesic constants:

```ts
const curveShorteningDefaultSpeedMetersPerSecond = 0.4;
const curveShorteningLengthIncreaseToleranceMeters = 1e-4;
const curveShorteningFuseAngleToleranceRadians = 0.03;
const curveShorteningFuseStepToleranceMeters = 1.1 * GEODESIC_MIN_LENGTH_METERS;
const curveShorteningMinStepMeters = 0.002;
```

The monotonicity tolerance is absolute. These are classroom-scale constructions,
and an absolute tolerance makes small numerical noise explicit.

## Public APIs

Add APIs with these observable contracts:

```ts
function createCurveShorteningPairObject(input: {
  readonly id: string;
  readonly first: GeodesicEndpointAttachment;
  readonly second: GeodesicEndpointAttachment;
  readonly freeEndAnchorId: string;
  readonly previousTotalLengthMeters?: number;
  readonly lastGoodFreeEndCellId: string;
  readonly lastGoodFreeEndPoint: Vec3;
  readonly state?: "moving" | "ready-to-fuse";
}): CurveShorteningPairObject;

function tieAndDetachGeodesicEndpoints(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly detachedEmitterId: string;
  readonly first: GeodesicEndpointSelection;
  readonly second: GeodesicEndpointSelection;
  readonly createPairId: () => string;
  readonly createFreeEndId: () => string;
}): CurveShorteningPairObject | undefined;

function advanceCurveShorteningPairs(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly speedMetersPerSecond?: number;
}): readonly string[];

function fuseCurveShorteningPair(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pairId: string;
}): GeodesicIntervalObject | undefined;
```

`tieAndDetachIncidentGeodesics` and `advanceStraighteningGeodesics` should not
be extended. They should be replaced or retired as Phase F lands.

Add small internal helpers with these contracts. Exact names may adapt to the
codebase, but the behavior should be explicit and covered by tests:

```ts
function getPortalWordBetweenEndpointRoles(input: {
  readonly interval: GeodesicIntervalObject;
  readonly sourceRole: GeodesicEndRole;
  readonly targetRole: GeodesicEndRole;
}): readonly GeodesicPortalTraversal[];

function updatePortalWordForMovedEndpoint(input: {
  readonly interval: GeodesicIntervalObject;
  readonly movedRole: GeodesicEndRole;
  readonly traversal: GeodesicPortalTraversal;
}): readonly GeodesicPortalTraversal[];

function previewRebuildGeodesicInterval(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): GeodesicTraceBuildResult | undefined;
```

`getPortalWordBetweenEndpointRoles` returns `interval.portalWord` for
`start -> end`, returns `reverseGeodesicPortalWord(interval.portalWord)` for
`end -> start`, and returns an empty word only when source and target are the
same endpoint role.

`updatePortalWordForMovedEndpoint` is used when the shared free end crosses a
portal during shortening. If the moved endpoint is the interval's `end`, append
the traversal to the interval word. If the moved endpoint is the interval's
`start`, prepend the reversed traversal. Always reduce adjacent inverse
traversals and reject words whose first/last cells no longer match the current
endpoint anchor cells.

`previewRebuildGeodesicInterval` must validate and construct the would-be trace
from the supplied candidate interval and candidate anchors without deleting the
registry interval, replacing existing segments, rewriting endpoint attachments,
or changing the interval's portal word. A later commit step may replace the
segments after monotonicity succeeds.

## Tie And Detach

Tie/release accepts only endpoint selections from segment hits. Validation:

- both selected endpoint attachments still exist;
- the selections are not the same `(geodesicId, role)`;
- both selected endpoint attachments are attached to `detachedEmitterId`;
- every affected interval is locked before detach;
- selecting `start` and `end` of the same interval is valid;
- selecting endpoint roles whose opposite endpoints attach to the same emitter
  is valid.

Construction:

1. Create one shared `FreeGeodesicEndObject` at the detached emitter beam point.
2. For each selected endpoint role, replace its anchor attachment with the
   shared free end.
3. Mark every affected interval `motionState: "moving"`.
4. Preserve each interval's existing `portalWord`; if endpoint role orientation
   changes, store the reversed portal word on that interval so its word remains
   ordered from `start` toward `end`.
5. Rebuild each affected interval from its endpoint anchors and portal word.
6. Create one `CurveShorteningPairObject` whose `first` and `second` are the two
   free-end endpoint roles.

This keeps the visible geodesic arcs in place at detach time. Detach changes
endpoint attachments; it does not collapse anything to same-cell straightening
segments.

Same-emitter locked loop:

- before detach, `G1.start` and `G1.end` both attach to emitter `E1`;
- after detach, `G1.start` and `G1.end` both attach to one shared free end;
- the pair owns `(G1, start)` and `(G1, end)`;
- the interval's portal word is preserved;
- the result is a free loop, not a deleted geodesic.

## Tick Geometry

For each tick, resolve the two endpoint roles attached to the shared free end.
Compute their incident tangents in a common lift. The two endpoint roles may be
from different intervals or opposite roles of the same interval.

Let `u` and `v` be unit vectors pointing away from the shared free end along the
two incident arcs. Use the local curve-shortening descent direction:

```text
descent = normalize(u + v)
```

If `u + v` is near zero, the construction is locally straight at the free end.
Mark the pair `ready-to-fuse`.

Otherwise move the shared free end by:

```text
step = min(speed * deltaSeconds, 0.25 * shortestIncidentLength)
nextFreeEnd = currentFreeEnd + descent * step
```

If `step < curveShorteningMinStepMeters`, do not jitter the free end. Mark the
pair `ready-to-fuse` when the turn angle is within
`curveShorteningFuseAngleToleranceRadians`; otherwise leave it moving.

The proposed free-end movement uses the normal dynamic-object portal crossing
rules for an autonomous anchor. If the shared free end crosses a portal, update
each affected interval's stored portal word with
`updatePortalWordForMovedEndpoint` before retracing. This is the only homotopy
change permitted during a shortening tick, and it represents the moving glued
point crossing a portal. Do not search for alternate portal words.

If the shared free end does not cross a portal, its cell id remains unchanged
and all affected interval portal words remain unchanged for the candidate
rebuild.

## Retracing

After proposing a shared free-end move:

1. Save the previous pair object, shared free end, affected intervals, and
   current derived segment chains.
2. Compute the candidate shared-free-end cell, local point, and any portal-word
   updates caused by the free end crossing a portal.
3. Preview-rebuild every distinct affected interval from its candidate endpoint
   anchors and stored candidate portal word.
4. Reject unexpected portal words.
5. Treat a forbidden-zone hit as a half failure.
6. Treat a wall hit before the shared free end as a half failure.
7. Treat inability to realize a stored portal word as a half failure.

Preview rebuilds must be rollback-safe. In particular, do not call a helper that
can delete a short interval, remove computed objects, or replace existing
segments until the tick is known to commit. The existing destructive locked
rebuild helpers may be reused only behind a wrapper that restores all affected
objects and segment chains on monotonicity rejection or half failure.

An anchored preview succeeds only when the traced path reaches the lifted target
endpoint with the expected portal word and no earlier terminal. A terminal
`wall-hit`, `forbidden-zone-hit`, or unexpected `portal-hit` before the target
is a failure for that interval. A terminal `open` is valid only when it is the
normal representation of reaching the anchored target and the traced length is
the requested lifted length.

For ordinary two-interval pairs, there are two distinct affected intervals. For
a free loop, there is one affected interval; rebuild it once.

## Monotonicity

Compute total length over distinct affected intervals:

```text
nextTotal = sum(length(interval) for each distinct geodesic id owned by pair)
previous = pair.previousTotalLengthMeters ?? currentTotalBeforeTick
```

If:

```text
nextTotal <= previous + curveShorteningLengthIncreaseToleranceMeters
```

commit the tick:

- replace the affected segment chains with the previewed rebuilt segments;
- update affected intervals with any candidate portal words caused by a
  shared-free-end portal crossing;
- update `previousTotalLengthMeters` to `nextTotal`;
- update `lastGoodFreeEndCellId` and `lastGoodFreeEndPoint`.

If `nextTotal` increases past tolerance:

- restore the shared free end to the last good point;
- restore affected intervals and segment chains to the saved pre-tick state,
  then rebuild affected intervals at the last good point only if their current
  segments no longer match that state;
- set pair state to `ready-to-fuse`;
- do not update `previousTotalLengthMeters`.

If a candidate free-end portal crossing happened during a rejected tick, the
candidate portal-word updates are discarded with the rest of the preview state.

## Failure Cleanup

If all affected intervals fail, delete them, delete the shared free end, delete
the pair object, and clean stale measurements, protractor angles, and
intersections.

If one interval fails in a two-interval pair:

- delete the failed moving interval;
- delete the pair object;
- replace the surviving interval's shared-free-end attachment with a new
  singly-attached free end at the last good point;
- set the surviving interval `motionState` to `"stable"`;
- rebuild it as a stable free geodesic in its stored portal class;
- clean computed objects that reference the deleted interval or pair.

If a free loop fails, delete the loop interval, the shared free end, and the pair
object. There is no emitter-attached survivor.

## Fusion

Fusion consumes one `CurveShorteningPairObject` in `ready-to-fuse` state.

For ordinary two-interval pairs:

1. Identify each interval's non-free endpoint.
2. If both non-free endpoints are emitters, create one stable locked interval.
3. Reuse the lower geodesic id among the moving intervals for the fused result.
4. Construct the fused portal word role-aware from the two non-free endpoints:
   use the first kept interval's non-free endpoint as fused `start`, travel from
   that endpoint to the shared free end along the first interval, then travel
   from the shared free end to the second interval's non-free endpoint along
   the second interval. In formula form:

   ```text
   fusedWord =
     getPortalWordBetweenEndpointRoles(firstInterval, firstNonFreeRole, firstFreeRole)
     + getPortalWordBetweenEndpointRoles(secondInterval, secondFreeRole, secondNonFreeRole)
   ```

   Then reduce adjacent inverse traversals.
5. Rebuild derived segments from endpoint anchors and fused portal word.
6. On success, delete the other moving interval, the shared free end, and the
   pair object.

If the two non-free endpoints are the same emitter, same-emitter fusion is valid
when the fused lifted displacement is at least `GEODESIC_MIN_LENGTH_METERS`.

The fused interval keeps two explicit endpoint roles even when both roles attach
to the same emitter. It must be rebuilt with the ordinary anchored rebuild path
from endpoint anchors plus the fused portal word. Fusion must fail if that
rebuild would cross a forbidden zone, hit a wall early, consume a different
portal word, or create a degenerate lifted displacement.

For a free loop:

1. Reuse the loop's geodesic id.
2. Set `motionState: "stable"`.
3. Keep both endpoint roles attached to the same free end.
4. Rebuild derived segments from the loop's endpoint anchors and portal word.
5. If the lifted displacement is degenerate, delete the interval, free end, and
   pair object.
6. If the loop remains nondegenerate, delete only the pair object and keep the
   stable free loop.

If fusion fails for any reason, delete the moving geodesics owned by the pair,
the shared free end, and the pair object. Failure must not leave a stuck
`ready-to-fuse` object.

Fusion should not infer endpoint order from segment ids or visual segment
orientation. Endpoint roles and `getPortalWordBetweenEndpointRoles` are the
source of truth.

## Renderer And UI

Phase F should update the renderer/tooling in these slices:

1. Tie/detach selection highlights half segments by endpoint role.
2. The active tie/detach state stores `GeodesicEndpointSelection[]`, not ids.
3. The action becomes available when an emitter has at least two selectable
   endpoint attachments, including two roles from one interval.
4. Moving intervals render with the moving color derived from
   `motionState === "moving"`.
5. The frame loop calls `advanceCurveShorteningPairs`, not
   `advanceStraighteningGeodesics`.
6. The palette action is enabled only after endpoint-selection tests and pair
   creation tests exist.

## Test Slices

Implement Phase F in these vertical slices:

1. Add `CurveShorteningPairObject` and runtime cleanup tests.
2. Convert tie/detach selection payloads to endpoint selections and highlight
   half segments.
3. Tie two distinct locked intervals at one emitter into two moving intervals
   and one pair.
4. Untie the two endpoint roles of one same-emitter locked loop into a stable
   free-loop shortening pair where both endpoint roles attach to one free end.
5. Advance one same-cell pair monotonically and mark it `ready-to-fuse`.
6. Fuse a same-cell pair into one stable locked interval using the lower id.
7. Advance a torus wrapped pair and fuse it into a same-emitter locked interval
   with a nonempty portal word.
8. Advance a free loop and keep it as a stable free loop when it remains
   nondegenerate.
9. Delete a free loop when shortening makes its lifted displacement degenerate.
10. Hit a forbidden zone with one half and verify the other half survives as a
    stable free geodesic.
11. Verify final fusion never creates a segment spanning a portal.
12. Verify measurements, protractor angles, and intersections refresh or clean
    up after pair deletion and fusion.
13. Verify a shared free end crossing a portal updates affected portal words by
    endpoint role and rolls those updates back when monotonicity rejects the
    tick.
14. Verify a wall hit before the candidate shared free end is treated as a half
    failure and does not silently commit a shortened wrong-homotopy trace.
15. Verify fused portal-word composition is role-aware by fusing a pair where
    the selected free roles are not both `end`.

Do not unskip the old straightening tests as-is. Replace them with endpoint and
pair behavior tests.

## Non-Goals

- Do not search over alternate portal words.
- Do not minimize across homotopy classes.
- Do not infer curve-shortening pairs by scanning arbitrary moving geodesics.
- Do not store endpoint identity on segment ids.
- Do not use `connectionState: "straightening"` as pair ownership.
