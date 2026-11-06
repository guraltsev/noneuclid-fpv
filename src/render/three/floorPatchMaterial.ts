/**
 * Rigid floor patches for a textured floor material.
 *
 * The torus floor is painted by overlapping rigid patches (see `cell-complex/floorUv.ts`): each nearby anchor paints the floor texture with a constant
 * meters-to-UV matrix, and the patches are blended by a compact kernel. `floorPatchSamples` in `floorUv.ts` is the specification of the fragment code here: change them together.
 * The patch field travels in `material.userData.floorPatchField`, which `Material.clone()` copies, but `clone()` does not copy `onBeforeCompile` or
 * `customProgramCacheKey`, so `patchFloorPatchMaterial` must run on each clone, before the portal clip patch (which chains the earlier hook and key).
 */
import * as THREE from "three";
import type { FloorPatchField } from "../../cell-complex/floorUv";

const vertexDeclarations = "varying vec2 vFloorPatchPoint;";

const fragmentDeclarations = [
  "varying vec2 vFloorPatchPoint;",
  "uniform vec2 floorPatchOrigin;",
  "uniform vec2 floorPatchStep1;",
  "uniform vec2 floorPatchStep2;",
  "uniform vec2 floorPatchInverseRow1;",
  "uniform vec2 floorPatchInverseRow2;",
  "uniform vec2 floorPatchMetersToUvRow1;",
  "uniform vec2 floorPatchMetersToUvRow2;",
  "uniform float floorPatchInverseRadiusSquared;",
].join("\n");

// Transcribes floorPatchSamples. Patch UVs differ by constants, so all patches share one gradient; textureGrad keeps mipmapping valid inside the branch.
const fragmentColor = /* glsl */ `
#ifdef USE_MAP
  vec2 floorPatchPointDx = dFdx(vFloorPatchPoint);
  vec2 floorPatchPointDy = dFdy(vFloorPatchPoint);
  vec2 floorPatchUvDx = vec2(dot(floorPatchMetersToUvRow1, floorPatchPointDx), dot(floorPatchMetersToUvRow2, floorPatchPointDx));
  vec2 floorPatchUvDy = vec2(dot(floorPatchMetersToUvRow1, floorPatchPointDy), dot(floorPatchMetersToUvRow2, floorPatchPointDy));
  vec2 floorPatchOffset = vFloorPatchPoint - floorPatchOrigin;
  vec2 floorPatchCenter = floor(vec2(dot(floorPatchInverseRow1, floorPatchOffset), dot(floorPatchInverseRow2, floorPatchOffset)) + 0.5);
  float floorPatchKernels[9];
  vec2 floorPatchToPoints[9];
  float floorPatchMaxKernel = 0.0;
  for (int index = 0; index < 9; index++) {
    float m = floorPatchCenter.x + float(index % 3) - 1.0;
    float n = floorPatchCenter.y + float(index / 3) - 1.0;
    vec2 toPoint = floorPatchOffset - m * floorPatchStep1 - n * floorPatchStep2;
    float falloff = max(1.0 - dot(toPoint, toPoint) * floorPatchInverseRadiusSquared, 0.0);
    float falloff2 = falloff * falloff;
    float falloff4 = falloff2 * falloff2;
    float falloff8 = falloff4 * falloff4;
    float kernel = falloff8 * falloff8;
    floorPatchKernels[index] = kernel;
    floorPatchToPoints[index] = toPoint;
    floorPatchMaxKernel = max(floorPatchMaxKernel, kernel);
  }
  float floorPatchWeightFloor = 0.02 * floorPatchMaxKernel;
  vec4 floorPatchColor = vec4(0.0);
  float floorPatchWeightSum = 0.0;
  for (int index = 0; index < 9; index++) {
    float weight = floorPatchKernels[index] - floorPatchWeightFloor;
    if (weight > 0.0) {
      vec2 toPoint = floorPatchToPoints[index];
      vec2 patchUv = vec2(dot(floorPatchMetersToUvRow1, toPoint), dot(floorPatchMetersToUvRow2, toPoint));
      floorPatchColor += weight * textureGrad(map, patchUv, floorPatchUvDx, floorPatchUvDy);
      floorPatchWeightSum += weight;
    }
  }
  diffuseColor *= floorPatchColor / floorPatchWeightSum;
#endif
`;

/**
 * Installs the rigid floor patches on a material whose `userData.floorPatchField` is set, and leaves any other material alone. Call it on each clone, before
 * `patchPortalClipMaterial`.
 */
export function patchFloorPatchMaterial<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  const field = material.userData.floorPatchField as FloorPatchField | undefined;
  if (!field) {
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.floorPatchOrigin = { value: new THREE.Vector2(field.origin.x, field.origin.y) };
    shader.uniforms.floorPatchStep1 = { value: new THREE.Vector2(field.step1.x, field.step1.y) };
    shader.uniforms.floorPatchStep2 = { value: new THREE.Vector2(field.step2.x, field.step2.y) };
    shader.uniforms.floorPatchInverseRow1 = { value: new THREE.Vector2(field.inverseRow1.x, field.inverseRow1.y) };
    shader.uniforms.floorPatchInverseRow2 = { value: new THREE.Vector2(field.inverseRow2.x, field.inverseRow2.y) };
    shader.uniforms.floorPatchMetersToUvRow1 = { value: new THREE.Vector2(field.metersToUvRow1.x, field.metersToUvRow1.y) };
    shader.uniforms.floorPatchMetersToUvRow2 = { value: new THREE.Vector2(field.metersToUvRow2.x, field.metersToUvRow2.y) };
    shader.uniforms.floorPatchInverseRadiusSquared = { value: field.inverseRadiusSquared };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
      // A floor vertex is (x, 0, -y) in the cell's Three.js frame, already baked into the geometry.
      .replace("#include <begin_vertex>", "vFloorPatchPoint = vec2(position.x, -position.z);\n#include <begin_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragmentDeclarations}`)
      .replace("#include <map_fragment>", fragmentColor);
  };
  material.customProgramCacheKey = () => "floor-rigid-patches:";
  material.needsUpdate = true;
  return material;
}
