/**
 * Steady-state allocation of Three.js math objects in four per-frame render functions: selecting the clip eye,
 * resolving an XR portal-eye render root, writing runtime-object instances, and updating geodesic emitter labels.
 * Each is warmed up once (so module-scope scratch objects exist), then called many times while the process heap is
 * measured; the median bytes allocated per call should be near zero when the function reuses its scratch objects on
 * every frame instead of constructing new ones. A benchmark, not a test (_docs/tests.md §4.7): it prints a table for
 * a person to read and is never run by `npm test`.
 *
 *   npm run bench -- frameAllocations
 *
 * Measured by heap growth, not by mocking `three`: the `three` package builds as genuine ESM with frozen export
 * bindings, so its classes cannot be swapped for counting subclasses outside a module-mocking test runner (Vitest's
 * `vi.mock`, which only works inside a running Vitest worker, not a plain script).
 */
import * as THREE from "three";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { createGeodesicEmitterLabelController } from "../../src/render/three/geodesicEmitterLabelController";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import { createPortalClipMaterialState, updatePortalClipMaterialTextureEye } from "../../src/render/three/portalClipMaterial";
import {
  createRootVisiblePortalPath,
  updateRuntimeObjectRenderArchetypeInstances,
} from "../../src/render/three/renderPortalInstances";
import {
  createRuntimeObjectRenderArchetypeDiagnostics,
  groupRuntimeObjectRenderRecordsByArchetype,
  type RuntimeObjectRenderArchetype,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { createXrPortalEyeRenderRootTarget, resolveXrPortalEyeRenderRoot } from "../../src/render/three/xrPortalEye";

const iterationsPerTrial = 20_000;
const trials = 7;
const rows: string[] = ["function                                   median bytes/call"];

rows.push(formatRow("clip-eye select", measureBytesPerCall(clipEyeSelectCase())));
rows.push(formatRow("xr portal-eye root resolve", measureBytesPerCall(xrPortalEyeRootCase())));
rows.push(formatRow("runtime-object instance sync", measureBytesPerCall(runtimeObjectInstanceSyncCase())));
rows.push(formatRow("geodesic emitter label update", measureBytesPerCall(geodesicEmitterLabelCase())));

console.info(`\nper-frame allocation (${iterationsPerTrial} calls/trial, ${trials} trials)\n${rows.join("\n")}`);

function clipEyeSelectCase(): () => void {
  const state = createPortalClipMaterialState(createPortalClipData({ maxVisiblePaths: 4 }));
  let eye = 0;

  return () => {
    eye = eye === 0 ? 1 : 0;
    updatePortalClipMaterialTextureEye(state, eye);
  };
}

function xrPortalEyeRootCase(): () => void {
  const world = compileCellComplex(twoCellWorld());
  const anchorPoint = { x: 0.8, y: 0.8, z: 0 };
  const inside = eyeCamera(0.5, 0.5);
  const outside = eyeCamera(1.5, 0.5);
  const target = createXrPortalEyeRenderRootTarget();
  let useInside = true;

  // Warm-up: establish both root cells once before measuring.
  resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: inside, target });
  resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: outside, target });

  return () => {
    useInside = !useInside;
    resolveXrPortalEyeRenderRoot({ world, sourceCellId: "a", anchorPoint, camera: useInside ? inside : outside, target });
  };
}

function runtimeObjectInstanceSyncCase(): () => void {
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

  run(); // warm-up

  return run;
}

function geodesicEmitterLabelCase(): () => void {
  const controller = createGeodesicEmitterLabelController({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    runtimeObjectRegistry: { getAll: () => [] } as never,
    geodesicEmitterLabelsByKey: new Map(),
    getWorld: () => ({ cellsById: new Map() }) as never,
    getPlayerPose: () => ({ cellId: "a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 }) as never,
    getRegistryVersion: () => 0,
  });

  controller.updateGeodesicEmitterLabels(); // warm-up

  return () => controller.updateGeodesicEmitterLabels();
}

function measureBytesPerCall(run: () => void): number {
  const samples: number[] = [];

  for (let trial = 0; trial < trials; trial += 1) {
    forceGcIfAvailable();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterationsPerTrial; i += 1) {
      run();
    }

    const after = process.memoryUsage().heapUsed;
    samples.push((after - before) / iterationsPerTrial);
  }

  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function forceGcIfAvailable(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

function formatRow(label: string, bytesPerCall: number): string {
  return `${label.padEnd(42)} ${bytesPerCall.toFixed(1).padStart(10)}`;
}

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
