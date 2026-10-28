import { describe, expect, it } from "vitest";
import { worldCatalog } from "../../src/authoring/worldCatalog";
import {
  basicCube,
  basicTetrahedron,
  cube,
  dodecahedron,
  genus2Torus,
  icosahedron,
  octahedron,
  tetrahedron,
  torus,
  torusModuli,
} from "../../src/authoring/exampleWorlds";
import {
  defaultStartingQuestionCubeMessage,
  defaultStartingQuestionCubeTutorialPages,
} from "../../src/authoring/worldBuilder";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { getDynamicObjectCollisionBounds, simpleCylinderIntersectsSimpleCylinder } from "../../src/movement/collision";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { DEFAULT_PLAYER_HEIGHT_METERS, DEFAULT_PLAYER_RADIUS_METERS } from "../../src/movement/playerBody";
import { createDefaultPlayerPose, playerPoseToDynamicObject, type PlayerPose } from "../../src/movement/playerPose";
import { helpHubHomeGuidance } from "../../src/world-objects/helpHubCopy";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";

const exampleWorlds = [
  ["001-basic-cube", basicCube],
  ["002-basic-tetrahedron", basicTetrahedron],
  ["cube", cube],
  ["dodecahedron", dodecahedron],
  ["genus-2-torus", genus2Torus],
  ["icosahedron", icosahedron],
  ["octahedron", octahedron],
  ["tetrahedron", tetrahedron],
  ["torus", torus],
  ["torus-moduli", torusModuli],
] as const;

describe("example worlds", () => {
  it.each(exampleWorlds)("does not repeat object assets within %s", (_name, world) => {
    expect(repeatedObjectAssetPaths(world)).toEqual([]);
  });

  it("exposes every Platonic solid as a selectable world", () => {
    expect(worldCatalog.map((entry) => entry.id).sort()).toEqual([
      "001-basic-cube",
      "002-basic-tetrahedron",
      "cube",
      "dodecahedron",
      "genus-2-torus",
      "icosahedron",
      "octahedron",
      "tetrahedron",
      "torus",
      "torus-moduli",
    ]);
  });

  it("keeps the standard torus flat without a geometry computer", () => {
    const torusRoom = torus.cells.find((cell) => cell.id === "torus-room");
    const computer = torusRoom?.visuals?.objects?.find((object) => object.id === "torus-geometry-computer");

    expect(computer).toBeUndefined();
  });

  it("places a geometry computer in the torus moduli room", () => {
    const torusRoom = torusModuli.cells.find((cell) => cell.id === "torus-room");
    const computer = torusRoom?.visuals?.objects?.find((object) => object.id === "torus-geometry-computer");

    expect(computer).toMatchObject({
      kind: "asset",
      assetPath: "computerlarge/ComputerLarge.glb",
      class: "geometry-computer",
      collision: {
        radius: 1.035,
        height: 1.5525,
      },
    });
  });

  it("models the genus-2 torus as a paired octagon", () => {
    const octagon = genus2Torus.cells.find((cell) => cell.id === "genus-2-octagon");
    const vertexClasses = buildVertexClasses(genus2Torus);
    const quotientEdges = (octagon?.portals.length ?? 0) / 2;
    const eulerCharacteristic = vertexClasses.length - quotientEdges + genus2Torus.cells.length;

    expect(octagon?.baseVertices).toHaveLength(8);
    expect(octagon?.portals).toHaveLength(8);
    expect(octagon?.baseVertices[0]?.x).toBeCloseTo(66.519326);
    expect(octagon?.baseVertices[2]?.y).toBeCloseTo(66.519326);
    expect(vertexClasses).toHaveLength(1);
    expect(quotientEdges).toBe(4);
    expect(eulerCharacteristic).toBe(-2);
  });

  it("marks every genus-2 octagon side without a geometry computer", () => {
    const octagon = genus2Torus.cells.find((cell) => cell.id === "genus-2-octagon");
    const objectsById = new Map((octagon?.visuals?.objects ?? []).map((object) => [object.id, object]));
    const sideLandmarks = [
      ["genus-2-side-0-stop-sign", "sign", 51.85, 0],
      ["genus-2-side-1-tree", "tree", 36.95, 36.95],
      ["genus-2-side-2-bicycle", "bike", 0, 51.85],
      ["genus-2-side-3-flower-pot", "flower-pot", -36.95, 36.95],
      ["genus-2-side-4-campfire", "fire", -51.85, 0],
      ["genus-2-side-5-rocks", "rocks", -36.95, -36.95],
      ["genus-2-side-6-traffic-cone", "cone", 0, -51.85],
      ["genus-2-side-7-bench", "bench", 36.95, -36.95],
    ] as const;

    for (const [id, className, x, y] of sideLandmarks) {
      const object = objectsById.get(id);

      expect(object?.class).toBe(className);
      expect(object?.position.x).toBeCloseTo(x);
      expect(object?.position.y).toBeCloseTo(y);
    }
    expect(octagon?.visuals?.objects?.some((object) => object.class === "geometry-computer")).toBe(false);
    expect(octagon?.visuals?.objects?.some((object) => object.class === "decoration")).toBe(false);
  });

  it.each(exampleWorlds)("places the starter house and question cube in %s", (_name, world) => {
    const startCell = world.cells.find((cell) => cell.id === world.startingPosition?.cellId);
    const house = startCell?.visuals?.objects?.find((object) => object.id === "startingHouse");
    const questionCube = startCell?.visuals?.objects?.find((object) => object.id === "startingQuestionCube");

    expect(world.startingPosition).toMatchObject({
      position: {
        x: expect.any(Number),
        y: expect.any(Number),
        z: 0,
      },
      pitchRadians: 0,
    });
    expect(house).toMatchObject({
      kind: "asset",
      assetPath: "small_house/small_house.glb",
    });
    expect(questionCube).toMatchObject({
      kind: "asset",
      assetPath: "questionblock/questionBlock.glb",
      displayHelpMessage: defaultStartingQuestionCubeMessage,
      tutorialPages: defaultStartingQuestionCubeTutorialPages,
      goalPages: expect.arrayContaining([
        expect.objectContaining({
          title: "Goal",
          body: expect.any(String),
        }),
      ]),
    });
    expect(questionCube?.tutorialPages?.some((page) => page.body.includes(helpHubHomeGuidance))).toBe(true);
  });

  it("keeps tetrahedron faces equilateral so portal-glued corners align", () => {
    for (const cell of tetrahedron.cells) {
      const sideLengths = cell.baseVertices.map((start, index) => {
        const end = cell.baseVertices[(index + 1) % cell.baseVertices.length];
        return Math.hypot(end.x - start.x, end.y - start.y);
      });

      expect(sideLengths[0]).toBeCloseTo(sideLengths[1], 12);
      expect(sideLengths[1]).toBeCloseTo(sideLengths[2], 12);
    }
  });

  it.each(exampleWorlds)("keeps houses away from the starting player in %s", (_name, world) => {
    const startCell = world.cells[0];
    const playerBounds = getPlayerBounds(getStartPose(world, startCell.id));
    const collidingHouses: string[] = [];

    for (const object of startCell.visuals?.objects ?? []) {
      if (object.kind !== "asset" || object.assetPath !== "small_house/small_house.glb") {
        continue;
      }

      if (!object.collision) {
        throw new Error(`Expected house ${object.id} to have collision bounds.`);
      }

      const objectBounds = getDynamicObjectCollisionBounds({
        cellId: startCell.id,
        localPose: yawRigidTransform3(object.yawRadians ?? 0, object.position),
        collision: object.collision,
      });

      if (!objectBounds) {
        throw new Error(`Expected house ${object.id} collision bounds to compile.`);
      }

      if (simpleCylinderIntersectsSimpleCylinder(playerBounds, objectBounds)) {
        collidingHouses.push(object.id);
      }
    }

    expect(collidingHouses).toEqual([]);
  });

  it("keeps tetrahedron starter-neighborhood collisions away from the starting player", () => {
    const faceA = tetrahedron.cells.find((cell) => cell.id === "face-a");
    const mouse = faceA?.visuals?.objects?.find((object) => object.id === "face-a-geo-mouse");
    const playerBounds = getPlayerBounds(getStartPose(tetrahedron, "face-a"));

    expect(mouse?.kind).toBe("geo-mouse");
    expect(mouse?.collision).toEqual({
      radius: 0.42,
      height: 0.6,
      offset: { x: 0, y: 0.75, z: 0.31 },
    });

    if (!mouse?.collision) {
      throw new Error("Expected mouse and player collision bounds.");
    }

    const mouseBounds = getDynamicObjectCollisionBounds({
      cellId: "face-a",
      localPose: yawRigidTransform3(mouse.yawRadians ?? 0, { x: 0, y: 0, z: 0 }),
      collision: mouse.collision,
    });

    expect(mouseBounds).toBeDefined();
    expect(simpleCylinderIntersectsSimpleCylinder(playerBounds, mouseBounds!)).toBe(false);
  });

  it("keeps the tetrahedron stop sign at the corrected small scale", () => {
    const faceD = tetrahedron.cells.find((cell) => cell.id === "face-d");
    const stopSign = faceD?.visuals?.objects?.find((object) => object.id === "face-d-stop-sign");

    expect(stopSign?.kind).toBe("asset");
    expect(stopSign?.scale).toBeCloseTo(0.024);
  });
});

function repeatedObjectAssetPaths(world: CellComplexSpec): string[] {
  const counts = new Map<string, number>();

  for (const cell of world.cells) {
    for (const object of cell.visuals?.objects ?? []) {
      counts.set(object.assetPath, (counts.get(object.assetPath) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([assetPath]) => assetPath)
    .sort();
}

function getStartPose(world: CellComplexSpec, fallbackCellId: string): PlayerPose {
  return world.startingPosition
    ? {
        cellId: world.startingPosition.cellId,
        position: world.startingPosition.position,
        yawRadians: world.startingPosition.yawRadians ?? 0,
        pitchRadians: world.startingPosition.pitchRadians ?? 0,
      }
    : createDefaultPlayerPose(fallbackCellId);
}

function getPlayerBounds(playerPose: PlayerPose) {
  const playerBounds = getDynamicObjectCollisionBounds(
    playerPoseToDynamicObject(
      playerPose,
      simpleCollisionCylinder(DEFAULT_PLAYER_RADIUS_METERS, DEFAULT_PLAYER_HEIGHT_METERS, {
        x: 0,
        y: 0,
        z: DEFAULT_PLAYER_HEIGHT_METERS / 2,
      }),
    ),
  );

  if (!playerBounds) {
    throw new Error("Expected player collision bounds.");
  }

  return playerBounds;
}

function buildVertexClasses(world: CellComplexSpec) {
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

      if (!targetCell || !targetPortal) {
        throw new Error(`Missing target for portal "${cell.id}:${portal.id}".`);
      }

      unionVertex(parent, vertexKey(cell.id, portal.sideIndex), vertexKey(portal.targetCellId, (targetPortal.sideIndex + 1) % targetCell.baseVertices.length));
      unionVertex(parent, vertexKey(cell.id, (portal.sideIndex + 1) % cell.baseVertices.length), vertexKey(portal.targetCellId, targetPortal.sideIndex));
    }
  }

  const classes = new Map<string, string[]>();

  for (const key of parent.keys()) {
    const root = findVertexRoot(parent, key);
    classes.set(root, [...(classes.get(root) ?? []), key]);
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
