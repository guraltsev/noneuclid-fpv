import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { getDynamicObjectCollisionBounds } from "../../src/movement/collision";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import {
  buildObjectCollisionWireframe,
  updateObjectCollisionWireframe,
  updateObjectCollisionWireframeInCellAxes,
} from "../../src/render/three/debugCollisionWireframes";
import { buildStaticObjectCollisionWireframeGroup } from "../../src/render/three/staticObjectCollisionWireframes";
import { applyWorldRigidTransform, worldPointToThree } from "../../src/render/three/worldAxes";
import { createRuntimeStaticAssetObject, runtimeObjectToDynamicObjectState } from "../../src/world-objects/runtimeObjectRegistry";
import { cube } from "../../src/authoring/exampleWorlds";

describe("debug collision wireframes", () => {
  it("draws object collision wireframes as runtime cylinders in cell axes", () => {
    const object: DynamicObjectState = {
      cellId: "room",
      localPose: yawRigidTransform3(Math.PI / 2, { x: 1, y: 2, z: 0.5 }),
      collision: simpleCollisionCylinder(0.25, 1),
    };
    const root = new THREE.Group();
    const wireframe = buildObjectCollisionWireframe("long-box", object);
    const positions = wireframe.geometry.getAttribute("position");

    root.add(wireframe);
    applyWorldRigidTransform(root, object.localPose);
    root.updateMatrixWorld(true);

    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    wireframe.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

    expect(wireframe).toBeInstanceOf(THREE.LineSegments);
    expect(positions.count).toBe(104);
    expect(worldPosition.x).toBeCloseTo(1);
    expect(worldPosition.y).toBeCloseTo(0.5);
    expect(worldPosition.z).toBeCloseTo(-2);
    expect(worldQuaternion.x).toBeCloseTo(0);
    expect(worldQuaternion.y).toBeCloseTo(0);
    expect(worldQuaternion.z).toBeCloseTo(0);
    expect(Math.abs(worldQuaternion.w)).toBeCloseTo(1);
    expect(worldScale.x).toBeCloseTo(0.5);
    expect(worldScale.y).toBeCloseTo(1);
    expect(worldScale.z).toBeCloseTo(0.5);
  });

  it("builds collision wireframes for static collidable assets such as the cube house", () => {
    const front = cube.cells.find((cell) => cell.id === "front");
    const house = front?.visuals?.objects?.find((object) => object.kind === "asset" && object.collision);

    expect(house?.kind).toBe("asset");
    if (!front || !house || house.kind !== "asset") {
      throw new Error("Expected cube front house fixture.");
    }

    const runtimeHouse = createRuntimeStaticAssetObject(house, front.id);
    const group = buildStaticObjectCollisionWireframeGroup(front.id, [runtimeHouse]);
    const wireframe = group?.getObjectByName(`object-collision-wireframe:${house.id}`);
    const expectedBounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(runtimeHouse));

    expect(group?.name).toBe("static-object-collision-wireframes:front");
    expect(wireframe).toBeInstanceOf(THREE.LineSegments);
    expect(expectedBounds).toBeDefined();
    expect(wireframe?.position).toEqual(worldPointToThree(expectedBounds!.center));
    expect(wireframe?.scale.x).toBeCloseTo(expectedBounds!.radius * 2);
    expect(wireframe?.scale.y).toBeCloseTo(expectedBounds!.halfHeight * 2);
    expect(wireframe?.scale.z).toBeCloseTo(expectedBounds!.radius * 2);
  });

  it("hides wireframes for objects without bounds and shows them again when bounds return", () => {
    const withBounds: DynamicObjectState = {
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      collision: simpleCollisionCylinder(0.25, 1),
    };
    const withoutBounds: DynamicObjectState = { ...withBounds, collision: undefined };

    for (const update of [updateObjectCollisionWireframe, updateObjectCollisionWireframeInCellAxes]) {
      const mesh = new THREE.Group();
      update(mesh, withoutBounds);
      expect(mesh.visible).toBe(false);
      update(mesh, withBounds);
      expect(mesh.visible).toBe(true);
    }
  });
});
