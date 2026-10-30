import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { cube, icosahedron, tetrahedron } from "../../src/authoring/exampleWorlds";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import {
  composeRigidTransform3,
  identityMat3,
  orthonormalizeYawRigidTransform3,
  transformDirection3,
  yawRigidTransform3,
  type RigidTransform3,
} from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { collectGeodesicCreatureDebugDump } from "../../src/render/three/geodesicCreatureDebug";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createObjectHost } from "../../src/world-objects/worldObjectOwner";
import {
  applyForbiddenZoneSideRule,
  geodesicSideOfPoint,
  createSimpleGeoCreature,
  createSimpleGeoCreatureRuntime,
  forbiddenZoneLateralOscillationScale,
} from "../../src/world-objects/simpleGeoCreature";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("simple geo creature movement", () => {
  it("keeps lateral oscillation bounded instead of accumulating sideways drift", () => {
    const world = compileCellComplex(singleRoom());
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0.5, 0],
      scale: 0.1,
      speed: 0,
      oscillationRate: 1,
      oscillationMagnitude: 0.2,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets());

    runtime.update(world, 0.25);
    expect(runtime.root.position.x).toBeCloseTo(0.2);

    runtime.update(world, 0.25);
    expect(runtime.root.position.x).toBeCloseTo(0);
  });

  it("scales only sideways delta while lateral oscillation is stopped near a forbidden zone", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0.25, 0.5, 1],
      scale: 0.1,
      speed: 0,
      oscillationRate: 1,
      oscillationMagnitude: 0.2,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room-a", stubAssets());

    runtime.update(world, 0.25);
    expect(runtime.root.position.x).toBeCloseTo(0.25);

    runtime.update(world, 0.25);
    expect(runtime.root.position.x).toBeCloseTo(0.25);
  });

  it("stops lateral oscillation within 50cm of a forbidden zone", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const cell = world.cellsById.get("room-a");

    if (!cell) {
      throw new Error("Expected room-a.");
    }

    expect(forbiddenZoneLateralOscillationScale(cell, dynamicObject({ x: 0.25, y: 1, z: 0.5 }))).toBe(0);
  });

  it("interpolates lateral oscillation between 50cm and 1m from a forbidden zone", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const cell = world.cellsById.get("room-a");

    if (!cell) {
      throw new Error("Expected room-a.");
    }

    expect(forbiddenZoneLateralOscillationScale(cell, dynamicObject({ x: 0, y: 1, z: 0.5 }))).toBeCloseTo(0.5);
    expect(forbiddenZoneLateralOscillationScale(cell, dynamicObject({ x: -0.25, y: 1, z: 0.5 }))).toBe(1);
  });

  it("keeps a tetrahedron creature inside its runtime cell across repeated portal crossings", () => {
    const world = compileCellComplex(tetrahedron);
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [-2.2, 0, 2.2],
      scale: 0.1,
      turn: 114,
      speed: 1.7,
      oscillationRate: 1.4,
      oscillationMagnitude: 0.15,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "face-a", stubAssets(), registry);
    const cellRoots = new Map<string, THREE.Object3D>(
      world.cells.map((cell) => [cell.id, new THREE.Group()] as const),
    );

    runtime.syncParent(cellRoots);

    for (let frame = 0; frame < 900; frame += 1) {
      runtime.update(world, 1 / 30);
      runtime.syncParent(cellRoots);

      const dump = collectGeodesicCreatureDebugDump({
        world,
        runtimes: [runtime],
        registry,
        cellRoots,
      });

      expect(dump.issueCount, `frame ${frame}: ${JSON.stringify(dump.records[0])}`).toBe(0);
    }
  });

  it("lets a mouse ignore collidable static runtime objects", () => {
    const world = compileCellComplex(singleRoom());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      speed: 1,
      collision: {
        radius: 0.25,
        height: 0.4,
        offset: { x: 0, y: 0, z: 0.2 },
      },
    });
    registry.add({
      id: "house",
      kind: "asset",
      assetPath: "small_house/small_house.glb",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0.65, z: 0 }),
      collision: {
        radius: 0.35,
        height: 1,
        offset: { x: 0, y: 0, z: 0.5 },
      },
      portalRenderable: false,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets(), registry);

    runtime.update(world, 1);

    const object = registry.get("mouse");
    expect(object?.kind).toBe("geo-mouse");
    expect(object?.localPose.translation.y).toBeCloseTo(1);
  });

  it("stops a mouse at the surface of a supplied player obstacle", () => {
    const world = compileCellComplex(singleRoom());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      speed: 1,
      collision: {
        radius: 0.25,
        height: 0.4,
        offset: { x: 0, y: 0, z: 0.2 },
      },
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets(), registry);

    runtime.update(world, 1, [
      {
        cellId: "room",
        localPose: yawRigidTransform3(0, { x: 0, y: 0.65, z: 0 }),
        collision: simpleCollisionCylinder(0.25, 0.4, { x: 0, y: 0, z: 0.2 }),
      },
    ]);

    const object = registry.get("mouse");
    expect(object?.kind).toBe("geo-mouse");
    // The obstacle sits 0.65 m ahead and the radii sum to 0.5 m, so the mouse advances 0.15 m and stops there.
    expect(object?.localPose.translation.y).toBeGreaterThan(0.14);
    expect(object?.localPose.translation.y).toBeLessThanOrEqual(0.15);
  });
});

function dynamicObject(translation: { readonly x: number; readonly y: number; readonly z: number }): DynamicObjectState {
  return {
    cellId: "room-a",
    localPose: { rotation: identityMat3, translation },
    collision: simpleCollisionCylinder(0.1, 0.2),
  };
}

function stubAssets(): PreparedWorldAssets {
  return {
    getTexture() {
      return undefined;
    },
    getConfiguredTexture() {
      return undefined;
    },
    instantiateGltf() {
      return {
        scene: new THREE.Group(),
        animations: [],
      };
    },
  };
}

function singleRoom(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 2,
        baseVertices: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        portals: [],
      },
    ],
  };
}

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "west",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}

describe("side rule", () => {
  it("passes the zone centre on the geodesic's side (sign convention)", () => {
    // Geodesic along +x with the zone centre at the origin on its left (the line is at y = -0.12).
    expect(geodesicSideOfPoint({ x: -1, y: -0.12 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBe(1);
    expect(geodesicSideOfPoint({ x: -1, y: 0.12 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBe(-1);
    // On the line: the vertex counts as on the right.
    expect(geodesicSideOfPoint({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBe(-1);
    // v = (0, 0), c = (0, -0.2), side +1 gives t = (1, 0).
    const left = applyForbiddenZoneSideRule({ x: 0, y: 0.05 }, { x: 0, y: -0.2 }, { x: 0, y: 0 }, 0.2 + 1e-5, 1);
    expect(left.x).toBeCloseTo(0.05, 6);
    expect(left.y).toBeCloseTo(0, 6);
    const right = applyForbiddenZoneSideRule({ x: 0, y: 0.05 }, { x: 0, y: -0.2 }, { x: 0, y: 0 }, 0.2 + 1e-5, -1);
    expect(right.x).toBeCloseTo(-0.05, 6);
    // A displacement that does not point at the disc is returned unchanged.
    expect(applyForbiddenZoneSideRule({ x: 0, y: -0.05 }, { x: 0, y: -0.2 }, { x: 0, y: 0 }, 0.2, 1)).toEqual({ x: 0, y: -0.05 });
  });
});

describe("leader and detour", () => {
  const dt = 1 / 60;
  const mouseCollision = { radius: 0.05, height: 0.2, offset: { x: 0, y: 0, z: 0.1 } } as const;

  function makeCreature(
    world: CompiledCellComplex,
    cellId: string,
    x: number,
    y: number,
    turnDegrees: number,
    speed = 1.2,
  ) {
    const registry = createRuntimeObjectRegistry();
    const spec = createSimpleGeoCreature("geo-mouse", "m", "mouse/Mouse.glb", {
      position: [x, 0, y],
      turn: turnDegrees,
      speed,
      collision: mouseCollision,
    });
    const runtime = createSimpleGeoCreatureRuntime(spec, cellId, stubAssets(), registry);
    const pose = () => {
      const object = registry.get("m");
      if (!object) throw new Error("missing creature");
      return { cellId: object.cellId, pose: object.localPose };
    };
    const leaderInCreatureFrame = (): RigidTransform3 => {
      const leader = runtime.leaderForDebug();
      return composeRigidTransform3(leader.creatureFromLeader, leader.localPose);
    };
    const lag = (): number => {
      const leader = leaderInCreatureFrame().translation;
      const mine = pose().pose.translation;
      return Math.hypot(leader.x - mine.x, leader.y - mine.y);
    };
    const nearestColumn = () => {
      const cell = world.cellsById.get(pose().cellId);
      if (!cell) throw new Error("missing cell");
      const mine = pose().pose.translation;
      return cell.singularityColumns
        .map((column) => ({ column, distance: Math.hypot(column.center.x - mine.x, column.center.y - mine.y) }))
        .sort((a, b) => a.distance - b.distance)[0];
    };
    return { runtime, registry, pose, leaderInCreatureFrame, lag, nearestColumn, world };
  }

  /** Signed angle of the creature around the nearest zone centre, measured from the leader's forward direction (frame independent). */
  function angleAroundZone(c: ReturnType<typeof makeCreature>) {
    const { column } = c.nearestColumn();
    const mine = c.pose().pose.translation;
    const leaderPose = c.leaderInCreatureFrame();
    const d = transformDirection3(leaderPose, { x: 0, y: 1, z: 0 });
    const rx = mine.x - column.center.x;
    const ry = mine.y - column.center.y;
    return Math.atan2(d.x * ry - d.y * rx, d.x * rx + d.y * ry);
  }

  /** v relative to the creature and the leader's forward direction, for the side test. */
  function crossForwardToZone(c: ReturnType<typeof makeCreature>): { cross: number; distance: number; along: number } {
    const { column, distance } = c.nearestColumn();
    const mine = c.pose().pose.translation;
    const d = transformDirection3(c.leaderInCreatureFrame(), { x: 0, y: 1, z: 0 });
    const vx = column.center.x - mine.x;
    const vy = column.center.y - mine.y;
    return { cross: d.x * vy - d.y * vx, distance, along: -(d.x * vx + d.y * vy) };
  }

  function expectCoincide(c: ReturnType<typeof makeCreature>, tolerance: number): void {
    const leaderPose = c.leaderInCreatureFrame();
    const mine = c.pose().pose;
    expect(Math.hypot(leaderPose.translation.x - mine.translation.x, leaderPose.translation.y - mine.translation.y)).toBeLessThan(tolerance);
    expect(Math.abs(leaderPose.rotation.m00 - mine.rotation.m00)).toBeLessThan(tolerance);
    expect(Math.abs(leaderPose.rotation.m10 - mine.rotation.m10)).toBeLessThan(tolerance);
  }

  it("1. follows the unobstructed geodesic exactly across portals", () => {
    const world = compileCellComplex(icosahedron);
    const cellId = world.cells[0].id;
    const speed = 1.2;
    let verified = false;

    for (let candidate = 0; candidate < 40 && !verified; candidate += 1) {
      const turn = 7 + candidate * 9;
      // Reference walk; reject headings that come within reach of a zone.
      let refCell = cellId;
      let refPose: RigidTransform3 = yawRigidTransform3((turn * Math.PI) / 180, { x: 0.3, y: 0.2, z: 0 });
      const reference: { cellId: string; pose: RigidTransform3 }[] = [];
      let clear = true;
      for (let tick = 0; tick < 2000 && clear; tick += 1) {
        const dir = transformDirection3(refPose, { x: 0, y: 1, z: 0 });
        const walk = walkDevelopedSegment({
          world,
          cellId: refCell,
          start: { x: refPose.translation.x, y: refPose.translation.y },
          direction: { x: dir.x, y: dir.y },
          lengthMeters: speed * dt,
        });
        const last = walk.pieces[walk.pieces.length - 1];
        const moved: RigidTransform3 = {
          rotation: refPose.rotation,
          translation: { x: refPose.translation.x + dir.x * speed * dt, y: refPose.translation.y + dir.y * speed * dt, z: 0 },
        };
        refPose = orthonormalizeYawRigidTransform3(composeRigidTransform3(last.cellFromStart, moved));
        refCell = last.cellId;
        reference.push({ cellId: refCell, pose: refPose });
        const cell = world.cellsById.get(refCell)!;
        for (const column of cell.singularityColumns) {
          if (Math.hypot(column.center.x - refPose.translation.x, column.center.y - refPose.translation.y) < 0.3) clear = false;
        }
      }
      if (!clear) continue;

      const c = makeCreature(world, cellId, 0.3, 0.2, turn, speed);
      let maxTranslation = 0;
      let maxRotation = 0;
      for (let tick = 0; tick < 2000; tick += 1) {
        c.runtime.update(world, dt);
        const mine = c.pose();
        expect(mine.cellId).toBe(reference[tick].cellId);
        const r = reference[tick].pose;
        maxTranslation = Math.max(maxTranslation, Math.hypot(mine.pose.translation.x - r.translation.x, mine.pose.translation.y - r.translation.y));
        maxRotation = Math.max(maxRotation, Math.abs(mine.pose.rotation.m00 - r.rotation.m00), Math.abs(mine.pose.rotation.m10 - r.rotation.m10));
      }
      expect(maxTranslation).toBeLessThan(1e-9);
      expect(maxRotation).toBeLessThan(1e-12);
      verified = true;
    }

    expect(verified).toBe(true);
  });

  function detourScenario(options: { zoneOnLeft: boolean; lineOffset?: number }) {
    const world = compileCellComplex(cube);
    // Cube face "front" is 15 m wide with a zone (radius 0.15) at each corner.
    // Heading +x along y = 7.5 - 0.12 passes the corner (7.5, 7.5) with it on the left; heading -x along y = 7.38 passes (-7.5, 7.5) on the right.
    const offset = options.lineOffset ?? 0.12;
    const c = options.zoneOnLeft
      ? makeCreature(world, "front", 4.5, 7.5 - offset, -90)
      : makeCreature(world, "front", -4.5, 7.5 - offset, 90);
    return c;
  }

  for (const zoneOnLeft of [true, false]) {
    it(`${zoneOnLeft ? "2" : "3"}. keeps the zone vertex on the geodesic's side (zone on the ${zoneOnLeft ? "left" : "right"})`, () => {
      const c = detourScenario({ zoneOnLeft });
      let passedTicks: number | undefined;
      let detoured = false;

      for (let tick = 0; tick < 600; tick += 1) {
        c.runtime.update(c.world, dt);
        const s = crossForwardToZone(c);
        if (s.distance < 1) {
          if (zoneOnLeft) {
            expect(s.cross).toBeGreaterThanOrEqual(-1e-9);
          } else {
            expect(s.cross).toBeLessThanOrEqual(1e-9);
          }
        }
        if (c.lag() > 1e-4) detoured = true;
        if (passedTicks === undefined && s.along > 1 && s.distance < 3) passedTicks = tick;
      }

      expect(detoured).toBe(true);
      expect(passedTicks).toBeDefined();
      expect(c.lag()).toBeLessThan(1e-6);
      expectCoincide(c, 1e-6);
    });
  }

  it("4. a geodesic exactly through the vertex passes it on the right and the creature rejoins", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 4.5, 7.5, -90);
    let minCross = Infinity;

    for (let tick = 0; tick < 700; tick += 1) {
      c.runtime.update(world, dt);
      const s = crossForwardToZone(c);
      if (s.distance < 1) minCross = Math.min(minCross, -s.cross);
    }

    // Vertex on the right of the motion: cross(forward, v - c) <= 0 throughout.
    expect(minCross).toBeGreaterThanOrEqual(-1e-9);
    expect(c.lag()).toBeLessThan(1e-6);
    expectCoincide(c, 1e-6);
  });

  it("5. a creature pushed to the wrong side of a zone orbits to the required side and rejoins", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 4.5, 7.5 - 0.12, -90);
    // A body below and left of the corner squeezes the creature up over the line, onto the wrong side of the corner zone (found by scanning body placements; the wrong-side branch is entered here).
    const body = {
      cellId: "front",
      localPose: yawRigidTransform3(0, { x: 7.1, y: 7.1, z: 0 }),
      collision: simpleCollisionCylinder(0.4, 0.4, { x: 0, y: 0, z: 0.2 }),
    };
    let previous: number | undefined;
    let worstDecrease = 0;
    let total = 0;

    // The geodesic loops back to the same corner after about 800 ticks, so stop well before that.
    for (let tick = 0; tick < 400; tick += 1) {
      c.runtime.update(world, dt, tick < 150 ? [body] : []);
      const s = crossForwardToZone(c);
      if (s.distance < 0.6) {
        const angle = angleAroundZone(c);
        if (previous !== undefined) {
          let step = angle - previous;
          while (step > Math.PI) step -= 2 * Math.PI;
          while (step < -Math.PI) step += 2 * Math.PI;
          total += step;
          worstDecrease = Math.min(worstDecrease, total);
        }
        previous = angle;
      } else {
        previous = undefined;
      }
    }

    // Zone on the left: the creature goes round it counter-clockwise, so the unwrapped angle never decreases by more than jitter.
    expect(worstDecrease).toBeGreaterThan(-0.2);
    expect(c.lag()).toBeLessThan(1e-6);
  });

  it("6. a blocking body leashes the leader; the creature rejoins when it is removed", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 0, 0, -90);
    const body = {
      cellId: "front",
      localPose: yawRigidTransform3(0, { x: 1, y: 0, z: 0 }),
      collision: simpleCollisionCylinder(0.3, 0.4, { x: 0, y: 0, z: 0.2 }),
    };
    let maxLag = 0;

    for (let tick = 0; tick < 120; tick += 1) {
      c.runtime.update(world, dt, [body]);
      maxLag = Math.max(maxLag, c.lag());
    }
    expect(maxLag).toBeLessThanOrEqual(0.5 + 1.2 * dt + 1e-9);
    expect(maxLag).toBeGreaterThan(0.3);

    for (let tick = 0; tick < 600; tick += 1) {
      c.runtime.update(world, dt, []);
    }
    expect(c.lag()).toBeLessThan(1e-6);
    expectCoincide(c, 1e-6);
  });

  it("7a. host.placeAt re-seeds the leader and the creature walks the geodesic from the placed pose", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 0, 0, -90);
    const host = createObjectHost();
    host.register(c.runtime);
    for (let tick = 0; tick < 30; tick += 1) c.runtime.update(world, dt);

    const placed = yawRigidTransform3(0.3, { x: 0, y: -5, z: 0 });
    expect(host.placeAt("m", "front", placed)).toBe(true);
    expect(c.registry.get("m")!.localPose).toEqual(placed);
    expect(c.registry.get("m")!.cellId).toBe("front");
    const leader = c.runtime.leaderForDebug();
    expect(leader.creatureFromLeader.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(Math.abs(leader.creatureFromLeader.rotation.m00 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(leader.creatureFromLeader.rotation.m10)).toBeLessThan(1e-12);

    const fresh = makeCreature(world, "front", 0, -5, (0.3 * 180) / Math.PI);
    for (let tick = 0; tick < 100; tick += 1) {
      c.runtime.update(world, dt);
      fresh.runtime.update(world, dt);
      const mine = c.pose();
      const reference = fresh.pose();
      expect(mine.cellId).toBe(reference.cellId);
      expect(Math.hypot(
        mine.pose.translation.x - reference.pose.translation.x,
        mine.pose.translation.y - reference.pose.translation.y,
      )).toBeLessThan(1e-9);
    }
  });

  it("7b. host.placeAt into another cell moves the registry record and the three.js parent", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 0, 0, -90);
    const host = createObjectHost();
    host.register(c.runtime);
    const otherId = world.cells.find((cell) => cell.id !== "front")!.id;
    const cellRoots = new Map<string, THREE.Object3D>(world.cells.map((cell) => [cell.id, new THREE.Group()]));
    c.runtime.syncParent(cellRoots);
    expect(c.runtime.root.parent).toBe(cellRoots.get("front"));

    host.placeAt("m", otherId, yawRigidTransform3(0, { x: 1, y: 2, z: 0 }));

    expect(c.registry.get("m")!.cellId).toBe(otherId);
    expect(c.runtime.cellId).toBe(otherId);
    expect(c.registry.getObjectsInCell("front").map((object) => object.id)).not.toContain("m");
    c.runtime.syncParent(cellRoots);
    expect(c.runtime.root.parent).toBe(cellRoots.get(otherId));
  });

  it("7c. a direct registry.update of a creature throws and leaves its pose unchanged", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 0, 0, -90);
    const record = c.registry.get("m")!;
    const rootX = c.runtime.root.position.x;
    const rootY = c.runtime.root.position.y;
    const rootZ = c.runtime.root.position.z;

    expect(() => c.registry.update({ ...record, localPose: yawRigidTransform3(0, { x: 3, y: 3, z: 0 }) })).toThrow(/is owned/);

    expect(c.registry.get("m")!.localPose).toBe(record.localPose);
    expect(c.runtime.root.position.x).toBe(rootX);
    expect(c.runtime.root.position.y).toBe(rootY);
    expect(c.runtime.root.position.z).toBe(rootZ);
  });

  it("8. reset and transformGeometry put the leader back on the creature", () => {
    const world = compileCellComplex(cube);
    const c = makeCreature(world, "front", 0, 0, -90);
    const body = {
      cellId: "front",
      localPose: yawRigidTransform3(0, { x: 1, y: 0, z: 0 }),
      collision: simpleCollisionCylinder(0.3, 0.4, { x: 0, y: 0, z: 0.2 }),
    };
    for (let tick = 0; tick < 100; tick += 1) c.runtime.update(world, dt, [body]);
    expect(c.lag()).toBeGreaterThan(0.1);

    const identityMap = { cellId: "front", mapPoint: (point: { x: number; y: number; z: number }) => point, mapDirection: (direction: { x: number; y: number; z: number }) => direction };
    c.runtime.transformGeometry(new Map([["front", identityMap]]), world);
    expect(c.lag()).toBeLessThan(1e-9);
    expect(c.runtime.leaderForDebug().creatureFromLeader.translation).toEqual({ x: 0, y: 0, z: 0 });

    for (let tick = 0; tick < 100; tick += 1) c.runtime.update(world, dt, [body]);
    expect(c.lag()).toBeGreaterThan(0.1);
    c.runtime.reset(new Map());
    expect(c.lag()).toBeLessThan(1e-9);

    const before = c.pose().pose.translation.x;
    c.runtime.update(world, dt);
    expect(c.pose().pose.translation.x).toBeCloseTo(before + 1.2 * dt, 9);
    expectCoincide(c, 1e-9);
  });
});
