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
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { createGeodesicRuntimeRenderSources } from "../../src/render/three/geodesicCannonRenderer";
import { createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import {
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { createPlayerRoverRenderModel, type PlayerRoverRenderModel } from "../../src/render/three/playerRoverModel";
import { exemptFromPortalGhosts, portalGhostExemptions, type PortalGhostedRecords } from "../../src/render/three/runtimeObjectGhostRecords";
import {
  createRuntimeObjectInstanceSync,
  runtimeObjectRecordSources,
  type RuntimeObjectRecordSource,
} from "../../src/render/three/runtimeObjectInstanceSync";
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
import { readGlbBounds } from "../support/glbBounds";
import { createTestAppSession } from "../support/appSession";
import { createFakePreparedAssets } from "../support/preparedAssets";
import type { PlayerPose } from "../../src/movement/playerPose";

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

/** The drawn model of one object: a small box, `drawnOffsetX` m from the object's origin along its own x axis, or a box with nothing measurable. */
function rootFor(object: RuntimeWorldObject, drawn: { readonly offsetX?: number; readonly measurable?: boolean } = {}): THREE.Object3D {
  const root = new THREE.Group();
  const model = new THREE.Mesh(drawn.measurable === false ? new THREE.BoxGeometry(0, 0.2, 0) : new THREE.BoxGeometry(0.2, 0.2, 0.2));
  model.position.x = drawn.offsetX ?? 0;
  root.add(model);
  if (object.kind === "placed-flag") {
    root.children[0].name = "fake-sign-board";
    for (const side of ["front", "back"]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(drawn.measurable === false ? 0 : 0.1, drawn.measurable === false ? 0 : 0.1));
      plane.name = `placed-flag-text-plane:${object.id}:${side}`;
      root.add(plane);
    }
  }
  return root;
}

function setup(
  objects: RuntimeWorldObject[],
  drawn: Parameters<typeof rootFor>[1] = {},
  player: { readonly rover?: PlayerRoverRenderModel; readonly pose?: PlayerPose } = {},
) {
  const world = compileCellComplex(twoRooms());
  const registry = createRuntimeObjectRegistry(objects);
  const geodesicRenderSources = createGeodesicRuntimeRenderSources();
  const renderArchetypesByKey = new Map<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>();
  const sync = createRuntimeObjectInstanceSync({
    registry,
    runtimeObjectRootsById: new Map(objects.map((object) => [object.id, rootFor(object, drawn)])),
    renderSourcesByKey: new Map<string, RuntimeObjectRenderSourceMesh>(),
    renderArchetypesByKey,
    renderRoot: new THREE.Group(),
    geodesicRenderSources,
    geodesicArchetypeKeys: geodesicRenderSources.map((source) => source.archetypeKey),
    playerRoverRenderModel: player.rover,
    maxVisiblePaths: 4,
    diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
    getWorld: () => world,
    session: createTestAppSession(player.pose ? { playerPose: player.pose } : {}),
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

/** The kinds whose drawn part is the model of their own root (not a fixed geodesic part), with a collision cylinder the test can size. */
const modelKinds = ["geodesci-marmot", "geo-mouse", "geo-butterfly", "asset", "placed-flag"] as const;

describe("portal ghosts follow what is drawn, not the collision shape", () => {
  for (const kind of modelKinds) {
    const kindCase = kinds[kind] as Extract<KindCase, { object: unknown }>;
    // Not turned, so that the drawn model's offset along the object's own x axis is an offset along the world x axis, toward the west wall at -1.
    const at = (x: number) => ({
      ...kindCase.object("room-b", x, 0),
      localPose: yawRigidTransform3(0, { x, y: 0, z: 0 }),
      collision: simpleCollisionCylinder(0.3, 0.2),
    }) as RuntimeWorldObject;

    it(`ghosts a ${kind} whose drawn model reaches the portal, with the origin 0.3 m clear of it`, () => {
      const { sync, renderArchetypesByKey } = setup([at(-0.7)], { offsetX: -0.3 });

      sync.sync(frame());

      for (const [key, archetype] of bodyArchetypes(renderArchetypesByKey)) {
        expect(archetype.mesh.count, key).toBe(2);
      }
    });

    it(`draws no ghost of a ${kind} whose collision, not its model, reaches the portal`, () => {
      const { sync, renderArchetypesByKey } = setup([at(-0.85)], { offsetX: 0.3 });

      sync.sync(frame());

      for (const [key, archetype] of bodyArchetypes(renderArchetypesByKey)) {
        expect(archetype.mesh.count, key).toBe(1);
      }
    });

    it(`fails loudly when the drawn model of a ${kind} has nothing measurable`, () => {
      const { sync } = setup([at(-0.7)], { measurable: false });

      expect(() => sync.sync(frame())).toThrow(/Render footprint missing/);
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

/** The real rover model, as the renderer places it: the bounds of `rover.glb` as one box under the model's scale and half turn. */
function realRover(): PlayerRoverRenderModel {
  const bounds = readGlbBounds(new URL("../../public/assets/rover/rover.glb", import.meta.url));
  const size = bounds.max.map((max, axis) => max - bounds.min[axis]);
  const centre = bounds.max.map((max, axis) => (max + bounds.min[axis]) / 2);
  const assets = createFakePreparedAssets({
    instantiateGltf: () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]).translate(centre[0], centre[1], centre[2])));
      return { scene, animations: [] };
    },
  });
  return createPlayerRoverRenderModel(assets)!;
}

const poseAt = (x: number): PlayerPose => ({ cellId: "room-b", position: { x, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 });

/** What each source of the sync's records is checked by. A new source must be listed in `runtimeObjectRecordSources` and then here. */
const sourceChecks: Record<RuntimeObjectRecordSource, { readonly coveredBy: string } | { readonly exempt: keyof typeof portalGhostExemptions }> = {
  "runtime-objects": { coveredBy: "the per-kind tests above" },
  "geodesic-body-parts": { coveredBy: "the geodesic-cannon and geodesic-intersection kinds above" },
  "geodesic-segments": { exempt: "geodesic-segment" },
  "carry-highlight": { coveredBy: "tests/render/carryHighlight.test.ts (a shape across a portal is drawn on both sides)" },
  "player-rover": { coveredBy: "the player rover tests below" },
};

describe("every source of render records has a ghost check", () => {
  it("names a check or an exemption with a reason for every source", () => {
    for (const source of runtimeObjectRecordSources) {
      const check = sourceChecks[source];
      if ("exempt" in check) {
        expect(portalGhostExemptions[check.exempt].length, source).toBeGreaterThan(20);
      } else {
        expect(check.coveredBy.length, source).toBeGreaterThan(10);
      }
    }
  });

  it("accepts records only after the ghost rule: raw records are a type error", () => {
    const raw: readonly [] = [];
    // @ts-expect-error raw render records are not PortalGhostedRecords: they need a footprint (the ghost function) or an exemption with a reason
    const rejected: PortalGhostedRecords = raw;

    expect(rejected).toBe(raw);
    expect(exemptFromPortalGhosts("nothing-drawn", [])).toEqual([]);
    expect(() => exemptFromPortalGhosts("not-a-reason" as "nothing-drawn", [])).toThrow(/Unknown portal-ghost exemption/);
  });
});

describe("the player's rover is ghosted through the portal it stands at", () => {
  // The rover's own copy is never drawn in the root cell (it is the viewer's own body), so what shows at a portal is its copy in the other room.
  const roverCopies = (rover: PlayerRoverRenderModel, x: number) => {
    const { sync, renderArchetypesByKey } = setup([], {}, { rover, pose: poseAt(x) });
    sync.sync(frame());
    return [...renderArchetypesByKey.entries()]
      .filter(([key]) => key.startsWith(`${rover.archetypeKeyPrefix}:mesh:`))
      .reduce((count, [, archetype]) => count + archetype.mesh.count, 0);
  };

  it("draws a copy of the rover beyond the portal when it stands 0.05 m from it", () => {
    const rover = realRover();

    expect(roverCopies(rover, -0.95)).toBeGreaterThan(0);
  });

  it("draws none far from every portal (the rover's own copy is not drawn at the root)", () => {
    expect(roverCopies(realRover(), 0)).toBe(0);
  });

  it("fails loudly when the rover has nothing measurable to ghost", () => {
    const empty = createPlayerRoverRenderModel(
      createFakePreparedAssets({
        instantiateGltf: () => {
          const scene = new THREE.Group();
          scene.add(new THREE.Mesh(new THREE.BoxGeometry(0, 0.2, 0)));
          return { scene, animations: [] };
        },
      }),
    )!;

    expect(() => roverCopies(empty, -0.95)).toThrow(/Render footprint missing/);
  });
});