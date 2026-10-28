# 21 - Finish milestone 3 visible-path instances and clip polygons

Status: closed on 2026-05-28.

## Outcome

Milestone 3 visible-path instance rendering is complete.

The renderer now uses the full visible-path result for the current root cell, feeds destination-cell buckets into the archetype instance pools, and clips each rendered instance against the matching portal polygon.

## Implemented changes

- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) computes visible portal paths during the normal frame loop, updates clip data from the live paths, and populates archetype instance buffers from the current destination-cell buckets.
- [src/render/three/renderPortalInstances.ts](../../../src/render/three/renderPortalInstances.ts) builds visible paths by destination cell, writes instance matrices, writes per-instance `portalPathId` values, and reports overflow diagnostics.
- [src/render/three/portalClipData.ts](../../../src/render/three/portalClipData.ts) stores per-path clip polygons in a compact lookup structure and tracks overflow conditions.
- [src/render/three/portalClipMaterial.ts](../../../src/render/three/portalClipMaterial.ts) patches materials so fragments are discarded outside the active portal clip polygon.
- [src/render/three/cellRenderArchetypes.ts](../../../src/render/three/cellRenderArchetypes.ts) exposes instanced `portalPathId` attributes for each archetype mesh.

## Verification

### Automated

- [tests/render-contract/portalInstanceBuffers.test.ts](../../../tests/render-contract/portalInstanceBuffers.test.ts) covers visible-path instance population, duplicate destination handling, per-slot path ids, and overflow reporting.
- [tests/render-contract/portalClipData.test.ts](../../../tests/render-contract/portalClipData.test.ts) covers clip polygon lookup and overflow handling.
- [tests/render-contract/portalClipMaterial.test.ts](../../../tests/render-contract/portalClipMaterial.test.ts) covers material patching and viewport-to-NDC helpers.
- [tests/render-contract/visiblePortalPaths.test.ts](../../../tests/render-contract/visiblePortalPaths.test.ts) continues to cover visible-path computation and polygon clipping inputs.

### Final checks

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-28.

## Acceptance criteria status

- Ordinary rendering uses the full `computeVisiblePortalPaths(...)` result, not only the depth-0 root path: complete.
- All visible destination-cell copies are rendered through archetype `InstancedMesh` pools: complete.
- Every rendered instance is transformed by its matching `rootFromDestinationMatrix`: complete.
- Every rendered instance is clipped by its matching `clipPolygonNdc`: complete.
- Same-destination paths remain visually distinct when both are visible: complete.
- Static floors, ceilings, solid walls, portal frames, and static objects participate in visible-path rendering: complete.
- The root cell is rendered through the same path machinery as recursive copies: complete.
- Live instance buffers report capacity overflow instead of reallocating or silently dropping diagnostics: complete.
- Debug helpers and overlays still work: complete.
- `npm.cmd test -- --run`, `npm.cmd run typecheck`, and `npm.cmd run build` pass: complete.
