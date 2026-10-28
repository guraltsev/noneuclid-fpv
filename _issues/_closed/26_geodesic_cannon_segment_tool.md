# 26 - Geodesic cannon segment tool

Status: closed on 2026-08-03.

## Outcome

Placement, aiming, bounded extension, wall/portal terminals, cell-local segment
chains, runtime identities, rendering, reset, and interaction behavior are
implemented. Issue 31's interval/endpoint model supersedes parts of this
document's identity terminology and is the current source of truth.

## Closing evidence

The repository audit at `09dafe7` inspected the geodesic tool implementation
and focused world-object/render tests. Node/npm were unavailable, so tests were
not rerun for this documentation-only closure.

## Goal

Add an interactive geodesic cannon tool for constructing a locally straight, portal-aware geodesic trace as a chain of runtime objects.

The player should be able to:

- place a geodesic cannon on the floor,
- rotate or aim it,
- shoot an initial geodesic segment,
- walk through the world,
- click to extend the current geodesic by another meter,
- continue the geodesic through portals by creating the next segment in the target cell.

The visual result should look like a simple line or beam. A first implementation can render each segment as two crossed rectangular planes, with a fixed visual thickness and length equal to the traced segment length.

## Key Principle

The geodesic trace is world state, not a renderer trick.

Represent the cannon and every emitted segment as runtime registry objects. The registry remains authoritative for:

- object identity,
- cell membership,
- pose or segment geometry,
- selection and interaction,
- reset/removal behavior,
- future save/load behavior.

Rendering should be a view of those objects, preferably through the runtime-object archetype/instance renderer from issue 25.

Do not solve this by drawing one global Three.js line across portal boundaries. A geodesic that crosses a portal must become a new segment object in the destination cell.

## User Model

The intended mental model is:

```text
place cannon -> aim cannon -> shoot -> extend tail -> extend tail -> ...
```

Each click after shooting extends the current tail by up to `1m`.

If the current tail hit a portal, the next click creates a new segment in the target cell. If the current tail is still open inside a cell, the next click extends from that open endpoint in the same cell. If the current tail hit a non-portal wall, extension should be disabled or should produce a clear no-op.

The player may walk between clicks. Interaction targeting should decide whether the player is allowed to extend from the cannon, from the visible tail endpoint, or from the currently selected geodesic. The first implementation should choose one clear rule and keep it consistent.

Recommended first rule:

```text
The active geodesic can be extended while the geodesic cannon tool is selected, regardless of player cell, as long as the active geodesic has an extendable tail.
```

This keeps the core geometry work separate from proximity UX. A later issue can add tail-handle proximity, tooltips, or VR controller affordances.

## Non-Goals

- Do not implement a point-to-point shortest path solver.
- Do not implement global geodesic optimization.
- Do not infer curvature, holonomy, or theorem-level geometric quantities.
- Do not make one renderer object span multiple cells.
- Do not use renderer meshes as the source of truth for the geodesic state.
- Do not add collision against geodesic segment visuals in the first implementation.
- Do not require saving/loading unless a broader runtime-object persistence system exists.
- Do not block on polished cannon art. A simple procedural stand/barrel is enough.

## Terminology

This issue uses "geodesic" in the interactive/local sense used by the tool: a locally straight trace continued through portal identifications.

Code that performs the local trace can be named precisely, for example:

- `traceGeodesicSegment`,
- `extendGeodesicTrace`,
- `GeodesicSegmentObject`.

Avoid names implying a global point-to-point solver, such as:

- `solveGeodesic`,
- `shortestGeodesic`,
- `computeGlobalGeodesic`.

## Runtime Objects

Add runtime object types for the cannon and segments.

Suggested cannon shape:

```ts
interface GeodesicCannonObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-cannon";
  readonly activeGeodesicId?: string;
  readonly aimYawRadians: number;
}
```

Suggested segment shape:

```ts
interface GeodesicSegmentObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-segment";
  readonly geodesicId: string;
  readonly segmentIndex: number;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly lengthMeters: number;
  readonly terminal: GeodesicSegmentTerminal;
}

type GeodesicSegmentTerminal =
  | { readonly kind: "open" }
  | {
      readonly kind: "portal-hit";
      readonly portalId: string;
      readonly targetCellId: string;
      readonly targetPortalId: string;
      readonly targetStart: Vec3;
      readonly targetDirection: Vec3;
    }
  | { readonly kind: "wall-hit"; readonly sideIndex: number };
```

`direction` should be normalized in cell-local coordinates. The first implementation can keep traces horizontal by requiring `direction.z === 0` and `start.z` fixed to a visual height above the floor.

`localPose` still exists because runtime registry objects use it. For a segment, set `localPose.translation` to `start` and `localPose.rotation` to a yaw frame aligned to `direction`, but do not rely on `localPose` alone to recover the full segment. The explicit segment fields are the canonical trace data.

Update the runtime object union:

```ts
export type RuntimeWorldObject =
  | RuntimeCreatureObject
  | PlacedFlagObject
  | GeodesicCannonObject
  | GeodesicSegmentObject;
```

## Geodesic Collections

Each fired geodesic should have a stable `geodesicId`.

Segments should be independently registered objects, but their shared `geodesicId` lets code reconstruct the chain:

```ts
registry
  .getAll()
  .filter((object): object is GeodesicSegmentObject => object.kind === "geodesic-segment")
  .filter((segment) => segment.geodesicId === geodesicId)
  .sort((a, b) => a.segmentIndex - b.segmentIndex)
```

For performance and clarity, a helper can encapsulate this query.

Suggested helper API:

```ts
getGeodesicSegments(registry, geodesicId): readonly GeodesicSegmentObject[]
getGeodesicTail(registry, geodesicId): GeodesicSegmentObject | undefined
removeGeodesic(registry, geodesicId): void
```

## Segment Tracing

Add a pure tracing helper that knows about cell boundaries and portals but does not mutate the registry.

Suggested API:

```ts
interface TraceGeodesicSegmentInput {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly maxLengthMeters: number;
}

interface TraceGeodesicSegmentResult {
  readonly cellId: string;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly lengthMeters: number;
  readonly terminal: GeodesicSegmentTerminal;
}

function traceGeodesicSegment(input: TraceGeodesicSegmentInput): TraceGeodesicSegmentResult;
```

Recommended file:

```text
src/world-objects/geodesicCannon.ts
```

or, if tracing grows into a shared primitive:

```text
src/movement/geodesicTrace.ts
```

### Tracing Algorithm

The first implementation only needs straight horizontal tracing within convex prism cells.

Given:

- `start`,
- normalized horizontal `direction`,
- `maxLengthMeters`,
- source cell sides,

compute the nearest side intersection parameter `t` with `0 < t <= maxLengthMeters`.

For each side:

1. Treat the side as a 2D line segment in the floor plane.
2. Intersect the ray `start.xy + t * direction.xy` with the side segment.
3. Ignore intersections behind the start.
4. Ignore intersections with side projection outside `[0, side.lengthMeters]`, with a small tolerance.
5. Keep the smallest positive `t`.

If no side is hit within `maxLengthMeters`, return:

```ts
{
  lengthMeters: maxLengthMeters,
  terminal: { kind: "open" },
}
```

If a side is hit and the side has no portal, return:

```ts
{
  lengthMeters: hitT,
  terminal: { kind: "wall-hit", sideIndex: side.sideIndex },
}
```

If a side is hit and the side has a portal, transform the hit endpoint and direction through the portal:

```ts
const targetStart = transformPoint3(portal.transformToTarget, hitPoint);
const targetDirection = normalizeVec3(transformDirection3(portal.transformToTarget, direction));
```

Return:

```ts
{
  lengthMeters: hitT,
  terminal: {
    kind: "portal-hit",
    portalId: portal.id,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
    targetStart,
    targetDirection,
  },
}
```

Use a small epsilon so the next segment starts just inside the destination cell if exact portal-plane placement causes an immediate reverse hit. Prefer documenting that epsilon in the trace helper rather than scattering offsets through tool code.

### Endpoint Helpers

Add helpers:

```ts
getGeodesicSegmentEnd(segment): Vec3
canExtendGeodesicSegment(segment): boolean
```

`getGeodesicSegmentEnd` should compute:

```ts
segment.start + segment.direction * segment.lengthMeters
```

For a `portal-hit`, the next segment should use `terminal.targetStart` and `terminal.targetDirection`, not the source-cell endpoint.

## Extension Semantics

Add a registry-mutating helper:

```ts
interface ExtendGeodesicInput {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly maxLengthMeters?: number;
}

function extendGeodesic(input: ExtendGeodesicInput): GeodesicSegmentObject | undefined;
```

Behavior:

1. Find the current tail segment for `geodesicId`.
2. If there is no tail, return `undefined`.
3. If the tail terminal is `wall-hit`, return `undefined`.
4. If the tail terminal is `open`, start in the same cell at the tail endpoint with the same direction.
5. If the tail terminal is `portal-hit`, start in `targetCellId` at `targetStart` with `targetDirection`.
6. Trace at most `maxLengthMeters ?? 1`.
7. Create a new `GeodesicSegmentObject` with `segmentIndex = tail.segmentIndex + 1`.
8. Add it to the registry.
9. Return the new segment.

Add a shoot helper:

```ts
interface ShootGeodesicInput {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cannon: GeodesicCannonObject;
  readonly geodesicId: string;
  readonly maxLengthMeters?: number;
}

function shootGeodesic(input: ShootGeodesicInput): GeodesicSegmentObject;
```

The first segment starts at the cannon muzzle. For a simple first version, compute the muzzle as:

```text
cannon local position + cannon forward direction * fixed barrel offset
```

The first segment direction is the cannon's forward direction in the cannon's cell.

## Renderer Integration

Render geodesic cannon and segment objects through runtime object archetypes.

### Segment Visual

Use one reusable segment archetype:

```text
geodesic-segment:ribbon-cross
```

Geometry:

- two rectangular planes,
- local origin at segment start,
- local +X axis along segment direction,
- unit length from `x = 0` to `x = 1`,
- small width, for example `0.025m`,
- crossed at 90 degrees so the beam is visible from different angles.

Each segment emits one runtime render record:

```ts
{
  objectId: segment.id,
  cellId: segment.cellId,
  archetypeKey: "geodesic-segment:ribbon-cross",
  localMatrix: composeSegmentMatrix(segment),
}
```

`composeSegmentMatrix` should:

1. translate to `segment.start`,
2. rotate local +X to `segment.direction`,
3. scale local X by `segment.lengthMeters`.

Keep thickness in the source geometry rather than scaling Y/Z per segment unless a future style setting needs variable thickness.

### Cannon Visual

The cannon can be a simple procedural archetype or a small `Object3D` converted into runtime render records.

Minimum viable visual:

- base cylinder or box,
- short barrel box/cylinder pointing along local +X,
- optional aim marker.

It should emit runtime render records like other runtime objects. It may have a collision cylinder so placing cannons cannot overlap with other collidable objects.

### Runtime Archetype Source Strategy

Prefer creating explicit geometry/material source meshes for the cannon and segment archetypes. Do not instantiate a new mesh tree per segment.

Suggested renderer file:

```text
src/render/three/geodesicCannonRenderer.ts
```

Suggested API:

```ts
createGeodesicRuntimeRenderSources(): readonly RuntimeObjectRenderSourceMesh[]
collectGeodesicRuntimeRenderRecords(object: GeodesicCannonObject | GeodesicSegmentObject): readonly RuntimeObjectRenderRecord[]
```

If the existing runtime render source collection currently assumes an object root, either:

- add a source type that accepts explicit geometry/material,
- or create one hidden source root once per archetype and collect source meshes from it.

Do not create one source root per segment.

## Tool Integration

Add a runtime desktop tool id, for example:

```ts
"geodesic-cannon"
```

Update:

- runtime menu state,
- desktop tool palette,
- desktop tool indicator,
- createThreeApp input dispatch,
- any VR palette mapping if tools are shared.

Minimum desktop controls:

- select geodesic cannon tool,
- click floor to place a cannon,
- move mouse or use existing orientation placement logic to choose yaw,
- click or press a command to shoot,
- subsequent clicks extend the active geodesic.

If the existing placed-flag flow already has floor targeting and placement collision, reuse that style rather than creating a second floor-picking path.

The tool state should track:

```ts
interface GeodesicCannonToolState {
  readonly selectedCannonId?: string;
  readonly activeGeodesicId?: string;
}
```

This can live in `createThreeApp.ts` initially if the surrounding code keeps tool state there. Extract only if it becomes noisy.

## Placement Rules

Cannon placement should use the same floor-hit and collision conventions as placed signs:

- must hit a floor in a valid cell,
- must fit inside the cell,
- must not overlap collidable runtime objects,
- should avoid forbidden zones if normal collision checks do.

Segment placement should not use object collision checks by default. A geodesic beam is a trace, not a physical obstacle.

## Interaction And Tooltips

The first version can keep interactions minimal:

- cannon tooltip: `Geodesic cannon`,
- segment tooltip: optional, for example `Geodesic segment`,
- cannon interaction: select/activate cannon,
- segment interaction: optional select geodesic.

Do not target renderer instances for selecting the geodesic. Use registry objects and existing aim/focus helpers.

If segment interaction would require complex thin-object picking, skip it in the first implementation and make extension operate on the active geodesic.

## Reset And Removal

World reset should remove:

- all geodesic cannons,
- all geodesic segments,
- active geodesic/cannon tool state.

If a user can delete a cannon, decide whether it also deletes its active geodesic. Recommended first behavior:

```text
Deleting a cannon deletes the geodesic it owns.
```

Add helper:

```ts
removeGeodesicCannonAndSegments(registry, cannonId): void
```

## Likely Files

Likely new files:

- `src/world-objects/geodesicCannon.ts`
- `src/render/three/geodesicCannonRenderer.ts`
- `tests/world-objects/geodesicCannon.test.ts`
- `tests/render-contract/geodesicCannonRenderer.test.ts`

Likely touched files:

- `src/world-objects/runtimeObjectRegistry.ts`
- `src/render/three/createThreeApp.ts`
- `src/render/three/runtimeObjectRenderRecords.ts`
- `src/render/three/runtimeObjectRenderArchetypes.ts`
- `src/runtime/runtimeMenuState.ts`
- `src/ui/paletteDefinition.ts`
- `src/render/dom/desktopToolPalette.ts`
- `src/render/dom/desktopToolIndicator.ts`
- `src/render/three/vrPaletteLibraryAdapter.ts`
- `src/render/three/vrPaletteController.ts`
- `tests/world-objects/runtimeObjectRegistry.test.ts`
- `tests/render-contract/runtimeObjectPortalInstances.test.ts`

## Implementation Plan

### 1. Add domain model and pure helpers

Create geodesic cannon and segment object types.

Add:

- id creation helpers,
- segment endpoint helper,
- tail lookup helper,
- geodesic removal helper,
- runtime object type guards.

Keep these helpers independent of Three.js.

### 2. Add pure segment tracing

Implement `traceGeodesicSegment`.

Test it before adding UI.

Cover:

- open one-meter trace,
- wall hit before one meter,
- portal hit before one meter,
- nearest hit wins,
- side endpoint tolerance,
- missing cell throws or returns a clear failure,
- zero direction is rejected.

### 3. Add shoot and extend operations

Implement:

- `shootGeodesic`,
- `extendGeodesic`,
- `getGeodesicTail`,
- `removeGeodesic`.

Tests should verify that portal-hit extension creates the next object in the target cell.

### 4. Add runtime render sources and records

Create reusable geometry/material for:

- segment crossed ribbon,
- simple cannon body/barrel.

Add render record collection for geodesic objects.

Make sure segment records use the segment's cell and local matrix. Portal duplication should come from the runtime archetype renderer, not from custom geodesic code.

### 5. Wire records into the runtime object render loop

Update the runtime-object render source/record collection path so geodesic objects are included.

The portal instance renderer should see geodesic segment records the same way it sees mouse, marmot, butterfly, and placed sign records.

Do not add a geodesic-specific portal render path.

### 6. Add desktop tool state

Add the geodesic cannon tool to shared menu/tool definitions.

Implement a minimal flow:

1. select tool,
2. click floor to place cannon,
3. aim or use current camera yaw,
4. shoot first segment,
5. click to extend active geodesic.

If aim UI is too much for the first pass, use camera yaw at placement time and document that rotation controls are a follow-up. The data model should still include `aimYawRadians`.

### 7. Add cleanup and reset integration

Ensure reset removes geodesic objects and clears active tool state.

Ensure runtime render archetypes and materials are disposed through the existing runtime archetype disposal path.

### 8. Polish affordances

Add labels/tooltips only where the existing runtime object interaction model supports them cheaply.

Good first affordances:

- active cannon highlight,
- tail endpoint marker,
- disabled extension if the tail hit a wall.

These are optional after the core behavior works.

## Tests

Required world-object tests:

- creating a cannon sanitizes/normalizes yaw and collision data,
- shooting creates a segment with `segmentIndex === 0`,
- shooting from a cannon assigns a stable `geodesicId`,
- one-meter open trace creates an open segment,
- wall hit shortens the segment and stores `wall-hit`,
- portal hit shortens the segment and stores target cell/start/direction,
- extending an open tail creates the next segment in the same cell,
- extending a portal-hit tail creates the next segment in the target cell,
- extending a wall-hit tail returns no segment,
- removing a geodesic removes all segment objects,
- deleting/resetting a cannon removes or deactivates its active geodesic.

Required render-contract tests:

- geodesic segment renderer publishes one record per segment,
- segment record `cellId` matches the segment object,
- segment record matrix scales length correctly,
- segment record matrix rotates local +X to segment direction,
- segment archetype uses runtime portal clip attributes,
- portal-visible segment instances are created through `updateRuntimeObjectRenderArchetypeInstances`,
- portal-hit chains do not create renderer objects spanning two cells.

Required tool/integration tests where practical:

- selecting the geodesic cannon tool updates menu state,
- floor click places a cannon,
- shoot command creates the first segment,
- extend command creates another segment,
- reset clears cannon and segment runtime objects,
- existing placed flag, runtime object, movement, and portal rendering tests continue to pass.

Negative tests:

- geodesic segment objects are not collidable by default,
- tracing does not call any point-to-point geodesic solver,
- renderer code does not create one mesh tree per segment,
- no geodesic-specific portal clone path exists.

## Acceptance Criteria

- The user can place a geodesic cannon on the floor.
- The cannon has a persistent runtime object identity.
- The user can aim or rotate the cannon enough to choose the first segment direction.
- Shooting creates the first geodesic segment.
- Each extension adds at most `1m` of trace.
- A segment stops early when it hits a wall or portal.
- A portal hit records the target cell, target start point, and target direction.
- Extending after a portal hit creates a new segment object in the target cell.
- No segment object spans multiple cells.
- Geodesic segment visuals render through runtime object archetype/instance rendering.
- Portal-visible geodesic segments do not use cloned `Object3D` trees.
- Runtime registry state remains authoritative.
- Reset/removal does not leave orphaned segment render records.
- Full relevant test suite passes.

## Follow-Up Ideas

- Tail endpoint handles that can be clicked directly.
- VR controller cannon placement and extension.
- Color/style choices per geodesic.
- Distance labels on segments.
- Delete last segment / undo extension.
- Save/load geodesic traces.
- Optional collision or occlusion rules for geodesic beams.
- A later, separate global geodesic or shortest-path teaching tool.

## Notes For LLM Devs

Do not implement a global geodesic solver for this issue.

Do not draw one continuous renderer line through portals.

Do not make the renderer the source of truth.

Do not add a geodesic-specific portal clone renderer.

Think of this feature as another runtime object family:

```text
runtime registry objects -> runtime render records -> runtime archetype portal renderer
```

The only special geometric operation is local segment tracing inside one convex cell and transforming the endpoint/direction through a portal when a portal side is hit.
