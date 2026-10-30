/**
 * Steady-state frame code must not construct Three math objects. `three` is replaced by subclasses that count
 * constructions; three's own internals import by relative path, so only our code is counted.
 * Pattern: call once (warm-up creates module-scope scratch), reset the counts, call again, expect zero.
 */
import { describe, expect, it, vi } from "vitest";

const counts = vi.hoisted(() => ({ Vector2: 0, Vector3: 0, Vector4: 0, Matrix4: 0, Quaternion: 0, Group: 0 }));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  function counting<T extends new (...args: any[]) => object>(Base: T, name: keyof typeof counts): T {
    return class extends Base {
      constructor(...args: any[]) {
        super(...args);
        counts[name] += 1;
      }
    };
  }
  return {
    ...actual,
    Vector2: counting(actual.Vector2, "Vector2"),
    Vector3: counting(actual.Vector3, "Vector3"),
    Vector4: counting(actual.Vector4, "Vector4"),
    Matrix4: counting(actual.Matrix4, "Matrix4"),
    Quaternion: counting(actual.Quaternion, "Quaternion"),
    Group: counting(actual.Group, "Group"),
  };
});

function resetCounts(): void {
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
    counts[key] = 0;
  }
}

import * as THREE from "three";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import {
  createPortalClipMaterialState,
  updatePortalClipMaterialViewportFromRenderer,
} from "../../src/render/three/portalClipMaterial";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import {
  createRootVisiblePortalPath,
  updateRuntimeObjectRenderArchetypeInstances,
} from "../../src/render/three/renderPortalInstances";
import {
  createRuntimeObjectRenderArchetypeDiagnostics,
  groupRuntimeObjectRenderRecordsByArchetype,
  type RuntimeObjectRenderArchetype,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { createGeodesicEmitterLabelController } from "../../src/render/three/geodesicEmitterLabelController";
import { createXrPortalEyeRenderRootTarget, resolveXrPortalEyeRenderRoot } from "../../src/render/three/xrPortalEye";
import { worldPointToThree } from "../../src/render/three/worldAxes";

describe("per-frame allocation", () => {
  it("reads the viewport into a scratch Vector4 and sets the uniforms in place", () => {
    const state = createPortalClipMaterialState(createPortalClipData({ maxVisiblePaths: 4, maxClipVerticesPerPath: 8 }), {
      width: 1,
      height: 1,
    });
    const renderer = {
      getCurrentViewport: (target: THREE.Vector4) => target.set(10, 20, 300, 400),
    } as unknown as THREE.WebGLRenderer;

    updatePortalClipMaterialViewportFromRenderer(state, renderer);
    resetCounts();
    updatePortalClipMaterialViewportFromRenderer(state, renderer);

    expect(counts.Vector4).toBe(0);
    expect(state.uniforms.portalViewportOriginPixels.value.toArray()).toEqual([10, 20]);
    expect(state.uniforms.portalViewportPixels.value.toArray()).toEqual([300, 400]);
  });

  it("resolves an eye root without allocating math objects", () => {
    const world = compileCellComplex(twoCellWorld());
    const anchorPoint = { x: 0.8, y: 0.8, z: 0 };
    const inside = eyeCamera(0.5, 0.5);
    const outside = eyeCamera(1.5, 0.5);
    const target = createXrPortalEyeRenderRootTarget();

    resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: inside, target });
    const warm = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: outside, target });
    expect(warm.rootCellId).toBe("b");
    resetCounts();

    resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: inside, target });
    expect(counts.Matrix4).toBe(0);
    expect(counts.Vector3).toBe(0);

    const second = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: outside, target });
    expect(second.rootCellId).toBe("b");
    expect(second.camera).toBe(warm.camera);
    expect(counts.Matrix4).toBe(0);
    expect(counts.Vector3).toBe(0);
  });

  it("writes runtime-object instances without allocating math objects", () => {
    const archetype = createArchetype("body", 4);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const recordsByKey = groupRuntimeObjectRenderRecordsByArchetype([
      { objectId: "o", cellId: "a", archetypeKey: "body", localMatrix: new THREE.Matrix4().makeTranslation(1, 0, 0) },
    ]);
    const paths = new Map([
      [
        "a",
        [
          createRootVisiblePortalPath("a"),
          {
            ...createRootVisiblePortalPath("a"),
            depth: 1,
            pathId: 2,
            rootFromDestinationMatrix: new THREE.Matrix4().makeTranslation(5, 0, 0),
          },
        ],
      ],
    ]);
    const clipIndexByPathId = new Map([[2, 0]]);
    const cameraPositions = [new THREE.Vector3(100, 0, 0)];
    const run = (): void =>
      updateRuntimeObjectRenderArchetypeInstances([archetype], recordsByKey, paths, diagnostics, clipIndexByPathId, {
        cameraPositions,
      });

    run();
    resetCounts();
    run();

    expect(archetype.mesh.count).toBe(2);
    expect(counts.Matrix4).toBe(0);
    expect(counts.Vector3).toBe(0);
  });

  it("updates geodesic emitter labels without allocating a Quaternion", () => {
    const camera = new THREE.PerspectiveCamera();
    const controller = createGeodesicEmitterLabelController({
      scene: new THREE.Scene(),
      camera,
      runtimeObjectRegistry: { getAll: () => [] } as never,
      geodesicEmitterLabelsByKey: new Map(),
      getPlayerPose: () => ({ cellId: "a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 }) as never,
      getRegistryVersion: () => 0,
    });

    controller.updateGeodesicEmitterLabels();
    resetCounts();
    controller.updateGeodesicEmitterLabels();

    expect(counts.Quaternion).toBe(0);
  });
});

function twoCellWorld(): CellComplexSpec {
  const square = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  return {
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: square,
        portals: [{ id: "east", sideIndex: 1, targetCellId: "b", targetPortalId: "west" }],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: square,
        portals: [{ id: "west", sideIndex: 3, targetCellId: "a", targetPortalId: "east" }],
      },
    ],
  };
}

function eyeCamera(x: number, y: number): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(70, 1, 0.001, 250);
  result.position.copy(worldPointToThree({ x, y, z: 1.6 }));
  result.lookAt(worldPointToThree({ x: x + 1, y, z: 1.6 }));
  result.updateMatrixWorld(true);
  return result;
}

function createArchetype(archetypeKey: string, capacity: number): RuntimeObjectRenderArchetype {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), capacity);
  const portalPathIdAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const portalClipIndexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  mesh.geometry.setAttribute("portalPathId", portalPathIdAttribute);
  mesh.geometry.setAttribute("portalClipIndex", portalClipIndexAttribute);
  return { archetypeKey, mesh, portalPathIdAttribute, portalClipIndexAttribute, capacity, sourceObjectId: "source" };
}
