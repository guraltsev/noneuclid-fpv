/**
 * The square base and two-room-with-one-portal spec repeated, slightly differently, across many cell-complex,
 * movement and world-object test files. New tests should use these instead of retyping their own copy; existing
 * copies are not migrated by this change (see job 42's report).
 */
import type { CellComplexSpec } from "../../../src/cell-complex/specs";

/** A 2 m x 2 m square base centred on the origin, counter-clockwise from (-1, -1). */
export const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** Two 2 m square rooms ("room-a", "room-b"), room-a's east side glued to room-b's west side. */
export function twoRoomsWithPortal(options: { readonly heightMeters?: number; readonly targetHeightMeters?: number } = {}): CellComplexSpec {
  const heightMeters = options.heightMeters ?? 2;

  return {
    cells: [
      {
        id: "room-a",
        heightMeters,
        baseVertices: squareRoomBase,
        portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
      },
      {
        id: "room-b",
        heightMeters: options.targetHeightMeters ?? heightMeters,
        baseVertices: squareRoomBase,
        portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
      },
    ],
  };
}
