/**
 * Selects the portal-clip eye and viewport once per rendered eye instead of once per mesh.
 * three renders an XR frame by calling `renderScene` once per persistent sub-camera of the XR `ArrayCamera`, in XR view
 * order, which is also the order of the per-eye portal render states. Every archetype mesh's `onBeforeRender` calls
 * `beforeMesh`; the activator remembers the last camera and does the work only when the camera changes (or after
 * `beginRender`, called from `scene.onBeforeRender`). The eye is identified by the camera's index in
 * `renderer.xr.getCamera().cameras`, falling back to the viewport centre when the camera is not one of them.
 * No allocation: the fallback reads the viewport into module-scope scratch objects.
 */
import * as THREE from "three";

/** Hooks the activator calls; `createThreeApp` supplies the portal-clip uniform updates. */
export interface PortalEyeActivatorDeps {
  /** `portalEyeRenderStates.length`. */
  getEyeCount(): number;
  /** Sets the active eye index and the clip texture row offset. */
  applyEye(eyeIndex: number): void;
  /** Reads the renderer's current viewport into the clip uniforms. */
  applyViewport(renderer: THREE.WebGLRenderer): void;
}

/** Per-render eye/viewport activation shared by every archetype mesh's `onBeforeRender`. */
export interface PortalEyeActivator {
  /** Call from scene.onBeforeRender: forgets the last camera so the next mesh re-applies eye and viewport. */
  beginRender(): void;
  /** Call from every archetype mesh's onBeforeRender; does nothing when renderCamera is the previous mesh's camera. */
  beforeMesh(renderer: THREE.WebGLRenderer, renderCamera: THREE.Camera): void;
}

const viewportScratch = new THREE.Vector4();
const drawingBufferScratch = new THREE.Vector2();

/** Creates an activator over `deps`. */
export function createPortalEyeActivator(deps: PortalEyeActivatorDeps): PortalEyeActivator {
  let lastCamera: THREE.Camera | undefined;

  function resolveEye(renderer: THREE.WebGLRenderer, renderCamera: THREE.Camera, eyeCount: number): number {
    if (eyeCount <= 1) {
      return 0;
    }

    if (renderer.xr.isPresenting) {
      const index = (renderer.xr.getCamera() as THREE.ArrayCamera).cameras.indexOf(renderCamera as THREE.PerspectiveCamera);

      if (index >= 0 && index < eyeCount) {
        return index;
      }
    }

    const viewport = renderer.getCurrentViewport(viewportScratch);
    const drawingBuffer = renderer.getDrawingBufferSize(drawingBufferScratch);

    if (drawingBuffer.x > 0 && viewport.z > 0) {
      const viewportCenterX = viewport.x + viewport.z / 2;
      return Math.min(eyeCount - 1, Math.max(0, Math.floor((viewportCenterX / drawingBuffer.x) * eyeCount)));
    }

    return 0;
  }

  return {
    beginRender() {
      lastCamera = undefined;
    },
    beforeMesh(renderer, renderCamera) {
      if (renderCamera === lastCamera) {
        return;
      }

      lastCamera = renderCamera;
      deps.applyEye(resolveEye(renderer, renderCamera, deps.getEyeCount()));
      deps.applyViewport(renderer);
    },
  };
}
