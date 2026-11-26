/**
 * Ground tint for a textured floor material (design 018 section 4.1).
 *
 * `computeGroundTint` (world-assets) makes a small image over the cell; this module uploads it as a texture and patches a
 * floor material so its colour is multiplied by the image and by a gain that lifts the dark photo textures. The patch chains any
 * earlier `onBeforeCompile` and program cache key (the floor patch), and must run before the portal clip patch. Textures must
 * not live in `userData` (`Material.clone()` copies it as JSON), so the caller passes the texture to each clone.
 */
import * as THREE from "three";
import type { GroundTint } from "../../world-assets/groundTint";

/**
 * Multiplier applied to the floor colour together with the tint image (the image is 0..2 around 1.0). The photo floors
 * are dark, so a gain above 1 lifts them; tune it by eye.
 */
export const groundTintGain = 1.35;

/** Uploads the tint image as a linear-filtered, edge-clamped, non-colour-managed texture. The caller owns it. */
export function createGroundTintTexture(tint: GroundTint): THREE.DataTexture {
  const texture = new THREE.DataTexture(tint.data, tint.width, tint.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Multiplies the material's diffuse colour by `texture` (mapped over the tint's rectangle) and by `gain`. Mutates and
 * returns the material; it replaces `onBeforeCompile` with one that runs the previous hook first.
 */
export function patchGroundTintMaterial<TMaterial extends THREE.Material>(
  material: TMaterial,
  texture: THREE.Texture,
  tint: GroundTint,
  gain: number = groundTintGain,
): TMaterial {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.groundTintMap = { value: texture };
    shader.uniforms.groundTintOrigin = { value: new THREE.Vector2(tint.originX, tint.originY) };
    shader.uniforms.groundTintSize = { value: new THREE.Vector2(tint.sizeX, tint.sizeY) };
    shader.uniforms.groundTintGain = { value: gain };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundTintPoint;")
      // A floor vertex is (x, 0, -y) in the cell's Three.js frame, already baked into the geometry.
      .replace("#include <begin_vertex>", "vGroundTintPoint = vec2(position.x, -position.z);\n#include <begin_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec2 vGroundTintPoint;",
          "uniform sampler2D groundTintMap;",
          "uniform vec2 groundTintOrigin;",
          "uniform vec2 groundTintSize;",
          "uniform float groundTintGain;",
        ].join("\n"),
      )
      // Before color_fragment, not after map_fragment: the floor patch replaces the map chunk on lattice floors.
      .replace(
        "#include <color_fragment>",
        "diffuseColor.rgb *= texture2D(groundTintMap, (vGroundTintPoint - groundTintOrigin) / groundTintSize).rgb * 2.0 * groundTintGain;\n#include <color_fragment>",
      );
  };
  material.customProgramCacheKey = () => `${previousProgramKey}ground-tint:`;
  material.needsUpdate = true;
  return material;
}
