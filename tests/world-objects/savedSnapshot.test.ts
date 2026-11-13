/**
 * `tests/world-objects/savedSnapshot.test.ts` - unit tier.
 *
 * The saved snapshot behind undo (design 017 section 8.8): it keeps only the kinds that modules declare saved, restores what was removed, puts back what was replaced, leaves what appeared since alone, and reports the saved kinds a frame removed.
 */
import { describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { createRuntimeObjectRegistry, type RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import { restoreSavedSnapshot, savedKindsRemovedThisFrame, savedObjectKinds, takeSavedSnapshot } from "../../src/world-objects/savedSnapshot";
import type { GeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";

function emitter(id: string, aimYawRadians = 0): GeodesicEmitterObject {
  return { id, kind: "geodesicEmitters/emitter", cellId: "a", localPose: identityRigidTransform3, portalRenderable: true, aimYawRadians } as GeodesicEmitterObject;
}

function creature(id: string): RuntimeCreatureObject {
  return { id, kind: "geo-mouse", cellId: "a", localPose: identityRigidTransform3, portalRenderable: true };
}

const saved = savedObjectKinds([
  { objectKinds: [{ kind: "geodesicEmitters/emitter", persistence: "saved" }, { kind: "geodesicModel/segment", persistence: "rebuilt" }] },
]);

describe("saved snapshot", () => {
  it("lists only the kinds declared saved", () => {
    expect([...saved]).toEqual(["geodesicEmitters/emitter"]);
  });

  it("keeps saved objects only, and restores a removed one", () => {
    const registry = createRuntimeObjectRegistry([emitter("e1"), creature("m1")] as RuntimeWorldObject[]);
    const snapshot = takeSavedSnapshot(registry, saved);
    expect(snapshot.map((object) => object.id)).toEqual(["e1"]);

    registry.remove("e1");
    expect(restoreSavedSnapshot(registry, snapshot)).toBe(1);
    expect(registry.get("e1")).toBe(snapshot[0]);
  });

  it("puts a replaced object back and leaves a newer object alone", () => {
    const registry = createRuntimeObjectRegistry([emitter("e1")]);
    const snapshot = takeSavedSnapshot(registry, saved);
    registry.update(emitter("e1", 1));
    registry.add(emitter("e2"));

    expect(restoreSavedSnapshot(registry, snapshot)).toBe(1);
    expect((registry.get("e1") as GeodesicEmitterObject).aimYawRadians).toBe(0);
    expect(registry.get("e2")).toBeDefined();
    expect(restoreSavedSnapshot(registry, snapshot)).toBe(0);
  });

  it("reports the saved kinds removed since the journal was cleared", () => {
    const registry = createRuntimeObjectRegistry([emitter("e1"), creature("m1")] as RuntimeWorldObject[]);
    registry.changes.clear();
    expect(savedKindsRemovedThisFrame(registry, saved)).toEqual([]);
    registry.remove("m1");
    expect(savedKindsRemovedThisFrame(registry, saved)).toEqual([]);
    registry.remove("e1");
    expect(savedKindsRemovedThisFrame(registry, saved)).toEqual(["geodesicEmitters/emitter"]);
  });
});
