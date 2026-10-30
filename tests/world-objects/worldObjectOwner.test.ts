import { describe, expect, it } from "vitest";
import { identityRigidTransform3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { CellDeformationMap } from "../../src/runtime/worldGeometryDeformations";
import {
  createObjectHost,
  createPlainWorldObject,
} from "../../src/world-objects/worldObjectOwner";
import {
  createRuntimeObjectRegistry,
  type RuntimeCreatureObject,
} from "../../src/world-objects/runtimeObjectRegistry";

function house(id: string, cellId: string): RuntimeCreatureObject {
  return { id, kind: "geo-mouse", cellId, localPose: identityRigidTransform3, portalRenderable: false };
}

describe("object host and plain world objects", () => {
  it("placeAt returns false for an unknown id", () => {
    expect(createObjectHost().placeAt("nope", "cell-a", identityRigidTransform3)).toBe(false);
  });

  it("placeAt moves a plain object and the registry shows the new cell and pose", () => {
    const registry = createRuntimeObjectRegistry();
    const host = createObjectHost();
    const owner = createPlainWorldObject(registry, house("h", "cell-a"));
    host.register(owner);

    const pose = yawRigidTransform3(0.25, { x: 1, y: 2, z: 0 });
    expect(host.placeAt("h", "cell-b", pose)).toBe(true);

    expect(registry.get("h")!.cellId).toBe("cell-b");
    expect(registry.get("h")!.localPose).toBe(pose);
    expect(registry.getObjectsInCell("cell-a")).toEqual([]);
    expect(() => registry.update(house("h", "cell-a"))).toThrow(/is owned; use its owner/);
  });

  it("rejects a duplicate owner id", () => {
    const registry = createRuntimeObjectRegistry();
    const host = createObjectHost();
    const owner = createPlainWorldObject(registry, house("h", "cell-a"));
    host.register(owner);
    expect(() => host.register(owner)).toThrow(/already registered/);
  });

  it("transformGeometry maps the pose through a translation map and keeps it without a map", () => {
    const registry = createRuntimeObjectRegistry();
    const host = createObjectHost();
    const start = house("h", "cell-a");
    host.register(createPlainWorldObject(registry, {
      ...start,
      localPose: yawRigidTransform3(0.5, { x: 1, y: 1, z: 0 }),
    }));
    const map: CellDeformationMap = {
      cellId: "cell-b",
      mapPoint: (p) => ({ x: p.x + 2, y: p.y - 1, z: p.z }),
      mapDirection: (d) => d,
    };

    host.transformGeometry(new Map([["other", map]]));
    expect(registry.get("h")!.cellId).toBe("cell-a");
    expect(registry.get("h")!.localPose.translation).toEqual({ x: 1, y: 1, z: 0 });

    host.transformGeometry(new Map([["cell-a", map]]));
    const moved = registry.get("h")!;
    expect(moved.cellId).toBe("cell-b");
    expect(moved.localPose.translation.x).toBeCloseTo(3, 12);
    expect(moved.localPose.translation.y).toBeCloseTo(0, 12);
    expect(Math.atan2(moved.localPose.rotation.m10, moved.localPose.rotation.m00)).toBeCloseTo(0.5, 12);
  });
});
