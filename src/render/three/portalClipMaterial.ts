/**
 * Patches Three.js materials so instanced portal geometry is clipped, per fragment, to its path's convex NDC polygon.
 *
 * `patchPortalClipMaterial` hooks `onBeforeCompile` to add two instanced attributes (`portalPathId`,
 * `portalClipIndex`) and the uniforms of a shared `PortalClipMaterialState`. In the fragment shader the pixel's
 * window position (`gl_FragCoord`, physical pixels) is converted to NDC using the current viewport origin and size
 * ((p - origin) / size * 2 - 1, y up), then tested against the polygon fetched from the clip texture
 * (`portalClipData`): a point is inside if all edge cross products agree in sign with the polygon's winding.
 * With `smoothClipEdges` the signed distance to the nearest edge (in pixels) gives a coverage in [0,1]
 * (smoothstep over +-0.5 px) that is dithered with interleaved gradient noise via `discard`, which anti-aliases
 * aperture edges without blending. In the vertex shader, clipped instances get a small clip-space depth push
 * (`z += min(8e-5 * w, 8e-4)`) so they do not z-fight with the portal wall they are seen through.
 * Clip index semantics: -2 = unclipped, -1 or out of range = discard, otherwise a texture row (see `renderPortalInstances`).
 * For stereo/XR the row block is selected per eye with `portalClipTextureRowOffset` and the viewport uniforms are
 * updated to the eye's sub-viewport before each eye draws.
 */

import * as THREE from "three";
import type { PortalClipData } from "./portalClipData";

/** Shared uniform bundle and settings referenced by every patched material, so one update reaches all of them. */
export interface PortalClipMaterialState {
  /** Clip texture and layout this state samples. */
  readonly clipData: PortalClipData;
  /** Anti-alias clip edges with dithered coverage (true) or use a hard per-fragment inside test (false). */
  readonly smoothClipEdges: boolean;
  /** Uniforms injected into each patched shader; mutate `.value` in place, never replace the objects. */
  readonly uniforms: {
    readonly portalClipTexture: { value: THREE.DataTexture };
    /** Lower-left corner of the current viewport in physical pixels (nonzero for XR eye sub-viewports). */
    readonly portalViewportOriginPixels: { value: THREE.Vector2 };
    /** Size of the current viewport in physical pixels. */
    readonly portalViewportPixels: { value: THREE.Vector2 };
    readonly portalMaxVisiblePaths: { value: number };
    readonly portalMaxClipVerticesPerPath: { value: number };
    readonly portalClipTextureRows: { value: number };
    /** Row offset of the current eye's block in the clip texture (eyeIndex * max(1, maxVisiblePaths)). */
    readonly portalClipTextureRowOffset: { value: number };
  };
}

/** Creates the shared uniform state for `clipData`, initially with a zero viewport origin and eye 0. */
export function createPortalClipMaterialState(
  clipData: PortalClipData,
  viewportPixels: { readonly width: number; readonly height: number },
  options: { readonly smoothClipEdges?: boolean } = {},
): PortalClipMaterialState {
  return {
    clipData,
    smoothClipEdges: options.smoothClipEdges ?? true,
    uniforms: {
      portalClipTexture: { value: clipData.texture },
      portalViewportOriginPixels: { value: new THREE.Vector2(0, 0) },
      portalViewportPixels: { value: new THREE.Vector2(viewportPixels.width, viewportPixels.height) },
      portalMaxVisiblePaths: { value: clipData.maxVisiblePaths },
      portalMaxClipVerticesPerPath: { value: clipData.maxClipVerticesPerPath },
      portalClipTextureRows: { value: clipData.clipTextureRows },
      portalClipTextureRowOffset: { value: 0 },
    },
  };
}

/** Sets the viewport size and lower-left origin (physical pixels) used to map fragment coordinates to NDC. */
export function updatePortalClipMaterialViewport(
  state: PortalClipMaterialState,
  viewportPixels: { readonly width: number; readonly height: number },
  viewportOriginPixels: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): void {
  state.uniforms.portalViewportOriginPixels.value.set(viewportOriginPixels.x, viewportOriginPixels.y);
  state.uniforms.portalViewportPixels.value.set(viewportPixels.width, viewportPixels.height);
}

/** Selects which eye's polygon rows the shader reads; the index is floored and clamped to [0, maxClipTextureEyes - 1]. */
export function updatePortalClipMaterialTextureEye(
  state: PortalClipMaterialState,
  eyeIndex: number,
): void {
  const clampedEyeIndex = Math.min(
    state.clipData.maxClipTextureEyes - 1,
    Math.max(0, Math.floor(eyeIndex)),
  );

  state.uniforms.portalClipTextureRowOffset.value = clampedEyeIndex * Math.max(1, state.clipData.maxVisiblePaths);
}

/** Reads the renderer's current viewport (already scaled by pixel ratio, as WebGL sees it) and applies it via `updatePortalClipMaterialViewport`. */
export function updatePortalClipMaterialViewportFromRenderer(
  state: PortalClipMaterialState,
  renderer: THREE.WebGLRenderer,
): void {
  const viewport = renderer.getCurrentViewport(new THREE.Vector4());

  updatePortalClipMaterialViewport(
    state,
    { width: viewport.z, height: viewport.w },
    { x: viewport.x, y: viewport.y },
  );
}

/**
 * Installs portal clipping into a material (or each material of an array) and returns it.
 *
 * Mutates the material in place: wraps any existing `onBeforeCompile`, sets a program cache key derived from the
 * texture dimensions and smoothing mode, and forces recompilation. Relies on the stock shader chunks containing
 * `#include <common>`, `#include <begin_vertex>`, `#include <project_vertex>` and `void main() {`; a shader lacking
 * them is left silently unpatched. The material must be drawn by an instanced mesh carrying the two attributes.
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

/** Maps a pixel position relative to the viewport origin (y up) to NDC in [-1,1]; a zero-sized axis maps to 0. */
export function viewportPixelsToNdc(
  pointPixels: { readonly x: number; readonly y: number },
  viewportPixels: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  return {
    x: viewportPixels.width === 0 ? 0 : (pointPixels.x / viewportPixels.width) * 2 - 1,
    y: viewportPixels.height === 0 ? 0 : (pointPixels.y / viewportPixels.height) * 2 - 1,
  };
}

function patchSinglePortalClipMaterial(
  material: THREE.Material,
  state: PortalClipMaterialState,
): THREE.Material {
  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.portalClipTexture = state.uniforms.portalClipTexture;
    shader.uniforms.portalViewportOriginPixels = state.uniforms.portalViewportOriginPixels;
    shader.uniforms.portalViewportPixels = state.uniforms.portalViewportPixels;
    shader.uniforms.portalMaxVisiblePaths = state.uniforms.portalMaxVisiblePaths;
    shader.uniforms.portalMaxClipVerticesPerPath = state.uniforms.portalMaxClipVerticesPerPath;
    shader.uniforms.portalClipTextureRows = state.uniforms.portalClipTextureRows;
    shader.uniforms.portalClipTextureRowOffset = state.uniforms.portalClipTextureRowOffset;
    shader.vertexShader = patchVertexShader(shader.vertexShader);
    shader.fragmentShader = patchFragmentShader(
      shader.fragmentShader,
      state.clipData.maxVisiblePaths,
      state.clipData.maxClipVerticesPerPath,
      state.smoothClipEdges,
    );
  };
  material.customProgramCacheKey = () =>
    `portal-clip:${state.clipData.maxVisiblePaths}:${state.clipData.maxClipVerticesPerPath}:${state.smoothClipEdges ? "smooth" : "hard"}`;
  material.needsUpdate = true;
  return material;
}

// Adds the instanced attributes/varyings and the depth bias. The bias is only applied when the clip index is >= -0.5
// (i.e. not the unclipped root), pushing portal-seen geometry slightly farther than the portal opening.
function patchVertexShader(shader: string): string {
  return shader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "attribute float portalPathId;",
        "attribute float portalClipIndex;",
        "varying float vPortalPathId;",
        "varying float vPortalClipIndex;",
      ].join("\n"),
    )
    .replace(
      "#include <begin_vertex>",
      [
        "vPortalPathId = portalPathId;",
        "vPortalClipIndex = portalClipIndex;",
        "#include <begin_vertex>",
      ].join("\n"),
    )
    .replace(
      "#include <project_vertex>",
      [
        "#include <project_vertex>",
        "if (vPortalClipIndex >= -0.5) {",
        "  gl_Position.z += min(0.00008 * gl_Position.w, 0.0008);",
        "}",
      ].join("\n"),
    );
}

// Prepends clip code to `main`: smooth mode discards on zero coverage and stochastically for partial coverage;
// hard mode discards when the fragment is outside any edge.
function patchFragmentShader(
  shader: string,
  maxVisiblePaths: number,
  maxClipVerticesPerPath: number,
  smoothClipEdges: boolean,
): string {
  return shader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "uniform sampler2D portalClipTexture;",
        "uniform vec2 portalViewportOriginPixels;",
        "uniform vec2 portalViewportPixels;",
        "uniform float portalMaxVisiblePaths;",
        "uniform float portalMaxClipVerticesPerPath;",
        "uniform float portalClipTextureRows;",
        "uniform float portalClipTextureRowOffset;",
        "varying float vPortalPathId;",
        "varying float vPortalClipIndex;",
        portalClipShaderFunctions(maxVisiblePaths, maxClipVerticesPerPath),
      ].join("\n"),
    )
    .replace(
      "void main() {",
      smoothClipEdges
        ? [
            "void main() {",
            "  float portalClipCoverage = portalFragmentClipCoverage(gl_FragCoord.xy, vPortalClipIndex);",
            "  if (portalClipCoverage <= 0.0) {",
            "    discard;",
            "  }",
            "  if (portalClipCoverage < 1.0 && portalInterleavedGradientNoise(gl_FragCoord.xy) > portalClipCoverage) {",
            "    discard;",
            "  }",
          ].join("\n")
        : [
            "void main() {",
            "  if (portalFragmentShouldDiscard(gl_FragCoord.xy, vPortalClipIndex)) {",
            "    discard;",
            "  }",
          ].join("\n"),
    );
}

// GLSL helpers; loop bounds and limits are baked in as constants because GLSL ES requires constant loop bounds.
// Layout matches portalClipData: texel x = vertex index, row = eye offset + clip index, .z = vertex count.
// Inside test: sum shoelace terms to get the winding sign, then require every edge cross product (scaled by that sign) >= -1e-5.
function portalClipShaderFunctions(maxVisiblePaths: number, maxClipVerticesPerPath: number): string {
  return `
vec2 portalClipVertex(float clipIndex, int vertexIndex) {
  float textureRow = portalClipTextureRowOffset + clipIndex;
  vec2 uv = vec2(
    (float(vertexIndex) + 0.5) / portalMaxClipVerticesPerPath,
    (textureRow + 0.5) / portalClipTextureRows
  );
  return texture2D(portalClipTexture, uv).xy;
}

float portalClipVertexCount(float clipIndex) {
  float textureRow = portalClipTextureRowOffset + clipIndex;
  vec2 uv = vec2(0.5 / portalMaxClipVerticesPerPath, (textureRow + 0.5) / portalClipTextureRows);
  return texture2D(portalClipTexture, uv).z;
}

float portalInterleavedGradientNoise(vec2 fragmentPixels) {
  return fract(52.9829189 * fract(0.06711056 * fragmentPixels.x + 0.00583715 * fragmentPixels.y));
}

bool portalFragmentShouldDiscard(vec2 fragmentPixels, float clipIndex) {
  if (clipIndex < -1.5) {
    return false;
  }

  if (clipIndex < -0.5 || clipIndex >= ${maxVisiblePaths}.0) {
    return true;
  }

  float vertexCount = portalClipVertexCount(clipIndex);
  if (vertexCount < 2.5 || vertexCount > ${maxClipVerticesPerPath}.5) {
    return true;
  }

  vec2 pointNdc = vec2(
    portalViewportPixels.x <= 0.0 ? 0.0 : ((fragmentPixels.x - portalViewportOriginPixels.x) / portalViewportPixels.x) * 2.0 - 1.0,
    portalViewportPixels.y <= 0.0 ? 0.0 : ((fragmentPixels.y - portalViewportOriginPixels.y) / portalViewportPixels.y) * 2.0 - 1.0
  );
  float twiceArea = 0.0;

  for (int index = 0; index < ${maxClipVerticesPerPath}; index++) {
    if (float(index) >= vertexCount) {
      break;
    }
    int nextIndex = index + 1;
    if (float(nextIndex) >= vertexCount) {
      nextIndex = 0;
    }
    vec2 current = portalClipVertex(clipIndex, index);
    vec2 next = portalClipVertex(clipIndex, nextIndex);
    twiceArea += current.x * next.y - next.x * current.y;
  }

  float clipSign = twiceArea < 0.0 ? -1.0 : 1.0;
  for (int index = 0; index < ${maxClipVerticesPerPath}; index++) {
    if (float(index) >= vertexCount) {
      break;
    }
    int nextIndex = index + 1;
    if (float(nextIndex) >= vertexCount) {
      nextIndex = 0;
    }
    vec2 current = portalClipVertex(clipIndex, index);
    vec2 next = portalClipVertex(clipIndex, nextIndex);
    vec2 edge = next - current;
    vec2 toPoint = pointNdc - current;
    float edgeSide = clipSign * (edge.x * toPoint.y - edge.y * toPoint.x);
    if (edgeSide < -0.00001) {
      return true;
    }
  }

  return false;
}

float portalFragmentClipCoverage(vec2 fragmentPixels, float clipIndex) {
  if (clipIndex < -1.5) {
    return 1.0;
  }

  if (clipIndex < -0.5 || clipIndex >= ${maxVisiblePaths}.0) {
    return 0.0;
  }

  float vertexCount = portalClipVertexCount(clipIndex);
  if (vertexCount < 2.5 || vertexCount > ${maxClipVerticesPerPath}.5) {
    return 0.0;
  }

  vec2 pointNdc = vec2(
    portalViewportPixels.x <= 0.0 ? 0.0 : ((fragmentPixels.x - portalViewportOriginPixels.x) / portalViewportPixels.x) * 2.0 - 1.0,
    portalViewportPixels.y <= 0.0 ? 0.0 : ((fragmentPixels.y - portalViewportOriginPixels.y) / portalViewportPixels.y) * 2.0 - 1.0
  );
  float twiceArea = 0.0;

  for (int index = 0; index < ${maxClipVerticesPerPath}; index++) {
    if (float(index) >= vertexCount) {
      break;
    }
    int nextIndex = index + 1;
    if (float(nextIndex) >= vertexCount) {
      nextIndex = 0;
    }
    vec2 current = portalClipVertex(clipIndex, index);
    vec2 next = portalClipVertex(clipIndex, nextIndex);
    twiceArea += current.x * next.y - next.x * current.y;
  }

  float clipSign = twiceArea < 0.0 ? -1.0 : 1.0;
  float maxNdcUnitsPerPixel = max(
    portalViewportPixels.x <= 0.0 ? 2.0 : 2.0 / portalViewportPixels.x,
    portalViewportPixels.y <= 0.0 ? 2.0 : 2.0 / portalViewportPixels.y
  );
  float minSignedDistancePixels = 1000000.0;
  for (int index = 0; index < ${maxClipVerticesPerPath}; index++) {
    if (float(index) >= vertexCount) {
      break;
    }
    int nextIndex = index + 1;
    if (float(nextIndex) >= vertexCount) {
      nextIndex = 0;
    }
    vec2 current = portalClipVertex(clipIndex, index);
    vec2 next = portalClipVertex(clipIndex, nextIndex);
    vec2 edge = next - current;
    vec2 toPoint = pointNdc - current;
    float edgeSide = clipSign * (edge.x * toPoint.y - edge.y * toPoint.x);
    float edgeLengthNdc = max(length(edge), 0.0001);
    float signedDistancePixels = edgeSide / (edgeLengthNdc * maxNdcUnitsPerPixel);
    if (signedDistancePixels < -0.5) {
      return 0.0;
    }
    minSignedDistancePixels = min(minSignedDistancePixels, signedDistancePixels);
  }

  return smoothstep(-0.5, 0.5, minSignedDistancePixels);
}
`;
}
