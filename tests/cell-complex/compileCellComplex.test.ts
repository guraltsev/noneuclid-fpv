import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { cube, dodecahedron, genus2Torus, icosahedron, octahedron, tetrahedron, torus } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";
import { validateCellComplexSpec as validateAuthoringSpec } from "../../src/cell-complex/validateCellComplexSpec";
import {
  composeRigidTransform3,
  identityMat3,
  invertRigidTransform3,
  transformDirection3,
  transformPoint3,
} from "../../src/math/rigidTransform3";
import { almostEqualVec3, normalizeVec3, vec3 } from "../../src/math/vec3";

describe("compileCellComplex", () => {
  const triangleBase = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  it("preserves the visible prism cells from the starter world", () => {
    const compiled = compileCellComplex(twoPrismLoop);

    expect(compiled.cells.map((cell) => cell.id)).toEqual(["room-a", "room-b"]);
  });

  it("compiles the stage geometry examples", () => {
    const compiledTorus = compileCellComplex(torus);
    const compiledTetrahedron = compileCellComplex(tetrahedron);
    const compiledCube = compileCellComplex(cube);
    const compiledDodecahedron = compileCellComplex(dodecahedron);

    expect(compiledTorus.cells.map((cell) => cell.id)).toEqual(["torus-room"]);
    expect(compiledTetrahedron.cells).toHaveLength(4);
    expect(compiledCube.cells).toHaveLength(6);
    expect(compiledDodecahedron.cells).toHaveLength(12);
    expect(compiledDodecahedron.cells.every((cell) => cell.sideCount === 5)).toBe(true);
    expect(compiledDodecahedron.cells.every((cell) => cell.portals.length === 5)).toBe(true);
    expect(compiledDodecahedron.cells.reduce((total, cell) => total + cell.portals.length, 0)).toBe(60);
    expect(compiledCube.cells.every((cell) => cell.sideCount === 4)).toBe(true);
    expect(compiledCube.cellsById.get("front")?.objects).toHaveLength(3);
    expect(compiledCube.cells.every((cell) => cell.objects.length >= 1)).toBe(true);
  });

  it("keeps the tetrahedron example glued as four distinct tetrahedral vertices", () => {
    const vertexClasses = buildVertexClasses(tetrahedron);
    const quotientFaces = buildQuotientFaces(tetrahedron, vertexClasses);
    const quotientEdges = buildQuotientEdges(quotientFaces);

    expect(vertexClasses).toHaveLength(4);
    expect(vertexClasses.map((vertexClass) => vertexClass.length).sort((a, b) => a - b)).toEqual([3, 3, 3, 3]);
    expect(quotientFaces.map((face) => face.vertexClassIds).sort(compareStringArrays)).toEqual([
      ["q0", "q1", "q2"],
      ["q0", "q1", "q3"],
      ["q0", "q2", "q3"],
      ["q1", "q2", "q3"],
    ]);
    expect(quotientEdges).toEqual(["q0-q1", "q0-q2", "q0-q3", "q1-q2", "q1-q3", "q2-q3"]);
  });

  it("compiles portal lookups, side geometry, and forbidden zones for movement", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a");
    const eastPortal = roomA?.portalBySideIndex.get(1);

    expect(roomA?.isConvex).toBe(true);
    expect(eastPortal?.targetCellId).toBe("room-b");
    expect(roomA?.portalBySideIndex.get(1)?.id).toBe("side-1");
    expect(eastPortal?.reciprocalPortalId).toBe("side-3");
    expect(roomA?.sides).toHaveLength(4);
    expect(eastPortal?.transformToTarget.rotation).toEqual(identityMat3);
    expect(eastPortal?.transformToTarget.translation).toEqual({ x: -15, y: 0, z: 0 });
    expect(roomA?.forbiddenZones.map((zone) => zone.junctionId)).toEqual(["room-a:vertex-1", "room-a:vertex-2"]);
    expect(roomA?.singularityColumns.map((column) => column.junctionId)).toEqual([
      "room-a:vertex-1",
      "room-a:vertex-2",
    ]);
    expect(roomA?.singularityColumns[0]?.kind).toBe("invisible-cylinder");
    expect(roomA?.singularityColumns[0]?.radius).toBeCloseTo(0.15);
    expect(roomA?.singularityColumns[0]?.height).toBe(Infinity);
  });

  it("derives expected wraparound translations for the torus example", () => {
    const compiled = compileCellComplex(torus);
    const room = compiled.cellsById.get("torus-room");

    expect(room?.portalBySideIndex.get(0)?.transformToTarget.translation).toEqual({ x: 0, y: 15, z: 0 });
    expect(room?.portalBySideIndex.get(1)?.transformToTarget.translation).toEqual({ x: -15, y: 0, z: 0 });
    expect(room?.portalBySideIndex.get(2)?.transformToTarget.translation).toEqual({ x: 0, y: -15, z: 0 });
    expect(room?.portalBySideIndex.get(3)?.transformToTarget.translation).toEqual({ x: 15, y: 0, z: 0 });
  });

  it("derives seam-consistent compiled transforms for every example portal", () => {
    for (const world of [twoPrismLoop, torus, genus2Torus, cube, tetrahedron, octahedron, dodecahedron, icosahedron]) {
      const compiled = compileCellComplex(world);

      for (const cell of compiled.cells) {
        for (const portal of cell.portals) {
          const sourceSide = cell.sides[portal.sideIndex];
          const targetCell = compiled.cellsById.get(portal.targetCellId);
          const targetPortal = targetCell?.portalsById.get(portal.targetPortalId);

          expect(targetCell).toBeDefined();
          expect(targetPortal).toBeDefined();

          const targetSide = targetCell!.sides[targetPortal!.sideIndex];
          const sourceMidpoint = midpointOf(sourceSide);
          const targetMidpoint = midpointOf(targetSide);
          const sourceTangent = tangentOf(sourceSide);
          const targetTangent = tangentOf(targetSide);
          const sourceOutward = vec3(-sourceSide.inwardNormal.x, -sourceSide.inwardNormal.y, 0);
          const targetInward = vec3(targetSide.inwardNormal.x, targetSide.inwardNormal.y, 0);

          expect(almostEqualVec3(transformPoint3(portal.transformToTarget, sourceMidpoint), targetMidpoint)).toBe(true);
          expect(
            almostEqualVec3(
              normalizeVec3(transformDirection3(portal.transformToTarget, sourceTangent)),
              normalizeVec3(vec3(-targetTangent.x, -targetTangent.y, -targetTangent.z)),
            ),
          ).toBe(true);
          expect(
            almostEqualVec3(
              normalizeVec3(transformDirection3(portal.transformToTarget, sourceOutward)),
              normalizeVec3(targetInward),
            ),
          ).toBe(true);

          const roundTrip = composeRigidTransform3(targetPortal!.transformToTarget, portal.transformToTarget);

          expect(almostEqualVec3(roundTrip.translation, vec3(0, 0, 0))).toBe(true);
          expect(
            almostEqualVec3(
              transformPoint3(invertRigidTransform3(portal.transformToTarget), targetMidpoint),
              sourceMidpoint,
            ),
          ).toBe(true);
          expect(roundTrip.rotation.m00).toBeCloseTo(1);
          expect(roundTrip.rotation.m11).toBeCloseTo(1);
          expect(roundTrip.rotation.m22).toBeCloseTo(1);
        }
      }
    }
  });

  it("reports readable movement-critical authoring errors", () => {
    const errors = validateAuthoringSpec({
      cells: [
        {
          id: "room",
          heightMeters: 2,
          baseVertices: triangleBase,
          portals: [
            {
              id: "bad",
              sideIndex: 3,
              targetCellId: "missing",
              targetPortalId: "also-missing",
            },
            {
              id: "bad",
              sideIndex: 0,
              targetCellId: "room",
              targetPortalId: "bad",
            },
          ],
        },
        {
          id: "room",
          heightMeters: 2,
          baseVertices: triangleBase,
          portals: [],
        },
      ],
    });

    expect(errors).toContain('Duplicate cell id "room".');
    expect(errors).toContain('Cell "room" has duplicate portal id "bad".');
    expect(errors).toContain('Portal "room:bad" has sideIndex 3, expected 0-2.');
    expect(errors).toContain('Portal "room:bad" targets missing cell "missing".');
    expect(errors).toContain('Portal "room:bad" is not reciprocated by "room:bad".');
  });

  it("rejects non-convex and clockwise prism bases", () => {
    const nonConvexErrors = validateAuthoringSpec({
      cells: [
        {
          id: "non-convex",
          heightMeters: 2,
          baseVertices: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
          ],
          portals: [],
        },
      ],
    });
    const clockwiseErrors = validateAuthoringSpec({
      cells: [
        {
          id: "clockwise",
          heightMeters: 2,
          baseVertices: [
            { x: -1, y: -1 },
            { x: -1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: -1 },
          ],
          portals: [],
        },
      ],
    });

    expect(nonConvexErrors).toContain(
      'Cell "non-convex" must be strictly convex; non-convex prism cells are not supported.',
    );
    expect(clockwiseErrors).toContain(
      'Cell "clockwise" must list baseVertices in counterclockwise order in the x/y plane.',
    );
    expect(() =>
      compileCellComplex({
        cells: [
          {
            id: "non-convex",
            heightMeters: 2,
            baseVertices: [
              { x: 0, y: 0 },
              { x: 2, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 2 },
              { x: 0, y: 2 },
            ],
            portals: [],
          },
        ],
      }),
    ).toThrowError(/non-convex prism cells are not supported/);
  });
});

function midpointOf(side: { readonly start: { readonly x: number; readonly y: number }; readonly end: { readonly x: number; readonly y: number } }) {
  return vec3((side.start.x + side.end.x) / 2, (side.start.y + side.end.y) / 2, 0);
}

function tangentOf(side: { readonly start: { readonly x: number; readonly y: number }; readonly end: { readonly x: number; readonly y: number } }) {
  return normalizeVec3(vec3(side.end.x - side.start.x, side.end.y - side.start.y, 0));
}

function buildVertexClasses(world: { readonly cells: readonly { readonly id: string; readonly baseVertices: readonly unknown[]; readonly portals: readonly { readonly id: string; readonly sideIndex: number; readonly targetCellId: string; readonly targetPortalId: string }[] }[] }) {
  const parent = new Map<string, string>();
  const cellById = new Map(world.cells.map((cell) => [cell.id, cell]));
  const portalById = new Map<string, { readonly id: string; readonly sideIndex: number; readonly targetCellId: string; readonly targetPortalId: string }>();

  for (const cell of world.cells) {
    for (let vertexIndex = 0; vertexIndex < cell.baseVertices.length; vertexIndex += 1) {
      const key = vertexKey(cell.id, vertexIndex);
      parent.set(key, key);
    }

    for (const portal of cell.portals) {
      portalById.set(`${cell.id}:${portal.id}`, portal);
    }
  }

  for (const cell of world.cells) {
    for (const portal of cell.portals) {
      const targetCell = cellById.get(portal.targetCellId);
      const targetPortal = portalById.get(`${portal.targetCellId}:${portal.targetPortalId}`);

      expect(targetCell).toBeDefined();
      expect(targetPortal).toBeDefined();

      const sourceStart = vertexKey(cell.id, portal.sideIndex);
      const sourceEnd = vertexKey(cell.id, (portal.sideIndex + 1) % cell.baseVertices.length);
      const targetStart = vertexKey(portal.targetCellId, targetPortal!.sideIndex);
      const targetEnd = vertexKey(portal.targetCellId, (targetPortal!.sideIndex + 1) % targetCell!.baseVertices.length);

      unionVertex(parent, sourceStart, targetEnd);
      unionVertex(parent, sourceEnd, targetStart);
    }
  }

  const classes = new Map<string, string[]>();

  for (const key of parent.keys()) {
    const root = findVertexRoot(parent, key);
    const entries = classes.get(root);

    if (entries) {
      entries.push(key);
      continue;
    }

    classes.set(root, [key]);
  }

  return [...classes.values()];
}

function vertexKey(cellId: string, vertexIndex: number) {
  return `${cellId}:vertex-${vertexIndex}`;
}

function findVertexRoot(parent: Map<string, string>, key: string): string {
  const current = parent.get(key);

  if (!current) {
    throw new Error(`Missing vertex key "${key}".`);
  }

  if (current === key) {
    return current;
  }

  const root = findVertexRoot(parent, current);
  parent.set(key, root);
  return root;
}

function unionVertex(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = findVertexRoot(parent, left);
  const rightRoot = findVertexRoot(parent, right);

  if (leftRoot !== rightRoot) {
    parent.set(leftRoot, rightRoot);
  }
}

function buildQuotientFaces(
  world: { readonly cells: readonly { readonly id: string; readonly baseVertices: readonly unknown[] }[] },
  vertexClasses: readonly string[][],
) {
  const vertexClassIdByVertex = new Map<string, string>();
  const sortedVertexClasses = [...vertexClasses]
    .map((vertexClass) => [...vertexClass].sort())
    .sort(compareStringArrays);

  sortedVertexClasses.forEach((vertexClass, index) => {
    const quotientVertexId = `q${index}`;

    for (const vertex of vertexClass) {
      vertexClassIdByVertex.set(vertex, quotientVertexId);
    }
  });

  return world.cells.map((cell) => ({
    cellId: cell.id,
    vertexClassIds: cell.baseVertices
      .map((_, vertexIndex) => {
        const vertexClassId = vertexClassIdByVertex.get(vertexKey(cell.id, vertexIndex));

        if (!vertexClassId) {
          throw new Error(`Missing quotient vertex for "${vertexKey(cell.id, vertexIndex)}".`);
        }

        return vertexClassId;
      })
      .sort(),
  }));
}

function buildQuotientEdges(quotientFaces: readonly { readonly vertexClassIds: readonly string[] }[]) {
  const edges = new Set<string>();

  for (const face of quotientFaces) {
    for (let index = 0; index < face.vertexClassIds.length; index += 1) {
      const start = face.vertexClassIds[index];
      const end = face.vertexClassIds[(index + 1) % face.vertexClassIds.length];
      edges.add([start, end].sort().join("-"));
    }
  }

  return [...edges].sort();
}

function compareStringArrays(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const comparison = left[index].localeCompare(right[index]);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.length - right.length;
}
