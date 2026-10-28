import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { torus } from "../../src/authoring/exampleWorlds";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";
import { createTorusSkewCellDeformationMaps, createTorusSkewDeformationFamily } from "../../src/runtime/deformations/torusSkewDeformation";
import { transformPoseWithCellMaps } from "../../src/runtime/worldGeometryDeformations";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry, createRuntimeStaticAssetObject } from "../../src/world-objects/runtimeObjectRegistry";
import { createSimpleGeoCreature, createSimpleGeoCreatureRuntime } from "../../src/world-objects/simpleGeoCreature";

describe("world geometry runtime transforms", () => {
  it("recomputes authored starting position from the deformed spec", () => {
    const family = createTorusSkewDeformationFamily();
    const spec = family.applyToSpec(withStartingPosition(), skewState(3));

    expect(spec.startingPosition?.position.x).toBeCloseTo(0.6);
    expect(spec.startingPosition?.position.y).toBeCloseTo(3);
    expect(spec.startingPosition?.position.z).toBeCloseTo(1);
    expect(spec.startingPosition?.yawRadians).toBeCloseTo(Math.atan2(15, 3));
  });

  it("rebuilds authored static asset collision records from the deformed spec pose", () => {
    const family = createTorusSkewDeformationFamily();
    const spec = family.applyToSpec(torus, skewState(2));
    const cell = spec.cells[0];
    const bench = cell.visuals?.objects?.find((object) => object.id === "torus-bench");

    expect(bench?.kind).toBe("asset");
    if (bench?.kind !== "asset") {
      throw new Error("Expected torus bench asset.");
    }

    const runtimeObject = createRuntimeStaticAssetObject(bench, cell.id);

    expect(runtimeObject.localPose.translation).toEqual(bench.position);
    expect(runtimeObject.collision).toBe(bench.collision);
  });

  it("transforms placed sign pose and yaw through the dynamic-object map", () => {
    const maps = createTorusSkewCellDeformationMaps(skewState(0), skewState(2));
    const flag = createPlacedFlagObject({
      id: "flag",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI / 2, vec3(0, 3, 0)),
      flagType: "WoodenSign1",
    });
    const transformed = transformPoseWithCellMaps(flag, maps);

    expect(transformed?.localPose.translation.x).toBeCloseTo(0.4);
    expect(transformed?.localPose.translation.y).toBeCloseTo(3);
    expect(transformed?.localPose.translation.z).toBeCloseTo(0);
    expect(transformed ? Math.atan2(transformed.localPose.rotation.m10, transformed.localPose.rotation.m00) : 0)
      .toBeCloseTo(Math.atan2(15, 2));
  });

  it("keeps dynamic creature private state and registry state aligned after deformation", () => {
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 3],
      scale: 0.1,
      speed: 0,
      turn: 90,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "torus-room", stubAssets(), registry);
    const maps = createTorusSkewCellDeformationMaps(skewState(0), skewState(2));

    runtime.transformGeometry(maps);

    const object = registry.get("mouse");
    expect(object?.kind).toBe("geo-mouse");
    expect(object?.localPose.translation.x).toBeCloseTo(0.4);
    expect(object?.localPose.translation.y).toBeCloseTo(3);
    expect(object?.localPose.translation.z).toBeCloseTo(0);
    expect(runtime.root.position.x).toBeCloseTo(0.4);
  });
});

function withStartingPosition(): CellComplexSpec {
  return {
    ...torus,
    startingPosition: {
      cellId: "torus-room",
      position: { x: 0, y: 3, z: 1 },
      yawRadians: Math.PI / 2,
      pitchRadians: 0,
    },
  };
}

function skewState(skewXMeters: number) {
  return {
    kind: "torus-skew" as const,
    cellId: "torus-room" as const,
    widthMeters: 15,
    depthMeters: 15,
    skewXMeters,
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
