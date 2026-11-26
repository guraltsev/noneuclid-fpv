/**
 * `tests/render/landmarkMotion.test.ts` — unit tier.
 *
 * Moving landmark parts: the schedule rests between turns and turns by whole steps, or turns steadily; the kit gives every part made under
 * `moving` the same motion; the mesh carries pivot, axis and timing per vertex (in Three axes) only when something moves, and marks its
 * material; the shader patch declares what it uses and turns position and normal; the hook survives a clone through userData; a
 * transform moves pivots as points and turns axes; the clock tower's hands, a fir's tiers and the gears really move.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCellLandmarksMesh } from "../../src/render/three/buildCellLandmarks";
import {
  applyLandmarkMotion,
  landmarkMotionTime,
  motionAngleAt,
  patchLandmarkMotionMaterial,
  setLandmarkMotionTime,
  transformMotionAttributes,
} from "../../src/render/three/landmarkMotion";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { build, faceThemes, firTiers } from "../../src/world-assets/faceThemes";
import type { LandmarkPlacement } from "../../src/world-assets/landmarkLayout";
import { measureParts, type LandmarkPart } from "../../src/world-assets/landmarkParts";
import { createSeededRandom } from "../../src/world-assets/seededNoise";

const palette = buildFacePalette(100, "tonal");

function placementOf(parts: readonly LandmarkPart[]): LandmarkPlacement {
  const measure = measureParts(parts);
  return { themeId: "t", kind: "t", role: "minor", x: 1, y: 2, yawRadians: 0, scale: 1, seed: 1, parts, triangles: measure.triangles, footprintRadiusMeters: 1, heightMeters: 1, colliders: [], floating: [] };
}

function compile(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

describe("motion schedule", () => {
  it("rests between turns and makes whole steps", () => {
    const timing = [0.5, 10, 2, 0] as const;
    expect(motionAngleAt(timing, 0)).toBeCloseTo(0, 9);
    expect(motionAngleAt(timing, 1)).toBeCloseTo(0.25, 9);
    expect(motionAngleAt(timing, 2)).toBeCloseTo(0.5, 9);
    expect(motionAngleAt(timing, 7)).toBeCloseTo(0.5, 9);
    expect(motionAngleAt(timing, 22)).toBeCloseTo(1.5, 9);
    expect(motionAngleAt([0, 10, 2, 0], 5)).toBe(0);
  });

  it("turns steadily when a move fills its period", () => {
    expect(motionAngleAt([1, 10, 10, 0], 2.5)).toBeCloseTo(0.25, 9);
    expect(motionAngleAt([1, 10, 10, 3], 2)).toBeCloseTo(0.5, 9);
  });
});

describe("moving parts in the kit and the mesh", () => {
  it("gives every part made under `moving` the same motion, and none after", () => {
    const parts = build(createSeededRandom(1), palette, (kit) => {
      kit.moving({ pivot: [0, 0, 1], axis: [0, 0, 1], step: 1, period: 5, move: 1, phase: 0 }, () => {
        kit.box([0, 0, 0], 1, 1, 1, "primary");
        kit.ball([0, 0, 2], 0.5, 0.5, 0.5, "accent");
      });
      kit.box([2, 0, 0], 1, 1, 1, "dark");
    });
    expect(parts[0].motion).toBeDefined();
    expect(parts[1].motion).toBe(parts[0].motion);
    expect(parts[2].motion).toBeUndefined();
  });

  it("writes pivot, axis and timing per vertex in Three axes and marks the material", () => {
    const parts: LandmarkPart[] = [
      { shape: "box", at: [0, 0, 0], sx: 1, sy: 1, sz: 1, color: "#808080", motion: { pivot: [0.5, 1, 2], axis: [0, 1, 0], step: 0.7, period: 6, move: 2, phase: 1 } },
      { shape: "box", at: [3, 0, 0], sx: 1, sy: 1, sz: 1, color: "#808080" },
    ];
    const mesh = buildCellLandmarksMesh("c", [placementOf(parts)], 0)!;
    const pivot = mesh.geometry.getAttribute("motionPivot");
    const axis = mesh.geometry.getAttribute("motionAxis");
    const timing = mesh.geometry.getAttribute("motionTiming");
    // Placement at (1, 2): the pivot (1.5, 3, 2) cell-local is (1.5, 2, -3) in Three axes; the axis +v is -z.
    expect([pivot.getX(0), pivot.getY(0), pivot.getZ(0)]).toEqual([1.5, 2, -3]);
    expect([axis.getX(0), axis.getY(0), axis.getZ(0)].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 0, -1]);
    expect([timing.getX(0), timing.getY(0), timing.getZ(0), timing.getW(0)].map((value) => Math.fround(value))).toEqual([0.7, 6, 2, 1].map(Math.fround));
    // The second box stands still: a zero step.
    expect(timing.getX(timing.count - 1)).toBe(0);
    expect((mesh.material as THREE.Material).userData.landmarkMotion).toBe(true);

    const still = buildCellLandmarksMesh("c", [placementOf([parts[1]])], 0)!;
    expect(still.geometry.getAttribute("motionPivot")).toBeUndefined();
    expect((still.material as THREE.Material).userData.landmarkMotion).toBeUndefined();
  });

  it("patches the shader to turn position and normal by the shared clock, also on a clone", () => {
    const material = new THREE.MeshLambertMaterial();
    material.userData.landmarkMotion = true;
    patchLandmarkMotionMaterial(material);
    const drawn = applyLandmarkMotion(material.clone());
    const shader = compile(drawn);
    for (const declaration of ["attribute vec3 motionPivot;", "attribute vec3 motionAxis;", "attribute vec4 motionTiming;", "uniform float landmarkMotionTime;"]) {
      expect(shader.vertexShader).toContain(declaration);
    }
    expect(shader.vertexShader.indexOf("objectNormal = landmarkMotionRotate")).toBeGreaterThan(shader.vertexShader.indexOf("#include <beginnormal_vertex>"));
    expect(shader.vertexShader.indexOf("transformed = motionPivot")).toBeGreaterThan(shader.vertexShader.indexOf("#include <begin_vertex>"));
    expect(shader.vertexShader).toContain("#include <project_vertex>");
    expect(shader.uniforms.landmarkMotionTime).toBe(landmarkMotionTime);
    setLandmarkMotionTime(12.5);
    expect(landmarkMotionTime.value).toBe(12.5);
    expect(applyLandmarkMotion(new THREE.MeshLambertMaterial()).customProgramCacheKey()).not.toContain("landmark-motion");
  });

  it("moves pivots as points and turns axes when the geometry is transformed", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("motionPivot", new THREE.BufferAttribute(new Float32Array([1, 0, 0]), 3));
    geometry.setAttribute("motionAxis", new THREE.BufferAttribute(new Float32Array([1, 0, 0]), 3));
    const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(5, 0, 0).multiply(new THREE.Matrix4().makeScale(2, 2, 2));
    transformMotionAttributes(geometry, matrix);
    const pivot = geometry.getAttribute("motionPivot");
    const axis = geometry.getAttribute("motionAxis");
    expect([pivot.getX(0), pivot.getY(0), pivot.getZ(0)].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([5, 0, -2]);
    expect([axis.getX(0), axis.getY(0), axis.getZ(0)].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 0, -1]);
  });
});

describe("what moves", () => {
  const partsOf = (themeId: string, name: string, seed = 3) =>
    faceThemes.find((theme) => theme.id === themeId)!.major.concat(faceThemes.find((theme) => theme.id === themeId)!.minor).find((entry) => entry.name === name)!.build({ random: createSeededRandom(seed), palette });

  it("ticks the clock tower's hands and turns its gears", () => {
    const moving = partsOf("clockwork", "clock tower").filter((part) => part.motion);
    // Four faces, two hands each, plus two gears of two parts.
    expect(moving.length).toBe(12);
    expect(moving.some((part) => part.motion!.move < part.motion!.period)).toBe(true);
    expect(moving.some((part) => part.motion!.move >= part.motion!.period)).toBe(true);
  });

  it("turns a fir's tiers about the trunk, each against the one below", () => {
    const parts = build(createSeededRandom(5), palette, (kit) => firTiers(kit, [0, 0, 1], 4, 3, 0));
    expect(parts).toHaveLength(3);
    expect(parts.map((part) => Math.sign(part.motion!.step))).toEqual([1, -1, 1]);
    expect(new Set(parts.map((part) => part.motion!.period)).size).toBe(3);
    for (const part of parts) expect(part.motion!.axis).toEqual([0, 0, 1]);
  });
});
