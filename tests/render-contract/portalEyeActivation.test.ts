import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createPortalEyeActivator } from "../../src/render/three/portalEyeActivation";

function setup(eyeCount: number, viewport = [0, 0, 100, 100], drawingBufferWidth = 200) {
  const camL = new THREE.PerspectiveCamera();
  const camR = new THREE.PerspectiveCamera();
  const viewportTargets: THREE.Vector4[] = [];
  const renderer = {
    xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) },
    getCurrentViewport: vi.fn((target: THREE.Vector4) => {
      viewportTargets.push(target);
      return target.set(viewport[0], viewport[1], viewport[2], viewport[3]);
    }),
    getDrawingBufferSize: vi.fn((target: THREE.Vector2) => target.set(drawingBufferWidth, 100)),
  };
  const applyEye = vi.fn();
  const applyViewport = vi.fn();
  const activator = createPortalEyeActivator({ getEyeCount: () => eyeCount, applyEye, applyViewport });

  return { camL, camR, renderer: renderer as unknown as THREE.WebGLRenderer, rawRenderer: renderer, viewportTargets, applyEye, applyViewport, activator };
}

describe("createPortalEyeActivator", () => {
  it("applies each eye once, identified by its position among the XR cameras", () => {
    const { camL, camR, renderer, rawRenderer, applyEye, applyViewport, activator } = setup(2);

    activator.beginRender();
    for (let i = 0; i < 100; i += 1) {
      activator.beforeMesh(renderer, camL);
    }
    for (let i = 0; i < 100; i += 1) {
      activator.beforeMesh(renderer, camR);
    }

    expect(applyEye.mock.calls).toEqual([[0], [1]]);
    expect(applyViewport).toHaveBeenCalledTimes(2);
    expect(rawRenderer.getCurrentViewport).not.toHaveBeenCalled();
  });

  it("falls back to the viewport centre for an unknown camera, without allocating a new target", () => {
    const { renderer, rawRenderer, viewportTargets, applyEye, activator } = setup(2, [960, 0, 960, 1080], 1920);
    const unknown = new THREE.PerspectiveCamera();

    activator.beginRender();
    activator.beforeMesh(renderer, unknown);
    activator.beginRender();
    activator.beforeMesh(renderer, unknown);

    expect(applyEye.mock.calls).toEqual([[1], [1]]);
    expect(rawRenderer.getCurrentViewport).toHaveBeenCalledTimes(2);
    expect(viewportTargets[0]).toBe(viewportTargets[1]);
  });

  it("uses eye 0 once per render when there is a single eye", () => {
    const { camL, camR, renderer, applyEye, activator } = setup(1);

    activator.beginRender();
    activator.beforeMesh(renderer, camL);
    activator.beforeMesh(renderer, camL);
    expect(applyEye.mock.calls).toEqual([[0]]);

    activator.beforeMesh(renderer, camR);
    expect(applyEye.mock.calls).toEqual([[0], [0]]);
  });

  it("re-applies the same camera after beginRender", () => {
    const { camL, renderer, applyEye, applyViewport, activator } = setup(2);

    activator.beginRender();
    activator.beforeMesh(renderer, camL);
    activator.beginRender();
    activator.beforeMesh(renderer, camL);

    expect(applyEye).toHaveBeenCalledTimes(2);
    expect(applyViewport).toHaveBeenCalledTimes(2);
  });
});
