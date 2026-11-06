/**
 * `tests/render/toolObjectRuntimes.test.ts` — unit tier.
 *
 * The runtimes of flags, lengths and angles follow the records written since the frame began, whoever wrote them: a new record gets a runtime, a record that is gone loses it. A hidden angle has none, and the writes of its countdown must not build one: a sync rebuilds a whole label.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { createToolObjectRuntimes } from "../../src/render/three/toolObjectRuntimes";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import { createProtractorAngleObject, vanishedAngleSeconds } from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { ProtractorAngleObject } from "../../src/world-objects/toolObjects";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";
import { createFakePreparedAssets } from "../support/preparedAssets";

const angle = createProtractorAngleObject({
  id: "angle",
  center: { objectId: "crossing", cellId: "a", point: { x: 1, y: 1, z: 1 }, geodesicIds: ["g-a", "g-b"] },
  first: { geodesicId: "g-a", segmentId: "segment-a", yawRadians: 0 },
  second: { geodesicId: "g-b", segmentId: "segment-b", yawRadians: Math.PI / 2 },
});

function setup() {
  installFakeCanvas2d();
  const registry = createRuntimeObjectRegistry();
  const placedFlagRuntimes = new Map();
  const protractorAngleRuntimes = new Map();
  const renderSources = new Map();
  const hitboxRequests = vi.fn();
  const runtimes = createToolObjectRuntimes({
    assets: createFakePreparedAssets(),
    runtimeObjectRegistry: registry,
    cellMeshes: new Map([["a", new THREE.Group()]]),
    placedFlagRuntimes,
    measuredGeodesicLengthRuntimes: new Map(),
    protractorAngleRuntimes,
    runtimeObjectRootsById: new Map(),
    runtimeObjectRenderSourcesByKey: renderSources,
    runtimeObjectRenderArchetypesByKey: new Map(),
    runtimeObjectRenderRoot: new THREE.Group(),
    syncSelectableHitboxDebug: hitboxRequests,
  });
  function frame(): void {
    runtimes.syncToolObjectRuntimesFromJournal();
    registry.changes.clear();
  }
  return { registry, placedFlagRuntimes, protractorAngleRuntimes, renderSources, hitboxRequests, frame };
}

describe("the runtimes of tool objects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follow a flag from the journal: added, changed, gone", () => {
    const { registry, placedFlagRuntimes, hitboxRequests, frame } = setup();
    const flag = createPlacedFlagObject({ id: "flag", cellId: "a", localPose: identityRigidTransform3, flagType: "WoodenSign1", message: "A1" });

    registry.add(flag);
    frame();
    expect(placedFlagRuntimes.has("flag")).toBe(true);
    expect(hitboxRequests).toHaveBeenCalledTimes(1);

    registry.update({ ...flag, message: "A2" });
    frame();
    expect(hitboxRequests).toHaveBeenCalledTimes(1);

    registry.remove("flag");
    frame();
    expect(placedFlagRuntimes.has("flag")).toBe(false);
    expect(hitboxRequests).toHaveBeenCalledTimes(2);
  });

  it("drop a hidden angle, build nothing for its countdown, and bring it back with its crossing", () => {
    const { registry, protractorAngleRuntimes, renderSources, hitboxRequests, frame } = setup();
    registry.add(angle);
    frame();
    expect(protractorAngleRuntimes.has("angle")).toBe(true);

    const hidden: ProtractorAngleObject = { ...angle, portalRenderable: false, vanishedSecondsLeft: vanishedAngleSeconds };
    registry.update(hidden);
    frame();
    expect(protractorAngleRuntimes.has("angle")).toBe(false);
    expect(hitboxRequests).toHaveBeenCalledTimes(2);

    const walks = vi.spyOn(renderSources, Symbol.iterator);
    registry.update({ ...hidden, vanishedSecondsLeft: 1 });
    frame();
    expect(protractorAngleRuntimes.has("angle")).toBe(false);
    expect(hitboxRequests).toHaveBeenCalledTimes(2);
    expect(walks).not.toHaveBeenCalled();

    registry.update(angle);
    frame();
    expect(protractorAngleRuntimes.has("angle")).toBe(true);
  });
});
