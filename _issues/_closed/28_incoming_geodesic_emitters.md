# 28 - Incoming geodesic emitters

Status: closed on 2026-08-03.

## Outcome

Emitter-hit locking, placing an emitter on a segment, locked rendering/actions,
and deletion cleanup are implemented. Issue 31's explicit interval endpoint
attachments supersede this document's outgoing/incoming connection model.

## Closing evidence

The repository audit at `09dafe7` inspected the locking, segment-split,
rendering, and cleanup tests. Node/npm were unavailable, so tests were not rerun
for this documentation-only closure.

## Goal

Allow a geodesic emitter to receive an incoming geodesic, not only create outgoing geodesics.

The player should be able to create an incoming connection in two ways:

- place a new emitter on an existing geodesic,
- aim or extend an existing geodesic until it reaches another emitter.

When a connection is made, the geodesic becomes endpoint-connected to the receiving emitter, is truncated exactly at the emitter connection point, and enters a locked state. A locked geodesic cannot be rotated, aimed, or extended. It can only be deleted.

Connected geodesics should render golden instead of light blue.

## User Model

The intended mental model is:

```text
ray reaches emitter -> emitter receives ray -> ray locks in place
```

For placement:

```text
select emitter tool -> point at geodesic -> click -> new emitter appears on ray -> ray is shortened to the emitter -> ray locks
```

For aiming:

```text
open source emitter menu -> aim geodesic at target emitter -> click -> ray connects if it is long enough
```

If the aimed ray is not long enough yet:

```text
extend -> extend -> reaches target emitter -> ray connects and locks
```

The player should not need to choose a separate "incoming" mode. The incoming behavior follows naturally from the target under the aimer.

## Terminology

Use "emitter" in UI and user-facing text. Existing code currently uses `GeodesicCannonObject` and `geodesic-cannon`; those names can remain until a broader rename is worth doing.

Use "connected" for a geodesic that reaches a receiving emitter.

Use "locked" for the interaction restriction created by that connection.

## Data Model

Keep the geodesic as a chain of `GeodesicSegmentObject` registry objects. Add endpoint association metadata to the geodesic, not to renderer-only state.

Recommended first shape:

```ts
interface GeodesicCannonObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-cannon";
  readonly activeGeodesicId?: string;
  readonly geodesicIds: readonly string[];
  readonly geodesicEmitterYawRadiansById?: Readonly<Record<string, number>>;
  readonly geodesicConnectionsById?: Readonly<Record<string, GeodesicEmitterConnection>>;
  readonly aimYawRadians: number;
}

interface GeodesicEmitterConnection {
  readonly outgoingEmitterId: string;
  readonly incomingEmitterId?: string;
  readonly state: "open" | "connected";
}
```

This lets the source emitter keep owning its geodesics while still recording the receiving emitter. The receiving emitter should also include the geodesic ID in `geodesicIds` so its action menu can show the incoming ray.

If lookup from geodesic ID to connection becomes awkward, add a small helper that derives global connection state from all emitters:

```ts
getGeodesicConnection(registry, geodesicId): GeodesicEmitterConnection | undefined
isGeodesicLocked(registry, geodesicId): boolean
```

Do not store lock state only on segments. Segment-level metadata is useful for rendering, but interaction state belongs to the geodesic relation between emitters.

## Segment Terminals

Add a terminal kind for emitter hits:

```ts
type GeodesicSegmentTerminal =
  | { readonly kind: "open" }
  | { readonly kind: "emitter-hit"; readonly emitterId: string }
  | { readonly kind: "portal-hit"; ... }
  | { readonly kind: "wall-hit"; readonly sideIndex: number }
  | { readonly kind: "forbidden-zone-hit"; readonly junctionId: string };
```

`canExtendGeodesicSegment` should return `false` for `emitter-hit`, the same way it already refuses wall and forbidden-zone tails.

## Connection Geometry

The connection point should be the emitter center in cell-local XY at `geodesicRayBeamHeightMeters`.

Use the emitter collision cylinder only as the target affordance if needed for picking. The persisted geodesic endpoint should terminate at the emitter centerline, not at the outside of the cylinder. That makes the visual read as `| - lock - |` rather than stopping short of the receiving pole.

Minimum geometric helper:

```ts
findNearestEmitterHitOnTrace({
  registry,
  sourceEmitterId,
  cellId,
  start,
  direction,
  maxLengthMeters,
}): { emitter: GeodesicCannonObject; distanceMeters: number } | undefined
```

Rules:

- ignore the outgoing source emitter,
- ignore emitters already associated with the same geodesic unless this is the intended incoming endpoint,
- only consider emitters in the same cell as the segment being traced,
- require the perpendicular distance from emitter center to ray to be within a connection tolerance,
- require the projected distance to be positive and within the trace length.

The first version does not need to detect emitters through portals in a single segment. Portal traversal already creates per-cell segments, so the helper runs once for each traced segment.

## Operations

Add a high-level operation for connecting a geodesic to an emitter:

```ts
connectGeodesicToEmitter({
  world,
  registry,
  geodesicId,
  incomingEmitterId,
  totalLengthMeters,
}): readonly GeodesicSegmentObject[]
```

The operation should:

1. Rebuild or truncate the geodesic to the exact total length.
2. Set the tail terminal to `{ kind: "emitter-hit", emitterId: incomingEmitterId }`.
3. Add the geodesic ID to the incoming emitter's `geodesicIds`.
4. Mark the source emitter connection state as `connected`.
5. Refresh geodesic intersection objects.

Add a placement operation:

```ts
placeGeodesicCannonOnGeodesic({
  world,
  registry,
  geodesicId,
  segmentId,
  distanceAlongSegmentMeters,
  id,
}): PlaceGeodesicCannonResult
```

The operation should:

1. Compute the exact point on the selected segment.
2. Place the new emitter at that floor point.
3. Truncate the geodesic to the total distance from its source to that point.
4. Create the incoming association and lock the geodesic.

This should not create a new outgoing geodesic automatically. It creates the emitter object and a receiving laser/head object for the associated incoming geodesic through the existing emitter render record path.

## Trace And Extend Behavior

`traceGeodesicSegment` currently only considers cell sides and forbidden zones. Keep that pure geometry helper if desired, and layer emitter-hit tracing above it:

```ts
traceGeodesicSegmentWithEmitters(input): TraceGeodesicSegmentResult
```

Algorithm:

1. Run the existing cell/wall/portal/forbidden-zone trace.
2. Search for the nearest eligible emitter hit before the returned segment length.
3. If found, return a trace with `lengthMeters` set to the emitter distance and terminal `emitter-hit`.
4. Otherwise return the original trace.

`shootGeodesic`, `extendGeodesic`, and `rebuildGeodesicToLength` should use this target-aware trace when a geodesic ID and source emitter ID are known.

If a geodesic is aimed at an emitter but its current total length is too short, aiming should preserve the requested yaw and remembered length. Later `extendGeodesic` calls should use target-aware tracing and connect once the target falls within the next extension.

## Lock Semantics

A geodesic is locked when:

- its connection state is `connected`, or
- its tail terminal is `emitter-hit`.

Locked geodesics:

- cannot enter `geodesic-cannon-rotate`,
- cannot enter `geodesic-cannon-aim`,
- cannot be extended,
- can be deleted from either associated emitter menu.

Deleting a locked geodesic should remove all its segments and remove the geodesic ID from both source and incoming emitters. It should not delete either emitter.

Deleting an emitter should remove every geodesic associated with it, including incoming locked geodesics, unless a later issue introduces shared ownership rules.

## UI

The emitter action menu should show different controls for open and locked geodesics.

Open geodesic row:

```text
G1    Rotate    Aim    Delete
```

Locked connected geodesic row:

```text
G1    | - lock - |    Delete
```

For the desktop DOM palette:

- remove the Rotate and Aim buttons for locked rows rather than disabling them,
- render a compact locked-connection symbol in their place,
- use `/assets/icons/lock.png`,
- invert the icon with CSS if needed for contrast.

For the in-scene or VR palette:

- use the same palette definition fields so desktop and VR do not diverge,
- represent locked rows as a non-interactive status surface plus a delete button,
- keep `scenePaletteItemId` and action callbacks absent for removed rotate/aim controls.

Recommended palette model change:

```ts
interface GeodesicCannonActionsPaletteContent {
  readonly kind: "geodesic-cannon-actions";
  readonly cannonId: string;
  readonly addAction: { readonly label: string; readonly disabled: boolean };
  readonly geodesics: readonly {
    readonly id: string;
    readonly label: string;
    readonly locked: boolean;
    readonly connectionSymbolLabel?: string;
    readonly deleteDisabled: boolean;
  }[];
}
```

Renderers can derive whether rotate/aim exists from `locked`.

## Rendering

Connected geodesic segments should be golden. Open geodesics remain light blue.

Recommended renderer change:

- keep the current blue `geodesicSegmentArchetypeKey` for open segments,
- add `geodesicSegmentConnectedArchetypeKey` with a gold material,
- choose the archetype key in `collectGeodesicRuntimeRenderRecords` based on `isGeodesicLocked(registry, segment.geodesicId)` or a segment-level `connected` field populated by world-object helpers.

If render records cannot conveniently access the registry, add readonly display state to each segment:

```ts
readonly connectionState?: "open" | "connected";
```

The source of truth should still be updated by geodesic operations, not by the renderer.

Suggested gold color: `0xf6c445`, emissive enough to read as a laser but not so saturated that it fights UI highlights.

## Picking And Placement

The existing aimer already targets geodesic segments. When the selected tool is `geodesic-cannon` and the aim target is a geodesic segment, route the click to `placeGeodesicCannonOnGeodesic` instead of floor placement.

Priority:

1. Existing interactable object target.
2. Geodesic segment target for incoming-emitter placement.
3. Floor target for ordinary emitter placement.

The selected point should use the resolved geodesic target point, not the renderer mesh vertex. If the aim target only reports object identity today, extend it to include `segmentDistanceMeters` or enough local hit data to compute the truncation distance.

## Tests

World-object tests:

- placing an emitter on a segment truncates the geodesic at the placement distance,
- placing on a later segment preserves earlier portal-crossing segments and truncates the selected segment,
- connected geodesics have `emitter-hit` tails and cannot extend,
- aiming at an emitter connects immediately when total length is sufficient,
- aiming at an emitter does not connect until extension reaches it,
- deleting a connected geodesic removes association from both emitters,
- deleting an emitter removes incoming locked geodesics.

Palette tests:

- locked rows expose no rotate or aim actions,
- locked rows expose the lock connection symbol and delete action,
- unlocked rows still expose rotate, aim, and delete.

Renderer tests:

- connected segments publish the connected/gold archetype key,
- open segments continue using the blue archetype key,
- connected emitters publish head records for incoming geodesic IDs.

Interaction tests:

- geodesic-cannon tool click on a segment places an incoming emitter,
- geodesic-cannon tool click on floor still places an ordinary emitter,
- rotate and aim commands no-op for locked geodesics even if called directly.

## Non-Goals

- Do not compute shortest paths between emitters.
- Do not bend a ray toward an emitter after aiming. The ray only connects if the current straight traced path intersects the emitter.
- Do not make a single renderer object span portal boundaries.
- Do not let locked geodesics be edited by hidden command paths.
- Do not introduce save/load changes unless runtime-object persistence is being handled separately.

## Acceptance

- A player can place an emitter on an existing geodesic and the geodesic visibly ends at the emitter.
- A player can aim or extend a geodesic into another emitter and the ray connects when long enough.
- Connected geodesics are golden.
- Connected geodesics cannot be rotated, aimed, or extended.
- Connected geodesics can be deleted.
- The emitter menu shows `| - lock - |` for locked geodesics instead of rotate and aim controls.
