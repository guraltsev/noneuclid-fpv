# 008 - Runtime Contracts

This document names the contracts that should become stable early. Exact TypeScript syntax may change during implementation, but the concepts should remain visible.

## CellComplexSpec

Author-authored description of the world.

Required behavior:

- names every cell,
- names the start cell and pose,
- names every portal,
- describes which faces are walls and which are portals,
- describes enabled tools,
- describes optional decorations.

It may contain convenient authoring sugar. The compiler removes ambiguity.

## CompiledCellComplex

Validated runtime model.

Required behavior:

- every cell id resolves,
- every portal endpoint resolves,
- every portal transform is explicit,
- every portal has a reverse traversal rule or a clear one-way rule,
- every forbidden zone is explicit,
- every collision surface is explicit,
- every public query has deterministic results.

Possible public shape:

```ts
export interface CompiledCellComplex {
  readonly id: string;
  readonly cells: ReadonlyMap<CellId, CompiledCell>;
  readonly portals: ReadonlyMap<PortalId, CompiledPortal>;
  readonly start: PlayerPose;
  cell(id: CellId): CompiledCell;
  portalAtFace(ref: CellFaceRef): CompiledPortal | undefined;
  forbiddenZones(cell: CellId): readonly ForbiddenZone[];
}
```

Do not expose mutable maps as part of the public contract.

## PrismCellSpec

First implemented cell type.

Required behavior:

- base polygon is simple,
- height is positive,
- side faces correspond to base edges,
- floor and ceiling are closed collision surfaces,
- side faces may be walls or portals,
- local coordinates are documented.

Possible local coordinate convention:

```text
x/z plane: floor coordinates
y: vertical height
floor: y = 0
ceiling: y = height
```

Pick one coordinate convention and use it everywhere.

## PortalSpec

Authoring description of a portal.

Required behavior:

- references a source cell face,
- references a target cell face,
- describes orientation in restricted terms,
- is compiled into a rigid transform,
- is rejected if source and target faces are incompatible.

## CompiledPortal

Runtime traversal rule.

Required behavior:

- can transform a point crossing from source to target,
- can transform a direction crossing from source to target,
- can transform a full player pose,
- can identify the source and target face interiors,
- can reject crossings too close to portal boundaries or forbidden zones.

## PlayerPose

Current player location.

Required behavior:

- stores current cell id,
- stores local position in the current cell,
- stores local orientation,
- does not claim a global Euclidean position across the entire complex.

## MoveRequest and MoveResult

Movement should be explicit and inspectable.

Possible result variants:

```ts
export type MoveResult =
  | { kind: "moved"; pose: PlayerPose }
  | { kind: "crossed-portal"; pose: PlayerPose; portal: PortalId }
  | { kind: "blocked-by-wall"; pose: PlayerPose; surface: CellFaceRef }
  | { kind: "blocked-by-floor-or-ceiling"; pose: PlayerPose }
  | { kind: "blocked-by-forbidden-zone"; pose: PlayerPose; zone: ForbiddenZoneId };
```

Use variants like this because they are easy to test and easy to show in a debug overlay.

## StraightRayTrace

The first ray tool should expose raw path data.

Possible shape:

```ts
export interface StraightRayTrace {
  readonly start: RayStart;
  readonly segments: readonly RaySegment[];
  readonly stopReason:
    | { kind: "max-distance" }
    | { kind: "max-portal-crossings" }
    | { kind: "hit-wall"; face: CellFaceRef }
    | { kind: "hit-forbidden-zone"; zone: ForbiddenZoneId }
    | { kind: "numeric-failure"; message: string };
}
```

This is not a geodesic solution. Do not call it one in code.

## DiscoveryLog

The discovery log is optional but useful for classroom review.

It should store student actions, not private personal data.

Examples:

- placed marker,
- fired ray,
- started path trace,
- stopped path trace,
- reset world,
- changed world.

Do not add accounts or cloud sync.

## DebugState

Debug state should be public enough for tests and classroom diagnosis.

Examples:

- current cell id,
- player position,
- last movement result,
- visible portal count,
- last ray stop reason,
- secure-context status,
- WebXR availability status.

Do not put debug state inside private renderer internals only.
