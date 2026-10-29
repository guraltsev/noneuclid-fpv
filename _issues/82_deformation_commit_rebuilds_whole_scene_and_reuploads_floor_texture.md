# 82 - Each deformation commit rebuilds the whole scene and re-uploads the floor texture

Status: open; re-verified 2026-10-28.

Priority: P2 (performance). Complements issue 55, which covers the worker build cost (~100 ms per step). This issue
covers the main-thread cost of *applying* each step, which is what makes the frame rate drop during a deformation.

Jobs: [30](../.agents/jobs/30_deformation_rebuild_pipeline.md).

## Status update 2026-10-28

Filed today; references re-checked against the current code and still accurate, with small line corrections below
(`rebuildCellMeshes` ends at `:2313`, `collectCellArchetypeSources` at `cellRenderArchetypes.ts:245`, and the texture
clone path in `preloadWorldAssets.ts` runs to `:243`). Nothing is implemented, and the measurements under
"Verification" have not been taken. Note that the app now steps by 0.04 m (`createThreeApp.ts:792`), so a full sweep
has about twice as many commits as the default 0.08 m step would give.

## Summary

A deformation step is committed about 10 times per second (one per worker build). Every commit tears down and rebuilds
all cell render data on the render thread, including every static decoration model, and creates a fresh floor
texture variant that, by inference from three r164's `Texture.needsUpdate` semantics, forces a re-upload of the 4K
KTX2 texture. Each commit therefore costs at least one frame, and the result is visible judder for the whole sweep.

Not yet measured; see "Verification" before implementing.

## Evidence

`commitWorldGeometrySnapshot` (`src/render/three/createThreeApp.ts:1487-1527`) does, on every commit:

- Receives the snapshot through `structuredClone` from the worker: ~9.5 ms on desktop (issue 55 table).
- `rebuildCellMeshes()` (`:2251-2313`):
  - Disposes every cell render archetype (geometry and material).
  - `buildCellRenderArchetypes` → `collectCellArchetypeSources` (`cellRenderArchetypes.ts:201-245`) calls
    `buildCellMesh`, which re-instantiates every decoration GLTF (house, bench, computer, flowers, cone) via
    `cloneSkeleton`, then clones and bakes every geometry (`geometry.clone()` + `applyMatrix4`), clones and re-patches
    every material, and allocates new `InstancedMesh` and instanced attribute buffers.
  - All static geometry is therefore re-uploaded to the GPU, although only its placement changed.
- Floor texture (`preloadWorldAssets.ts:205-243`): the cache key contains `repeatX/repeatY`, which change with every
  step (issue 81). Each commit creates a new `texture.clone()` with `needsUpdate = true`.
  - In three r164 `needsUpdate = true` also sets `source.needsUpdate`, bumping the version of the `Source` shared with
    the preloaded texture, so the GPU image is re-uploaded on the next render.
  - The cache is never evicted, and `disposeObject3D` (`runtimeSceneUtils.ts:77-84`) does not dispose maps, so one
    texture object accumulates per step.
- Recreates the portal debug runtime, reinstalls runtime diagnostics, and re-syncs every runtime object, wireframe and
  hitbox group.

## Proposed change

In order of cost/benefit:

1. **Make the floor texture independent of the deformation** (issue 81). One configured texture, uploaded once. This
   is a correctness fix and removes the re-upload and the cache growth.
2. **Stop rebuilding what does not change.**
   - Static decorations are rigid; a commit only moves them. Keep their archetypes and update a per-object placement
     (or rebake only the translation/yaw) instead of re-instantiating GLTFs.
   - Floor and wall geometry of a prism cell is a handful of vertices: update positions in place
     (`attributes.position.needsUpdate`), keep the buffers.
   - Reallocate `InstancedMesh` buffers only when `deriveCellRenderArchetypeCapacities` actually grows.
   - Keep the portal debug runtime and update it, rather than dispose/recreate.
3. **Commit intermediate steps without the worker** (issue 55 §2). For the torus every developed path transform is a
   translation m·u + n·v; recomputing the ~1800 kept paths' transforms from their words is well under 1 ms on the
   main thread. Run the full static cull only at the target or every N steps. This removes both the ~100 ms build
   latency and the ~10 ms deserialization.
4. **Step by time, not by distance** (issue 55 §1, issue 54 §2), and make `cancel()` reach the worker.

With 1–3 the deformation can advance every frame, smoothly, instead of in ~10 Hz steps that each cost a frame.

## Verification (before implementing)

- Record a Chrome Performance trace during a sweep in `torus-moduli`; attribute the long frames to
  `commitWorldGeometrySnapshot` and its children, and check GPU upload time.
- Log `renderer.info.memory.textures` / `.geometries` and `configuredTextures.size` before and after 20 steps to
  confirm the texture re-upload and the cache growth.

## Acceptance criteria

- During a full sweep a = 0 → 30 m on desktop, no frame exceeds 20 ms because of a commit (same bar as issue 55).
- `renderer.info.memory.textures` and the configured-texture cache size are unchanged after 100 deformation steps.
- A commit does not call `instantiateGltf` (test with a spy on `PreparedWorldAssets`).
