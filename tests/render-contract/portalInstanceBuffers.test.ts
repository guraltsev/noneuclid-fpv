import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CellRenderArchetype } from "../../src/render/three/cellRenderArchetypes";
import { createPortalInstanceDebugRenderer } from "../../src/render/three/portalInstanceDebug";
import {
  buildVisiblePathsByDestinationCell,
  createPortalInstanceDiagnostics,
  createPortalInstanceRenderDebugState,
  createRootVisiblePortalPath,
  groupVisiblePortalPathsByDestinationCell,
  unclippedPortalClipIndex,
  updateCellRenderArchetypeInstances,
} from "../../src/render/three/renderPortalInstances";

describe("updateCellRenderArchetypeInstances", () => {
  it("writes root and duplicate destination matrices, caps counts, and reports overflow", () => {
    const roomA = createArchetype("room-a", "room-a:floor:0", 1);
    const roomB = createArchetype("room-b", "room-b:floor:0", 1);
    const roomBWall = createArchetype("room-b", "room-b:wall:1", 1);
    const diagnostics = createPortalInstanceDiagnostics();
    const duplicateTransform = new THREE.Matrix4().makeTranslation(4, 0, 0);
    const visiblePaths = groupVisiblePortalPathsByDestinationCell([
      createRootVisiblePortalPath("room-a"),
      {
        ...createRootVisiblePortalPath("room-b"),
        pathId: 1,
      },
      {
        ...createRootVisiblePortalPath("room-b"),
        pathId: 2,
        rootFromDestinationMatrix: duplicateTransform,
      },
    ]);

    updateCellRenderArchetypeInstances([roomA, roomB, roomBWall], visiblePaths, diagnostics);

    expect(roomA.mesh.count).toBe(1);
    expect(roomB.mesh.count).toBe(1);
    expect(roomBWall.mesh.count).toBe(1);
    expect(readMatrix(roomA.mesh, 0)).toEqual(new THREE.Matrix4().elements);
    expect(readMatrix(roomB.mesh, 0)).toEqual(new THREE.Matrix4().elements);
    expect(readAttribute(roomA.portalPathIdAttribute, 0)).toBe(0);
    expect(readAttribute(roomA.portalClipIndexAttribute, 0)).toBe(unclippedPortalClipIndex);
    expect(readAttribute(roomB.portalPathIdAttribute, 0)).toBe(1);
    expect(diagnostics.capacityOverflowCount).toBe(2);
    expect(diagnostics.capacityOverflowArchetypes).toEqual(["room-b:floor:0", "room-b:wall:1"]);

    const debugState = createPortalInstanceRenderDebugState([roomA, roomB, roomBWall], visiblePaths, diagnostics, {
      enabled: true,
      showCellPathRendersInstances: true,
    });

    expect(debugState.ShowCellPathRendersInstances).toBe(true);
    expect(debugState.renderedInstanceCount).toBe(3);
    expect(debugState.renderedInstanceCountByCell).toEqual([
      { cellId: "room-a", count: 1 },
      { cellId: "room-b", count: 2 },
    ]);
  });

  it("builds visible destination buckets by intersecting kept path buckets with visible path ids", () => {
    const root = createRootVisiblePortalPath("room-a");
    const first = {
      ...createRootVisiblePortalPath("room-b"),
      pathId: 2,
      destinationCellId: "room-b",
    };
    const keptPathsByDestination = new Map([
      ["room-a", [{ id: 0, destinationCellId: "room-a" }]],
      [
        "room-b",
        [
          { id: 1, destinationCellId: "room-b" },
          { id: 2, destinationCellId: "room-b" },
        ],
      ],
    ]);
    const visiblePathById = new Map([
      [0, root],
      [2, first],
    ]);

    const grouped = buildVisiblePathsByDestinationCell(
      keptPathsByDestination as unknown as Parameters<typeof buildVisiblePathsByDestinationCell>[0],
      visiblePathById,
    );

    expect(grouped.get("room-a")?.map((path) => path.pathId)).toEqual([0]);
    expect(grouped.get("room-b")?.map((path) => path.pathId)).toEqual([2]);
  });

  it("writes portal path ids and clip indexes beside instance matrices", () => {
    const roomB = createArchetype("room-b", "room-b:floor:0", 2);
    const diagnostics = createPortalInstanceDiagnostics();
    const firstTransform = new THREE.Matrix4().makeTranslation(1, 0, 0);
    const secondTransform = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const visiblePaths = groupVisiblePortalPathsByDestinationCell([
      {
        ...createRootVisiblePortalPath("room-b"),
        depth: 1,
        pathId: 4,
        rootFromDestinationMatrix: firstTransform,
      },
      {
        ...createRootVisiblePortalPath("room-b"),
        depth: 1,
        pathId: 9,
        rootFromDestinationMatrix: secondTransform,
      },
    ]);

    updateCellRenderArchetypeInstances(
      [roomB],
      visiblePaths,
      diagnostics,
      new Map([
        [4, 0],
        [9, 1],
      ]),
    );

    expect(roomB.mesh.count).toBe(2);
    expect(readMatrix(roomB.mesh, 0)).toEqual(firstTransform.elements);
    expect(readMatrix(roomB.mesh, 1)).toEqual(secondTransform.elements);
    expect(readAttribute(roomB.portalPathIdAttribute, 0)).toBe(4);
    expect(readAttribute(roomB.portalPathIdAttribute, 1)).toBe(9);
    expect(readAttribute(roomB.portalClipIndexAttribute, 0)).toBe(0);
    expect(readAttribute(roomB.portalClipIndexAttribute, 1)).toBe(1);
  });
});

describe("createPortalInstanceDebugRenderer", () => {
  it("renders one debug instance per archetype for a selected cell and clears them on demand", () => {
    const scene = new THREE.Scene();
    const debugRenderer = createPortalInstanceDebugRenderer(scene, [
      createArchetype("room-a", "room-a:floor:0", 2),
      createArchetype("room-a", "room-a:wall:1", 2),
      createArchetype("room-b", "room-b:floor:0", 2),
    ]);

    const renderResult = debugRenderer.renderCellInstances(
      "room-a",
      new THREE.Matrix4().makeTranslation(1, 2, 3),
    );

    expect(renderResult.objectCount).toBe(2);
    expect(scene.getObjectByName("portal-instance-debug")?.children).toHaveLength(2);

    debugRenderer.clear();

    expect(scene.getObjectByName("portal-instance-debug")?.children).toHaveLength(0);
    debugRenderer.dispose();
  });
});

function createArchetype(cellId: string, archetypeId: string, capacity: number): CellRenderArchetype {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
    capacity,
  );
  mesh.count = 0;
  const portalPathIdAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const portalClipIndexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  mesh.geometry.setAttribute("portalPathId", portalPathIdAttribute);
  mesh.geometry.setAttribute("portalClipIndex", portalClipIndexAttribute);

  return {
    cellId,
    archetypeId,
    kind: "static-object",
    mesh,
    portalPathIdAttribute,
    portalClipIndexAttribute,
    capacity,
  };
}

function readMatrix(mesh: THREE.InstancedMesh, index: number): readonly number[] {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.elements;
}

function readAttribute(attribute: THREE.InstancedBufferAttribute, index: number): number {
  return attribute.getX(index);
}
