/**
 * Frame render snapshot: the portal-render values of one frame, computed once where the cell instances are written.
 *
 * The snapshot records the root cell the visible paths were computed for (the rendered root, which in single-view XR
 * can be the neighbour of the player's cell), the paths per destination cell as written to the cell archetypes, the
 * same paths flattened and regrouped for runtime-object instancing, the clip rows of the frame and the viewer
 * positions in the render frame. Runtime-object instancing reads only the snapshot, never the player's cell, so objects
 * always use the root that is actually rendered. Snapshots are immutable values replaced once per frame.
 */
import type * as THREE from "three";
import {
  flattenVisiblePortalPathGroups,
  groupVisiblePortalPathsByDestinationCell,
} from "./renderPortalInstances";
import type { VisiblePortalPath } from "./visiblePortalPaths";

/** Portal-render values of one frame, computed once where the cell instances are written. */
export interface FrameRenderSnapshot {
  /** `aimFrameSerial` of the frame (or of the setup / settings call) that built it. */
  readonly serial: number;
  /** Root cell the visible paths were computed for: the rendered root (eye 0's root in stereo). */
  readonly rootCellId: string;
  /** Visible paths per destination cell, as written to the cell archetypes (mono: table join; stereo: grouped union). */
  readonly visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
  /** The same paths flattened, de-duplicated by path id and sorted by id. */
  readonly objectPaths: readonly VisiblePortalPath[];
  /** `objectPaths` grouped by destination cell (input order kept): what runtime-object instancing reads. */
  readonly objectPathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
  /** Clip rows by path id for this frame (the live `portalClipData.clipIndexByPathId` map). */
  readonly clipIndexByPathId: ReadonlyMap<number, number>;
  /** Viewer positions in the render frame, one per eye (rover suppression). */
  readonly cameraPositions: readonly THREE.Vector3[];
}

/** Builds a snapshot; derives `objectPaths` and `objectPathsByDestinationCell` from `visiblePathsByDestinationCell`. */
export function createFrameRenderSnapshot(input: {
  serial: number;
  rootCellId: string;
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
  clipIndexByPathId: ReadonlyMap<number, number>;
  cameraPositions: readonly THREE.Vector3[];
}): FrameRenderSnapshot {
  const objectPaths = flattenVisiblePortalPathGroups(input.visiblePathsByDestinationCell);

  return {
    serial: input.serial,
    rootCellId: input.rootCellId,
    visiblePathsByDestinationCell: input.visiblePathsByDestinationCell,
    objectPaths,
    objectPathsByDestinationCell: groupVisiblePortalPathsByDestinationCell(objectPaths),
    clipIndexByPathId: input.clipIndexByPathId,
    cameraPositions: input.cameraPositions,
  };
}

/** Snapshot with no visible paths (no cull table, no result, or before the first visibility pass). */
export function createEmptyFrameRenderSnapshot(serial: number, rootCellId: string): FrameRenderSnapshot {
  return createFrameRenderSnapshot({
    serial,
    rootCellId,
    visiblePathsByDestinationCell: new Map(),
    clipIndexByPathId: new Map(),
    cameraPositions: [],
  });
}
