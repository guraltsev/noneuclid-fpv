import { describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import {
  createRuntimeObjectRegistry,
  createRuntimeStaticAssetObject,
  type RuntimeCreatureObject,
} from "../../src/world-objects/runtimeObjectRegistry";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createSegment } from "./geodesic/fixtures";
import { userObjectClass } from "../../src/world-objects/library";

function creature(id: string, cellId: string, extra: Partial<RuntimeCreatureObject> = {}): RuntimeCreatureObject {
  return {
    id,
    kind: "geo-mouse",
    cellId,
    localPose: identityRigidTransform3,
    portalRenderable: true,
    ...extra,
  };
}

function emitter(id: string, cellId: string, extra: Partial<GeodesicCannonObject> = {}): GeodesicCannonObject {
  return {
    id,
    kind: "geodesic-cannon",
    cellId,
    localPose: identityRigidTransform3,
    portalRenderable: true,
    geodesicIds: [],
    aimYawRadians: 0,
    ...extra,
  };
}

describe("runtimeObjectRegistry", () => {
  it("adds objects by id and indexes them under their cell", () => {
    const registry = createRuntimeObjectRegistry();
    const object = creature("mouse-a", "cell-a");

    registry.add(object);

    expect(registry.get("mouse-a")).toBe(object);
    expect(registry.getObjectsInCell("cell-a")).toEqual([object]);
  });

  it("moving an object updates old and new cell indexes", () => {
    const registry = createRuntimeObjectRegistry([creature("mouse-a", "cell-a")]);

    const moved = registry.moveToCell("mouse-a", "cell-b");

    expect(moved?.cellId).toBe("cell-b");
    expect(registry.getObjectsInCell("cell-a")).toEqual([]);
    expect(registry.getObjectsInCell("cell-b").map((object) => object.id)).toEqual(["mouse-a"]);
  });

  it("removing an object clears id and cell indexes", () => {
    const registry = createRuntimeObjectRegistry([creature("mouse-a", "cell-a")]);

    registry.remove("mouse-a");

    expect(registry.get("mouse-a")).toBeUndefined();
    expect(registry.getObjectsInCell("cell-a")).toEqual([]);
  });

  it("filters collidable and interactable objects", () => {
    const collidable = creature("mouse-a", "cell-a", { collision: simpleCollisionCylinder(0.5, 1) });
    const interactable = creature("mouse-b", "cell-a", {
      interactable: { label: "Edit", action: "edit-flag" },
    });
    const registry = createRuntimeObjectRegistry([collidable, interactable, creature("mouse-c", "cell-a")]);

    expect(registry.getCollidableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a"]);
    expect(registry.getInteractableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-b"]);
  });

  it("excludes geodesic emitters from player-blocking collisions while keeping other colliders", () => {
    const blocker = creature("mouse-a", "cell-a", { collision: simpleCollisionCylinder(0.5, 1) });
    const nonBlockingEmitter = emitter("emitter-a", "cell-a", { collision: simpleCollisionCylinder(0.3, 1.25) });
    const registry = createRuntimeObjectRegistry([blocker, nonBlockingEmitter]);

    expect(registry.getCollidableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a", "emitter-a"]);
    expect(registry.getPlayerBlockingObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a"]);
  });

  it("excludes objects that opt out of colliding with the user", () => {
    const blocker = creature("mouse-a", "cell-a", { collision: simpleCollisionCylinder(0.5, 1) });
    const softDecoration = creature("mouse-b", "cell-a", {
      collision: simpleCollisionCylinder(0.5, 1),
      class: "decoration",
      do_not_collide_with: [userObjectClass],
    });
    const registry = createRuntimeObjectRegistry([blocker, softDecoration]);

    expect(registry.getCollidableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a", "mouse-b"]);
    expect(registry.getPlayerBlockingObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a"]);
  });

  it("finds tooltip-capable objects from either tooltip metadata or interaction data", () => {
    const labelled = creature("mouse-a", "cell-a", {
      tooltip: { label: "geodesic mouse" },
    });
    const interactable = creature("mouse-b", "cell-a", {
      interactable: { label: "Edit", action: "edit-flag" },
    });
    const registry = createRuntimeObjectRegistry([labelled, interactable, creature("mouse-c", "cell-a")]);

    expect(registry.getTooltipObjectsInCell("cell-a").map((object) => object.id)).toEqual(["mouse-a", "mouse-b"]);
  });

  it("marks geometry-computer static assets as tooltip-capable interactables", () => {
    const computer = createRuntimeStaticAssetObject({
      id: "computer-a",
      kind: "asset",
      assetPath: "computerlarge/ComputerLarge.glb",
      position: { x: 0, y: 0, z: 0 },
      class: "geometry-computer",
      collision: {
        radius: 0.9,
        height: 1.35,
      },
    }, "cell-a");
    const registry = createRuntimeObjectRegistry([computer]);

    expect(computer.tooltip).toEqual({
      label: "Geometry computer",
      rangeMeters: 3,
    });
    expect(computer.interactable).toEqual({
      label: "World deformation",
      action: "open-geometry-computer",
      rangeMeters: 3,
    });
    expect(registry.getInteractableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["computer-a"]);
    expect(registry.getTooltipObjectsInCell("cell-a").map((object) => object.id)).toEqual(["computer-a"]);
  });

  it("marks help hub assets as primary read interactables", () => {
    const questionCube = createRuntimeStaticAssetObject({
      id: "question-a",
      kind: "asset",
      assetPath: "questionblock/questionBlock.glb",
      position: { x: 0, y: 0, z: 0 },
      class: "question-cube",
      tutorialPages: [{ title: "Move", body: "Use arrows." }],
    }, "cell-a");
    const registry = createRuntimeObjectRegistry([questionCube]);

    expect(questionCube.tooltip).toEqual({
      label: "Help hub",
      rangeMeters: 2.5,
    });
    expect(questionCube.interactable).toEqual({
      label: "Read",
      action: "open-tutorial",
      rangeMeters: 2.5,
    });
    expect(questionCube.autoDisplayHelpRangeMeters).toBeUndefined();
    expect(registry.getInteractableObjectsInCell("cell-a").map((object) => object.id)).toEqual(["question-a"]);
    expect(registry.getTooltipObjectsInCell("cell-a").map((object) => object.id)).toEqual(["question-a"]);
  });

  it("rejects writes to an owned id except through its publisher", () => {
    const registry = createRuntimeObjectRegistry([creature("mouse-a", "cell-a")]);
    const publish = registry.claimOwnership("mouse-a");

    expect(() => registry.update(creature("mouse-a", "cell-b"))).toThrow(/is owned; use its owner/);
    expect(() => registry.moveToCell("mouse-a", "cell-b")).toThrow(/is owned; use its owner/);
    expect(() => registry.remove("mouse-a")).toThrow(/is owned; use its owner/);

    publish(creature("mouse-a", "cell-b"));
    expect(registry.getObjectsInCell("cell-a")).toEqual([]);
    expect(registry.getObjectsInCell("cell-b").map((object) => object.id)).toEqual(["mouse-a"]);
    expect(() => publish(creature("mouse-z", "cell-b"))).toThrow(/cannot write/);
  });

  it("claiming an unknown or already claimed id throws, and release restores writes", () => {
    const registry = createRuntimeObjectRegistry([creature("mouse-a", "cell-a")]);

    expect(() => registry.claimOwnership("ghost")).toThrow(/missing/);
    registry.claimOwnership("mouse-a");
    expect(() => registry.claimOwnership("mouse-a")).toThrow(/already owned/);

    registry.releaseOwnership("mouse-a");
    registry.update(creature("mouse-a", "cell-c"));
    expect(registry.get("mouse-a")!.cellId).toBe("cell-c");
  });

  it("indexes objects by kind and segments by geodesic", () => {
    const segment = (id: string, geodesicId: string, segmentIndex: number) =>
      createSegment({ id, geodesicId, segmentIndex });
    const registry = createRuntimeObjectRegistry([
      emitter("e1", "a"),
      segment("s1", "g1", 0),
      creature("mouse-a", "a"),
      segment("s2", "g1", 1),
      emitter("e2", "a"),
      segment("s3", "g2", 0),
    ]);

    expect(registry.getObjectsOfKind("geodesic-cannon").map((object) => object.id)).toEqual(["e1", "e2"]);
    expect(registry.getSegmentsOfGeodesic("g1").map((object) => object.id).sort()).toEqual(["s1", "s2"]);
    expect(registry.getObjectsOfKind("asset")).toEqual([]);
    expect(registry.getSegmentsOfGeodesic("unknown")).toEqual([]);

    registry.update(segment("s1", "g2", 1));
    expect(registry.getSegmentsOfGeodesic("g1").map((object) => object.id)).toEqual(["s2"]);
    expect(registry.getSegmentsOfGeodesic("g2").map((object) => object.id).sort()).toEqual(["s1", "s3"]);

    registry.remove("s1");
    expect(registry.getSegmentsOfGeodesic("g2").map((object) => object.id)).toEqual(["s3"]);
    expect(registry.getObjectsOfKind("geodesic-segment").map((object) => object.id).sort()).toEqual(["s2", "s3"]);

    registry.moveToCell("e1", "b");
    registry.moveToCell("s2", "b");
    expect(registry.getObjectsOfKind("geodesic-cannon").map((object) => object.id)).toEqual(["e1", "e2"]);
    expect(registry.getSegmentsOfGeodesic("g1").map((object) => object.cellId)).toEqual(["b"]);
  });

  it("an ownership publisher re-indexes the same way as update", () => {
    const registry = createRuntimeObjectRegistry([creature("mouse-a", "cell-a"), emitter("e1", "cell-a")]);
    const publish = registry.claimOwnership("mouse-a");

    publish(creature("mouse-a", "cell-b"));
    publish({ ...creature("mouse-a", "cell-b"), kind: "geo-butterfly" });

    expect(registry.getObjectsInCell("cell-a").map((object) => object.id)).toEqual(["e1"]);
    expect(registry.getObjectsInCell("cell-b").map((object) => object.id)).toEqual(["mouse-a"]);
    expect(registry.getObjectsOfKind("geo-mouse")).toEqual([]);
    expect(registry.getObjectsOfKind("geo-butterfly").map((object) => object.id)).toEqual(["mouse-a"]);
  });

  describe("version", () => {
    it("counts each content change exactly once", () => {
      const registry = createRuntimeObjectRegistry();
      expect(registry.getVersion()).toBe(0);
      registry.add(creature("a", "cell-a"));
      expect(registry.getVersion()).toBe(1);
      registry.update(creature("a", "cell-a", { portalRenderable: false }));
      expect(registry.getVersion()).toBe(2);
      registry.moveToCell("a", "cell-b");
      expect(registry.getVersion()).toBe(3);
      registry.remove("a");
      expect(registry.getVersion()).toBe(4);
      registry.remove("a");
      expect(registry.getVersion()).toBe(4);
      expect(() => registry.update(creature("missing", "cell-a"))).toThrow();
      expect(registry.getVersion()).toBe(4);
    });

    it("is not changed by reads and counts the initial list", () => {
      const registry = createRuntimeObjectRegistry([creature("a", "c"), creature("b", "c"), creature("d", "c")]);
      expect(registry.getVersion()).toBe(3);
      registry.get("a");
      registry.getAll();
      registry.getObjectsInCell("c");
      expect(registry.getVersion()).toBe(3);
    });

    it("counts owner publishes but not claim, release or rejected writes", () => {
      const registry = createRuntimeObjectRegistry([creature("a", "c")]);
      const publish = registry.claimOwnership("a");
      expect(registry.getVersion()).toBe(1);
      publish(creature("a", "c", { portalRenderable: false }));
      expect(registry.getVersion()).toBe(2);
      expect(() => registry.update(creature("a", "c"))).toThrow();
      expect(registry.getVersion()).toBe(2);
      registry.releaseOwnership("a");
      expect(registry.getVersion()).toBe(2);
    });
  });
});