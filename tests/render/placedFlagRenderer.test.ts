/**
 * Placed-flag renderer (src/render/three/placedFlagRenderer.ts): renders a player-placed text sign as a glTF
 * model with the user's message rasterised onto two transparent planes over the sign board. Invariants: the
 * flag id and flag type of a runtime never change; `syncParent` re-parents the group under the root node of the
 * cell the flag now lives in.
 *
 * Prepared assets are faked by `tests/support/preparedAssets.ts` (a fake glTF with a named board/post mesh so the
 * board-finding heuristic has something to calibrate against); the canvas the text is drawn on is faked by
 * `tests/support/fakeCanvas2d.ts`.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { createPlacedFlagRuntime } from "../../src/render/three/placedFlagRenderer";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";
import { createFakePreparedAssets } from "../support/preparedAssets";

function fakeSignAssets() {
  const scene = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.72, 0.08));
  board.name = "fake-sign-board";
  board.position.set(0.2, 1.2, 0.045);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12));
  post.name = "fake-sign-post";
  post.position.set(-0.5, 0.9, 0);
  scene.add(board, post);

  return createFakePreparedAssets({
    getTexture: () => undefined,
    getConfiguredTexture: () => undefined,
    instantiateGltf: () => ({ scene, animations: [] }),
  });
}

describe("placedFlagRenderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places sign text on front and back planes centered on the sign board mesh", () => {
    const canvas = installFakeCanvas2d();
    const cellRoot = new THREE.Group();
    const runtime = createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "Hello",
    }), fakeSignAssets());

    runtime.syncParent(new Map([["room-a", cellRoot]]));

    const frontTextPlane = cellRoot.getObjectByName("placed-flag-text-plane:flag-a:front");
    const backTextPlane = cellRoot.getObjectByName("placed-flag-text-plane:flag-a:back");
    expect(runtime.root.parent).toBe(cellRoot);
    expect(runtime.cellId).toBe("room-a");
    expect(runtime.flagId).toBe("flag-a");
    expect(frontTextPlane).toBeDefined();
    expect(backTextPlane).toBeDefined();
    expect(frontTextPlane?.position.x).toBeCloseTo(-0.159);
    expect(frontTextPlane?.position.y).toBeCloseTo(0.9567);
    expect(frontTextPlane?.position.z).toBeCloseTo(-0.06375);
    expect(frontTextPlane?.rotation.y).toBeCloseTo(Math.PI);
    expect(backTextPlane?.position.x).toBeCloseTo(-0.159);
    expect(backTextPlane?.position.y).toBeCloseTo(0.9567);
    expect(backTextPlane?.position.z).toBeCloseTo(-0.00375);
    expect(backTextPlane?.rotation.y).toBeCloseTo(0);
    expect(frontTextPlane?.renderOrder).toBe(20);
    expect(backTextPlane?.renderOrder).toBe(20);
    expect((frontTextPlane as THREE.Mesh | undefined)?.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(canvas.height).toBe(256);
  });

  it("reparents when the runtime object changes cells", () => {
    installFakeCanvas2d();
    const roomA = new THREE.Group();
    const roomB = new THREE.Group();
    const runtime = createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "Hello",
    }), fakeSignAssets());

    runtime.syncParent(new Map([["room-a", roomA], ["room-b", roomB]]));
    runtime.syncFromObject(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-b",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "Hello",
    }));
    runtime.syncParent(new Map([["room-a", roomA], ["room-b", roomB]]));

    expect(runtime.root.parent).toBe(roomB);
    expect(runtime.cellId).toBe("room-b");
  });

  it("wraps and centers text in the calibrated writing area", () => {
    const canvas = installFakeCanvas2d();
    createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "ABCDEFGHIJKLMNO",
    }), fakeSignAssets());

    expect(canvas.context.fillStyle).toBe("#f8fafc");
    expect(canvas.context.textAlign).toBe("center");
    expect(canvas.context.textBaseline).toBe("middle");
    expect(canvas.context.font).toBe("bold 78px sans-serif");
    expect(canvas.context.fillText.mock.calls.map((call) => call[0])).toEqual(["ABCDEFGH", "IJKLMNO"]);
    expect(canvas.context.fillText.mock.calls.map((call) => call[1])).toEqual([256, 256]);
    expect(canvas.context.fillText.mock.calls[0][2]).toBeCloseTo(80);
    expect(canvas.context.fillText.mock.calls[1][2]).toBeCloseTo(176);
    expect(canvas.context.fillText.mock.calls.map((call) => call[3])).toEqual([512, 512]);
  });

  it("preserves explicit sign editor newlines as separate rendered lines", () => {
    const canvas = installFakeCanvas2d();
    createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "A\nB",
    }), fakeSignAssets());

    expect(canvas.context.fillText.mock.calls.map((call) => call[0])).toEqual(["A", "B"]);
  });
});
