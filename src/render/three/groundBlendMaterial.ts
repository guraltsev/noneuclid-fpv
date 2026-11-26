/**
 * Ground blending along the sides of a metric floor (design 018 section 8.3).
 *
 * A floor strip lies between a cell side and the inner polygon. This module patches the strip's `MeshStandardMaterial` so its
 * colour is a mixture of the cell's own ground (texture times tint) and the neighbour's ground carried across the portal
 * (the neighbour's texture sampled at the same physical point, times the neighbour's tint). The neighbour's share is
 * `1 - smoothstep(-h, h, s + n)`, where `s` is the distance from the side into the cell and `n` a value noise in a frame both
 * cells of a portal agree on (canonical distance along the side and canonical signed distance, see `groundBlendGeometry.ts`).
 * At the side itself both cells compute the same noise and complementary shares, so they show the same mixture: the border
 * is continuous and wanders. The noise tapers to zero near both ends of the side so the corners agree too.
 *
 * The patch chains any earlier `onBeforeCompile` and program cache key and must run before the portal clip patch. It replaces the
 * `map_fragment` chunk (the own texel is applied inside the block, not twice) and needs the vertex attributes
 * `neighbourUv`, `neighbourPoint`, `blendCoord`, `blendLength` and `blendSign` that `groundBlendGeometry.ts` writes. Textures
 * must not live in `userData` (`Material.clone()` copies it as JSON), so the caller passes them to each clone.
 */
import * as THREE from "three";
import type { GroundTint } from "../../world-assets/groundTint";
import { groundTintGain } from "./groundTintMaterial";

/** Largest half-width of the strip (its width) in meters, before it is limited by the size of the cell. */
export const blendHalfWidthMeters = 2.6;
/** Largest sideways wander of the border in meters (the noise `n` goes from minus to plus this). */
export const blendNoiseAmplitudeMeters = 1.1;
/** Size of the features of the border noise along the side, meters. */
export const blendNoiseFeatureMeters = 2.5;
/** Distance from either end of a side over which the noise fades to zero, meters. */
export const blendNoiseTaperMeters = 1.0;

/** A tint image together with the texture that holds it, as the shader needs them. */
export interface GroundBlendTintSource {
  readonly tint: GroundTint;
  readonly texture: THREE.Texture;
}

/** Everything `patchGroundBlendMaterial` needs to mix a cell's ground with its neighbour's. */
export interface GroundBlendOptions {
  /** The cell's own tint image (the same one the inner polygon uses). */
  readonly ownTint: GroundBlendTintSource;
  /** Colour texture of the neighbour's floor (sRGB, like the cell's own; shared, never disposed here). */
  readonly neighbourMap: THREE.Texture;
  /** The neighbour's `floorColor`, which its own floor material multiplies into its texture. */
  readonly neighbourColor: THREE.Color;
  /** The neighbour's tint image. */
  readonly neighbourTint: GroundBlendTintSource;
  /** Half-width `h` of the transition, meters. */
  readonly halfWidthMeters: number;
  /** Amplitude of the border noise, meters. */
  readonly noiseAmplitudeMeters: number;
  /** Seed of the noise; equal for both cells of a portal. */
  readonly seed: number;
  /** False on a side with no neighbour to blend with (a solid wall): the share is forced to 0. */
  readonly enabled: boolean;
  /** Multiplier on the colour, the same as the inner polygon's (default `groundTintGain`). */
  readonly gain?: number;
}

const vertexDeclarations = [
  "attribute vec2 neighbourUv;",
  "attribute vec2 neighbourPoint;",
  "attribute vec2 blendCoord;",
  "attribute float blendLength;",
  "attribute float blendSign;",
  "varying vec2 vGroundTintPoint;",
  "varying vec2 vNeighbourUv;",
  "varying vec2 vNeighbourPoint;",
  "varying vec2 vBlendCoord;",
  "varying float vBlendLength;",
  "varying float vBlendSign;",
].join("\n");

const vertexAssignments = [
  // A floor vertex is (x, 0, -y) in the cell's Three.js frame, already baked into the geometry.
  "vGroundTintPoint = vec2(position.x, -position.z);",
  "vNeighbourUv = neighbourUv;",
  "vNeighbourPoint = neighbourPoint;",
  "vBlendCoord = blendCoord;",
  "vBlendLength = blendLength;",
  "vBlendSign = blendSign;",
].join("\n");

const fragmentDeclarations = [
  "varying vec2 vGroundTintPoint;",
  "varying vec2 vNeighbourUv;",
  "varying vec2 vNeighbourPoint;",
  "varying vec2 vBlendCoord;",
  "varying float vBlendLength;",
  "varying float vBlendSign;",
  "uniform sampler2D groundTintMap;",
  "uniform vec2 groundTintOrigin;",
  "uniform vec2 groundTintSize;",
  "uniform float groundTintGain;",
  "uniform sampler2D neighbourMap;",
  "uniform vec3 neighbourColor;",
  "uniform sampler2D neighbourTintMap;",
  "uniform vec2 neighbourTintOrigin;",
  "uniform vec2 neighbourTintSize;",
  "uniform float blendHalfWidth;",
  "uniform float blendNoiseAmplitude;",
  "uniform float blendSeed;",
  "uniform float blendStrength;",
  "float blendHash(vec2 lattice, float seed) {",
  "  vec3 p3 = fract(vec3(lattice.x, lattice.y, seed) * vec3(0.1031, 0.1030, 0.0973));",
  "  p3 += dot(p3, p3.yzx + 33.33);",
  "  return fract((p3.x + p3.y) * p3.z);",
  "}",
  "float blendValueNoise(vec2 p, float seed) {",
  "  vec2 base = floor(p);",
  "  vec2 f = fract(p);",
  "  vec2 u = f * f * (3.0 - 2.0 * f);",
  "  float a = blendHash(base, seed);",
  "  float b = blendHash(base + vec2(1.0, 0.0), seed);",
  "  float c = blendHash(base + vec2(0.0, 1.0), seed);",
  "  float d = blendHash(base + vec2(1.0, 1.0), seed);",
  "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
  "}",
  `float blendNoise(vec2 coord, float seed) {`,
  `  vec2 p = coord / ${blendNoiseFeatureMeters.toFixed(1)};`,
  "  return 0.65 * blendValueNoise(p, seed) + 0.35 * blendValueNoise(p * 2.1 + vec2(5.2, 1.3), seed + 3.7);",
  "}",
].join("\n");

const fragmentColor = [
  "{",
  "  vec3 ownGround = diffuse * texture2D(map, vMapUv).rgb * texture2D(groundTintMap, (vGroundTintPoint - groundTintOrigin) / groundTintSize).rgb;",
  "  vec2 neighbourTintUv = clamp((vNeighbourPoint - neighbourTintOrigin) / neighbourTintSize, 0.0, 1.0);",
  "  vec3 neighbourGround = neighbourColor * texture2D(neighbourMap, vNeighbourUv).rgb * texture2D(neighbourTintMap, neighbourTintUv).rgb;",
  `  float taper = smoothstep(0.0, ${blendNoiseTaperMeters.toFixed(1)}, vBlendCoord.x) * smoothstep(0.0, ${blendNoiseTaperMeters.toFixed(1)}, vBlendLength - vBlendCoord.x);`,
  "  float wander = (blendNoise(vBlendCoord, blendSeed) - 0.5) * 2.0 * blendNoiseAmplitude * taper;",
  "  float distanceIntoCell = vBlendSign * (vBlendCoord.y + wander);",
  "  float neighbourShare = blendStrength * (1.0 - smoothstep(-blendHalfWidth, blendHalfWidth, distanceIntoCell));",
  "  diffuseColor.rgb = mix(ownGround, neighbourGround, neighbourShare) * 2.0 * groundTintGain;",
  "}",
].join("\n");

/**
 * Makes the material mix its own ground with the neighbour's as described in the module header. Mutates and returns the material;
 * it replaces `onBeforeCompile` with one that runs the previous hook first. The material must have a `map`.
 */
export function patchGroundBlendMaterial<TMaterial extends THREE.Material>(material: TMaterial, options: GroundBlendOptions): TMaterial {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    const own = options.ownTint;
    const neighbour = options.neighbourTint;
    shader.uniforms.groundTintMap = { value: own.texture };
    shader.uniforms.groundTintOrigin = { value: new THREE.Vector2(own.tint.originX, own.tint.originY) };
    shader.uniforms.groundTintSize = { value: new THREE.Vector2(own.tint.sizeX, own.tint.sizeY) };
    shader.uniforms.groundTintGain = { value: options.gain ?? groundTintGain };
    shader.uniforms.neighbourMap = { value: options.neighbourMap };
    shader.uniforms.neighbourColor = { value: options.neighbourColor.clone() };
    shader.uniforms.neighbourTintMap = { value: neighbour.texture };
    shader.uniforms.neighbourTintOrigin = { value: new THREE.Vector2(neighbour.tint.originX, neighbour.tint.originY) };
    shader.uniforms.neighbourTintSize = { value: new THREE.Vector2(neighbour.tint.sizeX, neighbour.tint.sizeY) };
    shader.uniforms.blendHalfWidth = { value: options.halfWidthMeters };
    shader.uniforms.blendNoiseAmplitude = { value: options.noiseAmplitudeMeters };
    shader.uniforms.blendSeed = { value: options.seed };
    shader.uniforms.blendStrength = { value: options.enabled ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
      .replace("#include <begin_vertex>", `${vertexAssignments}\n#include <begin_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragmentDeclarations}`)
      .replace("#include <map_fragment>", fragmentColor);
  };
  material.customProgramCacheKey = () => `${previousProgramKey}ground-blend:`;
  material.needsUpdate = true;
  return material;
}
