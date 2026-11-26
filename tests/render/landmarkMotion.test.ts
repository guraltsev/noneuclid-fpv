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
  patchLandmarkMotionMaterial,
  setLandmarkMotionTime,
  transformMotionAttributes,
} from "../../src/render/three/landmarkMotion";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { build, faceThemes, firTiers } from "../../src/world-assets/faceThemes";
import type { LandmarkPlacement } from "../../src/world-assets/landmarkLayout";
import { measureParts, motionValueAt, type LandmarkPart, type PartMotion } from "../../src/world-assets/landmarkParts";
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

const motion = (extra: Partial<PartMotion>): PartMotion => ({ pivot: [0, 0, 0], axis: [0, 0, 1], step: 0.5, period: 10, move: 2, phase: 0, ...extra });

describe("motion schedule", () => {
  it("rests between turns and makes whole steps", () => {
    const steps = motion({});
    expect(motionValueAt(steps, 0)).toBeCloseTo(0, 9);
    expect(motionValueAt(steps, 1)).toBeCloseTo(0.25, 9);
    expect(motionValueAt(steps, 2)).toBeCloseTo(0.5, 9);
    expect(motionValueAt(steps, 7)).toBeCloseTo(0.5, 9);
    expect(motionValueAt(steps, 22)).toBeCloseTo(1.5, 9);
  });

  it("turns steadily when a move fills its period", () => {
    expect(motionValueAt(motion({ step: 1, move: 10 }), 2.5)).toBeCloseTo(0.25, 9);
    expect(motionValueAt(motion({ step: 1, move: 10, phase: 3 }), 2)).toBeCloseTo(0.5, 9);
  });

  it("sways constantly either way", () => {
    const sway = motion({ schedule: "sway", step: 0.2, period: 4 });
    expect(motionValueAt(sway, 1)).toBeCloseTo(0.2, 9);
    expect(motionValueAt(sway, 3)).toBeCloseTo(-0.2, 9);
    expect(motionValueAt(sway, 2)).toBeCloseTo(0, 9);
  });

  it("pulses: out, hold, back, rest", () => {
    const pulse = motion({ schedule: "pulse", step: 0.4, period: 10, move: 1, hold: 3 });
    expect(motionValueAt(pulse, 0)).toBeCloseTo(0, 9);
    expect(motionValueAt(pulse, 0.5)).toBeCloseTo(0.2, 9);
    expect(motionValueAt(pulse, 2.5)).toBeCloseTo(0.4, 9);
    expect(motionValueAt(pulse, 4.5)).toBeCloseTo(0.2, 9);
    expect(motionValueAt(pulse, 7)).toBeCloseTo(0, 9);
    // The default hold is half of what the period leaves after the two moves.
    expect(motionValueAt(motion({ schedule: "pulse", step: 1, period: 10, move: 1 }), 5)).toBeCloseTo(1, 9);
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

  it("numbers a slide that sways and a grow that pulses for the shader", () => {
    const parts: LandmarkPart[] = [
      { shape: "box", at: [0, 0, 0], sx: 1, sy: 1, sz: 1, color: "#808080", motion: { kind: "slide", schedule: "sway", pivot: [0, 0, 0], axis: [0, 0, 1], step: 0.2, period: 5, move: 5, phase: 0 } },
      { shape: "box", at: [3, 0, 0], sx: 1, sy: 1, sz: 1, color: "#808080", motion: { kind: "grow", schedule: "pulse", pivot: [3, 0, 0], axis: [0, 0, 1], step: -1, period: 10, move: 2, phase: 0, hold: 1.5 } },
    ];
    const mode = buildCellLandmarksMesh("c", [placementOf(parts)], 0)!.geometry.getAttribute("motionMode");
    // kind + 3 * schedule: slide (1) + sway (2) = 7; grow (2) + pulse (3) = 11, with its hold.
    expect([mode.getX(0), mode.getX(mode.count - 1), mode.getY(mode.count - 1)]).toEqual([7, 11, 1.5]);
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
    // A turn (kind 0) in steps (schedule 0).
    const mode = mesh.geometry.getAttribute("motionMode");
    expect(mode.getX(0)).toBe(0);
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
    for (const declaration of ["attribute vec3 motionPivot;", "attribute vec3 motionAxis;", "attribute vec4 motionTiming;", "attribute vec2 motionMode;", "uniform float landmarkMotionTime;"]) {
      expect(shader.vertexShader).toContain(declaration);
    }
    expect(shader.vertexShader.indexOf("objectNormal = landmarkMotionRotate")).toBeGreaterThan(shader.vertexShader.indexOf("#include <beginnormal_vertex>"));
    expect(shader.vertexShader.indexOf("transformed = motionPivot")).toBeGreaterThan(shader.vertexShader.indexOf("#include <begin_vertex>"));
    // Slides move along the axis; grows scale about the pivot.
    expect(shader.vertexShader).toContain("transformed += motionAxis * landmarkMotionAmount;");
    expect(shader.vertexShader).toContain("(transformed - motionPivot) * max(0.0, 1.0 + landmarkMotionAmount)");
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
    const moving = partsOf("clockwork", "clock tower").filter((part) => part.motion && (part.motion.kind ?? "turn") === "turn");
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
