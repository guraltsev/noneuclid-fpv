import { describe, expect, it } from "vitest";
import { createEmptyFrameRenderSnapshot, createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";

function path(cellId: string, pathId: number, depth: number) {
  return { ...createRootVisiblePortalPath(cellId), pathId, depth };
}

describe("frameRenderSnapshot", () => {
  it("flattens, sorts and regroups the paths for objects and keeps the cell map", () => {
    const map = new Map([
      ["room-b", [path("room-b", 3, 1), path("room-b", 1, 0)]],
      ["room-a", [path("room-a", 2, 1)]],
    ]);

    const snapshot = createFrameRenderSnapshot({
      serial: 4,
      rootCellId: "room-b",
      visiblePathsByDestinationCell: map,
      clipIndexByPathId: new Map(),
      cameraPositions: [],
    });

    expect(snapshot.objectPaths.map((p) => p.pathId)).toEqual([1, 2, 3]);
    expect(snapshot.objectPathsByDestinationCell.get("room-b")?.map((p) => p.pathId)).toEqual([1, 3]);
    expect(snapshot.visiblePathsByDestinationCell).toBe(map);
    expect(snapshot.rootCellId).toBe("room-b");
    expect(snapshot.serial).toBe(4);
  });

  it("builds an empty snapshot that keeps the root cell", () => {
    const snapshot = createEmptyFrameRenderSnapshot(2, "room-a");

    expect(snapshot.objectPaths).toEqual([]);
    expect(snapshot.objectPathsByDestinationCell.size).toBe(0);
    expect(snapshot.visiblePathsByDestinationCell.size).toBe(0);
    expect(snapshot.rootCellId).toBe("room-a");
  });
});
