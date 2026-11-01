/**
 * `tests/render/runtimeObjectPortalGhostContract.test.ts` — unit tier.
 *
 * The portal-ghost contract of the runtime-object instance sync: every drawn part of every kind of runtime object is also drawn on the other
 * side of a portal it stands at, through the one general ghost mechanism (`collectRuntimeObjectRenderRecordsWithPortalGhosts`). An object 0.05 m
 * from a portal wall seen from the other room must have a second copy of each of its parts, not be cut off at the portal.
 *
 * The table of kinds is keyed by every `kind` of `RuntimeWorldObject`, so adding a kind to the union fails typecheck until the kind is listed
 * here with an object to test, or with the reason it needs no ghosts. That is what stops the same gap from being found one kind at a time.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createGeodesicRuntimeRenderSources } from "../../src/render/three/geodesicCannonRenderer";
import { createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import {
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { createRuntimeObjectInstanceSync } from "../../src/render/three/runtimeObjectInstanceSync";
import type { RuntimeObjectRenderSourceMesh } from "../../src/render/three/runtimeObjectRenderRecords";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import type { GeodesicIntersectionObject } from "../../src/world-objects/geodesic/objects";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import {
  createRuntimeObjectRegistry,
  createRuntimeStaticAssetObject,
  type RuntimeWorldObject,
} from "../../src/world-objects/runtimeObjectRegistry";
import type { MeasuredGeodesicLengthObject, ProtractorAngleObject } from "../../src/world-objects/toolObjects";
import { createTestAppSession } from "../support/appSession";

type Kind = RuntimeWorldObject["kind"];

/** An object to place at the portal, or the reason its kind needs no ghosts. */
type KindCase = { readonly object: (cellId: string, x: number, y: number) => RuntimeWorldObject } | { readonly exempt: string };

const standing = (x: number, y: number) => yawRigidTransform3(0.3, { x, y, z: 0 });
const creature = (kind: "geodesci-marmot" | "geo-mouse" | "geo-butterfly"): KindCase => ({
  object: (cellId, x, y) => ({ id: "subject", kind, cellId, localPose: standing(x, y), portalRenderable: true }),
});
const notDrawn = "not portalRenderable: it is data, never drawn as a body in a portal view";

/** Every kind of runtime object. A new kind must be added here (typecheck fails otherwise). */
const kinds: Record<Kind, KindCase> = {
  "geodesci-marmot": creature("geodesci-marmot"),
  "geo-mouse": creature("geo-mouse"),
  "geo-butterfly": creature("geo-butterfly"),
  asset: {
    object: (cellId, x, y) => ({
      ...createRuntimeStaticAssetObject({ id: "subject", kind: "asset", assetPath: "models/house.glb", position: { x, y, z: 0 } }, cellId),
      localPose: standing(x, y),
    }),
  },
  "placed-flag": {
    object: (cellId, x, y) => createPlacedFlagObject({ id: "subject", cellId, localPose: standing(x, y), flagType: "WoodenSign1" }),
  },
  "geodesic-cannon": {
    object: (cellId, x, y) => ({
      ...createGeodesicCannonObject({ id: "subject", cellId, localPose: standing(x, y) }),
      geodesicIds: ["g1"],
      activeGeodesicId: "g1",
    }),
  },
  "geodesic-intersection": {
    object: (cellId, x, y): GeodesicIntersectionObject => ({
      id: "subject",
      kind: "geodesic-intersection",
      cellId,
      localPose: standing(x, y),
      portalRenderable: true,
      geodesicIds: ["g1", "g2"],
      segmentIds: ["g1:segment:0", "g2:segment:0"],
    }),
  },
  "measured-geodesic-length": {
    object: (cellId, x, y): MeasuredGeodesicLengthObject => ({
      id: "subject",
      kind: "measured-geodesic-length",
      cellId,
      localPose: standing(x, y),
      portalRenderable: true,
      geodesicId: "g1",
      lengthMeters: 1,
      labelPoint: { x, y, z: 0 },
    }),
  },
  "protractor-angle": {
    object: (cellId, x, y): ProtractorAngleObject => ({
      id: "subject",
      kind: "protractor-angle",
      cellId,
      localPose: standing(x, y),
      portalRenderable: true,
      centerObjectId: "c",
      centerPoint: { x, y, z: 0 },
      first: { geodesicId: "g1", yawRadians: 0 } as unknown as ProtractorAngleObject["first"],
      second: { geodesicId: "g2", yawRadians: 1 } as unknown as ProtractorAngleObject["second"],
      angleRadians: 1,
      angleDegrees: 57.3,
      radiusMeters: 0.3,
    }),
  },
  "geodesic-segment": {
    exempt: "a segment is computed per cell and continues as the next segment of the geodesic in the next cell; ghosting it would draw it twice",
  },
  "geodesic-interval": { exempt: notDrawn },
  "free-geodesic-end": { exempt: notDrawn },
  "geodesic-corner": { exempt: notDrawn },
  "curve-shortening-pair": { exempt: notDrawn },
};

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function twoRooms(): CellComplexSpec {
  return {
    cells: [
      { id: "room-a", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }] },
      { id: "room-b", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }] },
    ],
  };
}

function path(cellId: string, pathId: number, depth: number): VisiblePortalPath {
  return { ...createRootVisiblePortalPath(cellId), pathId, depth, rootFromDestinationMatrix: new THREE.Matrix4() };
}

/** A frame rooted in room-b that also shows room-a through the west portal (so a copy of the subject in room-a is drawn at its own place). */
function frame() {
  return createFrameRenderSnapshot({
    serial: 1,
    rootCellId: "room-b",
    visiblePathsByDestinationCell: new Map([["room-b", [path("room-b", 0, 0)]], ["room-a", [path("room-a", 1, 1)]]]),
    clipIndexByPathId: new Map(),
    cameraPositions: [],
  });
}

function rootFor(object: RuntimeWorldObject): THREE.Object3D {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
  if (object.kind === "placed-flag") {
    root.children[0].name = "fake-sign-board";
    for (const side of ["front", "back"]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1));
      plane.name = `placed-flag-text-plane:${object.id}:${side}`;
      root.add(plane);
    }
  }
  return root;
}

function setup(objects: RuntimeWorldObject[]) {
  const world = compileCellComplex(twoRooms());
  const registry = createRuntimeObjectRegistry(objects);
  const geodesicRenderSources = createGeodesicRuntimeRenderSources();
  const renderArchetypesByKey = new Map<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>();
  const sync = createRuntimeObjectInstanceSync({
    registry,
    runtimeObjectRootsById: new Map(objects.map((object) => [object.id, rootFor(object)])),
    renderSourcesByKey: new Map<string, RuntimeObjectRenderSourceMesh>(),
    renderArchetypesByKey,
    renderRoot: new THREE.Group(),
    geodesicRenderSources,
    geodesicArchetypeKeys: geodesicRenderSources.map((source) => source.archetypeKey),
    playerRoverRenderModel: undefined,
    maxVisiblePaths: 4,
    diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
    getWorld: () => world,
    session: createTestAppSession(),
    buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
  });
  return { registry, sync, renderArchetypesByKey };
}

/**
 * The archetypes that draw the one subject. The geodesic render sources are shared by every geodesic kind, so archetypes of kinds that are not in
 * the scene exist with no instances; the subject's own copy always counts at least one.
 */
function bodyArchetypes(renderArchetypesByKey: ReadonlyMap<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>) {
  return [...renderArchetypesByKey.entries()].filter(([, archetype]) => archetype.mesh.count > 0);
}

function instancePositions(archetype: { readonly mesh: THREE.InstancedMesh }): THREE.Vector3[] {
  const matrix = new THREE.Matrix4();
  return Array.from({ length: archetype.mesh.count }, (_, index) => {
    archetype.mesh.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

describe("portal ghosts of every kind of runtime object", () => {
  for (const [kind, kindCase] of Object.entries(kinds) as [Kind, KindCase][]) {
    if ("exempt" in kindCase) {
      it(`${kind} is exempt: ${kindCase.exempt.slice(0, 40)}`, () => {
        expect(kindCase.exempt.length).toBeGreaterThan(10);
      });
      continue;
    }

    it(`draws every part of a ${kind} on both sides of the portal it stands at`, () => {
      // 0.05 m inside room-b from its west wall, which is room-a's east wall: the object straddles the portal's clearance.
      const { sync, renderArchetypesByKey } = setup([kindCase.object("room-b", -0.95, 0)]);

      sync.sync(frame());

      const archetypes = bodyArchetypes(renderArchetypesByKey);
      expect(archetypes.length).toBeGreaterThan(0);
      for (const [key, archetype] of archetypes) {
        // One copy in the object's own cell, one ghost in the cell on the other side of the portal.
        expect(archetype.mesh.count, key).toBe(2);
      }
    });

    it(`draws no ghost of a ${kind} that stands far from every portal`, () => {
      const { sync, renderArchetypesByKey } = setup([kindCase.object("room-b", 0, 0)]);

      sync.sync(frame());

      for (const [key, archetype] of bodyArchetypes(renderArchetypesByKey)) {
        expect(archetype.mesh.count, key).toBe(1);
      }
    });
  }
});

describe("the ghosts of an emitter that moves", () => {
  it("follow it: the copy beyond the portal moves with it and goes when it leaves", () => {
    const emitter = kinds["geodesic-cannon"] as Extract<KindCase, { object: unknown }>;
    const at = (x: number, y: number) => emitter.object("room-b", x, y);
    const { registry, sync, renderArchetypesByKey } = setup([at(-0.95, 0)]);
    const postKey = [...(sync.sync(frame()), renderArchetypesByKey.keys())].find((key) => key.startsWith("geodesic-ray:post"))!;
    const spread = () => {
      const [own, ghost] = instancePositions(renderArchetypesByKey.get(postKey)!).sort((left, right) => left.x - right.x);
      return { own, ghost };
    };
    const before = spread();

    registry.update(at(-0.95, 0.3));
    sync.sync(frame());
    const moved = spread();

    // Both copies shifted by the same amount along the portal (the ghost is the emitter seen through the portal).
    expect(moved.own.z - before.own.z).toBeCloseTo(-0.3, 6);
    expect(moved.ghost.z - before.ghost.z).toBeCloseTo(-0.3, 6);
    expect(moved.ghost.x - moved.own.x).toBeCloseTo(before.ghost.x - before.own.x, 6);

    registry.update(at(0, 0.3));
    sync.sync(frame());
    expect(renderArchetypesByKey.get(postKey)!.mesh.count).toBe(1);
  });
});
