import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildVisiblePathsByDestinationCell,
  createRootVisiblePortalPath,
  flattenVisiblePortalPathGroups,
  updateRuntimeObjectRenderArchetypeInstances,
} from "../../src/render/three/renderPortalInstances";
import type { PortalRenderPath } from "../../src/cell-complex/portalPaths";
import {
  createRuntimeObjectRenderArchetypeDiagnostics,
  groupRuntimeObjectRenderRecordsByArchetype,
  type RuntimeObjectRenderArchetype,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import type { RuntimeObjectRenderRecord } from "../../src/render/three/runtimeObjectRenderRecords";

describe("updateRuntimeObjectRenderArchetypeInstances", () => {
  it("groups records by archetype and composes visible path matrices with record local matrices", () => {
    const archetype = createArchetype("mouse-body", 4);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const recordMatrix = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const pathMatrix = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "mouse-a",
        cellId: "room-b",
        archetypeKey: "mouse-body",
        localMatrix: recordMatrix,
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([
        [
          "room-b",
          [
            {
              ...createRootVisiblePortalPath("room-b"),
              depth: 1,
              pathId: 7,
              rootFromDestinationMatrix: pathMatrix,
            },
          ],
        ],
      ]),
      diagnostics,
      new Map([[7, 3]]),
    );

    expect(archetype.mesh.count).toBe(1);
    expect(readMatrix(archetype.mesh, 0)).toEqual(new THREE.Matrix4().multiplyMatrices(pathMatrix, recordMatrix).elements);
    expect(archetype.portalPathIdAttribute.getX(0)).toBe(7);
    expect(archetype.portalClipIndexAttribute.getX(0)).toBe(3);
    expect(diagnostics.capacityOverflowCount).toBe(0);
  });

  it("reports overflow when matching records and paths exceed archetype capacity", () => {
    const archetype = createArchetype("flag-text", 1);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "flag-a",
        cellId: "room-a",
        archetypeKey: "flag-text",
        localMatrix: new THREE.Matrix4(),
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([
        [
          "room-a",
          [
            createRootVisiblePortalPath("room-a"),
            {
              ...createRootVisiblePortalPath("room-a"),
              depth: 1,
              pathId: 2,
            },
          ],
        ],
      ]),
      diagnostics,
    );

    expect(archetype.mesh.count).toBe(1);
    expect(diagnostics.capacityOverflowCount).toBe(1);
    expect(diagnostics.capacityOverflowArchetypes).toEqual(["flag-text"]);
  });

  it("can omit a runtime object's root-cell instance while keeping portal copies", () => {
    const archetype = createArchetype("player-rover", 2);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const portalMatrix = new THREE.Matrix4().makeTranslation(4, 0, 0);
    const recordMatrix = new THREE.Matrix4().makeTranslation(1, 0, 0);
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "player-rover",
        cellId: "room-a",
        archetypeKey: "player-rover",
        localMatrix: recordMatrix,
        omitRootVisiblePath: true,
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([
        [
          "room-a",
          [
            createRootVisiblePortalPath("room-a"),
            {
              ...createRootVisiblePortalPath("room-a"),
              depth: 1,
              pathId: 3,
              rootFromDestinationMatrix: portalMatrix,
            },
          ],
        ],
      ]),
      diagnostics,
    );

    expect(archetype.mesh.count).toBe(1);
    expect(readMatrix(archetype.mesh, 0)).toEqual(new THREE.Matrix4().multiplyMatrices(portalMatrix, recordMatrix).elements);
    expect(archetype.portalPathIdAttribute.getX(0)).toBe(3);
    expect(diagnostics.capacityOverflowCount).toBe(0);
  });

  it("omits player source and ghost records from stereo root-cell paths", () => {
    const archetype = createArchetype("player-rover", 2);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "user-robot",
        cellId: "room-a",
        archetypeKey: "player-rover",
        localMatrix: new THREE.Matrix4(),
        omitRootVisiblePath: true,
      },
      {
        objectId: "user-robot",
        cellId: "room-b",
        archetypeKey: "player-rover",
        localMatrix: new THREE.Matrix4(),
        omitRootVisiblePath: true,
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([
        ["room-a", [createRootVisiblePortalPath("room-a")]],
        ["room-b", [createRootVisiblePortalPath("room-b")]],
      ]),
      diagnostics,
    );

    expect(archetype.mesh.count).toBe(0);
    expect(diagnostics.capacityOverflowCount).toBe(0);
  });

  it("suppresses records closer than their camera distance cutoff", () => {
    const archetype = createArchetype("player-rover", 2);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "user-robot",
        cellId: "room-a",
        archetypeKey: "player-rover",
        localMatrix: new THREE.Matrix4().makeTranslation(0.49, 0, 0),
        suppressWithinCameraDistanceMeters: 0.5,
      },
      {
        objectId: "user-robot",
        cellId: "room-a",
        archetypeKey: "player-rover",
        localMatrix: new THREE.Matrix4().makeTranslation(0.5, 0, 0),
        suppressWithinCameraDistanceMeters: 0.5,
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([["room-a", [createRootVisiblePortalPath("room-a")]]]),
      diagnostics,
      new Map(),
      { cameraPositions: [new THREE.Vector3(0, 0, 0)] },
    );

    expect(archetype.mesh.count).toBe(1);
    expect(readMatrix(archetype.mesh, 0)).toEqual(new THREE.Matrix4().makeTranslation(0.5, 0, 0).elements);
    expect(diagnostics.capacityOverflowCount).toBe(0);
  });

  it("suppresses portal-transformed robot records within two meters of the camera", () => {
    const archetype = createArchetype("player-rover", 2);
    const diagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
    const nearPortalMatrix = new THREE.Matrix4().makeTranslation(1.99, 0, 0);
    const farPortalMatrix = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const records: RuntimeObjectRenderRecord[] = [
      {
        objectId: "user-robot",
        cellId: "room-a",
        archetypeKey: "player-rover",
        localMatrix: new THREE.Matrix4(),
        suppressWithinCameraDistanceMeters: 2,
      },
    ];

    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      groupRuntimeObjectRenderRecordsByArchetype(records),
      new Map([
        [
          "room-a",
          [
            {
              ...createRootVisiblePortalPath("room-a"),
              depth: 1,
              pathId: 3,
              rootFromDestinationMatrix: nearPortalMatrix,
            },
            {
              ...createRootVisiblePortalPath("room-a"),
              depth: 1,
              pathId: 4,
              rootFromDestinationMatrix: farPortalMatrix,
            },
          ],
        ],
      ]),
      diagnostics,
      new Map(),
      { cameraPositions: [new THREE.Vector3(0, 0, 0)] },
    );

    expect(archetype.mesh.count).toBe(1);
    expect(readMatrix(archetype.mesh, 0)).toEqual(farPortalMatrix.elements);
    expect(archetype.portalPathIdAttribute.getX(0)).toBe(4);
    expect(diagnostics.capacityOverflowCount).toBe(0);
  });

  it("flattens statically-kept visible path groups for runtime object rendering", () => {
    const rootPath = createRootVisiblePortalPath("room-a");
    const portalPath = {
      ...createRootVisiblePortalPath("room-b"),
      pathId: 4,
      destinationCellId: "room-b",
      depth: 1,
    };
    const groups = buildVisiblePathsByDestinationCell(
      new Map<string, readonly PortalRenderPath[]>([
        ["room-a", [portalRenderPath("room-a", 0)]],
        ["room-b", [portalRenderPath("room-b", 4)]],
      ]),
      new Map([
        [rootPath.pathId, rootPath],
        [portalPath.pathId, portalPath],
      ]),
    );

    expect(flattenVisiblePortalPathGroups(groups).map((path) => path.destinationCellId)).toEqual([
      "room-a",
      "room-b",
    ]);
  });
});

function createArchetype(archetypeKey: string, capacity: number): RuntimeObjectRenderArchetype {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    capacity,
  );
  const portalPathIdAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const portalClipIndexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  mesh.geometry.setAttribute("portalPathId", portalPathIdAttribute);
  mesh.geometry.setAttribute("portalClipIndex", portalClipIndexAttribute);

  return {
    archetypeKey,
    mesh,
    portalPathIdAttribute,
    portalClipIndexAttribute,
    capacity,
    sourceObjectId: "source",
  };
}

function readMatrix(mesh: THREE.InstancedMesh, index: number): readonly number[] {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.elements;
}

function portalRenderPath(destinationCellId: string, id: number): PortalRenderPath {
  const identity = {
    rotation: {
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: 0,
      m20: 0,
      m21: 0,
      m22: 1,
    },
    translation: { x: 0, y: 0, z: 0 },
  };
  return {
    id,
    rootCellId: "room-a",
    destinationCellId,
    depth: id === 0 ? 0 : 1,
    steps: [],
    destinationFromRoot: identity,
    rootFromDestination: identity,
  };
}
