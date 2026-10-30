/**
 * Patches Three.js materials so instanced portal geometry is clipped to its path's four world-space clip planes.
 *
 * `patchPortalClipMaterial` hooks `onBeforeCompile` to add two instanced attributes (`portalPathId`,
 * `portalClipIndex`) and the uniforms of a shared `PortalClipMaterialState`. The vertex shader reads the instance's
 * 4 planes `(n, d)` (inside where `n . X + d >= 0`, render frame) from the clip-plane texture (`portalClipData`) with
 * `texelFetch`, slot `portalClipIndex`, eye `portalClipEyeIndex`, and evaluates `n . X + d` at the vertex's
 * render-frame position `modelMatrix * instanceMatrix * vec4(transformed, 1)`. The value is affine in position, so
 * the interpolated value is exact and the clip follows the plane precisely.
 *
 * Two modes. With hardware clip distances (`WEBGL_clip_cull_distance`; define `PORTAL_CLIP_HARDWARE`) the vertex
 * shader writes `gl_ClipDistance[0..3]`: triangles are clipped before rasterisation, the fragment shader contains no
 * portal code and no `discard`, so early depth rejection stays on. The caller must enable the clip distances around
 * patched draws (`createPortalClipDistanceToggle`). Without the extension the vertex shader writes the four values
 * to one `vec4` varying and the fragment shader does a single compare and `discard` (no texture fetch, no loop).
 *
 * Clip index semantics: -2 = unclipped (all four distances positive), -1 or out of range = fully clipped, otherwise a
 * clip slot (see `renderPortalInstances`). Clipped instances also get a small clip-space depth push
 * (`z += min(8e-5 * w, 8e-4)`) so they do not z-fight with the portal wall they are seen through. For stereo/XR the
 * eye is selected with the uniform `portalClipEyeIndex` before each eye draws.
 */

import * as THREE from "three";
import { portalClipEpsilonMeters, portalClipPlaneTextureWidth, type PortalClipData } from "./portalClipData";

/** Shared uniform bundle and settings referenced by every patched material, so one update reaches all of them. */
export interface PortalClipMaterialState {
  /** Clip texture and layout this state samples. */
  readonly clipData: PortalClipData;
  /** True when patched programs write `gl_ClipDistance` (the extension is available and the toggle is in use). */
  readonly hardwareClipDistances: boolean;
  /** Uniforms injected into each patched shader; mutate `.value` in place, never replace the objects. */
  readonly uniforms: {
    readonly portalClipPlaneTexture: { value: THREE.DataTexture };
    /** Eye whose planes the shader reads (0 for mono). */
    readonly portalClipEyeIndex: { value: number };
    /** Number of eyes the texture is laid out for (`clipData.maxClipTextureEyes`). */
    readonly portalClipEyeCount: { value: number };
  };
}

/** Creates the shared uniform state for `clipData`, initially for eye 0. */
export function createPortalClipMaterialState(
  clipData: PortalClipData,
  options: { readonly hardwareClipDistances?: boolean } = {},
): PortalClipMaterialState {
  return {
    clipData,
    hardwareClipDistances: options.hardwareClipDistances ?? false,
    uniforms: {
      portalClipPlaneTexture: { value: clipData.texture },
      portalClipEyeIndex: { value: 0 },
      portalClipEyeCount: { value: clipData.maxClipTextureEyes },
    },
  };
}

/** Switches the four hardware clip distances on and off around patched draws. */
export interface PortalClipDistanceToggle {
  /** Enables `CLIP_DISTANCE0..3` (call at the end of a patched mesh's `onBeforeRender`). */
  enable(): void;
  /** Disables them again (call from the mesh's `onAfterRender`). */
  disable(): void;
}

/**
 * Returns a toggle for the four hardware clip distances, or `undefined` when the renderer lacks
 * `WEBGL_clip_cull_distance` (the material then uses the fragment fallback).
 *
 * WebGL requires `gl.enable(CLIP_DISTANCEi_WEBGL)` and Three.js never calls it; enabling a distance a program does not
 * write is undefined, so the clip distances must only be on while patched programs draw.
 */
export function createPortalClipDistanceToggle(renderer: THREE.WebGLRenderer): PortalClipDistanceToggle | undefined {
  if (!renderer.extensions.has("WEBGL_clip_cull_distance")) {
    return undefined;
  }

  const extension = renderer.extensions.get("WEBGL_clip_cull_distance") as { readonly CLIP_DISTANCE0_WEBGL: number };
  const gl = renderer.getContext();
  const base = extension.CLIP_DISTANCE0_WEBGL;

  return {
    enable() {
      for (let index = 0; index < 4; index += 1) {
        gl.enable(base + index);
      }
    },
    disable() {
      for (let index = 0; index < 4; index += 1) {
        gl.disable(base + index);
      }
    },
  };
}

/** Selects which eye's planes the shader reads; the index is floored and clamped to [0, maxClipTextureEyes - 1]. */
export function updatePortalClipMaterialTextureEye(
  state: PortalClipMaterialState,
  eyeIndex: number,
): void {
  state.uniforms.portalClipEyeIndex.value = Math.min(
    state.clipData.maxClipTextureEyes - 1,
    Math.max(0, Math.floor(eyeIndex)),
  );
}

/**
 * Installs portal clipping into a material (or each material of an array) and returns it.
 *
 * Mutates the material in place: wraps any existing `onBeforeCompile`, sets a program cache key derived from the eye
 * count and the clip mode, and forces recompilation. In hardware mode it also sets `extensions.clipCullDistance` so
 * Three.js emits the `#extension` line. Relies on the stock shader chunks containing `#include <common>`,
 * `#include <begin_vertex>`, `#include <project_vertex>` and `void main() {`; a shader lacking them is left silently
 * unpatched. The material must be drawn by an instanced mesh carrying the two attributes.
 */
export function patchPortalClipMaterial(
  material: THREE.Material | THREE.Material[],
  state: PortalClipMaterialState,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => patchSinglePortalClipMaterial(entry, state));
  }

  return patchSinglePortalClipMaterial(material, state);
}

function patchSinglePortalClipMaterial(
  material: THREE.Material,
  state: PortalClipMaterialState,
): THREE.Material {
  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.portalClipPlaneTexture = state.uniforms.portalClipPlaneTexture;
    shader.uniforms.portalClipEyeIndex = state.uniforms.portalClipEyeIndex;
    shader.uniforms.portalClipEyeCount = state.uniforms.portalClipEyeCount;
    shader.vertexShader = patchVertexShader(shader.vertexShader, state.hardwareClipDistances);
    shader.fragmentShader = patchFragmentShader(shader.fragmentShader, state.hardwareClipDistances);
  };
  material.customProgramCacheKey = () =>
    `portal-clip-planes:${state.clipData.maxClipTextureEyes}:${state.hardwareClipDistances ? "hw" : "frag"}`;

  if (state.hardwareClipDistances) {
    // Three.js reads `material.extensions` for every material type but only ShaderMaterial declares it.
    const extensible = material as THREE.Material & { extensions?: Record<string, boolean> };

    extensible.extensions = { ...extensible.extensions, clipCullDistance: true };
  }

  material.needsUpdate = true;
  return material;
}

// Adds the instanced attributes, the plane fetch and the per-vertex plane distances, and the depth bias. The bias is
// only applied when the clip index is >= -0.5 (i.e. not the unclipped root), pushing portal-seen geometry slightly
// farther than the portal opening.
function patchVertexShader(shader: string, hardwareClipDistances: boolean): string {
  return shader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        hardwareClipDistances ? "#define PORTAL_CLIP_HARDWARE" : "",
        `#define PORTAL_CLIP_EPSILON ${formatGlslFloat(portalClipEpsilonMeters)}`,
        "uniform highp sampler2D portalClipPlaneTexture;",
        "uniform int portalClipEyeIndex;",
        "uniform int portalClipEyeCount;",
        "attribute float portalPathId;",
        "attribute float portalClipIndex;",
        "varying float vPortalPathId;",
        "#ifndef PORTAL_CLIP_HARDWARE",
        "varying vec4 vPortalClipDistances;",
        "#endif",
        "vec4 portalClipPlane(int slot, int planeIndex) {",
        "  int t = (slot * portalClipEyeCount + portalClipEyeIndex) * 4 + planeIndex;",
        `  return texelFetch(portalClipPlaneTexture, ivec2(t % ${portalClipPlaneTextureWidth}, t / ${portalClipPlaneTextureWidth}), 0);`,
        "}",
      ].join("\n"),
    )
    .replace(
      "#include <begin_vertex>",
      [
        "vPortalPathId = portalPathId;",
        "#include <begin_vertex>",
      ].join("\n"),
    )
    .replace(
      "#include <project_vertex>",
      [
        "#include <project_vertex>",
        "if (portalClipIndex >= -0.5) {",
        "  gl_Position.z += min(0.00008 * gl_Position.w, 0.0008);",
        "}",
        "#ifdef USE_INSTANCING",
        "vec4 portalRenderPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);",
        "#else",
        "vec4 portalRenderPosition = modelMatrix * vec4(transformed, 1.0);",
        "#endif",
        "vec4 portalClipDistances;",
        "if (portalClipIndex < -1.5) {",
        "  portalClipDistances = vec4(1.0);",
        "} else if (portalClipIndex < -0.5) {",
        "  portalClipDistances = vec4(-1.0);",
        "} else {",
        "  int portalSlot = int(portalClipIndex + 0.5);",
        "  for (int j = 0; j < 4; j++) {",
        "    vec4 plane = portalClipPlane(portalSlot, j);",
        "    portalClipDistances[j] = dot(plane.xyz, portalRenderPosition.xyz) + plane.w + PORTAL_CLIP_EPSILON;",
        "  }",
        "}",
        "#ifdef PORTAL_CLIP_HARDWARE",
        "gl_ClipDistance[0] = portalClipDistances.x;",
        "gl_ClipDistance[1] = portalClipDistances.y;",
        "gl_ClipDistance[2] = portalClipDistances.z;",
        "gl_ClipDistance[3] = portalClipDistances.w;",
        "#else",
        "vPortalClipDistances = portalClipDistances;",
        "#endif",
      ].join("\n"),
    );
}

// Hardware mode: no portal code beyond the declaration of the (debug) path-id varying. Fallback: one compare and discard.
function patchFragmentShader(shader: string, hardwareClipDistances: boolean): string {
  return shader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "varying float vPortalPathId;",
        hardwareClipDistances ? "" : "varying vec4 vPortalClipDistances;",
      ].join("\n"),
    )
    .replace(
      "void main() {",
      hardwareClipDistances
        ? "void main() {"
        : [
            "void main() {",
            "  if (any(lessThan(vPortalClipDistances, vec4(0.0)))) {",
            "    discard;",
            "  }",
          ].join("\n"),
    );
}

// GLSL float literal for a JS number (always with a decimal point or exponent).
function formatGlslFloat(value: number): string {
  const text = String(value);

  return /[.e]/.test(text) ? text : `${text}.0`;
}
