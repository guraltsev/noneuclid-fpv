import { describe, expect, it } from "vitest";
import { worldObjectLibrary } from "../../src/world-objects/library";
import { standardUserRobotObject, userObjectClass } from "../../src/world-objects/library";
import {
  butterflyVerticalOscillationHeightMagnitudeMeters,
  butterflyVerticalOscillationRateHz,
} from "../../src/world-objects/simpleGeoCreature";

describe("worldObjectLibrary", () => {
  it("maps static wrappers to the expected asset paths and ids", () => {
    expect(
      worldObjectLibrary.small_house("front-house", {
        position: [-1, 0, 2],
        scale: 3,
        turn: 15,
      }),
    ).toMatchObject({
      id: "front-house",
      kind: "asset",
      assetPath: "small_house/small_house.glb",
      position: { x: -1, y: 2, z: 0 },
      scale: 7.5,
      modelOffset: { x: 0, y: 0, z: 3.75 },
      turnRadians: Math.PI / 12,
      yawRadians: Math.PI / 12,
      class: "house",
    });

    expect(
      worldObjectLibrary.tree("right-tree", {
        position: [0.5, 0, -0.5],
      }),
    ).toMatchObject({
      id: "right-tree",
      kind: "asset",
      assetPath: "Tree1/Tree.glb",
      position: { x: 0.5, y: -0.5, z: 0 },
    });

    expect(
      worldObjectLibrary.grass("top-grass", {
        position: [0, 0, 0],
      }),
    ).toMatchObject({
      id: "top-grass",
      assetPath: "grass1/Grass.glb",
    });

    expect(
      worldObjectLibrary.tree_swirl("swirl", {
        position: [0, 0, 0],
      }),
    ).toMatchObject({
      id: "swirl",
      assetPath: "TreeSwirl/tree_swirl.glb",
    });
  });

  it.each([
    ["bicycle", "bicycle/Bicycle.glb"],
    ["flower_group", "FloweGroup/flower_group.glb"],
    ["flower_pot", "flowerPot/flower_pot.glb"],
    ["stop_sign", "stopsign/stop_sign.glb"],
    ["traffic_cone", "trafficCone/Cone.glb"],
    ["clock", "_legacy/clock_low_poly/scene.gltf"],
    ["campfire", "_legacy/low_poly_campfire/scene.gltf"],
    ["rocks", "_legacy/low_poly_rocks/scene.gltf"],
    ["emergency_button", "_legacy/low_poly_emergency_button/scene.gltf"],
  ] as const)("maps %s to %s", (libraryKey, assetPath) => {
    expect(
      worldObjectLibrary[libraryKey](`${libraryKey}-object`, {
        position: [0, 0, 0],
      }),
    ).toMatchObject({
      id: `${libraryKey}-object`,
      kind: "asset",
      assetPath,
    });
  });

  it("raises benches so the seat surface is above the floor", () => {
    expect(
      worldObjectLibrary.bench("bench-object", {
        position: [0, 0, 0],
        scale: 2,
      }),
    ).toMatchObject({
      id: "bench-object",
      kind: "asset",
      assetPath: "Bench/Bench.glb",
      scale: 1.8,
      modelOffset: { x: 0, y: 0, z: 0.81 },
    });
  });

  it("adds a player collision cylinder to small houses", () => {
    const object = worldObjectLibrary.small_house("front-house", {
      position: [0, 0, 0],
    });

    expect(object.kind).toBe("asset");
    expect(object.collision).toEqual({
      radius: 1.2000000000000002,
      height: 2.1,
      offset: {
        x: 0.17220746725797653,
        y: -0.08449252694845199,
        z: 1.05,
      },
    });
  });

  it("keeps base collision classes and collision areas in library definitions", () => {
    expect(worldObjectLibrary.tree("tree-a", { position: [0, 0, 0], scale: 2 })).toMatchObject({
      class: "tree",
      collision: {
        radius: 0.84,
        height: 6.2,
        offset: { x: 0, y: 0, z: 3.1 },
      },
    });

    expect(worldObjectLibrary.stop_sign("stop-a", { position: [0, 0, 0], scale: 2 })).toMatchObject({
      class: "sign",
      scale: 0.06,
      collision: {
        radius: 0.64,
        height: 4.3,
        offset: { x: 0, y: 0, z: 2.15 },
      },
    });
  });

  it("lets authored instances override documented collision metadata without changing library defaults", () => {
    const object = worldObjectLibrary.grass("soft-grass", {
      position: [0, 0, 0],
      class: "soft-groundcover",
      do_not_collide_with: [userObjectClass, "creature"],
    });

    expect(object).toMatchObject({
      class: "soft-groundcover",
      do_not_collide_with: [userObjectClass, "creature"],
    });
  });

  it("defines the automatic user robot as a standard library object", () => {
    expect(standardUserRobotObject).toMatchObject({
      id: "user-robot",
      class: userObjectClass,
      assetPath: "rover/rover.glb",
      scale: 0.1925,
      collision: {
        radius: 0.32,
        height: 1,
      },
    });
  });

  it("makes trees taller and narrower using per-axis scaling", () => {
    const object = worldObjectLibrary.tree("left-tree", {
      position: [0, 0, 0],
      scale: 3,
    });

    expect(object.scale).toBe(3);
    expect(object.scaleXYZ?.x).toBeCloseTo(0.04);
    expect(object.scaleXYZ?.y).toBeCloseTo(0.05);
    expect(object.scaleXYZ?.z).toBeCloseTo(0.04);
  });

  it("scales stop signs down from their oversized source model", () => {
    expect(
      worldObjectLibrary.stop_sign("tiny-stop", {
        position: [0, 0, 0],
        scale: 0.8,
      }),
    ).toMatchObject({
      id: "tiny-stop",
      kind: "asset",
      assetPath: "stopsign/stop_sign.glb",
      scale: 0.024,
    });
  });

  it("creates geo mice as dynamic specs with authored speed and oscillation", () => {
    const object = worldObjectLibrary.geo_mouse("front-runner", {
      position: [-4.2, 0, -1.8],
      scale: 1.05,
      turn: 74,
      speed: 2.4,
      oscillationRate: 1.6,
      oscillationMagnitude: 0.18,
    });

    expect(object).toMatchObject({
      id: "front-runner",
      kind: "geo-mouse",
      assetPath: "mouse/Mouse.glb",
      position: { x: -4.2, y: -1.8, z: 0 },
      scale: 0.035,
      turnRadians: (74 * Math.PI) / 180,
      yawRadians: (74 * Math.PI) / 180,
      speedMetersPerSecond: 2.4,
      oscillationRateHz: 1.6,
      oscillationMagnitudeMeters: 0.18,
    });

    if (object.kind !== "geo-mouse") {
      throw new Error("Expected a geo mouse.");
    }

    expect(object.collision.radius).toBeCloseTo(0.76125);
    expect(object.collision.height).toBeCloseTo(1.114935);
    expect(object.collision.offset?.y).toBeCloseTo(0.3675);
    expect(object.collision.offset?.z).toBeCloseTo(0.567468);
  });

  it("creates geo butterflies as dynamic specs", () => {
    const object = worldObjectLibrary.geo_butterfly("flutter", {
      position: [1, 2, 3],
      speed: 0.8,
    });

    expect(object).toMatchObject({
      id: "flutter",
      kind: "geo-butterfly",
      assetPath: "butterfly/Butterfly.glb",
      position: { x: 1, y: 3, z: 2 },
      scale: 0.8,
      speedMetersPerSecond: 0.8,
    });

    if (object.kind !== "geo-butterfly") {
      throw new Error("Expected a geo butterfly.");
    }

    expect(object.collision.radius).toBeCloseTo(0.6204);
    expect(object.collision.height).toBeCloseTo(0.738591);
    expect(object.collision.offset).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
    expect(object.collision.offset?.x).toBeCloseTo(0.013101);
    expect(object.collision.offset?.y).toBeCloseTo(0.036391);
    expect(object.collision.offset?.z).toBeCloseTo(0.379296);
  });

  it("gives butterflies bounded vertical bobbing with a tenth-second random rate bucket", () => {
    const object = worldObjectLibrary.geo_butterfly("flutter", {
      position: [1, 2, 3],
      oscillationRate: 1.2,
      oscillationMagnitude: 0.3,
    });

    if (object.kind !== "geo-butterfly") {
      throw new Error("Expected a geo butterfly.");
    }

    const firstBucketRate = butterflyVerticalOscillationRateHz(object, 0.04);
    const sameBucketRate = butterflyVerticalOscillationRateHz(object, 0.09);
    const nextBucketRate = butterflyVerticalOscillationRateHz(object, 0.11);

    expect(firstBucketRate).toBe(sameBucketRate);
    expect(firstBucketRate).toBeGreaterThanOrEqual(1.2 * 1.31);
    expect(firstBucketRate).toBeLessThanOrEqual(2);
    expect(nextBucketRate).not.toBe(firstBucketRate);
    expect(butterflyVerticalOscillationHeightMagnitudeMeters(object)).toBeCloseTo(0.073859);
  });

});
