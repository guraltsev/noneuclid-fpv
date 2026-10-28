# 20 - Milestone 3 archetype instance pool and debug path renders

Status: closed on 2026-05-28.

## Outcome

Issue 20 is complete.

This issue delivered the first Milestone 3 completion slice described in the issue itself:

- the current active cell renders through archetype-backed `THREE.InstancedMesh` pools using the depth-0 root path,
- `window.noneuclidPortalDebug.ShowCellPath(...)` can optionally render destination-cell archetype instances through the new instance path,
- the renderer architecture is prepared for later ordinary visible portal-path copies without cloning a cell mesh per path.

Milestone 3 as a whole is still not complete. Ordinary camera-visible portal-copy rendering from the full `computeVisiblePortalPaths(...)` result remains later work. Closing this issue means the foundation slice is done, not that the full milestone is done.

## Implemented changes

- [src/render/three/cellRenderArchetypes.ts](../../../src/render/three/cellRenderArchetypes.ts) plans and builds per-cell floor, ceiling, solid-wall, portal-frame, and static-object archetypes as reusable fixed-capacity `THREE.InstancedMesh` batches.
- [src/render/three/renderPortalInstances.ts](../../../src/render/three/renderPortalInstances.ts) creates the depth-0 root visible path, groups paths by destination cell, updates instance matrices and `mesh.count`, and reports compact capacity-overflow diagnostics.
- [src/render/three/portalInstanceDebug.ts](../../../src/render/three/portalInstanceDebug.ts) provides the separate debug instance renderer used by `ShowCellPath(...)` so inspected paths do not mutate the live frame buffers.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) derives capacities from `buildStaticallyCulledPortalPathTables(...)`, adds the archetype meshes to the scene, updates the active cell through the root path each frame, and wires `ShowCellPathRendersInstances` into `window.noneuclidPortalDebug`.
- [src/render/three/debugOverlay.ts](../../../src/render/three/debugOverlay.ts) and [src/render/three/renderState.ts](../../../src/render/three/renderState.ts) surface compact portal-instance counts and overflow diagnostics.
- [src/glue/debugOptions.ts](../../../src/glue/debugOptions.ts) defines the `portal-path-overlay-instances` debug option with the public label `ShowCellPathRendersInstances`.

## Verification

### Automated

- [tests/render-contract/cellRenderArchetypes.test.ts](../../../tests/render-contract/cellRenderArchetypes.test.ts) covers archetype planning, static-object inclusion, marmot exclusion, and capacity derivation from statically kept path tables.
- [tests/render-contract/portalInstanceBuffers.test.ts](../../../tests/render-contract/portalInstanceBuffers.test.ts) covers root-path writes, duplicate destination handling, `mesh.count` capping, overflow reporting, debug-state summaries, and the separate debug instance renderer.
- [tests/debugSettings.test.ts](../../../tests/debugSettings.test.ts) covers the `portal-path-overlay-instances` debug option and its parse/serialize/runtime behavior.

### Final checks

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-28.

## Acceptance criteria status

- Static render archetypes are built per cell from compiled geometry and loaded assets: complete.
- Each archetype is backed by a fixed-capacity `THREE.InstancedMesh`: complete.
- Archetype capacity is derived from statically culled destination-path counts: complete.
- The current active cell renders through the depth-0 path instance pool: complete.
- Ordinary floors and static objects are no longer rendered from real visible cell object trees: complete for static cell content; legacy cell roots remain as runtime parents for dynamic objects such as geodesci marmots.
- The normal frame path populates instance buffers for at least the active depth-0 cell: complete.
- The architecture is ready for visible portal paths to populate instance buffers by destination cell later: complete.
- `ShowCellPathRendersInstances` is available as a debug-toggleable option: complete.
- `ShowCellPath(...)` preserves the old ad-hoc floor behavior when the option is false: complete.
- `ShowCellPath(...)` renders destination-cell archetype instances with the inspected path transform when the option is true: complete.
- Debug state reports archetype counts, rendered instance counts, capacity, and overflows: complete.
- Render-contract tests cover archetype planning, capacity derivation, instance updates, and debug behavior: complete.

## Follow-up notes

- Normal camera-visible portal-copy rendering is still not enabled for every visible path returned by `computeVisiblePortalPaths(...)`; that belongs to later Milestone 3 follow-up work, not this issue.
- `portalInstanceDebug.ts` currently clones one temporary `InstancedMesh` per matching archetype while an inspected path is shown. That matches the issue guidance for an isolated debug group and avoids mutating the main frame buffers.
