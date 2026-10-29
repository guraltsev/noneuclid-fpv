import { describe, expect, it } from "vitest";
import { torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { checkPortalPathString } from "../../src/cell-complex/portalPathDebug";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import {
  buildTorusParallelogramVertices,
  createTorusSkewCellDeformationMaps,
  createTorusSkewDeformationFamily,
  defaultTorusSkewDeformationState,
  nextTorusSkewStep,
  validateTorusSkewBaseSpec,
  type TorusSkewDeformationState,
} from "../../src/runtime/deformations/torusSkewDeformation";
import { createInitialWorldDeformationState } from "../../src/runtime/worldGeometryDeformationFamilies";
import { torusModuli } from "../../src/authoring/exampleWorlds";
import {
  deformationStatesEqual,
  transformPoseWithCellMaps,
  transformPositionedObjectSpecWithMap,
  transformRigidPoseWithMap,
} from "../../src/runtime/worldGeometryDeformations";
import { transformYawWithMap } from "../../src/render/three/runtimeSceneUtils";
import { createGeodesicMarmot, createGeodesicMarmotRuntimeObject } from "../../src/world-objects/geodesicMarmot";
import type { CellObjectSpec } from "../../src/cell-complex/specs";

describe("torus skew deformation", () => {
  it("zero skew reproduces the current torus square", () => {
    expect(buildTorusParallelogramVertices(defaultTorusSkewDeformationState)).toEqual(torus.cells[0].baseVertices);
  });

  it("positive skew produces a convex parallelogram", () => {
    expect(buildTorusParallelogramVertices(skewState(2))).toEqual([
      { x: -8.5, y: -7.5 },
      { x: 6.5, y: -7.5 },
      { x: 8.5, y: 7.5 },
      { x: -6.5, y: 7.5 },
    ]);

    const world = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torus, skewState(2)));

    expect(world.cellsById.get("torus-room")?.isConvex).toBe(true);
  });

  it("rejects negative A offsets", () => {
    expect(() => createTorusSkewDeformationFamily().applyToSpec(torus, skewState(-2)))
      .toThrowError(/A must be between 0m and 30m/);
  });

  it("keeps side ids and portal ids unchanged", () => {
    const spec = createTorusSkewDeformationFamily().applyToSpec(torus, skewState(1));

    expect(spec.cells[0].id).toBe(torus.cells[0].id);
    expect(spec.cells[0].portals).toEqual(torus.cells[0].portals);
  });

  it("keeps opposite side lengths equal", () => {
    const world = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torus, skewState(2)));
    const room = world.cellsById.get("torus-room")!;

    expect(room.sides[0].lengthMeters).toBeCloseTo(room.sides[2].lengthMeters);
    expect(room.sides[1].lengthMeters).toBeCloseTo(room.sides[3].lengthMeters);
  });

  it("preserves lattice coordinates for point transforms", () => {
    const maps = createTorusSkewCellDeformationMaps(skewState(0), skewState(2));
    const map = maps.get("torus-room")!;
    const point = vec3(0, 0, 1.25);

    expect(map.mapPoint(point)).toEqual({ x: 0, y: 0, z: 1.25 });
    expect(map.mapPoint(vec3(-7.5, -7.5, 0))).toEqual({ x: -8.5, y: -7.5, z: 0 });
  });

  it("maps the forward vector through the linear part of the lattice map", () => {
    const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(2)).get("torus-room")!;
    const transformed = map.mapDirection(vec3(0, 1, 0));

    expect(transformed.x / transformed.y).toBeCloseTo(2 / 15);

    const pose = transformRigidPoseWithMap(yawRigidTransform3(0, vec3(0, 0, 0)), map);
    expect(Math.atan2(pose.rotation.m10, pose.rotation.m00)).toBeCloseTo(-Math.atan(2 / 15), 10);
    // New forward R'·e_y = (m01, m11) is parallel to A·e_y = (2/15, 1).
    expect(pose.rotation.m01 / pose.rotation.m11).toBeCloseTo(2 / 15, 10);
  });

  it("rejects invalid non-torus specs clearly", () => {
    const family = createTorusSkewDeformationFamily();

    expect(() =>
      family.applyToSpec(
        {
          cells: [
            {
              ...torus.cells[0],
              id: "not-torus",
            },
          ],
        },
        skewState(1),
      ),
    ).toThrowError(/Expected a "torus-room" cell/);
  });

  it("compiles skewed torus portal transforms without NaN or Infinity", () => {
    const world = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torus, skewState(2)));

    for (const cell of world.cells) {
      for (const portal of cell.portals) {
        expect(Object.values(portal.transformToTarget.rotation).every(Number.isFinite)).toBe(true);
        expect(Object.values(portal.transformToTarget.translation).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("keeps an explicit zero width or depth so range validation rejects it", () => {
    const family = createTorusSkewDeformationFamily();

    expect(() => family.normalizeState(torus, { ...skewState(0), widthMeters: 0 })).toThrowError(/widthMeters/);
    expect(() => family.normalizeState(torus, { ...skewState(0), depthMeters: 0 })).toThrowError(/depthMeters/);
    expect(family.normalizeState(torus, { ...skewState(0), widthMeters: Number.NaN }).widthMeters).toBe(15);
    expect(
      family.normalizeState(torus, { ...skewState(0), depthMeters: undefined as unknown as number }).depthMeters,
    ).toBe(15);
  });

  it("transports the marmot velocity direction by the linear part of the map", () => {
    const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(6)).get("torus-room")!;
    const velocity = { x: 0.6, y: 0.8 };
    const marmot = {
      kind: "geodesci-marmot", id: "m", position: vec3(1, 2, 0), velocity,
      yawRadians: Math.atan2(-velocity.x, velocity.y),
    } as unknown as CellObjectSpec;
    const mapped = transformPositionedObjectSpecWithMap(marmot, map) as unknown as {
      velocity: { x: number; y: number }; yawRadians: number;
    };
    expect(mapped.velocity.x).toBeCloseTo(0.7546055221635046, 10);
    expect(mapped.velocity.y).toBeCloseTo(0.6561787149247866, 10);
    expect(mapped.yawRadians).toBeCloseTo(-0.8550527371260165, 10);
    // The body +y axis of the new yaw points along the new velocity.
    expect(-Math.sin(mapped.yawRadians)).toBeCloseTo(mapped.velocity.x, 10);
    expect(Math.cos(mapped.yawRadians)).toBeCloseTo(mapped.velocity.y, 10);
  });

  it("keeps a closed-geodesic forward vector closed under a full shear", () => {
    const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(15)).get("torus-room")!;
    // Forward (1, 0) is yaw -π/2; A·(1, 0) = (1, 0).
    const east = transformRigidPoseWithMap(yawRigidTransform3(-Math.PI / 2, vec3(1, 2, 0)), map);
    expect(east.rotation.m01).toBeCloseTo(1, 10);
    expect(east.rotation.m11).toBeCloseTo(0, 10);
    // Forward ∝ v = (0, 15) is yaw 0; it must become ∝ v' = (15, 15), yaw -π/4.
    const north = transformRigidPoseWithMap(yawRigidTransform3(0, vec3(1, 2, 0)), map);
    expect(Math.atan2(north.rotation.m10, north.rotation.m00)).toBeCloseTo(-Math.PI / 4, 10);
    expect(north.rotation.m01).toBeCloseTo(Math.SQRT1_2, 10);
    expect(north.rotation.m11).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("keeps geodesic cannon direction angles as directions", () => {
    const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(15)).get("torus-room")!;
    expect(transformYawWithMap(0, vec3(0, 0, 0), map)).toBeCloseTo(0, 10);
    expect(transformYawWithMap(Math.PI / 2, vec3(0, 0, 0), map)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("live and authored marmots get the same heading after a commit", () => {
    const maps = createTorusSkewCellDeformationMaps(skewState(0), skewState(6));
    const spec = createGeodesicMarmot({ id: "m", position: { x: 1, y: 2, z: 0 }, velocity: { x: 0.6, y: 0.8 } });
    const live = transformPoseWithCellMaps(createGeodesicMarmotRuntimeObject(spec, "torus-room"), maps)!;
    const authored = transformPositionedObjectSpecWithMap(spec, maps.get("torus-room")!);
    const liveYaw = Math.atan2(live.localPose.rotation.m10, live.localPose.rotation.m00);
    expect(liveYaw).toBeCloseTo(-0.8550527371260165, 10);
    expect(authored.yawRadians!).toBeCloseTo(liveYaw, 10);
  });

  it("keeps immediate reverse paths filtered under depth-10 static culling", () => {
    const world = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torus, skewState(2)));
    const staticCull = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 10,
      skipImmediateReverse: true,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 50_000,
    });
    const check = checkPortalPathString("0 2", {
      world,
      rootCellId: "torus-room",
      candidateTables: staticCull.tables,
      keptTables: staticCull.tables,
      cullSummariesByRootCellId: staticCull.summariesByRootCellId,
    });

    expect(staticCull.tables.tablesByRootCellId.get("torus-room")?.paths.length).toBeGreaterThan(0);
    expect(check.existsInBuiltTable).toBe(false);
  });
});

describe("torus skew base frame and width step", () => {
  const rest: TorusSkewDeformationState = {
    kind: "torus-skew",
    cellId: "torus-room",
    widthMeters: 15,
    depthMeters: 15,
    skewXMeters: 0,
  };

  function runSteps(start: TorusSkewDeformationState, target: TorusSkewDeformationState) {
    const options = { maxStepMeters: 0.08 };
    let state = start;
    let steps = 0;
    for (; steps < 1000 && !deformationStatesEqual(state, target); steps += 1) {
      const next = nextTorusSkewStep(state, target, options);
      const moved = Math.hypot(
        next.widthMeters - state.widthMeters,
        next.skewXMeters - state.skewXMeters,
        next.depthMeters - state.depthMeters,
      );
      expect(moved).toBeLessThanOrEqual(0.08 + 1e-12);
      state = next;
    }
    return { state, steps };
  }

  it("rejects a torus footprint that is not centred", () => {
    const spec = {
      ...torus,
      cells: [
        {
          ...torus.cells[0],
          baseVertices: [
            { x: 0, y: 0 },
            { x: 15, y: 0 },
            { x: 15, y: 15 },
            { x: 0, y: 15 },
          ],
        },
      ],
    };
    expect(createTorusSkewDeformationFamily().canApplyToSpec(spec)).toBe(false);
    expect(validateTorusSkewBaseSpec(spec).some((error) => /centred parallelogram/.test(error))).toBe(true);
    expect(createInitialWorldDeformationState(spec)).toEqual({ kind: "static-world" });
  });

  it("rejects a rotated torus footprint", () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const baseVertices = torus.cells[0].baseVertices.map((vertex) => ({
      x: vertex.x * c - vertex.y * s,
      y: vertex.x * s + vertex.y * c,
    }));
    const spec = { ...torus, cells: [{ ...torus.cells[0], baseVertices }] };
    expect(createTorusSkewDeformationFamily().canApplyToSpec(spec)).toBe(false);
  });

  it("still accepts the shipped torus worlds", () => {
    const family = createTorusSkewDeformationFamily();
    expect(family.canApplyToSpec(torus)).toBe(true);
    expect(family.canApplyToSpec(torusModuli)).toBe(true);
  });

  it("steps width, skew and depth together and reaches a wider target", () => {
    const target = { ...rest, widthMeters: 40, depthMeters: 20 };
    const { state, steps } = runSteps(rest, target);
    expect(deformationStatesEqual(state, target)).toBe(true);
    expect(steps).toBeLessThan(1000);
  });

  it("stays in range on the boundary b = w/2 while the width changes", () => {
    const start = { ...rest, widthMeters: 15, depthMeters: 7.5, skewXMeters: 0 };
    const target = { ...rest, widthMeters: 20, depthMeters: 10, skewXMeters: 0 };
    const { state } = runSteps(start, target);
    expect(deformationStatesEqual(state, target)).toBe(true);
  });
});

function skewState(skewXMeters: number): TorusSkewDeformationState {
  return {
    kind: "torus-skew",
    cellId: "torus-room",
    widthMeters: 15,
    depthMeters: 15,
    skewXMeters,
  };
}
