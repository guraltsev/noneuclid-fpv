/**
 * The focus outline and the Laser preview (src/render/three/focusOutline.ts, laserPreview.ts): the outline is one group in the focused object's cell root, tinted with the tool color and rebuilt only when the object or color changes; the preview stands at a floor target, points along the heading and hides otherwise.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { createFocusOutline } from "../../src/render/three/focusOutline";
import { createLaserPreview } from "../../src/render/three/laserPreview";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";

describe("createFocusOutline", () => {
  it("adds one tinted group to the cell root, keeps it for the same object and removes it", () => {
    const cellRoot = new THREE.Group();
    const outline = createFocusOutline(new Map([["room", cellRoot]]));
    const emitter = createGeodesicEmitterObject({ id: "emitter-a", cellId: "room", localPose: yawRigidTransform3(0, { x: 1, y: 0, z: 0 }) });

    outline.update(emitter, "#ff0000");
    expect(cellRoot.children).toHaveLength(1);
    const group = cellRoot.children[0];
    const mesh = group.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("ff0000");

    outline.update(emitter, "#ff0000");
    expect(cellRoot.children[0]).toBe(group);

    outline.update(emitter, "#00ff00");
    expect(cellRoot.children).toHaveLength(1);
    expect(cellRoot.children[0]).not.toBe(group);

    outline.update(undefined, "#00ff00");
    expect(cellRoot.children).toHaveLength(0);
    outline.dispose();
  });
});

describe("createLaserPreview", () => {
  const floorTarget = { kind: "floor", rootPoint: { x: 2, y: 3, z: 0 } } as AimTarget;

  it("stands at the floor target, turned to the heading, and hides without one", () => {
    const scene = new THREE.Scene();
    const preview = createLaserPreview(scene);

    preview.update(floorTarget, Math.PI / 2);
    expect(preview.root.visible).toBe(true);
    expect(preview.root.position.x).toBeCloseTo(2);
    expect(preview.root.position.z).toBeCloseTo(-3);
    expect(preview.root.rotation.y).toBeCloseTo(Math.PI / 2);

    preview.update({ ...floorTarget, kind: "object" } as AimTarget, 0);
    expect(preview.root.visible).toBe(false);
    preview.update(undefined, undefined);
    expect(preview.root.visible).toBe(false);
    preview.dispose();
  });
});
