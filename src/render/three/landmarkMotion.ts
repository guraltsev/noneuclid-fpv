/**
 * Moving parts of generated landmarks and decorations, turned in the vertex shader (design 018 section 9.9).
 *
 * A landmark mesh is one merged geometry drawn once per portal copy, so its parts cannot be moved on the CPU. Instead every vertex of a
 * moving part carries its motion (`world-assets/landmarkParts.ts`, `PartMotion`) as attributes in the mesh's own frame:
 * `motionPivot` and `motionAxis`, and `motionTiming` = (step, period, move, phase). The patched vertex shader turns the vertex and its
 * normal about the axis through the pivot by the angle the schedule gives at the shared clock {@link landmarkMotionTime}; a vertex with a
 * zero step stands still. Every copy through every portal moves in step, at no CPU cost.
 *
 * The schedule: at clock `t`, with `u = (t + phase) / period`, the part has made `floor(u)` steps and is `smoothstep(0, move, fract(u) *
 * period)` of the way through the next one; with `move >= period` it turns steadily instead. The baked shade of a turning face does not
 * change: the turns are slow and the light is soft, so it does not show.
 *
 * Materials lose shader hooks when cloned, so a moving mesh's material is marked in `userData.landmarkMotion` and {@link applyLandmarkMotion}
 * installs the hook on the clone that is drawn. A geometry whose positions are transformed must have its motion attributes transformed
 * too ({@link transformMotionAttributes}).
 */
import * as THREE from "three";

/** The shared clock of every moving part, seconds; the frame loop sets it. */
export const landmarkMotionTime: { value: number } = { value: 0 };

/** Sets the clock of every moving part (call once per frame). */
export function setLandmarkMotionTime(seconds: number): void {
  landmarkMotionTime.value = seconds;
}

/** Names of the motion attributes. */
export const motionAttributeNames = { pivot: "motionPivot", axis: "motionAxis", timing: "motionTiming" } as const;

/** The angle (radians) the schedule `(step, period, move, phase)` gives at clock `t`, as the shader computes it (without its wrap to a turn). */
export function motionAngleAt(timing: readonly [number, number, number, number], t: number): number {
  const [step, period, move, phase] = timing;

  if (step === 0) {
    return 0;
  }

  const u = (t + phase) / period;
  const steps = Math.floor(u);
  const fraction = u - steps;
  const x = Math.min(1, Math.max(0, (fraction * period) / move));
  const progress = move >= period ? fraction : x * x * (3 - 2 * x);
  return step * (steps + progress);
}

const vertexDeclarations = [
  "attribute vec3 motionPivot;",
  "attribute vec3 motionAxis;",
  "attribute vec4 motionTiming;",
  "uniform float landmarkMotionTime;",
  "vec3 landmarkMotionRotate(vec3 v, vec3 axis, float angle) {",
  "  float c = cos(angle);",
  "  float s = sin(angle);",
  "  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);",
  "}",
  "float landmarkMotionAngle() {",
  "  if (motionTiming.x == 0.0) return 0.0;",
  "  float u = (landmarkMotionTime + motionTiming.w) / motionTiming.y;",
  "  float steps = floor(u);",
  "  float fraction = u - steps;",
  "  float progress = motionTiming.z >= motionTiming.y ? fraction : smoothstep(0.0, motionTiming.z, fraction * motionTiming.y);",
  "  return mod(motionTiming.x * steps, 6.28318530718) + motionTiming.x * progress;",
  "}",
].join("\n");

/** Patches `material` to turn moving parts (see the module header); chains an earlier hook and program cache key. Returns the material. */
export function patchLandmarkMotionMaterial<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.landmarkMotionTime = landmarkMotionTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nfloat landmarkMotionAngleValue = landmarkMotionAngle();\nobjectNormal = landmarkMotionRotate(objectNormal, motionAxis, landmarkMotionAngleValue);",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntransformed = motionPivot + landmarkMotionRotate(transformed - motionPivot, motionAxis, landmarkMotionAngleValue);",
      );
  };
  material.customProgramCacheKey = () => `${previousProgramKey}landmark-motion:`;
  material.needsUpdate = true;
  return material;
}

/** Installs the motion hook on `material` if its `userData.landmarkMotion` asks for it (after a clone). Returns the material. */
export function applyLandmarkMotion<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  return material.userData.landmarkMotion === true ? patchLandmarkMotionMaterial(material) : material;
}

/**
 * Transforms the motion attributes of `geometry` by `matrix`, as `geometry.applyMatrix4(matrix)` transforms its positions: pivots as
 * points, axes as directions (renormalised). Does nothing for a geometry without them.
 */
export function transformMotionAttributes(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  const pivot = geometry.getAttribute(motionAttributeNames.pivot) as THREE.BufferAttribute | undefined;
  const axis = geometry.getAttribute(motionAttributeNames.axis) as THREE.BufferAttribute | undefined;

  if (!pivot || !axis) {
    return;
  }

  pivot.applyMatrix4(matrix);
  const rotation = new THREE.Matrix3().setFromMatrix4(matrix);
  const vector = new THREE.Vector3();

  for (let index = 0; index < axis.count; index += 1) {
    vector.fromBufferAttribute(axis, index).applyMatrix3(rotation);
    const length = vector.length();
    if (length > 1e-9) vector.divideScalar(length);
    axis.setXYZ(index, vector.x, vector.y, vector.z);
  }

  pivot.needsUpdate = true;
  axis.needsUpdate = true;
}
