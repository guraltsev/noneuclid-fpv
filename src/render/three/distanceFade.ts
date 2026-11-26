/**
 * Distance limits for what is drawn far away, without popping (design 018 section 8).
 *
 * Distant things used to be cut by portal depth (number of portals crossed), which is not distance: the same landmark changes depth when the
 * camera crosses a portal or is seen through another path, so it appeared and vanished with small moves. Three pieces replace that:
 *
 * - Radial fog (`installRadialFog`): three.js fogs by view depth (`-z`), so a far object at the side of the view is less fogged than the
 *   same object straight ahead and changes as the head turns. The fog here uses the distance from the eye, so everything farther than the
 *   fog's far distance is exactly the fog colour whichever way one looks.
 * - Distance culling: an archetype with `maxDrawDistanceMeters` is not instanced on a path whose copy of its bounding sphere is entirely
 *   farther than that from every eye. Culling beyond the fog's far distance is invisible; culling closer needs the fade below.
 * - Dithered fade (`patchDistanceFadeMaterial`): fragments between `startMeters` and `endMeters` from the eye are discarded with a growing,
 *   screen-space ordered probability, so small dressing (scenery) thins out to nothing before it is culled at `endMeters`.
 *
 * The fog override is global (it changes `THREE.ShaderChunk.fog_vertex`) and must run before the first material compiles.
 */
import * as THREE from "three";

/** Far distance of the scene fog, meters: beyond it everything is the fog colour. */
export const sceneFogFarMeters = 95;
/** Near distance of the scene fog, meters. */
export const sceneFogNearMeters = 18;
/** Scenery (grass tufts, pebbles) starts to thin out at this distance from the eye, meters. */
export const sceneryFadeStartMeters = 38;
/** Scenery is gone at this distance from the eye, meters, and not instanced beyond it. */
export const sceneryFadeEndMeters = 50;
/** Landmarks are not instanced beyond this distance from the eye, meters (where the radial fog has fully covered them). */
export const landmarkMaxDrawDistanceMeters = sceneFogFarMeters;
/**
 * Runtime objects (creatures, decorations, tools, flags) are not instanced beyond this distance from the eye, meters. The margin past the fog's far
 * distance covers parts that move outside the rest-pose bounding sphere (landmark motion: sway, slide, grow).
 */
export const runtimeObjectMaxDrawDistanceMeters = sceneFogFarMeters + 5;

const radialFogVertex = "#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif\n";

/** Makes three.js fog use the distance from the eye instead of the view depth (see the module header). Idempotent. */
export function installRadialFog(): void {
  (THREE.ShaderChunk as Record<string, string>).fog_vertex = radialFogVertex;
}

/** The scene fog, linear from `sceneFogNearMeters` to `sceneFogFarMeters`. */
export function createSceneFog(color: THREE.ColorRepresentation): THREE.Fog {
  installRadialFog();
  return new THREE.Fog(color, sceneFogNearMeters, sceneFogFarMeters);
}

/** Distance band of a dithered fade. */
export interface DistanceFadeOptions {
  readonly startMeters: number;
  readonly endMeters: number;
}

/**
 * Makes the material dissolve between `startMeters` and `endMeters` from the eye (see the module header). Mutates and returns the material;
 * chains any earlier `onBeforeCompile` and program cache key, and keeps the shader tokens later patches (the portal clip) need.
 */
export function patchDistanceFadeMaterial<TMaterial extends THREE.Material>(material: TMaterial, options: DistanceFadeOptions): TMaterial {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.distanceFadeStart = { value: options.startMeters };
    shader.uniforms.distanceFadeEnd = { value: options.endMeters };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vDistanceFadeEye;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvDistanceFadeEye = length( mvPosition.xyz );");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vDistanceFadeEye;\nuniform float distanceFadeStart;\nuniform float distanceFadeEnd;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        [
          "#include <clipping_planes_fragment>",
          "{",
          "  float distanceFadeKeep = 1.0 - smoothstep( distanceFadeStart, distanceFadeEnd, vDistanceFadeEye );",
          // Interleaved gradient noise: a stable screen-space threshold, so the fade is a fine stipple and does not crawl.
          "  float distanceFadeThreshold = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );",
          "  if ( distanceFadeKeep < 1.0 && distanceFadeThreshold >= distanceFadeKeep ) discard;",
          "}",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => `${previousProgramKey}distance-fade:`;
  material.needsUpdate = true;
  return material;
}
