/**
 * Visible portal paths (src/visibility/visiblePortalPaths.ts): per-frame, camera-visible portal-path discovery.
 * Walks a portal-path table from the root, clipping each portal's aperture by its parent's surviving sector and
 * the camera frustum, and keeps a path only while its clip polygon has positive screen area (in pixels) at least
 * `minPortalScreenAreaPixels`; a path whose polygon vanishes (behind the camera, outside the frustum, or clipped
 * to nothing by an ancestor) is dropped along with everything under it, without visiting its children. Depth,
 * total visible-path count and screen-area budgets stop the walk early (`budgetExhausted`). A near-boundary
 * camera pose must not make a portal flicker in and out, nor duplicate a destination with near-zero slivers.
 * `computeIndependentVisiblePortalPaths` runs the same walk once per camera (stereo) and must agree with calling
 * `computeVisiblePortalPaths` separately for each.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cube, tetrahedron } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/cell-complex/twoPrismLoop";
import { twoRoomsWithPortal } from "../fixtures/cell-complex/twoRoomWorld";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import { describeVisiblePortalPath, type ComputeVisiblePortalPathsResult as VisibilityResult } from "../../src/visibility/visiblePortalPaths";
import { identityRigidTransform3, type RigidTransform3 } from "../../src/math/rigidTransform3";
import { computeIndependentVisiblePortalPaths, computeVisiblePortalPaths } from "../support/visibilityHarness";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import type { PortalPathTable } from "../../src/cell-complex/portalPaths";
import { developPortalSegment } from "../../src/cell-complex/orientedPortal";
import {
  clipPlanesToNdcPolygon,
  clipSectorByPortal,
  funnelClipPlanes,
  type DirectionSector,
} from "../../src/visibility/portalFunnel";
import { threePointToWorld } from "../../src/render/three/worldAxes";
import { createCameraAt } from "../support/cameras";

type ComputeVisiblePortalPathsResult = VisibilityResult<RigidTransform3>;

describe("computeVisiblePortalPaths", () => {
  it("includes the root path when requested", () => {
    const world = compileCellComplex(twoPrismLoop);
    const table = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "room-a",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.6 }),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ includeRootCell: true }),
    });

    expect(result.paths[0]).toMatchObject({
      pathId: 0,
      destinationCellId: "room-a",
      depth: 0,
    });
    expect(result.summary.visiblePathCountByDepth).toContainEqual({ depth: 0, count: 1 });
  });

  it("marks a first-hop portal in front of the camera visible", () => {
    const world = compileCellComplex(twoPrismLoop);
    const table = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "room-a",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.6 }),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions(),
    });

    expect(result.paths.map((path) => path.pathId)).toContain(1);
    expect(result.visiblePathById.get(1)?.screenAreaPixels).toBeGreaterThan(0);
  });

  it("matches separate per-eye visibility when computed in one independent-camera pass", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const leftEye = createCamera({ x: -0.04, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110);
    const rightEye = createCamera({ x: 0.04, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110);
    const options = defaultOptions({ maxDepth: 2, maxVisiblePaths: 8, minPortalScreenAreaPixels: 0 });
    const batched = computeIndependentVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      cameras: [leftEye, rightEye],
      viewportPixels: { width: 800, height: 600 },
      options,
    });
    const separate = [leftEye, rightEye].map((camera) =>
      computeVisiblePortalPaths({
        world,
        rootCellId: "front",
        pathTable: table,
        camera,
        viewportPixels: { width: 800, height: 600 },
        options,
      })
    );

    expect(batched).toHaveLength(2);
    expectVisibleResultsEquivalent(batched[0], separate[0]);
    expectVisibleResultsEquivalent(batched[1], separate[1]);
  });

  it("rejects a portal fully behind the camera", () => {
    const world = compileCellComplex(twoPrismLoop);
    const table = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "room-a",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: -1, y: 0, z: 1.6 }),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions(),
    });

    expect(result.paths.map((path) => path.pathId)).not.toContain(1);
    expect(result.summary.clippedByCameraCount).toBe(1);
  });

  it("clips a grazing parent aperture instead of making cube path 0 3 visible", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const pathZeroThree = table.paths.find((path) =>
      path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "0 3",
    );
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera(
        { x: -4.460064, y: -1.749517, z: 1.45 },
        { x: -5.379274, y: -1.358049, z: 1.407513 },
        70,
        803 / 1067,
      ),
      viewportPixels: { width: 803, height: 1067 },
      options: defaultOptions({ maxDepth: 2, minPortalScreenAreaPixels: 4 }),
    });

    expect(pathZeroThree).toBeDefined();
    expect(result.paths.map((path) => path.pathId)).not.toContain(pathZeroThree!.id);
  });

  it("drops near-corner duplicate sliver paths while keeping the main portal views", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera(
        { x: -6.978344, y: 7.499599, z: 1.45 },
        { x: -6.012365, y: 7.648173, z: 1.238317 },
        70,
        803 / 985,
      ),
      viewportPixels: { width: 803, height: 985 },
      options: defaultOptions({ maxDepth: 2, minPortalScreenAreaPixels: 16 }),
    });
    const directTopPath = table.paths.find((path) =>
      path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "2",
    );
    const directRightPath = table.paths.find((path) =>
      path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "1",
    );
    const cornerSliverPath = table.paths.find((path) =>
      path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "1 2",
    );
    const visiblePathIds = result.paths.map((path) => path.pathId);

    expect(directTopPath).toBeDefined();
    expect(directRightPath).toBeDefined();
    expect(cornerSliverPath).toBeDefined();
    expect(visiblePathIds).toContain(directTopPath!.id);
    expect(visiblePathIds).toContain(directRightPath!.id);
    // The sliver is kept as a terminal path (no holes) or absent; it never grows into a real view.
    const sliver = result.visiblePathById.get(cornerSliverPath!.id);

    expect(sliver === undefined || (sliver.terminal && sliver.screenAreaPixels < 16)).toBe(true);
  });

  it("rejects a child path when its parent is not visible", () => {
    const world = compileCellComplex(twoPrismLoop);
    const table = buildPortalPathTables(world, { maxDepth: 2, skipImmediateReverse: false }).tablesByRootCellId.get("room-a")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "room-a",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: -1, y: 0, z: 1.6 }),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ maxDepth: 2 }),
    });

    expect(table.pathsById.get(2)?.parentPathId).toBe(1);
    expect(result.paths.map((path) => path.pathId)).not.toContain(2);
  });

  it("keeps nested aperture area from growing beyond the parent aperture", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ maxDepth: 2, minPortalScreenAreaPixels: 0 }),
    });
    const child = result.paths.find((path) => path.depth === 2);

    expect(child).toBeDefined();
    expect(child!.screenAreaPixels).toBeLessThanOrEqual(
      result.visiblePathById.get(table.pathsById.get(child!.pathId)!.parentPathId!)!.screenAreaPixels + 1e-6,
    );
  });

  it("limits discovery by maxDepth", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 3 }).tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ maxDepth: 1, minPortalScreenAreaPixels: 0 }),
    });

    expect(Math.max(...result.paths.map((path) => path.depth))).toBeLessThanOrEqual(1);
  });

  it("limits reported visible paths by maxVisiblePaths and sets budgetExhausted", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ maxDepth: 2, maxVisiblePaths: 1, minPortalScreenAreaPixels: 0 }),
    });

    expect(result.paths).toHaveLength(1);
    expect(result.summary.budgetExhausted).toBe(true);
    expect(result.summary.clippedByBudgetCount).toBeGreaterThan(0);
  });

  it("keeps two visible paths to the same destination as distinct visible paths", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 120),
      viewportPixels: { width: 800, height: 600 },
      options: defaultOptions({ maxDepth: 2, minPortalScreenAreaPixels: 0 }),
    });
    const duplicateDestination = [...groupByDestination(result.paths).values()].find((paths) => paths.length > 1);

    expect(duplicateDestination).toBeDefined();
    expect(new Set(duplicateDestination?.map((path) => path.pathId)).size).toBe(duplicateDestination?.length);
  });

  it("reports live ShowCellPath visibility only when the matched id is in the latest result", () => {
    const visible = fakeVisibleResult([1]);

    expect(describeVisiblePortalPath(1, visible)).toMatchObject({
      currentlyVisible: true,
      screenAreaPixels: 12,
    });
    expect(describeVisiblePortalPath(2, visible)).toEqual({ currentlyVisible: false });
  });
});

interface CapturedBoundaryPoseCase {
  readonly label: string;
  readonly world: CellComplexSpec;
  readonly rootCellId: string;
  readonly maxDepth: number;
  readonly minPortalScreenAreaPixels: number;
  readonly cameraPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly cameraLookAt: { readonly x: number; readonly y: number; readonly z: number };
  readonly fovDegrees: number;
  readonly viewportPixels: { readonly width: number; readonly height: number };
  check(result: ComputeVisiblePortalPathsResult, table: PortalPathTable): void;
}

// Each pose below was captured from a real near-boundary camera position that once made a portal flicker, vanish
// or clip incorrectly; every case is a distinct world, root cell or aperture configuration (tests.md §4.4).
const capturedBoundaryPoseCases: readonly CapturedBoundaryPoseCase[] = [
  {
    label: "a first-hop portal nearly on its own boundary plane",
    world: twoRoomsWithPortal({ heightMeters: 3 }),
    rootCellId: "room-a",
    maxDepth: 1,
    minPortalScreenAreaPixels: 0,
    cameraPosition: { x: 0.995, y: 0, z: 1.6 },
    cameraLookAt: { x: 1.995, y: 0, z: 1.6 },
    fovDegrees: 70,
    viewportPixels: { width: 800, height: 600 },
    check: (result) => {
      expect(result.paths.map((path) => path.pathId)).toContain(1);
      expect(result.visiblePathById.get(1)?.screenAreaPixels).toBeGreaterThan(100_000);
    },
  },
  {
    label: "a cube's top portal, captured near-boundary",
    world: cube,
    rootCellId: "front",
    maxDepth: 2,
    minPortalScreenAreaPixels: 4,
    cameraPosition: { x: -2.106879, y: 7.498034, z: 1.45 },
    cameraLookAt: { x: -2.986468, y: 7.414927, z: 0.981581 },
    fovDegrees: 70,
    viewportPixels: { width: 803, height: 985 },
    check: (result, table) => checksTopPortalStaysLarge(result, table),
  },
  {
    label: "a cube's top portal, its aperture straddling the camera plane",
    world: cube,
    rootCellId: "front",
    maxDepth: 2,
    minPortalScreenAreaPixels: 4,
    cameraPosition: { x: -0.610551, y: 7.498906, z: 1.45 },
    cameraLookAt: { x: -1.598485, y: 7.621336, z: 1.355143 },
    fovDegrees: 70,
    viewportPixels: { width: 803, height: 985 },
    check: (result, table) => checksTopPortalStaysLarge(result, table),
  },
  {
    label: "a tetrahedron portal filling the view from just inside its boundary",
    world: tetrahedron,
    rootCellId: "face-a",
    maxDepth: 2,
    minPortalScreenAreaPixels: 16,
    cameraPosition: { x: 9.461191, y: 6.636625, z: 1.45 },
    cameraLookAt: { x: 9.510715, y: 7.626288, z: 1.31541 },
    fovDegrees: 70,
    viewportPixels: { width: 1053, height: 665 },
    check: (result, table) => {
      const directFaceBPath = table.paths.find(
        (path) => path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "1",
      );

      expect(directFaceBPath).toBeDefined();
      const visiblePath = result.visiblePathById.get(directFaceBPath!.id);
      expect(visiblePath).toBeDefined();
      expect(visiblePath?.screenAreaPixels).toBeGreaterThan(100_000);
      expect(visiblePath?.clipRectNdc.minX).toBeLessThanOrEqual(-0.95);
    },
  },
  {
    label: "a cube's left-face portals, captured near-boundary",
    world: cube,
    rootCellId: "left",
    maxDepth: 2,
    minPortalScreenAreaPixels: 4,
    cameraPosition: { x: 6.569187, y: 7.491772, z: 1.45 },
    cameraLookAt: { x: 6.009501, y: 8.267515, z: 1.158498 },
    fovDegrees: 70,
    viewportPixels: { width: 803, height: 985 },
    check: (result) => {
      expect(result.summary.visiblePathCount).toBeGreaterThan(1);
      expect(result.paths.some((path) => path.depth === 1 && path.screenAreaPixels > 10_000)).toBe(true);
    },
  },
  {
    label: "a cube's right-face portals, captured near-boundary",
    world: cube,
    rootCellId: "right",
    maxDepth: 2,
    minPortalScreenAreaPixels: 4,
    cameraPosition: { x: 7.086317, y: 7.489888, z: 1.45 },
    cameraLookAt: { x: 7.256504, y: 8.447983, z: 1.219589 },
    fovDegrees: 70,
    viewportPixels: { width: 803, height: 985 },
    check: (result) => {
      expect(result.summary.visiblePathCount).toBeGreaterThan(1);
      expect(result.paths.some((path) => path.depth === 1 && path.screenAreaPixels > 10_000)).toBe(true);
      expect(result.paths.every((path) => path.clipPolygonNdc.length <= 8)).toBe(true);
    },
  },
];

function checksTopPortalStaysLarge(result: ComputeVisiblePortalPathsResult, table: PortalPathTable): void {
  const topPortalPath = table.paths.find((path) => path.steps.map((step) => step.sourcePortalSideIndex).join(" ") === "2");

  expect(topPortalPath).toBeDefined();
  expect(result.paths.map((path) => path.pathId)).toContain(topPortalPath!.id);
  expect(result.visiblePathById.get(topPortalPath!.id)?.screenAreaPixels).toBeGreaterThan(10_000);
  expect(result.visiblePathById.get(topPortalPath!.id)?.clipRectNdc.maxX).toBeGreaterThan(0.95);
}

describe.each(capturedBoundaryPoseCases)("captured near-boundary camera pose: $label", (testCase) => {
  it("keeps the expected portal view stable", () => {
    const world = compileCellComplex(testCase.world);
    const table = buildPortalPathTables(world, { maxDepth: testCase.maxDepth }).tablesByRootCellId.get(testCase.rootCellId)!;
    const camera = createCameraAt(testCase.cameraPosition, testCase.cameraLookAt, {
      fovDegrees: testCase.fovDegrees,
      aspect: testCase.viewportPixels.width / testCase.viewportPixels.height,
    });
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: testCase.rootCellId,
      pathTable: table,
      camera,
      viewportPixels: testCase.viewportPixels,
      options: defaultOptions({ maxDepth: testCase.maxDepth, minPortalScreenAreaPixels: testCase.minPortalScreenAreaPixels }),
    });

    testCase.check(result, table);
  });
});

// Reference implementation of the visibility rule that loops over the whole table in table order (parents first)
// instead of using the stack traversal. Returns the pre-budget set of kept path ids.
function referenceVisibleIds(
  world: ReturnType<typeof compileCellComplex>,
  table: PortalPathTable,
  camera: THREE.PerspectiveCamera,
  viewportPixels: { width: number; height: number },
  options: { maxDepth: number; minPortalScreenAreaPixels: number },
): Set<number> {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const eye = threePointToWorld(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld));
  const sectorByPathId = new Map<number, DirectionSector>([[0, { full: true }]]);
  const terminalByPathId = new Map<number, boolean>([[0, options.maxDepth <= 0]]);
  const visible = new Set<number>([0]);
  const out = new Float64Array(18);

  for (const path of table.paths) {
    if (path.depth === 0 || path.depth > options.maxDepth || path.parentPathId === undefined) {
      continue;
    }

    const parentSector = sectorByPathId.get(path.parentPathId);

    if (!parentSector || terminalByPathId.get(path.parentPathId)) {
      continue;
    }

    const parent = table.pathsById.get(path.parentPathId)!;
    const step = path.steps[path.steps.length - 1];
    const portal = path.newestPortalInRoot
      ?? developPortalSegment(world, step.sourceCellId, step.sourcePortalSideIndex, parent.rootFromDestination);
    const sector = clipSectorByPortal(parentSector, portal, eye);

    if (!sector || sector.full) {
      continue;
    }

    const planes = funnelClipPlanes(sector.right, sector.left, portal, eye);
    const count = clipPlanesToNdcPolygon(planes, camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, out);
    let twice = 0;

    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;

      twice += out[index * 2] * out[next * 2 + 1] - out[next * 2] * out[index * 2 + 1];
    }

    const area = count >= 3 ? Math.abs(twice) / 2 * viewportPixels.width * viewportPixels.height / 4 : 0;

    if (!(area > 0)) {
      continue;
    }

    visible.add(path.id);
    sectorByPathId.set(path.id, sector);
    terminalByPathId.set(path.id, area < options.minPortalScreenAreaPixels || path.depth >= options.maxDepth);
  }

  return visible;
}

describe("computeVisiblePortalPaths traversal", () => {
  const viewportPixels = { width: 800, height: 600 };
  const options = defaultOptions({ maxDepth: 6, maxVisiblePaths: 100_000, minPortalScreenAreaPixels: 16 });

  it("visits the same paths as a full-table scan (mono)", () => {
    const world = compileCellComplex(cube);
    const table = buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: 1e-6 }).tables.tablesByRootCellId.get("front")!;
    const cameras = [
      createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      createCamera({ x: 7.49, y: 1, z: 1.45 }, { x: 6, y: 3, z: 1.45 }, 70),
      createCamera({ x: 1, y: 1, z: 1.45 }, { x: 4, y: 1, z: 1.45 - 3 * Math.tan(Math.PI / 6) }, 90),
    ];

    for (const camera of cameras) {
      const result = computeVisiblePortalPaths({ world, rootCellId: "front", pathTable: table, camera, viewportPixels, options });
      const expected = referenceVisibleIds(world, table, camera, viewportPixels, options);

      expect(new Set(result.paths.map((path) => path.pathId))).toEqual(expected);
      expect(expected.size).toBeGreaterThan(3);
    }
  });

  it("visits the same paths as a full-table scan for each eye (shared-root stereo)", () => {
    const world = compileCellComplex(cube);
    const table = buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: 1e-6 }).tables.tablesByRootCellId.get("front")!;
    const eyes = [
      createCamera({ x: -0.032, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      createCamera({ x: 0.032, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
    ];
    const batched = computeIndependentVisiblePortalPaths({ world, rootCellId: "front", pathTable: table, cameras: eyes, viewportPixels, options });

    expect(batched).toHaveLength(2);
    eyes.forEach((eye, index) => {
      const ids = new Set(batched[index].paths.map((path) => path.pathId));
      const alone = computeVisiblePortalPaths({ world, rootCellId: "front", pathTable: table, camera: eye, viewportPixels, options });

      expect(ids).toEqual(referenceVisibleIds(world, table, eye, viewportPixels, options));
      expect(ids).toEqual(new Set(alone.paths.map((path) => path.pathId)));
    });
  });

  it("examines only the children of visible non-terminal parents", () => {
    const world = compileCellComplex(cube);
    const table = buildStaticallyCulledPortalPathTables(world, { maxDepth: 10, toleranceMeters: 1e-6 }).tables.tablesByRootCellId.get("front")!;

    expect(table.paths.length).toBeGreaterThan(1000);

    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.45 }, { x: 0, y: 7.5, z: 1.45 }, 20),
      viewportPixels,
      options: defaultOptions({ maxDepth: 10, maxVisiblePaths: 100_000, minPortalScreenAreaPixels: 16 }),
    });
    const childCount = result.paths
      .filter((path) => !path.terminal)
      .reduce((sum, path) => sum + (table.pathsByParentPathId.get(path.pathId)?.length ?? 0), 0);

    expect(result.summary.examinedPathCount).toBe(childCount);
    expect(result.summary.examinedPathCount).toBeLessThan(table.paths.length * 0.1);
  });

  it("returns four clip planes and at most eight polygon vertices for every path", () => {
    const world = compileCellComplex(cube);
    const table = buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: 1e-6 }).tables.tablesByRootCellId.get("front")!;
    const result = computeVisiblePortalPaths({
      world,
      rootCellId: "front",
      pathTable: table,
      camera: createCamera({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 2, z: 1.6 }, 110),
      viewportPixels,
      options,
    });

    for (const path of result.paths) {
      expect(path.clipPlanes).toHaveLength(16);
      expect(path.clipPolygonNdc.length).toBeLessThanOrEqual(8);
    }
  });

});

function defaultOptions(
  overrides: Partial<Parameters<typeof computeVisiblePortalPaths>[0]["options"]> = {},
): Parameters<typeof computeVisiblePortalPaths>[0]["options"] {
  return {
    maxDepth: 1,
    maxVisiblePaths: 100,
    minPortalScreenAreaPixels: 1,
    includeRootCell: true,
    sortMode: "depth-then-area",
    ...overrides,
  };
}

// Positional-argument convenience over the shared builder, matching every call site in this file.
function createCamera(
  position: { readonly x: number; readonly y: number; readonly z: number },
  lookAt: { readonly x: number; readonly y: number; readonly z: number },
  fovDegrees = 70,
  aspect = 800 / 600,
): THREE.PerspectiveCamera {
  return createCameraAt(position, lookAt, { fovDegrees, aspect });
}

function groupByDestination(paths: ComputeVisiblePortalPathsResult["paths"]): Map<string, ComputeVisiblePortalPathsResult["paths"]> {
  const groups = new Map<string, ComputeVisiblePortalPathsResult["paths"]>();

  for (const path of paths) {
    groups.set(path.destinationCellId, [...(groups.get(path.destinationCellId) ?? []), path]);
  }

  return groups;
}

function fakeVisibleResult(pathIds: readonly number[]): Pick<ComputeVisiblePortalPathsResult, "visiblePathById"> {
  return {
    visiblePathById: new Map(
      pathIds.map((pathId) => [
        pathId,
        {
          pathId,
          destinationCellId: "room-b",
          depth: 1,
          rootFromDestinationMatrix: identityRigidTransform3,
          clipPlanes: new Float64Array(16),
          terminal: false,
          clipPolygonNdc: [],
          clipRectNdc: { minX: -0.1, minY: -0.1, maxX: 0.1, maxY: 0.1 },
          screenAreaPixels: 12,
        },
      ]),
    ),
  };
}

function expectVisibleResultsEquivalent(
  actual: ComputeVisiblePortalPathsResult,
  expected: ComputeVisiblePortalPathsResult,
): void {
  expect(actual.summary).toEqual(expected.summary);
  expect(actual.paths).toHaveLength(expected.paths.length);

  for (let index = 0; index < expected.paths.length; index += 1) {
    const actualPath = actual.paths[index];
    const expectedPath = expected.paths[index];

    expect(actualPath.pathId).toBe(expectedPath.pathId);
    expect(actualPath.destinationCellId).toBe(expectedPath.destinationCellId);
    expect(actualPath.depth).toBe(expectedPath.depth);
    expect(actualPath.rootFromDestinationMatrix).toEqual(expectedPath.rootFromDestinationMatrix);
    expect(actualPath.clipPolygonNdc).toHaveLength(expectedPath.clipPolygonNdc.length);
    actualPath.clipPolygonNdc.forEach((point, pointIndex) => {
      expect(point.x).toBeCloseTo(expectedPath.clipPolygonNdc[pointIndex].x, 12);
      expect(point.y).toBeCloseTo(expectedPath.clipPolygonNdc[pointIndex].y, 12);
    });
    expect(actualPath.clipRectNdc.minX).toBeCloseTo(expectedPath.clipRectNdc.minX, 12);
    expect(actualPath.clipRectNdc.minY).toBeCloseTo(expectedPath.clipRectNdc.minY, 12);
    expect(actualPath.clipRectNdc.maxX).toBeCloseTo(expectedPath.clipRectNdc.maxX, 12);
    expect(actualPath.clipRectNdc.maxY).toBeCloseTo(expectedPath.clipRectNdc.maxY, 12);
    expect(actualPath.screenAreaPixels).toBeCloseTo(expectedPath.screenAreaPixels, 8);
  }
}
