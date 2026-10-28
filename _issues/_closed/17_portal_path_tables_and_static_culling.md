# 17 - Portal path tables, static culling, and debug inspection

Status: closed on 2026-05-27.

## Outcome

The renderer path-data layer is implemented and available for later visible-path and instanced-rendering work.

The compiled cell-complex contract exposes the portal, side, transform, and reciprocal metadata needed to enumerate portal paths without renderer coupling. Path tables are generated per root cell, preserve distinct paths to the same destination cell, accumulate portal transforms, and skip immediate reverse crossings by default.

Static portal path culling is implemented as a pure cell-complex pass. It preserves kept path ids, reports rejection summaries, supports static path budgets, and performs conservative geometric rejection against ancestor portal aperture planes and vertical ranges.

Debug inspection is available behind debug flags. The app can install `window.noneuclidPortalDebug` with `CheckCellPath(...)`, `ShowCellPath(...)`, `HideCellPaths()`, path-table summaries, static-cull summaries, and compact debug state.

## Implemented changes

- [src/cell-complex/compileCellComplex.ts](../../../src/cell-complex/compileCellComplex.ts), [src/cell-complex/prismCells.ts](../../../src/cell-complex/prismCells.ts), and [src/cell-complex/specs.ts](../../../src/cell-complex/specs.ts) provide the renderer-neutral compiled world contract used by path construction.
- [src/cell-complex/portalPaths.ts](../../../src/cell-complex/portalPaths.ts) defines `buildPortalPathTables(...)`, path table indexes, stable path ids, parent links, accumulated transforms, and immediate-reverse filtering.
- [src/cell-complex/staticPortalPathCull.ts](../../../src/cell-complex/staticPortalPathCull.ts) defines `staticallyCullPortalPathTables(...)`, kept tables, rejection summaries, optional rejected-path details, geometric culling, and static path budgets.
- [src/cell-complex/portalPathDebug.ts](../../../src/cell-complex/portalPathDebug.ts) provides renderer-neutral path parsing, path checking, and compact debug state.
- [src/glue/debugOptions.ts](../../../src/glue/debugOptions.ts) defines `portal-path-debug`, `portal-static-cull-debug`, and `portal-path-overlays`.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) wires the debug flags into `window.noneuclidPortalDebug` and optional path overlays.

## Verification

### Automated

- [tests/cell-complex/portalPaths.test.ts](../../../tests/cell-complex/portalPaths.test.ts) covers per-root tables, depth-0 paths, outgoing depth-1 counts, immediate reverse behavior, duplicate destinations, transform inverses, stable ids, parent ids, and cube paths through depth 10.
- [tests/cell-complex/staticPortalPathCull.test.ts](../../../tests/cell-complex/staticPortalPathCull.test.ts) covers depth-0 preservation, kept path ids, ambiguous kept bounds, impossible rejected bounds, rejection summaries, static path budgets, and well-formed no-rejection summaries.
- [tests/cell-complex/portalPathDebug.test.ts](../../../tests/cell-complex/portalPathDebug.test.ts) covers pure path parsing/checking, cull reporting, and debug state.
- [tests/debugSettings.test.ts](../../../tests/debugSettings.test.ts) covers portal path debug option parsing and runtime applicability.

### Final checks

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-27.

## Acceptance criteria status

- `compileCellComplex(...)` exposes the compiled portal data needed by path tables without renderer-specific coupling: complete.
- `buildPortalPathTables(...)` exists in a pure cell-complex module: complete.
- Path tables are generated per root cell up to configurable depth: complete.
- Path ids, parent links, destination cells, and accumulated transforms are inspectable: complete.
- Immediate reverse skipping is implemented and tested: complete.
- `staticallyCullPortalPathTables(...)` exists in a pure cell-complex module: complete.
- Static culling returns kept tables plus rejection summaries: complete.
- Debug flags for portal path inspection are defined: complete.
- `CheckCellPath(...)`, `ShowCellPath(...)`, and `HideCellPaths()` are implemented behind debug flags: complete.
- Tests cover path enumeration, culling summaries, and pure path-checking behavior: complete.

## Follow-up notes

- `outside-ancestor-portal-slab` is part of the public rejection type, but the current geometric implementation rejects against ancestor portal planes and vertical ranges only.
- The overlay helper is wired and functional, but its material currently uses the destination cell floor color rather than the bright red color described in the original debug-helper sketch.
