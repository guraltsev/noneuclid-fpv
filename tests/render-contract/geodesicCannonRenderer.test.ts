import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildRuntimeObjectRenderArchetype } from "../../src/render/three/runtimeObjectRenderArchetypes";
import {
  collectGeodesicRuntimeRenderRecords,
  composeSegmentMatrix,
  createGeodesicRuntimeRenderSources,
  geodesicIntersectionArchetypePrefix,
  geodesicRayAssetPaths,
  geodesicRayHeadArchetypePrefix,
  geodesicRayPostArchetypePrefix,
  geodesicSegmentConnectedArchetypeKey,
  geodesicSegmentStraighteningArchetypeKey,
  geodesicSegmentTieDetachSelectedArchetypeKey,
  geodesicSegmentArchetypeKey,
  getGeodesicRayArchetypeKeys,
} from "../../src/render/three/geodesicCannonRenderer";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";
import type { GeodesicCannonObject, GeodesicIntersectionObject, GeodesicSegmentObject } from "../../src/world-objects/geodesicCannon";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";

describe("geodesic cannon renderer", () => {
  it("publishes one render record per geodesic segment in the segment cell", () => {
    const segment = createSegment({ cellId: "cell-b", lengthMeters: 1.75 });
    const records = collectGeodesicRuntimeRenderRecords(segment);

    expect(records).toHaveLength(1);
    expect(records[0].objectId).toBe(segment.id);
    expect(records[0].cellId).toBe("cell-b");
    expect(records[0].archetypeKey).toBe(geodesicSegmentArchetypeKey);
  });

  it("publishes connected geodesic segments with the connected archetype", () => {
    const records = collectGeodesicRuntimeRenderRecords(createSegment({
      connectionState: "connected",
      terminal: { kind: "emitter-hit", emitterId: "ray-emitter-b" },
    }));

    expect(records[0].archetypeKey).toBe(geodesicSegmentConnectedArchetypeKey);
  });

  it("publishes straightening geodesic segments with the orange archetype", () => {
    const records = collectGeodesicRuntimeRenderRecords(createSegment({
      connectionState: "straightening",
    }));

    expect(records[0].archetypeKey).toBe(geodesicSegmentStraighteningArchetypeKey);
  });

  it("publishes tie-detach selected geodesic segments with the selection archetype", () => {
    const records = collectGeodesicRuntimeRenderRecords(createSegment({
      connectionState: "connected",
      highlightState: "tie-detach-selected",
    }));

    expect(records[0].archetypeKey).toBe(geodesicSegmentTieDetachSelectedArchetypeKey);
  });

  it("scales the segment record matrix by segment length", () => {
    const matrix = composeSegmentMatrix(createSegment({ lengthMeters: 2.5 }));
    const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    const end = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix);

    expect(end.distanceTo(origin)).toBeCloseTo(2.5);
  });

  it("creates a reusable segment archetype source with portal clip instance attributes", () => {
    const source = createGeodesicRuntimeRenderSources().find(
      (entry) => entry.archetypeKey === geodesicSegmentArchetypeKey,
    );
    expect(source).toBeDefined();

    const archetype = buildRuntimeObjectRenderArchetype(source!, 3, undefined);
    expect(archetype.mesh.geometry.getAttribute("portalPathId")).toBe(archetype.portalPathIdAttribute);
    expect(archetype.mesh.geometry.getAttribute("portalClipIndex")).toBe(archetype.portalClipIndexAttribute);
    expect(archetype.capacity).toBe(3);
  });

  it("publishes ray-emitter-on-post records from shared source archetype keys", () => {
    const sources = createGeodesicRuntimeRenderSources();
    const rayKeys = getGeodesicRayArchetypeKeys(sources);
    const records = collectGeodesicRuntimeRenderRecords(createRayEmitter(), rayKeys);

    expect(rayKeys.length).toBeGreaterThan(0);
    expect(rayKeys.some((key) => key.startsWith(`${geodesicRayPostArchetypePrefix}:`))).toBe(true);
    expect(rayKeys.some((key) => key.startsWith(`${geodesicRayHeadArchetypePrefix}:`))).toBe(true);
    expect(records).toHaveLength(rayKeys.length);
    expect(records.every((record) => record.cellId === "cell-a")).toBe(true);
    expect(records.map((record) => record.objectId)).toContain("ray-emitter-a");
    expect(records.map((record) => record.objectId)).toContain("ray-emitter-a:g-a:head");
  });

  it("publishes one laser emitter head record for each geodesic on the same post", () => {
    const sources = createGeodesicRuntimeRenderSources();
    const rayKeys = getGeodesicRayArchetypeKeys(sources);
    const headKeys = rayKeys.filter((key) => key.startsWith(`${geodesicRayHeadArchetypePrefix}:`));
    const postKeys = rayKeys.filter((key) => key.startsWith(`${geodesicRayPostArchetypePrefix}:`));
    const records = collectGeodesicRuntimeRenderRecords(createRayEmitter({
      geodesicIds: ["g-a", "g-b", "g-c"],
    }), rayKeys);

    expect(records.filter((record) => postKeys.includes(record.archetypeKey))).toHaveLength(postKeys.length);
    expect(records.filter((record) => headKeys.includes(record.archetypeKey))).toHaveLength(headKeys.length * 3);
  });

  it("does not publish laser emitter head records for an empty post", () => {
    const sources = createGeodesicRuntimeRenderSources();
    const rayKeys = getGeodesicRayArchetypeKeys(sources);
    const headKeys = rayKeys.filter((key) => key.startsWith(`${geodesicRayHeadArchetypePrefix}:`));
    const postKeys = rayKeys.filter((key) => key.startsWith(`${geodesicRayPostArchetypePrefix}:`));
    const records = collectGeodesicRuntimeRenderRecords(createRayEmitter({
      activeGeodesicId: undefined,
      geodesicIds: [],
    }), rayKeys);

    expect(records.filter((record) => postKeys.includes(record.archetypeKey))).toHaveLength(postKeys.length);
    expect(records.filter((record) => headKeys.includes(record.archetypeKey))).toHaveLength(0);
  });

  it("publishes balloon records for geodesic intersection vertices", () => {
    const sources = createGeodesicRuntimeRenderSources();
    const keys = sources.map((source) => source.archetypeKey);
    const balloonKeys = keys.filter((key) => key.startsWith(`${geodesicIntersectionArchetypePrefix}:`));
    const records = collectGeodesicRuntimeRenderRecords(createIntersection(), keys);

    expect(balloonKeys.length).toBeGreaterThan(0);
    expect(records).toHaveLength(balloonKeys.length);
    expect(records.every((record) => record.objectId === "vertex-a")).toBe(true);
    expect(records.every((record) => record.cellId === "cell-a")).toBe(true);
  });

  it("raises prepared post assets so the post is not buried below the floor", () => {
    const sources = createGeodesicRuntimeRenderSources(createPreparedRayAssets());
    const postSource = sources.find((source) => source.archetypeKey.startsWith(`${geodesicRayPostArchetypePrefix}:`));

    expect(postSource).toBeDefined();
    const bounds = getSourceMeshWorldBounds(postSource!);

    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
  });
});

function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesic-segment",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0.32 }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: 0.32 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}

function createRayEmitter(overrides: Partial<GeodesicCannonObject> = {}): GeodesicCannonObject {
  return {
    id: "ray-emitter-a",
    kind: "geodesic-cannon",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    collision: { radius: 0.3, height: 0.5 },
    portalRenderable: true,
    activeGeodesicId: "g-a",
    geodesicIds: ["g-a"],
    aimYawRadians: 0,
    ...overrides,
  };
}

function createPreparedRayAssets(): PreparedWorldAssets {
  return {
    getTexture: () => undefined,
    getConfiguredTexture: () => undefined,
    instantiateGltf(assetPath) {
      if (assetPath === geodesicRayAssetPaths.post) {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), new THREE.MeshBasicMaterial()));
        return { scene, animations: [] };
      }

      if (assetPath === geodesicRayAssetPaths.lightsaber) {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), new THREE.MeshBasicMaterial()));
        return { scene, animations: [] };
      }

      if (assetPath === geodesicRayAssetPaths.balloon) {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial()));
        return { scene, animations: [] };
      }

      return undefined;
    },
  };
}

function createIntersection(overrides: Partial<GeodesicIntersectionObject> = {}): GeodesicIntersectionObject {
  return {
    id: "vertex-a",
    kind: "geodesic-intersection",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 1.08 }),
    portalRenderable: true,
    tooltip: { label: "vertex", rangeMeters: 3 },
    geodesicIds: ["g-a", "g-b"],
    segmentIds: ["g-a:segment:0", "g-b:segment:0"],
    ...overrides,
  };
}

function getSourceMeshWorldBounds(source: { readonly mesh: THREE.Mesh }): THREE.Box3 {
  source.mesh.updateWorldMatrix(true, false);
  const geometry = source.mesh.geometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(source.mesh.matrixWorld);
}
