/**
 * Moving parts of generated landmarks and decorations, turned in the vertex shader (design 018 section 9.9).
 *
 * A landmark mesh is one merged geometry drawn once per portal copy, so its parts cannot be moved on the CPU. Instead every vertex of a
 * moving part carries its motion (`world-assets/landmarkParts.ts`, `PartMotion`) as attributes in the mesh's own frame:
 * `motionPivot` and `motionAxis`, `motionTiming` = (step, period, move, phase) and `motionMode` = (kind + 3 * schedule, hold). The
 * patched vertex shader computes the amount the schedule gives at the shared clock {@link landmarkMotionTime} (`motionValueAt`) and turns
 * the vertex and its normal about the axis through the pivot, slides it along the axis, or scales it about the pivot; a vertex with a zero
 * step stands still. Every copy through every portal moves in step, at no CPU cost. The baked shade of a moving face does not change: the
 * motions are slow or small and the light is soft, so it does not show.
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
export const motionAttributeNames = { pivot: "motionPivot", axis: "motionAxis", timing: "motionTiming", mode: "motionMode" } as const;

const vertexDeclarations = [
  "attribute vec3 motionPivot;",
  "attribute vec3 motionAxis;",
  "attribute vec4 motionTiming;",
  "attribute vec2 motionMode;",
  "uniform float landmarkMotionTime;",
  "vec3 landmarkMotionRotate(vec3 v, vec3 axis, float angle) {",
  "  float c = cos(angle);",
  "  float s = sin(angle);",
  "  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);",
  "}",
  // The amount the schedule gives now (see `motionValueAt`); turns in steps or steady are wrapped to within a full turn.
  "float landmarkMotionValue() {",
  "  if (motionTiming.x == 0.0) return 0.0;",
  "  float schedule = floor(motionMode.x / 3.0 + 0.01);",
  "  float u = (landmarkMotionTime + motionTiming.w) / motionTiming.y;",
  "  float steps = floor(u);",
  "  float fraction = u - steps;",
  "  float time = fraction * motionTiming.y;",
  "  if (schedule < 0.5) return mod(motionTiming.x * steps, 6.28318530718) + motionTiming.x * smoothstep(0.0, motionTiming.z, time);",
  "  if (schedule < 1.5) return mod(motionTiming.x * steps, 6.28318530718) + motionTiming.x * fraction;",
  "  if (schedule < 2.5) return motionTiming.x * sin(6.28318530718 * u);",
  "  return motionTiming.x * smoothstep(0.0, motionTiming.z, time) * (1.0 - smoothstep(motionTiming.z + motionMode.y, 2.0 * motionTiming.z + motionMode.y, time));",
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
        [
          "#include <beginnormal_vertex>",
          "float landmarkMotionAmount = landmarkMotionValue();",
          "float landmarkMotionKind = motionMode.x - 3.0 * floor(motionMode.x / 3.0 + 0.01);",
          "if (landmarkMotionKind < 0.5) objectNormal = landmarkMotionRotate(objectNormal, motionAxis, landmarkMotionAmount);",
        ].join("\n"),
      )
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "if (landmarkMotionKind < 0.5) transformed = motionPivot + landmarkMotionRotate(transformed - motionPivot, motionAxis, landmarkMotionAmount);",
          "else if (landmarkMotionKind < 1.5) transformed += motionAxis * landmarkMotionAmount;",
          "else transformed = motionPivot + (transformed - motionPivot) * max(0.0, 1.0 + landmarkMotionAmount);",
        ].join("\n"),
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
