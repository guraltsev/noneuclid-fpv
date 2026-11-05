# 90 - Portal wall textures pile up in the texture cache during deformation

Status: open. Read from the code; not measured.

Priority: P3 (a slow leak of GPU memory during long deformation sessions). Split from issue
[82](82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md), whose floor half job 10 fixed.

Jobs: [30](../.agents/jobs/30_deformation_rebuild_pipeline.md).

## Problem

`buildPortalMesh` (`src/render/three/buildPortalMesh.ts`) gives each wall a texture repeat of `max(1, edgeLength / 8)`.
`getConfiguredTexture` (`src/render/three/preloadWorldAssets.ts`) caches one cloned texture per full configuration, and the
repeat is part of the key. Nothing evicts entries.

A deformation changes edge lengths, and each commit rebuilds the cell meshes. So every commit with an edge longer than 8 m and a
new length adds a clone, which is uploaded and then kept. The material is built even when `showWall` is false. The floor had the
same fault until job 10 fixed its repeat at 1.

## Done when

- A wall's texture does not depend on a floating-point edge length: world-space UVs with a fixed repeat, as the floor does.
- A test: commits of different edge lengths leave the number of configured textures unchanged.
