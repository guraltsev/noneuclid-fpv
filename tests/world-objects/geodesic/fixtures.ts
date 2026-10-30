import { expect } from "vitest";
import { compileCellComplex } from "../.././../src/cell-complex/compileCellComplex";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  advanceCurveShorteningPairs,
  tieAndDetachGeodesicEndpoints,
} from "../../../src/world-objects/geodesic/curveShortening";
import {
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import { rebuildDerivedGeodesicSegments } from "../../../src/world-objects/geodesic/intervals";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import { walkDevelopedSegment } from "../../../src/cell-complex/segmentWalk";

export function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "g-a:segment:0",
    kind: "geodesic-segment",
    cellId: "a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: geodesicRayBeamHeightMeters }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}

export function compileWorld(withPortal: boolean) {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        portals: withPortal ? [{ id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" }] : [],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        portals: withPortal ? [{ id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" }] : [],
      },
    ],
  });
}

export function totalGeodesicLength(registry: ReturnType<typeof createRuntimeObjectRegistry>, geodesicId: string): number {
  return getGeodesicSegments(registry, geodesicId)
    .reduce((total, segment) => total + segment.lengthMeters, 0);
}

export function getCannonGeodesicIds(registry: ReturnType<typeof createRuntimeObjectRegistry>, cannonId: string): readonly string[] {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon" ? cannon.geodesicIds : [];
}

export function getCannonGeodesicYaw(
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  cannonId: string,
  geodesicId: string,
): number | undefined {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon" ? cannon.geodesicEmitterYawRadiansById?.[geodesicId] : undefined;
}

export function getCannonPoseYaw(
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  cannonId: string,
): number | undefined {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon"
    ? Math.atan2(cannon.localPose.rotation.m10, cannon.localPose.rotation.m00)
    : undefined;
}

export function normalizeYaw(yawRadians: number): number {
  return Math.atan2(Math.sin(yawRadians), Math.cos(yawRadians));
}

export function horizontalDistance(left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function horizontalDirection(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly z: 0 } {
  const length = horizontalDistance(start, end);
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length, z: 0 };
}

export function createCarryPortalTransition(
  world: ReturnType<typeof compileLargePortalWorld> | ReturnType<typeof compileThreeCellPortalWorld>,
  sourceCellId: string,
  sourcePortalId: string,
) {
  const portal = world.cellsById.get(sourceCellId)?.portalsById.get(sourcePortalId);
  if (!portal) {
    throw new Error(`Missing portal ${sourceCellId}:${sourcePortalId}.`);
  }

  return {
    sourceCellId,
    sourcePortalId,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
    transformToTarget: portal.transformToTarget,
  };
}

export function createCarryPortalTraversal(
  world: ReturnType<typeof compileLargePortalWorld> | ReturnType<typeof compileThreeCellPortalWorld>,
  sourceCellId: string,
  sourcePortalId: string,
) {
  const portal = world.cellsById.get(sourceCellId)?.portalsById.get(sourcePortalId);
  if (!portal) {
    throw new Error(`Missing portal ${sourceCellId}:${sourcePortalId}.`);
  }

  return {
    sourceCellId,
    sourcePortalId,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
  };
}

export function compileLargeWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: -3, y: -3 },
          { x: 3, y: -3 },
          { x: 3, y: 3 },
          { x: -3, y: 3 },
        ],
        portals: [],
      },
    ],
  });
}

export function compileLargePortalWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" }],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" }],
      },
    ],
  });
}

// Cell a (trapezoid) is glued to cell b through a 0.25 m portal: narrower than two forbidden-zone radii, so no word through it is feasible.
export function compileNarrowPortalWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 0.25 },
          { x: 0, y: 2 },
        ],
        portals: [{ id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" }],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 0.25 },
        ],
        portals: [{ id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" }],
      },
    ],
  });
}

export function compileThreeCellPortalWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "front",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "front-left", sideIndex: 1, targetCellId: "left", targetPortalId: "left-front" }],
      },
      {
        id: "left",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [
          { id: "left-front", sideIndex: 3, targetCellId: "front", targetPortalId: "front-left" },
          { id: "left-back", sideIndex: 1, targetCellId: "back", targetPortalId: "back-left" },
        ],
      },
      {
        id: "back",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "back-left", sideIndex: 3, targetCellId: "left", targetPortalId: "left-back" }],
      },
    ],
  });
}

export function compileTorusLoopWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "torus-room",
        heightMeters: 3,
        baseVertices: [
          { x: -7.5, y: -7.5 },
          { x: 7.5, y: -7.5 },
          { x: 7.5, y: 7.5 },
          { x: -7.5, y: 7.5 },
        ],
        portals: [
          { id: "bottom-top", sideIndex: 0, targetCellId: "torus-room", targetPortalId: "top-bottom" },
          { id: "right-left", sideIndex: 1, targetCellId: "torus-room", targetPortalId: "left-right" },
          { id: "top-bottom", sideIndex: 2, targetCellId: "torus-room", targetPortalId: "bottom-top" },
          { id: "left-right", sideIndex: 3, targetCellId: "torus-room", targetPortalId: "right-left" },
        ],
      },
    ],
  });
}

// Two 5 m cells glued into a 10 m cylinder: a's right side to b's left side, b's right side to a's left side.
export function compileTwoCellCylinderWorld() {
  const square = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  return compileCellComplex({
    cells: [
      { id: "a", heightMeters: 3, baseVertices: square, portals: [
        { id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" },
        { id: "a-left", sideIndex: 3, targetCellId: "b", targetPortalId: "b-right" },
      ] },
      { id: "b", heightMeters: 3, baseVertices: square, portals: [
        { id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" },
        { id: "b-right", sideIndex: 1, targetCellId: "a", targetPortalId: "a-left" },
      ] },
    ],
  });
}

// Cell a's right side is glued to cell b's left side; b's bottom side is glued to b's own right side, which is a
// rotation by -90 degrees about b's corner (5, 0). A free loop around that corner has a kink, so it really moves.
export function compileRotatedFreeLoopWorld() {
  const square = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  return compileCellComplex({
    cells: [
      { id: "a", heightMeters: 3, baseVertices: square, portals: [
        { id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" },
      ] },
      { id: "b", heightMeters: 3, baseVertices: square, portals: [
        { id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" },
        { id: "b-bottom", sideIndex: 0, targetCellId: "b", targetPortalId: "b-right" },
        { id: "b-right", sideIndex: 1, targetCellId: "b", targetPortalId: "b-bottom" },
      ] },
    ],
  });
}

// Advances until the pair is gone or `maxTicks` is reached. Fails if the pair's total length ever grows by more than 1e-9 m.
export function runCurveShorteningUntilPairGone(
  world: ReturnType<typeof compileCellComplex>,
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  options: { readonly pairId: string; readonly geodesicIds: readonly string[]; readonly deltaSeconds: number; readonly maxTicks: number },
): number {
  const total = () => [...new Set(options.geodesicIds)].reduce((sum, id) => sum + totalGeodesicLength(registry, id), 0);
  let previous = total();
  let ticks = 0;
  while (ticks < options.maxTicks && registry.get(options.pairId)) {
    advanceCurveShorteningPairs({ world, registry, deltaSeconds: options.deltaSeconds });
    ticks += 1;
    if (registry.get(options.pairId)) {
      const next = total();
      expect(next).toBeLessThanOrEqual(previous + 1e-9);
      previous = next;
    }
  }
  return ticks;
}

// Issue 66: two emitters on the 15 m torus, a straight arc E1 -> E2 and an arc E2 -> E1 that wraps once to the right,
// tied and released at E2.
export function createTorusTiedPairScenario() {
  const world = compileTorusLoopWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -3, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 3, y: 2, z: 0 }) }));
  registry.add(createGeodesicIntervalObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "torus-room" }));
  registry.add(createGeodesicIntervalObject({
    id: "g2",
    startAnchorObjectId: "e2",
    endAnchorObjectId: "e1",
    startCellId: "torus-room",
    portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
  }));
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g1" });
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g2" });
  tieAndDetachGeodesicEndpoints({
    world,
    registry,
    detachedEmitterId: "e2",
    first: { geodesicId: "g1", role: "end", anchorObjectId: "e2" },
    second: { geodesicId: "g2", role: "start", anchorObjectId: "e2" },
    createPairId: () => "pair",
    createFreeEndId: () => "free",
  });
  return { world, registry };
}

// A two-arc pair in the 6 m single cell: emitters at (-halfWidth, 0) and (halfWidth, 0), free end at (0, height).
export function createSymmetricPairScenario(halfWidth: number, height: number) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: -halfWidth, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "a", localPose: yawRigidTransform3(0, { x: halfWidth, y: 0, z: 0 }) }));
  registry.add(createFreeGeodesicEndObject({ id: "free", cellId: "a", point: { x: 0, y: height, z: geodesicRayBeamHeightMeters } }));
  registry.add(createGeodesicIntervalObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "free", startCellId: "a", motionState: "moving" }));
  registry.add(createGeodesicIntervalObject({ id: "g2", startAnchorObjectId: "free", endAnchorObjectId: "e2", startCellId: "a", motionState: "moving" }));
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" });
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" });
  registry.add(createCurveShorteningPairObject({
    id: "pair",
    first: { geodesicId: "g1", role: "end", anchorObjectId: "free" },
    second: { geodesicId: "g2", role: "start", anchorObjectId: "free" },
    freeEndAnchorId: "free",
    lastGoodFreeEndCellId: "a",
    lastGoodFreeEndPoint: { x: 0, y: height, z: geodesicRayBeamHeightMeters },
  }));
  return { world, registry };
}

// One 15 m torus cell, one emitter at (-2, 1.95), ten loops (a, b) = (18 - j, j) through it, about 200 segments.
export function createTorusLoopBenchmarkScene() {
  const world = compileTorusLoopWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({
    id: "e",
    cellId: "torus-room",
    localPose: yawRigidTransform3(0, { x: -2, y: 1.95, z: 0 }),
  }));
  const words = new Map<string, unknown>();
  for (let j = 0; j < 10; j += 1) {
    const a = 18 - j;
    const b = j;
    const norm = Math.hypot(a, b);
    const walk = walkDevelopedSegment({
      world,
      cellId: "torus-room",
      start: { x: -2, y: 1.95 },
      direction: { x: a / norm, y: b / norm },
      lengthMeters: 15 * norm,
      maxCrossings: 64,
    });
    expect(walk.status).toBe("end");
    expect(walk.crossings.length).toBe(18);
    const portalWord = walk.crossings.map((crossing) => ({
      sourceCellId: crossing.sourceCellId,
      sourcePortalId: crossing.portalId,
      targetCellId: crossing.targetCellId,
      targetPortalId: crossing.targetPortalId,
    }));
    registry.add(createGeodesicIntervalObject({
      id: `loop-${j}`,
      startAnchorObjectId: "e",
      endAnchorObjectId: "e",
      startCellId: "torus-room",
      portalWord,
    }));
    words.set(`loop-${j}`, portalWord);
    expect(rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: `loop-${j}` }).length).toBeGreaterThan(0);
  }
  return { world, registry, words };
}
