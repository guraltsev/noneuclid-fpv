# 58 - GPU portal clipping: silent drop on vertex overflow, 32 texture fetches per fragment, no early-Z

Status: open; implemented by job 22, which ended "done, needs review" (manual browser/GPU/Quest checks not run); see the Report in `.agents/jobs/_done/22_gpu_portal_clip_planes.md`. Re-verified 2026-10-28.

Priority: P2 (correctness for the overflow; performance for the rest).

Jobs: [22](../.agents/jobs/22_gpu_portal_clip_planes.md).

## Status update 2026-10-29

Re-checked at `0b468e1`: unchanged. Stale references: the runtime-object clip index is `renderPortalInstances.ts:309`
(not `:275`); `portalClipEdgeSmoothingEnabled` is `false` (`renderQuality.ts:16`), so the smooth mode is compiled off
and only the hard mode runs; the smoothing flag is read at `createThreeApp.ts:878` (not `:853`) and the overflow ids
reach debug state at `:2730` (not `:2597`). three r0.164 supports `material.extensions.clipCullDistance` but never
calls `gl.enable(CLIP_DISTANCEi)`; job 22 handles that.

## Status update 2026-10-28

Nothing in the proposal is implemented. Clips are still NDC polygons of at most 8 vertices in a float texture. Overflow
paths still get clip index -1, the fragment shader still loops over vertices with texture fetches, and every patched
material still compiles `discard`. Line numbers below have been updated. One fact needs a correction: the shader has
two modes (`portalClipMaterial.ts:191-235`). The `1e-5` edge test applies only to the hard mode
(`portalFragmentShouldDiscard`, `:309`). The smooth mode (`portalFragmentClipCoverage`), on when render quality and
`portalClipEdgeSmoothingEnabled` are on (`createThreeApp.ts:853`), divides by edge length and works in pixels
(`:370`). Its leak does not depend on edge length, but it still discards stochastically. The overflow ids reach the
debug state as `clipPolygonOverflowPathIds` (`createThreeApp.ts:2597`). No randomized sweep, GPU timing or pixel test
exists.

## Summary

Clip polygons are packed as vertices, at most 8 per path, into a float texture. A fragment shader tests every vertex of
every clipped instance. A polygon with more than 8 vertices makes its path disappear completely, in both eyes. The
shader re-derives the winding on every fragment, uses an edge tolerance whose size depends on edge length, and its
`discard` turns off early depth rejection for every patched material, the unclipped root included. Each clip region
is a convex cone through the eye (issue 57), so it can be expressed as at most 4 clip planes per path and enforced by
hardware clip distances or by a single varying.

## Evidence

- `portalClipData.ts:17`: `defaultMaxClipVerticesPerPath = 8`.
- `portalClipData.ts:129-140` (`updateStereo`): a path whose polygon has more than 8 vertices in *any* eye goes into
  `polygonVertexOverflowPathIds` and gets no clip index. `renderPortalInstances.ts:211,275` then writes clip index -1,
  and `portalClipMaterial.ts:267-269` discards every fragment. The path's descendants still render, inside a hole. Ways to
  reach 9 or more vertices:
  - a depth-1 aperture clipped by the near plane is a pentagon, and pentagon ∩ screen square can have up to 9 vertices;
  - unequal heights (issue 41) add top and bottom edges;
  - Sutherland-Hodgman keeps collinear vertices, since `dedupePolygonVertices` (`visiblePortalPaths.ts:756`) only
    merges consecutive points closer than 1e-9.
- `portalClipMaterial.ts:282-312` (hard mode; the smooth mode at `:318-375` has the same loops): per fragment, two loops of up to 8 iterations with 2 `texture2D` reads each, so 32
  fetches, plus a shoelace sum to recover the winding sign. The CPU already knows the winding: `convexHull` returns CCW
  (`visiblePortalPaths.ts:778`), and Sutherland-Hodgman preserves the candidate's orientation.
- `portalClipMaterial.ts:309` (hard mode only; see the status update): the threshold `edgeSide < -1e-5` is applied to `cross(edge, toPoint) = |edge| · dist`.
  The tolerated leak is therefore 1e-5/|edge| in NDC: sub-pixel for long edges, about 10 px for an edge 1 px long.
- `portalClipMaterial.ts:191-235` (`discard` at `:223`, `:226`, `:232`): `discard` is compiled into every patched material. On tile-based GPUs (Quest/Adreno)
  this disables early-Z/LRZ for *all* cell geometry, the root instance (clip index -2) included. Each clipped instance
  also rasterizes the whole projected cell mesh and discards everything outside its polygon. Fragment cost scales with
  the sum of the projected cell areas, not with the polygon areas.
- `portalClipData.ts:62-63`: texture height = maxVisiblePaths x eyes = 4000 rows. Raising `maxVisiblePaths`
  (`createThreeApp.ts:762`) above 2048 exceeds `MAX_TEXTURE_SIZE` = 4096 on some mobile GPUs.

## Proposed change

1. **Represent clips as planes, not vertices.** For each (eye, path), upload up to 4 world-space (render-frame) planes
   n·X + d >= 0 through the eye (issue 57, step 2): 4 vec4 texels per row, normalized so |n| = 1. Fall back to general
   polygons only for unequal heights. Keep a polygon form only for the debug overlay.
2. **Vertex-stage evaluation.** In the vertex shader, fetch the instance's 4 planes once per vertex and output
   `vPortalClip = vec4(dot(n_j, worldPos) + d_j)`. This is linear in object space, so perspective-correct interpolation
   is exact. The fragment test becomes `if (any(lessThan(vPortalClip, vec4(-eps)))) discard;`, with eps in meters. That
   means no fragment texture fetches and no winding loop.
3. **Hardware clipping where available.** When `WEBGL_clip_cull_distance` is present (WebGL2/ANGLE), write
   `gl_ClipDistance[0..3]` instead and leave `discard` out of the program. Triangles are then clipped before
   rasterization, so overdraw falls to the polygon area and early-Z returns. Detect the extension once and compile
   two program variants through `customProgramCacheKey`.
4. **Split the root material.** Render depth-0 instances, the unclipped root, with an unpatched program so they
   always keep early-Z.
5. **Overflow policy, if polygons stay.** Remove collinear vertices
   (|orient| < 1e-7 · |edge|) before the size check. If more than K remain, raise K for that row: store K = 16 with
   a per-row count; the shader loop is already bounded by the count. Never fall back to clip index -1 for a path that
   is visible.
6. Move the per-eye block offset out of the texture height, for example into a 2D layout of (paths x eyes·K), so that
   rows <= maxVisiblePaths.

## Acceptance criteria

- No visible path is ever drawn with clip index -1 because of polygon size. The overflow counter in
  `createPortalInstanceRenderDebugState` stays at 0 in a randomized camera sweep.
- The fragment shader for clipped instances performs no texture fetches. With the extension, the programs contain no
  `discard`.
- A GPU timing (EXT_disjoint_timer_query) of the default world at depth 10 on desktop and Quest shows lower fragment
  time than the current shader. Record the numbers in the PR.
- A pixel test shows clip leakage of at most 1 px for polygons with edges shorter than 2 px.
