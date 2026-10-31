import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";
import { createPlacedFlagRuntime } from "../../src/render/three/placedFlagRenderer";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";

describe("placedFlagRenderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places sign text on front and back planes centered on the sign board mesh", () => {
    const canvas = installCanvasDocumentShim();
    const cellRoot = new THREE.Group();
    const runtime = createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "Hello",
    }), createPreparedAssets());

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
    installCanvasDocumentShim();
    const roomA = new THREE.Group();
    const roomB = new THREE.Group();
    const runtime = createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "Hello",
    }), createPreparedAssets());

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
    const canvas = installCanvasDocumentShim();
    createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "ABCDEFGHIJKLMNO",
    }), createPreparedAssets());

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
    const canvas = installCanvasDocumentShim();
    createPlacedFlagRuntime(createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "A\nB",
    }), createPreparedAssets());

    expect(canvas.context.fillText.mock.calls.map((call) => call[0])).toEqual(["A", "B"]);
  });
});

function createPreparedAssets(): PreparedWorldAssets {
  return {
    getTexture: () => undefined,
    getConfiguredTexture: () => undefined,
    instantiateGltf() {
      const scene = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.72, 0.08));
      board.name = "fake-sign-board";
      board.position.set(0.2, 1.2, 0.045);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12));
      post.name = "fake-sign-post";
      post.position.set(-0.5, 0.9, 0);
      scene.add(board, post);

      return {
        scene,
        animations: [],
      };
    },
  };
}

function installCanvasDocumentShim(): {
    readonly context: {
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly fillText: ReturnType<typeof vi.fn>;
    readonly measureText: (text: string) => { readonly width: number };
    fillStyle: string;
    font: string;
    textAlign: string;
    textBaseline: string;
  };
  height: number;
  width: number;
} {
  const canvas = {
    width: 0,
    height: 0,
    context: {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 60 })),
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
    },
    getContext() {
      return this.context;
    },
  };

  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "canvas") {
        throw new Error(`Unexpected element: ${tagName}`);
      }

      return canvas;
    },
  });
  return canvas;
}
