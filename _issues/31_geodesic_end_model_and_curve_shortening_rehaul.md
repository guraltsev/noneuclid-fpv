# 31 - Geodesic end model and portal-safe curve shortening rehaul

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: active; revise this issue before further Phase F work.

Priority: P1 domain correctness.

Phases A-E are implemented, and Phase F is no longer wholly unimplemented:
explicit shortening-pair objects, endpoint-role detach, portal-aware movement,
fusion, and the active frame-loop path now exist. The status and diagnosis
sections therefore understate progress. At the same time, legacy emitter
connections, segment `connectionState`, legacy tie/detach, and old straightening
APIs remain despite this issue saying they should be retired. Replace the prose
status with a checked migration list, keep this issue open until the missing
issue-32 safety tests pass, and remove the legacy path only after equivalent
behavior is protected.

## Goal

Rehaul the geodesic system around explicit geodesic ends, not whole-geodesic
incident identity.

The immediate bugs to fix are:

- tying and releasing a portal-wrapped loop can delete or break the whole
  construction instead of collapsing it to one wrapped geodesic;
- angle measurement rejects two distinct endpoint selections of the same
  geodesic at an emitter;
- straightening assumes the two halves live in one cell and can fuse into one
  same-cell segment, which is false on quotient spaces such as the torus.

The corrected model should make the torus case natural:

```text
>- G1 -- E1 -- G2 -- E2 -- G1 ->
```

If the player ties and releases at `E2`, the two incident ends at `E2` should
detach, enter curve shortening, and eventually fuse into one locked geodesic
whose two ends are incident to `E1`. That fused geodesic may wrap through one or
more portals. It must not be rejected just because both ends attach to the same
emitter.

## Greenlight Status

This issue is greenlit as a domain-model direction, but not as a single
end-to-end implementation task.

There is no backwards compatibility requirement for the old geodesic identity
model. The first implementation step is to remove the legacy notion
of geodesics as cannon-owned ids, source/incoming emitter connections,
straightening state, and segment-owned connection state. New behavior should be
rebuilt from explicit geodesic intervals and endpoint attachments. The first
useful new geodesic model is intentionally small: one interval emitted from a
geodesic emitter, with the opposite endpoint attached to a singly-attached free
end and therefore aimable.

Phases A through E are greenlit only after the Core Implementation Contracts
below are implemented or stubbed with tests in the same phase that first uses
them. Phase F is greenlit only through the separate curve-shortening algorithm
note, which specifies the portal/lift shortening step, monotonicity tolerance,
failure behavior, rollback-safe retracing, and final-fusion trace construction
in implementation-level detail. See
`docs/issues/32_phase_f_curve_shortening_algorithm_note.md` for the Phase F
greenlight contract.

Do not start by relaxing the same-geodesic rejection in tie/release or the
protractor. Those local fixes hide the identity problem and make the later
migration harder.

## Current Implementation Status

Status as of 2026-06-25:

- Phase A is implemented.
- Phase B is implemented.
- Phase C is implemented for interval-based locking, including emitter-hit
  locking, same-emitter wrapped loops, lifted degenerate rejection, endpoint
  tangents, portal-word duplicate policy, and post-lock anchored rebuilds.
- Phase D is implemented for protractor endpoint-role identity and refresh.
- Phase E is implemented for carrying locked intervals, including portal-word
  updates during carry, same-cell portal transitions, out-of-bounds carried
  endpoint preview, release-time portal normalization, geometry commit rebuilds,
  and refresh of dependent measurements/protractor angles/intersections.
- Phase F is greenlit for implementation through
  `docs/issues/32_phase_f_curve_shortening_algorithm_note.md`, but remains
  incomplete. Tie/release, curve-shortening pairs, monotone shortening, and
  final fusion are not implemented by this document.

What is now true in the codebase:

- geodesic intervals and free-end anchors exist as runtime objects and are part
  of the runtime object union;
- geodesic cannons are attachable anchors;
- aiming and extending a free geodesic uses interval endpoint attachments and a
  free-end anchor instead of the old emitter-connection model;
- derived segment chains are rebuilt from interval data and split into
  `start`/`end` half segments for interaction;
- reverse lookup helpers exist for anchor attachments, endpoint pairs, segment
  hit to endpoint selection, endpoint tangents, portal words, and locked
  rebuilds;
- cutting a free geodesic by placing a new emitter keeps the source geodesic id
  on the locked prefix and creates one continuation interval with a recomputed
  portal word;
- emitter-hit locking replaces the free-end attachment with the hit emitter,
  deletes the now-unused free end, stores the realized portal word, and then
  recomputes the locked segment chain from endpoint anchors plus portal word so
  the rendered geodesic lands exactly on the emitter pole;
- locked intervals may attach both endpoint roles to the same emitter when the
  lifted displacement is nondegenerate; same-emitter wrapped loops expose two
  endpoint attachments and two endpoint tangents at that emitter;
- locked rebuilds use lifted endpoint displacement and portal words rather than
  local same-cell coordinates alone;
- duplicate handling allows homotopically distinct locked intervals and does not
  prune wrapped same-emitter loops merely because their anchors match;
- protractor selections store endpoint roles and reject only identical
  `(geodesicId, endRole)` selections, so selecting `start` and `end` of one
  geodesic is valid;
- protractor angles refresh from endpoint-role identity after segment rebuilds,
  including rebuilds caused by carrying an emitter;
- carrying a locked emitter updates incident interval portal words when the
  player crosses portals, including quotient/same-cell portal crossings;
- while carrying, a locked geodesic may survive transient rebuild failures from
  out-of-bounds preview placement, but it is destroyed immediately if the traced
  geodesic path crosses a forbidden zone;
- on release, a carried emitter that is formally outside the current cell is
  normalized through the relevant portal before the final strict rebuild;
- geometry commits collect and rebuild locked geodesics from interval endpoint
  metadata and portal words;
- renderer color now derives consistently from interval state across all
  rebuilt segments of a locked geodesic, including midpoint-split chains.

What is intentionally still disabled or deferred:

- tie/detach remains visible but disabled until it is rebuilt on endpoint-role
  selections and curve-shortening pair ownership;
- curve-shortening/fusion is not done and must follow the separate Phase F
  algorithm note;
- the old straightening implementation is not a compatibility target and should
  not be revived for Phase F;
- several future-phase tests are currently marked skipped until those phases are
  implemented.

Verification currently in place:

- updated world-object tests cover Phase A and B interval behavior, reverse
  lookup, half-role splitting, endpoint-hit resolution, and cut continuation;
- world-object tests cover Phase C locking to distinct emitters, locking through
  portals, same-emitter wrapped loops, lifted degenerate rejection, endpoint
  tangent resolution, post-lock anchored rebuild, and forbidden-zone deletion;
- protractor tests cover endpoint-role identity, same-geodesic start/end
  selection, selection refresh after rebuilds, and renderer/hitbox behavior;
- carry tests cover fixed-face carry, same-cell portal transitions, different
  cell portal transitions, player traversal word updates, out-of-bounds preview,
  release-time portal normalization, preserving transient live rebuild failures,
  deleting forbidden-zone traces during carry, and geometry commit rebuilds;
- computed-object tests cover refreshing measurements, protractor angles, and
  intersections after locked geodesic rebuilds;
- palette tests assert that deferred controls remain visible or enabled
  according to the currently implemented feature set;
- a regression test covers the locked-coloring bug where only part of a locked
  split geodesic rendered as locked;
- `npm.cmd run typecheck` and `npm.cmd test -- --run` pass with 86 test files,
  570 passing tests, and 8 skipped future-phase tests.

## Current Diagnosis

The current code has useful building blocks, but the identity model is too
coarse.

`src/world-objects/geodesicCannon.ts` currently represents a connection as:

```ts
interface GeodesicEmitterConnection {
  readonly outgoingEmitterId: string;
  readonly incomingEmitterId?: string;
  readonly state: "open" | "connected" | "straightening";
}
```

This describes a relation between a geodesic id and one or two emitters. It does
not describe the two ends of the geodesic as separate incident objects. That
causes several downstream problems:

- `tieAndDetachIncidentGeodesics` rejects duplicate selected geodesic ids, so a
  single geodesic that returns to the same emitter cannot provide two selectable
  endpoint roles.
- `resolveDetachedEndpoint` returns only the other emitter, not which endpoint
  role, direction, segment, or portal lift is involved.
- `tieAndDetachIncidentGeodesics` requires both remaining endpoints and the
  detached emitter to be in the same cell.
- `advanceStraighteningGeodesics` deletes the straightening geodesic when the
  two straightening segments are not exactly two same-cell segments.
- `lockStraightenedGeodesic` fuses by creating one segment in one cell from
  `start` to `end`.
- `findCoincidentConnectedGeodesic` treats a same endpoint pair and same
  same-cell segment as a duplicate, which is dangerous once homotopically
  distinct wrapped geodesics exist.

The protractor has the same identity problem. `createProtractorAngleObject`
throws when the two selections have the same `geodesicId`, even when they are
different endpoint roles of the same geodesic at the same emitter.

## Design Principle

A geodesic has two endpoint attachments.

Each endpoint is attached to an anchor object. Emitters are visible anchors.
Invisible free ends are anchors for free rays, moving curve-shortening vertices,
and other temporary unattached endpoints. An endpoint may be absent only
transiently during an operation that will either repair the invariant or delete
the geodesic.

The important identity for editing and measuring is not just:

```text
geodesicId
```

It is:

```text
geodesic endpoint = (geodesicId, endRole)
```

where `endRole` is `start` or `end`. Two selections with the same `geodesicId`
are valid if they refer to different endpoint roles. Two selections are invalid
only if they refer to the same `(geodesicId, endRole)` pair.

`start` and `end` are logical endpoint roles of one geodesic interval. They are
not physical source/incoming emitters, and they are not cloned emitter objects.
Each role attaches to one existing anchor object. That anchor may be a visible
geodesic emitter or an invisible free endpoint object. If both roles attach to
the same emitter, the registry still contains exactly one emitter object;
reverse lookup returns two endpoint attachments for that same anchor.

## Invariants

- A geodesic interval always has exactly two endpoint attachments.
- Every endpoint attachment points to an anchor object with
  `canAttachGeodesics: true`.
- A locked geodesic has two emitter anchors. The two endpoints may attach to
  the same emitter if they are different endpoint roles.
- A free geodesic has at least one endpoint attached to a
  `FreeGeodesicEndObject`.
- An aimable free geodesic has one emitter endpoint, one free-end endpoint, and
  the free end has exactly one attached geodesic endpoint total.
- A curve-shortening pair contains two moving endpoint roles attached to the
  same `FreeGeodesicEndObject`. Those endpoint roles may belong to two
  different geodesics, or they may be the `start` and `end` roles of one
  geodesic interval when untying a same-emitter loop into a free loop.
- A geodesic segment object never spans a portal. Portal crossing remains a
  chain of segment objects.
- A geodesic interval carries `startCellId` and `portalWord` as its path/lift
  source of truth. The end cell id, endpoint tangents, lifted endpoint
  coordinates, lengths, and angles are computed quantities.
- Given an initial position in `startCellId`, `portalWord` determines the
  Euclidean coordinates of the reached endpoint in the unfolded source-cell
  coordinate system, even when those coordinates are outside the visible polygon
  of the source cell.
- Rendering still uses real per-cell segment objects. The unfolded coordinates
  are for identity and rebuild math only; they are not fake renderable objects
  outside the portal traversal code.
- Homotopically distinct locked geodesics between the same emitters are allowed.
  Duplicate pruning must compare endpoint roles and portal words, not only
  emitter ids and local coordinates.
- Geodesics shorter than `GEODESIC_MIN_LENGTH_METERS = 0.15` are degenerate and
  should be rejected or deleted. This check uses lifted endpoint displacement,
  not visible same-cell coordinates.
- Same-emitter intervals with too-small lifted endpoint displacement are
  degenerate and should be rejected or deleted, even if the stored portal word
  is nonempty. Geodesics do not stop at portals.

## Proposed Domain Model

Introduce geodesic anchor objects and explicit geodesic interval records in the
existing runtime object registry.

An anchor is any runtime object that can host geodesic endpoints. Geodesic
emitters are visible anchors. Invisible free ends are anchors used for open
rays, moving curve-shortening vertices, and other temporary unattached
endpoints.

```ts
interface GeodesicAnchorObject {
  readonly id: string;
  readonly cellId: string;
  readonly canAttachGeodesics: true;
}

interface FreeGeodesicEndObject extends RuntimeWorldObjectBase {
  readonly kind: "free-geodesic-end";
  readonly canAttachGeodesics: true;
  readonly faceId?: string;
}
```

`FreeGeodesicEndObject` is not rendered as a user-facing object. It is a
topological anchor. Its position is `localPose.translation`. It may have one
attached geodesic endpoint for an ordinary free ray, or two attached geodesic
endpoints for a curve-shortening glued point.

Free-end lifecycle:

- creating an aimable geodesic creates one `GeodesicIntervalObject` and one
  `FreeGeodesicEndObject`;
- the `start` endpoint attaches to the emitter and the `end` endpoint attaches
  to the free end;
- extending or aiming the geodesic moves the free-end object and rebuilds the
  derived segment chain;
- locking the geodesic to an emitter replaces the free-end attachment with an
  emitter attachment and deletes the now-unattached free-end object;
- deleting a geodesic deletes any free-end anchor that no remaining geodesic
  endpoint uses.

A geodesic interval is the source of truth for its two endpoint identities and
portal word. The segment chain remains drawable/cache output derived from this
record. The interval object itself is invisible and noncollidable: it exists to
own identity, attachments, and lift data, not to render geometry.

Exact naming can adapt to the codebase, but the model should be equivalent to:

```ts
type GeodesicEndRole = "start" | "end";
type GeodesicHalfRole = "start" | "end";

interface GeodesicIntervalObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-interval";
  readonly start: GeodesicEndpointAttachment;
  readonly end: GeodesicEndpointAttachment;
  readonly startCellId: string;
  readonly portalWord: readonly GeodesicPortalTraversal[];
  readonly motionState: "stable" | "moving";
}

interface GeodesicEndpointAttachment {
  readonly geodesicId: string;
  readonly role: GeodesicEndRole;
  readonly anchorObjectId: string;
}

interface GeodesicSegmentObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-segment";
  readonly geodesicId: string;
  readonly segmentIndex: number;
  readonly halfRole: GeodesicHalfRole;
}
```

Runtime registry behavior:

- `GeodesicIntervalObject`, `FreeGeodesicEndObject`, and
  `CurveShorteningPairObject` are runtime objects, but only geodesic segments
  and visible anchors produce renderer records.
- Invisible geodesic objects have no collision, no tooltip, no interaction, and
  `portalRenderable: false`.
- Registry queries such as `getAll()` and `getObjectsInCell()` include invisible
  objects. Render, tooltip, interaction, and collision adapters must filter them
  by the existing visible capabilities, not by assuming every runtime object has
  a mesh.
- Geodesic emitters carry `canAttachGeodesics: true`. Legacy geodesic identity
  fields such as `geodesicIds`, `activeGeodesicId`,
  `geodesicEmitterYawRadiansById`, and `geodesicConnectionsById` are not a
  compatibility surface. They should be removed as part of the first phase. New
  code must not read them as source of truth.
- Endpoint tangent and yaw are computed from `(geodesicId, endRole)` and the
  current derived chain. A same-emitter locked loop therefore has two endpoint
  tangents even though it has one emitter object and one geodesic id.

The source of truth is therefore:

- anchor objects own positions and can host endpoint attachments;
- geodesic interval objects own endpoint identities, `startCellId`, and
  `portalWord`;
- segment objects are derived visual traces and never define endpoint identity;
- end cell id, endpoint tangents, lengths, angles, and lifted endpoint
  coordinates are computed from anchor poses, `startCellId`, and `portalWord`.

Segment chains must be split into two half-geodesics for interaction and
highlighting. Every `GeodesicSegmentObject` belongs entirely to either the
`start` half or the `end` half. If the half boundary falls inside a traced cell
segment, derived segment creation splits that trace into two segment objects at
total arclength / 2. A hit exactly at the midpoint resolves to the `start` half.
The half role is stored on each segment and refreshed whenever the derived chain
is rebuilt.

Required helper APIs:

```ts
function getGeodesicEndpointAttachmentsForAnchor(
  registry: RuntimeObjectRegistry,
  anchorObjectId: string,
): readonly GeodesicEndpointAttachment[];

function getGeodesicEndpoints(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly [GeodesicEndpointAttachment, GeodesicEndpointAttachment] | undefined;

function resolveGeodesicEndpointSelectionFromSegmentHit(
  registry: RuntimeObjectRegistry,
  segmentId: string,
): GeodesicEndpointSelection | undefined;
```

Reverse lookup is the public way to answer:

- which geodesic endpoints are attached to this emitter?
- which geodesic endpoints are attached to this free end?
- which endpoint role does a hit segment select?
- which computed tangent does an endpoint present at its anchor?
- which portal word/lift distinguishes this interval from another one?

Reverse lookup is a domain helper for incidence, validation, cleanup, tangent
resolution, and automatic operations. It is not a user-facing endpoint picker in
the emitter menu. User-facing endpoint-role selection comes from world hits on
derived half segments.

Do not turn a portal-wrapped geodesic into one renderer object. A geodesic
interval owns a portal word and a derived segment chain. Segment objects still
never span portals.

An aimable free geodesic is a special case of this model: one endpoint is
attached to an emitter, the other endpoint is attached to a
`FreeGeodesicEndObject`, that free end has exactly one attached endpoint total,
and the geodesic is not `moving`. This condition should be checked through
reverse lookup, not encoded as a separate object kind.

Visual state is derived from the geodesic interval:

- locked geodesic: both endpoint anchors are emitters; render derived segments
  with the locked color;
- free stable geodesic: at least one endpoint anchor is a free end and
  `motionState === "stable"`; render derived segments with the free color;
- moving geodesic: `motionState === "moving"`; render derived segments with the
  moving color.

## Core Implementation Contracts

Implement these helpers before or with the first phase that needs them. They are
the contract that makes the phase plan shippable instead of leaving each phase
to invent source-of-truth behavior.

### Interval Lifecycle

Required APIs:

```ts
function createFreeGeodesicEndObject(input: {
  readonly id: string;
  readonly cellId: string;
  readonly point: Vec3;
}): FreeGeodesicEndObject;

function createGeodesicIntervalObject(input: {
  readonly id: string;
  readonly startAnchorObjectId: string;
  readonly endAnchorObjectId: string;
  readonly startCellId: string;
  readonly portalWord?: readonly GeodesicPortalTraversal[];
  readonly motionState?: "stable" | "moving";
}): GeodesicIntervalObject;

function replaceGeodesicEndpointAttachment(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  endRole: GeodesicEndRole,
  nextAnchorObjectId: string,
): GeodesicIntervalObject | undefined;

function removeGeodesicIntervalAndDerivedObjects(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): void;
```

Deletion must remove derived segments, stale intersections, stale measurements,
stale protractor selections for deleted endpoint roles, and any unshared
`FreeGeodesicEndObject`. Removing one endpoint must not leave a geodesic
interval with one permanent endpoint.

Computed-object cleanup is dependency-based:

- if a geodesic interval is deleted, remove measurements, protractor selections,
  intersections, and other computed objects that reference its geodesic id or
  either endpoint role;
- if a geodesic interval survives but its derived segments are rebuilt, refresh
  computed objects by `(geodesicId, endRole)` first and by replacement segment
  ids only as a fallback;
- if a computed object references a deleted segment id but cannot resolve a
  surviving geodesic endpoint role, delete that computed object.

### Portal And Lift Math

Required APIs:

```ts
interface LiftedGeodesicEndpoint {
  readonly sourceRole: GeodesicEndRole;
  readonly targetRole: GeodesicEndRole;
  readonly sourceAnchorObjectId: string;
  readonly targetAnchorObjectId: string;
  readonly sourceCellId: string;
  readonly sourcePoint: Vec3;
  readonly targetPointInSourceCell: Vec3;
  readonly portalWordFromSourceToTarget: readonly GeodesicPortalTraversal[];
}

function getGeodesicPortalWord(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicPortalTraversal[] | undefined;

function reverseGeodesicPortalWord(
  word: readonly GeodesicPortalTraversal[],
): readonly GeodesicPortalTraversal[];

function liftGeodesicEndpoint(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly sourceRole: GeodesicEndRole;
}): LiftedGeodesicEndpoint | undefined;

function geodesicHasNonzeroLiftedDisplacement(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
}): boolean;
```

`portalWord` is ordered from the interval's `start` endpoint toward its `end`
endpoint. Reversing the endpoint order must reverse and invert the portal word.
The lift helper must return coordinates such that tracing from `sourcePoint`
toward `targetPointInSourceCell` consumes exactly
`portalWordFromSourceToTarget`. For `sourceRole === "start"`, that word is the
interval's portal word. For `sourceRole === "end"`, that word is the
reversed/inverted interval word.
`liftGeodesicEndpoint(interval, "start")` computes the `end` endpoint position
in the Euclidean coordinates of the `start` endpoint's cell. Calling it with
`"end"` computes the `start` endpoint position in the Euclidean coordinates of
the `end` endpoint's cell, using the reversed portal word.

The lifted result is the source for angle and length:

```text
delta = targetPointInSourceCell - sourcePoint
yaw = atan2(delta.y, delta.x)
length = hypot(delta.x, delta.y)
```

Same-emitter intervals are valid only when this lifted displacement is nonzero.
A nonempty portal word alone is not proof of nondegeneracy.

### Derived Segment Rebuild

Required APIs:

```ts
interface GeodesicTraceBuildResult {
  readonly interval: GeodesicIntervalObject;
  readonly segments: readonly GeodesicSegmentObject[];
  readonly terminal:
    | { readonly kind: "free-end"; readonly freeEndObjectId: string }
    | { readonly kind: "emitter-hit"; readonly emitterId: string }
    | { readonly kind: "forbidden-zone-hit"; readonly junctionId: string }
    | { readonly kind: "wall-hit"; readonly sideIndex: number };
}

function traceGeodesicFromLiftedChord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly sourceCellId: string;
  readonly sourcePoint: Vec3;
  readonly yawRadians: number;
  readonly lengthMeters: number;
  readonly expectedPortalWord?: readonly GeodesicPortalTraversal[];
}): GeodesicTraceBuildResult | undefined;

function aimFreeGeodesicFromEndpoint(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly emitterEndRole: GeodesicEndRole;
  readonly targetPointInEmitterCell: Vec3;
}): GeodesicTraceBuildResult | undefined;

function rebuildDerivedGeodesicSegments(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
}): GeodesicTraceBuildResult | undefined;

function splitDerivedSegmentsIntoEndpointHalves(
  segments: readonly GeodesicSegmentObject[],
): readonly GeodesicSegmentObject[];
```

There are two rebuild regimes:

- Anchored rebuild: both endpoint anchors already exist and the interval's
  `portalWord` is identity data. `rebuildDerivedGeodesicSegments` calls
  `liftGeodesicEndpoint`, computes the lifted yaw and length, traces the chord,
  verifies the traced portal word matches the interval word, and then replaces
  derived segments.
- Aiming rebuild: one endpoint is an emitter and the other is a singly-attached
  free end. `aimFreeGeodesicFromEndpoint` uses the crosshair point in the
  emitter endpoint's cell to determine yaw/direction only. It traces along that
  direction for the interval's current computed length. If the trace hits a
  wall, forbidden zone, or emitter before that length is exhausted, the free end
  is temporarily placed at the truncated hit endpoint during aiming preview. On
  the committing click, an emitter hit converts the interval into a locked
  geodesic when the computed length is enough to reach that emitter. No
  continuation is traced beyond the hit emitter. For wall and forbidden-zone
  hits, the trace updates the free-end anchor terminal cell and local position.
  For emitter hits on commit, the free-end attachment is replaced by the hit
  emitter and the now-unattached free-end anchor is deleted. In all cases the
  interval's `portalWord` is rewritten from the realized trace and derived
  segments are replaced.

The free-end anchor always lives in its actual terminal cell. Lifted target
coordinates are computed values for geometry math, not registry positions.

When `expectedPortalWord` is supplied, tracing must consume the same portals in
the same order. If the traced path hits a different portal, wall, forbidden
zone, or otherwise cannot realize the expected word, the rebuild fails without
silently changing the interval's homotopy class. A locked interval that cannot
be retraced in its stored portal/lift class is invalid and must be removed with
the dependency-based cleanup above.

`rebuildDerivedGeodesicSegments` deletes and recreates only the segment chain
for one interval. In anchored rebuild mode it must not mutate endpoint
attachments or portal word. In aiming mode, the explicit aiming operation may
move the free-end anchor and rewrite the interval portal word. Every rebuilt
chain must contain one segment per cell traversal and must never contain a
segment that spans a portal.

Half splitting is by total arclength after tracing. If the midpoint falls inside
a segment and both pieces are at least the geometric tolerance, split that trace
into two segment objects. If the midpoint lands on a segment boundary, the
segment before the boundary is `start` half and the segment after the boundary
is `end` half. A hit exactly at the midpoint resolves to the `start` half.
Segments shorter than tolerance may be merged only when doing so does not cross
a portal or mix half roles.

### Selection, Tangents, And Labels

Required APIs:

```ts
function resolveEndpointTangentAtAnchor(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly endRole: GeodesicEndRole;
}): { readonly anchorObjectId: string; readonly yawRadians: number } | undefined;

function resolveGeodesicEndpointSelectionFromSegmentHit(
  registry: RuntimeObjectRegistry,
  segmentId: string,
): GeodesicEndpointSelection | undefined;

function collectGeodesicMenuRowsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly { readonly geodesicId: string; readonly label: string }[];
```

Menus show one row per geodesic interval. They do not select endpoint roles.
Endpoint-role identity for user actions comes from world hits on half segments.
Same-emitter loops therefore create two endpoint attachments at one anchor, but
only one menu row.

### Split And Carry Helpers

Required APIs:

```ts
function splitGeodesicIntervalAtSegmentHit(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly segmentId: string;
  readonly distanceAlongSegmentMeters: number;
  readonly placedEmitterId: string;
  readonly createContinuationGeodesicId: (sourceGeodesicId: string, sideIndex: number) => string;
}): readonly GeodesicIntervalObject[];

function rebuildLockedGeodesicFromEndpointsAndPortalWord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly carriedAnchorObjectId?: string;
  readonly carriedPortalTransition?: GeodesicCarryPortalTransition;
}): GeodesicTraceBuildResult | undefined;
```

Splitting with a newly placed emitter does not copy a suffix portal word. The
source geodesic id stays on the prefix, which becomes locked from its original
emitter endpoint to the placed emitter. The prefix portal word is the trace
prefix up to the hit. A new continuation interval is created with
`createContinuationGeodesicId(...)`; it starts at the placed emitter and uses
the forward tangent at the hit plus the remaining computed length. The
continuation is retraced from the placed emitter, and its portal word is
recomputed from that retrace. If retracing hits a forbidden zone before the
remaining length is exhausted, the continuation free end is placed at the
truncated hit endpoint.

Carrying must preserve the existing portal word unless the carried anchor
explicitly crosses a portal and the carry operation updates the lift.

## Interaction Semantics

### Selection

Selecting a geodesic in the world should resolve to an endpoint role, not only
a geodesic id.

Palette rows should still display exactly one entry per geodesic interval:
`G1`, `G2`, and so on. Do not show separate menu rows for `G1 start` and
`G1 end`. The emitter menu is interval-level only. It may select an aimable free
geodesic interval for whole-interval actions or aiming, but it must not choose
which endpoint role of a locked or double-incident geodesic is selected.
When a geodesic is cut, the source geodesic keeps its existing label and the
new continuation geodesic receives the next available label.

Endpoint-specific identity for user actions comes from world hits on
half-segments. Reverse lookup at anchors is for domain logic, validation,
cleanup, and tangent resolution; it is not a menu-level endpoint picker.

Action callbacks that operate on a selected endpoint should carry enough
information to identify that endpoint:

```ts
interface GeodesicEndpointSelection {
  readonly geodesicId: string;
  readonly endRole: GeodesicEndRole;
  readonly anchorObjectId: string;
}
```

This lets the same geodesic interval expose two endpoint selections at one
emitter when both logical endpoint roles attach to the same anchor. That still
does not duplicate the emitter or duplicate the geodesic's menu row.

For endpoint selection and highlighting, the derived segment chain is split into
two half-geodesics by arclength. A hit on a segment whose `halfRole` is `start`
selects the interval's `start` endpoint role. A hit on a segment whose
`halfRole` is `end` selects the interval's `end` endpoint role. Because the
midpoint is physically split into two segment objects, every hit has a stable
endpoint-role interpretation.

Tie/release and protractor selection use endpoint selections created by aiming
at rendered half segments in the world, outside the emitter menu. Selecting
`start` and `end` of the same geodesic is valid. Selecting two endpoint roles
that both attach to the same emitter is valid. Selecting the exact same
`(geodesicId, endRole)` twice is invalid.

A geodesic is manually aimable only when it has exactly one emitter endpoint and
exactly one singly-attached free-end endpoint. A locked geodesic, a same-emitter
locked loop, a double-incident geodesic, and a moving curve-shortening geodesic
cannot be manually aimed.

### Protractor

The protractor should reject identical endpoint selections, not identical
geodesic ids.

Replace:

```text
first.geodesicId !== second.geodesicId
```

with:

```text
first.geodesicId !== second.geodesicId || first.endRole !== second.endRole
```

If the same geodesic has both endpoint roles attached to an emitter, measuring
the angle between those ends is valid.

The persisted protractor selection should store `geodesicId`, `endRole`, and a
fallback segment id so it can refresh after rebuilds.

## Tie And Release Semantics

Tie/release at an emitter should:

1. Resolve the two selected endpoint roles at that emitter.
2. Verify they are two different endpoint selections.
3. Identify the two opposite endpoint attachments.
4. Create a `FreeGeodesicEndObject` at the detached point.
5. Replace the selected endpoint attachments with that shared free end.
6. Create a curve-shortening pair that owns the two selected endpoint roles now
   attached to the shared free end.
7. Mark every affected geodesic interval as `moving`.
8. Preserve portal/lift metadata from both incident arcs.

Special case that must be valid:

```text
opposite end A emitter id === opposite end B emitter id
```

This is the torus wrapped-loop case. The two opposite ends attach to the same
emitter but different endpoint roles/lifts.

A locked loop whose start and end anchors are the same emitter must also be
valid. Reverse lookup on that emitter returns two endpoint attachments for the
same geodesic. Tie/release may select those two endpoint roles and detach the
loop from that emitter exactly as it would detach two different geodesics. Same
`geodesicId` and same anchor object do not imply the same selected endpoint.
After detach, the loop remains one geodesic interval whose `start` and `end`
roles both attach to the same free end. This is a free loop, and it is a valid
moving curve-shortening object when its lifted displacement is nondegenerate.

The current same-cell construction in `tieAndDetachIncidentGeodesics` should be
replaced by a portal-aware initialization:

- keep each half's existing traced chain up to the detached emitter;
- replace the selected endpoint anchors with the shared free-end anchor without
  moving the visible arcs at detach time;
- reverse or re-orient portal words only when required to keep each interval's
  word ordered from `start` to `end`;
- do not collapse to straight same-cell segments at tie time.

## Curve Shortening Regime

This section describes the target model. Phase F is greenlit only through the
complete curve-shortening algorithm note in
`docs/issues/32_phase_f_curve_shortening_algorithm_note.md`, so implementation
should not start from this section alone.

Curve shortening is a state over two endpoint roles at one shared free end, not
a special state of one ordinary locked geodesic. The two endpoint roles may
belong to two different geodesic intervals, or they may be the `start` and
`end` roles of one interval in the free-loop case.

Represent curve-shortening state as an explicit runtime object. It is not
rendered, does not collide, and exists only to coordinate the two moving
endpoint roles that share one free-end anchor.

```ts
interface CurveShorteningPairObject extends RuntimeWorldObjectBase {
  readonly kind: "curve-shortening-pair";
  readonly id: string;
  readonly first: GeodesicEndpointAttachment;
  readonly second: GeodesicEndpointAttachment;
  readonly freeEndAnchorId: string;
  readonly previousTotalLengthMeters?: number;
  readonly state: "moving" | "ready-to-fuse";
}

interface FreeGeodesicEndObject extends RuntimeWorldObjectBase {
  readonly kind: "free-geodesic-end";
  readonly canAttachGeodesics: true;
  readonly liftFromFirstEndpoint?: readonly GeodesicPortalTraversal[];
}
```

The glued point is represented by the shared `FreeGeodesicEndObject`. Reverse
lookup on `freeEndAnchorId` must return exactly the two moving geodesic endpoint
roles owned by the shortening pair. Those endpoint roles may have the same
`geodesicId` when the pair represents a free loop.

Creation:

- it creates one shared `FreeGeodesicEndObject` at the detached emitter point;
- it replaces the selected endpoint attachments with the shared free end;
- each affected geodesic keeps its portal word/lift metadata;
- when the selections are from two geodesics, both become moving intervals with
  one endpoint attached to the shared free end;
- when the selections are the `start` and `end` roles of one same-emitter loop,
  that one interval becomes a moving free loop with both roles attached to the
  shared free end;
- it creates one `CurveShorteningPairObject` referencing the two free-end
  endpoint roles and the shared free end.

Each tick:

1. Resolve the shared free-end anchor and the two attached moving endpoints.
2. Compute the two incident tangent directions at the free end in a common
   lift.
3. Move the free-end anchor a small step along the half-angle direction that
   reduces the smaller angle.
4. Retrace affected intervals from their endpoint anchors and portal words,
   respecting portals and forbidden zones.
5. Compute total length over distinct affected geodesic ids.
6. If an affected interval hits a forbidden zone, break the pair:
   - delete the interval that failed;
   - delete the curve-shortening pair relation;
   - leave the surviving emitter-attached path as an unlocked geodesic when it
     is still valid.
7. If total length suddenly increases past tolerance, mark the pair
   `ready-to-fuse` and hand it to final fusion.

Pair invariants:

- both referenced endpoint roles exist and have `motionState === "moving"`;
- both referenced endpoint roles attach to `freeEndAnchorId`;
- the free end has exactly those two attached geodesic endpoint roles;
- the two referenced endpoint roles may belong to the same geodesic id;
- in the two-geodesic case, each moving geodesic's other endpoint is usually a
  geodesic emitter, and those emitter anchors may be the same object;
- in the free-loop case, both endpoint roles of one moving interval attach to
  `freeEndAnchorId`;
- `previousTotalLengthMeters` is updated only after a successful monotone tick.

Failure cleanup:

- if all affected intervals fail retracing, delete the moving geodesics, the
  shared free end, and the pair object;
- if one interval fails in a two-geodesic pair, delete the failed moving geodesic
  and the pair object;
- the surviving half becomes a stable free geodesic by keeping its emitter
  endpoint and replacing the shared free end with a singly-attached free end at
  the last valid point;
- if a free loop fails, delete the loop interval, the shared free end, and the
  pair object because there is no emitter-attached survivor;
- remove stale measurements, protractor angles, and intersection markers that
  reference deleted geodesics or endpoint selections.

The length monotonicity check is essential. The current implementation stops
when the vertex is close to a same-cell line. On quotient spaces, the minimum
may occur across a portal word and cannot be detected by same-cell distance to
one chord.

## Final Straightening And Fusion

Final fusion should take the two shortened halves and produce one locked
geodesic with two explicit ends when the pair has emitter-side endpoints. If the
pair represents a free loop, finalization keeps one stable free loop or deletes
it if shortening makes it degenerate.

It must not assume the result is one segment. Instead:

1. Choose the endpoint pair and portal word/lift represented by the shortened
   halves.
2. Trace the final locally straight path through the cell complex.
3. Create a segment chain, with one segment per cell traversal.
4. Reuse the lower geodesic id among the affected moving intervals for the
   finalized interval.
5. Create one stable geodesic interval record whose two endpoint attachments
   point to the final emitter anchors, or keep the free-loop interval with both
   endpoint roles attached to the same free end.
6. Preserve distinct endpoint roles, even when both endpoint attachments point
   to the same emitter or the same free end.
7. Mark the resulting geodesic `stable`.
8. Delete the temporary moving geodesics not reused, the pair object, and any
   free-end anchor that is no longer attached.
9. If fusion/finalization fails, delete the moving geodesics owned by the pair,
   the shared free end, and the pair object.

Fusion consumes a `CurveShorteningPairObject`; it should not infer pairs by
searching for arbitrary moving geodesics that happen to share a free end. The
pair object is the ownership boundary for cleanup and finalization.

For the torus loop, the result may be:

```text
E1 -- segment in torus cell -- portal-hit -- segment in torus cell -- E1
```

The two endpoint anchors may be the same emitter. The two endpoint roles must
remain distinct.

For a same-emitter loop untied at that same emitter, the result may instead be a
stable free loop:

```text
free end -- wrapped G1 -- same free end
```

Both endpoint roles attach to the same `FreeGeodesicEndObject`. This is valid
when the interval's lifted displacement is nondegenerate.

## Portal Requirements

Portal state needs to become part of geodesic identity.

Minimum requirement:

- every locked geodesic interval can report its ordered `portalWord`;
- every endpoint selection can report the tangent in the local emitter cell;
- rebuilding a locked geodesic preserves its intended portal word unless an
  operation explicitly changes homotopy class;
- duplicate detection includes portal word/lift.

Do not use only local emitter coordinates to decide whether a wrapped loop is
too short. In a torus, the same emitter coordinate in two lifts can represent a
nontrivial loop longer than `GEODESIC_MIN_LENGTH_METERS`.

## Forbidden-Zone Behavior

During curve shortening:

- forbidden-zone hits are detected by retracing each half, not by checking only
  one same-cell segment;
- if one half breaks, the pair exits curve shortening;
- the broken half is removed;
- the other half becomes unlocked if it still has one emitter-attached end and a
  valid open trace;
- all stale measurements, protractor angles, and intersection markers for
  removed ends are cleaned up.

This is different from the current behavior that deletes the entire geodesic
pair when either straightening half enters a forbidden zone.

## Rehaul Plan

This is a breaking rehaul. Do not preserve the old cannon connection model as a
parallel source of truth. Phase A starts by removing the legacy
geodesic model: `geodesicConnectionsById`, cannon-owned `geodesicIds` as
identity, `activeGeodesicId` as identity, `geodesicEmitterYawRadiansById` as
endpoint tangent storage, source/incoming emitter identity, straightening state,
and segment `connectionState`. New geodesic behavior is rebuilt from
`GeodesicIntervalObject`s, endpoint attachments, free-end anchors, portal words,
and derived segment chains.

The first useful replacement model is deliberately narrow: an emitter creates an
aimable free geodesic interval with one emitter endpoint and one singly-attached
free-end endpoint. Aiming this interval traces from the emitter endpoint through
the crosshair, updates the free end, computes the portal word, and rebuilds the
derived segment chain.

Old tests that assert private fields such as `geodesicIds`,
`geodesicConnectionsById`, or segment `connectionState` should be rewritten as
behavior tests as the phases migrate. Later features should be temporarily
removed, disabled, or rebuilt on endpoint intervals rather than kept alive
through compatibility shims.

Each phase must leave the app in a coherent state and should be shippable on its
own.

Current phase status:

- Phase A removed the legacy source-of-truth model and restored aimable
  emitter-to-free-end geodesics on intervals and free-end anchors.
- Phase B restored cutting by placing a new emitter on an aimable free geodesic.
- Phase C restored collision locking and the minimum duplicate policy needed
  for locked intervals, including wrapped same-emitter loops and post-lock
  anchored rebuilds.
- Phase D restored protractor behavior on endpoint selections.
- Phase E restored carrying and geometry-commit rebuilds for locked intervals.
- Phase F is greenlit by the separate algorithm note and is the main remaining
  work for tie/release, curve shortening, and final fusion.

### A. Aiming Works

Remove the legacy geodesic model and reintroduce the first useful new model:
one aimable free geodesic interval with one emitter endpoint and one
singly-attached free-end endpoint.

Scope:

- remove legacy cannon-owned geodesic identity and straightening state
  (`geodesicConnectionsById`, source/incoming connections, `connectionState`,
  and yaw maps as endpoint tangent storage);
- add `GeodesicIntervalObject`, `FreeGeodesicEndObject`, and anchor reverse-lookup
  helpers;
- mark geodesic cannons as attachable anchors;
- add invisible geodesic objects to the `RuntimeWorldObject` union and verify
  render, collision, tooltip, and interaction adapters ignore them unless they
  explicitly opt in;
- create a free-end anchor whenever a new aimable geodesic is created;
- create a geodesic interval whose emitter endpoint attaches to the cannon and
  whose opposite endpoint attaches to the free end;
- implement `aimFreeGeodesicFromEndpoint` for the emitter-to-free-end case:
  the crosshair point in the emitter endpoint's cell determines yaw/direction,
  the interval's current computed length determines how far to trace, wall,
  forbidden-zone, or emitter hits may truncate that length during aiming
  preview, and the trace determines the terminal cell/local free-end position
  and portal word;
- keep the free-end anchor in the actual terminal cell reached by the trace;
- implement anchored `rebuildDerivedGeodesicSegments` only as needed for stable
  free geodesics whose interval already has a portal word;
- split the derived chain at total arclength / 2 and store `halfRole` on every
  segment;
- compute source endpoint tangent from `(geodesicId, "start")`, not from
  `geodesicEmitterYawRadiansById`;
- keep renderer state derived from segment chains and geodesic motion state.

Acceptance:

- aiming and extending an unlocked geodesic works;
- every aimable geodesic has one emitter endpoint and one free-end endpoint;
- the free end has exactly one attached endpoint;
- aiming rewrites the interval portal word from the traced path;
- aiming preserves the current computed length unless the trace is truncated by
  a wall, forbidden-zone, or emitter hit;
- an emitter hit during aiming preview truncates the visible free geodesic, and
  an emitter hit on the committing click converts the interval into a locked
  geodesic when the computed length is enough to reach that emitter;
- committing an emitter hit does not create or trace any continuation beyond
  the hit emitter;
- aiming moves the free-end anchor to the trace terminal cell and local
  position;
- deleting the geodesic deletes its unshared free end;
- reverse lookup from the emitter and free end returns endpoint attachments;
- every derived segment has a `halfRole`;
- a midpoint split produces two segment objects when the midpoint falls inside
  a traced segment;
- a world hit on a `start` half segment resolves to the `start` endpoint role,
  and a hit on an `end` half segment resolves to the `end` endpoint role;
- the old `geodesicConnectionsById`, source/incoming connection model,
  segment `connectionState`, and cannon yaw maps are not read by the new
  aiming/extension code;
- unreimplemented geodesic controls remain visible but disabled;
- if `geodesicIds`, `activeGeodesicId`, or `geodesicEmitterYawRadiansById`
  still exist in the file during this phase, deleting them must not lose
  endpoint identity or endpoint tangent information.

### B. Cutting With New Emitter Works

Placing an emitter on an aimable free geodesic locks the prefix and creates a
new aimable continuation geodesic.

Scope:

- implement `splitGeodesicIntervalAtSegmentHit`;
- preserve the source geodesic id for the prefix from the original emitter
  endpoint to the placed emitter;
- replace the source interval's free-end attachment with the placed emitter so
  the source interval becomes locked;
- compute and store the prefix portal word from the trace up to the hit;
- create one continuation geodesic with
  `createContinuationGeodesicId(...)`;
- attach the continuation start endpoint to the placed emitter and its opposite
  endpoint to the old free-end anchor, which remains singly attached to the
  continuation;
- retrace the continuation from the placed emitter using the forward tangent at
  the hit and the remaining computed length;
- recompute the continuation portal word from that retrace instead of copying a
  suffix from the old portal word;
- if the continuation retrace hits a wall or forbidden zone before the
  remaining length is exhausted, place the continuation free end at the
  truncated hit endpoint;
- rebuild derived segments and half roles without using old cannon connection
  state.

Acceptance:

- placing an emitter on a free geodesic cuts it cleanly;
- the source geodesic keeps its id and becomes locked to the placed emitter;
- the continuation geodesic gets the new id and remains aimable from the placed
  emitter;
- old segments and stale endpoint attachments are removed or replaced;
- each resulting geodesic satisfies the two-endpoint invariant;
- the source portal word matches the traced prefix up to the hit;
- the continuation portal word is recomputed from the cut tangent and remaining
  computed length;
- the old free-end anchor is attached only to the continuation after the cut;
- midpoint/half-role splitting is recomputed for both resulting intervals;
- measurements/intersections referencing deleted geodesics are cleaned up.

### C. Locking Upon Collision Works

Lock open geodesics by replacing their free-end anchor with an emitter endpoint.

Scope:

- when tracing reaches an emitter, change the free-end attachment to that
  emitter;
- delete the now-unattached free-end object;
- store the `portalWord` represented by the traced segment chain;
- compute both endpoint tangents from endpoint roles and derived segments;
- allow `start` and `end` to attach to the same emitter when the portal word is
  nonempty;
- compare lifted endpoint displacement, not local emitter coordinates alone,
  when rejecting degenerate intervals.

Acceptance:

- locking to a distinct emitter works;
- locking from an emitter back to itself through a nonempty portal word works;
- locked geodesics have two emitter endpoints;
- final derived segments still never span a portal;
- duplicate detection does not remove same-emitter wrapped loops;
- same-emitter intervals with lifted endpoint displacement shorter than
  `GEODESIC_MIN_LENGTH_METERS = 0.15` are rejected as degenerate;
- a same-emitter locked loop exposes two endpoint attachments and two endpoint
  tangents at the same emitter.

### D. Measuring Angles Works

Move protractor identity from geodesic ids to endpoint selections.

Scope:

- extend `ProtractorDirectedGeodesic` with `endRole`;
- reject only identical `(geodesicId, endRole)` selections;
- resolve live selections from endpoint attachments and current derived
  segments;
- persist fallback segment id only as a refresh aid, not as identity;
- refresh a protractor selection by `(geodesicId, endRole)` first and by
  fallback segment id only when finding the nearest replacement segment for the
  same endpoint role.

Acceptance:

- selecting the same endpoint twice is rejected;
- selecting `start` and `end` of the same geodesic is allowed;
- angles refresh after segment rebuilds;
- the emitter menu still exposes one row per geodesic interval, even when both
  endpoint roles attach to the same emitter;
- a same-emitter locked loop can measure the angle between its two endpoint
  tangents at that emitter.

### E. Carrying Emitters Works

Rebuild locked geodesics from endpoint metadata and portal word while emitters
move.

Scope:

- replace the old source/incoming connection rebuild with endpoint-role
  rebuild;
- preserve the geodesic's portal word unless the carry operation explicitly
  crosses a portal and updates the lift;
- update endpoint tangents after rebuild;
- refresh measurements, protractor angles, and intersections after rebuild;
- update geometry commit policy to collect geodesic ids from interval objects,
  not from cannon-owned connection fields.

Acceptance:

- carrying an emitter updates every incident locked geodesic;
- carrying preserves wrapped same-emitter loops;
- geometry commits rebuild locked geodesics by explicit endpoints and portal
  word;
- invalid locked geodesics that cannot be retraced are removed with cleanup of
  stale computed objects.

### F. Tie And Release Works

Introduce curve-shortening pairs and portal-aware final fusion.

This phase must be implemented from
`docs/issues/32_phase_f_curve_shortening_algorithm_note.md`, not from the target
description alone.

Scope:

- change tie/release selection payloads to `(geodesicId, endRole)`;
- create a shared free-end anchor and attach the two detached endpoint roles to
  it;
- create a `CurveShorteningPairObject` to own the two moving endpoint roles;
- allow those endpoint roles to come from two different geodesics or from the
  `start` and `end` roles of one same-emitter loop;
- advance pairs by moving the shared free end and retracing affected intervals
  in their portal/lift classes;
- fuse `ready-to-fuse` pairs into one stable locked geodesic when emitter-side
  endpoints remain;
- finalize same-geodesic free loops as stable free loops when nondegenerate;
- reuse the lower geodesic id for the finalized interval;
- delete temporary moving geodesics, the pair object, and unused free ends.

Acceptance:

- tie/release can act on `start` and `end` of the same geodesic;
- tie/release can act when the two remaining endpoints attach to the same
  emitter;
- tie/release of a same-emitter loop may create a free loop whose two endpoint
  roles attach to the same free end;
- reverse lookup on the shared free end returns exactly two moving endpoint
  roles;
- total length is tracked monotonically across ticks;
- final fusion may produce multiple segments;
- final fusion may produce a locked geodesic whose two endpoint roles attach to
  the same emitter;
- finalization may produce a stable free loop whose two endpoint roles attach to
  the same free end;
- if final fusion/finalization fails, the moving geodesics owned by the pair are
  deleted with the pair and shared free end;
- forbidden-zone failure leaves a valid surviving free geodesic when one half
  remains valid.

### G. Duplicate Detection And Policy Cleanup

Harden global cleanup once all endpoint-based features are in place.

Scope:

- compare endpoint roles, anchor ids, portal word, and per-cell segment geometry
  when pruning duplicates;
- treat reversed endpoint order as equivalent only when the reversed portal word
  represents the same path;
- update computed-object policy to remove or rebuild curve-shortening pairs
  consistently after geometry changes.

Acceptance:

- same local endpoint coordinates with different portal words are not zero
  length;
- same-emitter wrapped loops are not removed as duplicates;
- geometry commit does not delete a valid wrapped locked geodesic solely because
  both endpoint anchors are the same emitter.

## Required Tests

Add tests before or with the implementation.

World-object tests:

- emitters and free geodesic ends are geodesic anchors;
- reverse lookup returns all geodesic endpoint attachments for an emitter;
- reverse lookup returns all geodesic endpoint attachments for a free end;
- aimable free geodesic requires a singly-attached free end and one emitter
  endpoint;
- protractor allows two different endpoint roles of the same geodesic;
- protractor rejects selecting the exact same endpoint role twice;
- a geodesic can be locked from an emitter back to the same emitter through a
  nonempty portal word;
- a same-emitter interval with lifted endpoint displacement shorter than
  `GEODESIC_MIN_LENGTH_METERS = 0.15` is rejected as degenerate;
- a locked same-emitter loop exposes two selectable endpoint roles at that
  emitter;
- derived segment chains are split at total arclength / 2;
- a derived segment belongs entirely to either the `start` half or the `end`
  half;
- a midpoint hit resolves to the `start` endpoint role;
- placing an emitter on a free geodesic keeps the source geodesic id for the
  locked prefix and creates a new id for the continuation geodesic;
- the continuation geodesic after a cut recomputes its portal word from the cut
  tangent and remaining computed length;
- tie/release can detach the two endpoint roles of a locked same-emitter loop;
- detaching a same-emitter loop at its emitter creates a free loop whose two
  endpoint roles attach to one shared free end;
- tie/release at one emitter in a two-emitter torus loop creates a shortening
  pair whose moving geodesics share one free-end anchor and whose remaining
  ends both attach to the other emitter;
- advancing that pair fuses into one connected wrapped geodesic;
- advancing a nondegenerate free loop keeps it as one stable free loop;
- advancing a degenerate free loop deletes it and the shared free end;
- final fused wrapped geodesic has two emitter ends with distinct endpoint
  roles;
- final stable free loop has two free-end endpoint roles with distinct endpoint
  roles;
- final fused wrapped geodesic has a nonempty portal word;
- final fusion deletes temporary moving geodesics and the shared free-end
  anchor;
- same-emitter wrapped loop is not removed as a duplicate;
- forbidden-zone hit during shortening leaves a valid surviving unlocked
  geodesic when one half remains valid.

Portal tests:

- same local endpoint coordinates with different portal words are not treated as
  too short unless their lifted displacement is shorter than
  `GEODESIC_MIN_LENGTH_METERS`;
- final fusion never creates a segment spanning a portal;
- reversed portal words compare equal only when they represent the same
  endpoint pair in reverse orientation.

Palette/interaction tests:

- emitter menu shows exactly one row for a geodesic interval, even when both
  endpoint roles attach to the same emitter;
- world hits on `start` half segments select the `start` endpoint role;
- world hits on `end` half segments select the `end` endpoint role;
- tie/release action sends `(geodesicId, endRole)` selections;
- tie/release highlights endpoint half selections, not whole geodesic ids;
- locked same-emitter loop can be deleted from either endpoint role without
  leaving stale segment or connection state.

Computed-object tests:

- length measurements refresh after same-emitter loop fusion;
- protractor angles centered on an emitter survive wrapped geodesic rebuilds;
- geometry commit does not delete a valid wrapped locked geodesic solely because
  both endpoint anchors are the same emitter.

## Acceptance

- The torus loop scenario collapses to one locked wrapped geodesic instead of
  breaking.
- Geodesics have explicit endpoint-role identity in domain helpers and action
  payloads.
- The protractor measures angles between different endpoint roles of the same
  geodesic.
- Curve shortening is portal-aware and length-monotone after the separate Phase
  F algorithm note is written and implemented.
- Forbidden-zone failures during shortening break only the invalid dynamic pair
  and leave a valid unlocked survivor when possible.
- Final fusion creates a portal-aware segment chain, not one same-cell segment.
- Renderer state remains derived from runtime objects; no geodesic visual spans
  a portal.

## Non-Goals

- Do not implement a global shortest-path solver.
- Do not infer arbitrary homotopy minimizers. Preserve and operate within the
  portal/lift class implied by the current construction.
- Do not replace the runtime object registry with a separate geometry database.
- Do not make geodesic segment meshes the source of truth.

## Notes For LLM Devs

The tempting local fix is to relax the `incidentGeodesicIds[0] ===
incidentGeodesicIds[1]` check. That is not enough. The failure is structural:
operations need endpoint-role identity and portal lift data.

Treat this as a domain-model migration:

```text
anchor objects own positions where geodesics attach
geodesic interval objects own two endpoint attachments, startCellId, and one portalWord
reverse lookup finds all endpoint attachments attached to an anchor
segment chains are visual traces derived from geodesic intervals
segment chains are split into start/end half segments for interaction
endpoint selections are what tools select and measure
path words distinguish wrapped realizations
```

Once those concepts exist, the torus behavior becomes ordinary instead of a
special case.
