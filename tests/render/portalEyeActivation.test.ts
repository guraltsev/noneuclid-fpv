/**
 * Portal-clip eye activation (src/render/three/portalEyeActivation.ts): selects the active portal-clip eye once
 * per rendered eye rather than once per mesh, since three.js calls every archetype mesh's `onBeforeRender` for
 * every mesh of every eye. The eye is identified by the render camera's position in `renderer.xr.getCamera()`'s
 * camera list (XR view order), falling back to the viewport centre for a camera that is not one of them, without
 * allocating a new viewport target on the fallback path.
 *
 * The renderer is faked by tests/support/fakeRenderer.ts.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createPortalEyeActivator } from "../../src/render/three/portalEyeActivation";
import { createFakeRenderer } from "../support/fakeRenderer";

function setup(eyeCount: number, viewport: readonly [number, number, number, number] = [0, 0, 100, 100], drawingBufferWidth = 200) {
  const camL = new THREE.PerspectiveCamera();
  const camR = new THREE.PerspectiveCamera();
  const renderer = createFakeRenderer({
    xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) },
    viewport,
    drawingBufferSize: { width: drawingBufferWidth, height: 100 },
  });
  const applyEye = vi.fn();
  const applyViewport = vi.fn();
  const activator = createPortalEyeActivator({ getEyeCount: () => eyeCount, applyEye, applyViewport });

  return { camL, camR, renderer, applyEye, applyViewport, activator };
}

describe("createPortalEyeActivator", () => {
  it("applies each eye once, identified by its position among the XR cameras", () => {
    const { camL, camR, renderer, applyEye, applyViewport, activator } = setup(2);

    activator.beginRender();
    for (let i = 0; i < 100; i += 1) {
      activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camL);
    }
    for (let i = 0; i < 100; i += 1) {
      activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camR);
    }

    expect(applyEye.mock.calls).toEqual([[0], [1]]);
    expect(applyViewport).toHaveBeenCalledTimes(2);
    expect(renderer.getCurrentViewport).not.toHaveBeenCalled();
  });

  it("falls back to the viewport centre for an unknown camera, without allocating a new target", () => {
    const { renderer, applyEye, activator } = setup(2, [960, 0, 960, 1080], 1920);
    const unknown = new THREE.PerspectiveCamera();

    activator.beginRender();
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, unknown);
    activator.beginRender();
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, unknown);

    expect(applyEye.mock.calls).toEqual([[1], [1]]);
    expect(renderer.getCurrentViewport).toHaveBeenCalledTimes(2);
    const targets = renderer.getCurrentViewport.mock.calls.map(([target]) => target);
    expect(targets[0]).toBe(targets[1]);
  });

  it("uses eye 0 once per render when there is a single eye", () => {
    const { camL, camR, renderer, applyEye, activator } = setup(1);

    activator.beginRender();
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camL);
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camL);
    expect(applyEye.mock.calls).toEqual([[0]]);

    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camR);
    expect(applyEye.mock.calls).toEqual([[0], [0]]);
  });

  it("re-applies the same camera after beginRender", () => {
    const { camL, renderer, applyEye, applyViewport, activator } = setup(2);

    activator.beginRender();
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camL);
    activator.beginRender();
    activator.beforeMesh(renderer as unknown as THREE.WebGLRenderer, camL);

    expect(applyEye).toHaveBeenCalledTimes(2);
    expect(applyViewport).toHaveBeenCalledTimes(2);
  });
});
