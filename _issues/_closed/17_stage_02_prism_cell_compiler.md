# 17 - Stage 02 prism cell compiler

Status: closed on 2026-05-25.

## Outcome

The prism-cell compiler is implemented and produces runtime data that movement and rendering can consume directly.

Authoring specs now compile into validated prism cells, side geometry, portal lookups, compiled portal transforms, and portal-junction collision data.

## Implemented changes

- [src/cell-complex/specs.ts](../../../src/cell-complex/specs.ts) defines the authored and compiled cell-complex contracts.
- [src/cell-complex/prismCells.ts](../../../src/cell-complex/prismCells.ts) exposes compiled prism-cell geometry, side data, portal lookups, and cell metadata.
- [src/cell-complex/compileCellComplex.ts](../../../src/cell-complex/compileCellComplex.ts) compiles authored worlds into runtime cells.
- [src/cell-complex/compilePortalTransforms.ts](../../../src/cell-complex/compilePortalTransforms.ts) and [src/cell-complex/portalTransforms.ts](../../../src/cell-complex/portalTransforms.ts) provide explicit runtime portal transforms.
- [src/cell-complex/forbiddenZones.ts](../../../src/cell-complex/forbiddenZones.ts) computes portal-junction collision columns from compiled prism geometry.
- [src/authoring/validateAuthoringSpec.ts](../../../src/authoring/validateAuthoringSpec.ts) reports movement-critical authoring errors before runtime.

## Verification

### Automated

- [tests/cell-complex/compileCellComplex.test.ts](../../../tests/cell-complex/compileCellComplex.test.ts) verifies:
  - valid sample worlds compile,
  - duplicate and missing references are rejected with readable errors,
  - side geometry and portal lookup data are present,
  - portal transforms round-trip correctly,
  - forbidden zones are produced at adjacent portal junctions.
- [tests/cell-complex/describeGeometry.test.ts](../../../tests/cell-complex/describeGeometry.test.ts) verifies the compiled geometry can be summarized for inspection.

### Final checks

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-25.

## Acceptance criteria status

- Duplicate cell ids are rejected: complete.
- Invalid or missing portal endpoints are rejected: complete.
- Invalid prism bases and non-positive heights are rejected: complete.
- Runtime floor, ceiling, side, wall, and portal geometry is compiled: complete.
- Explicit portal transforms are available to runtime code: complete.
- Forbidden zones are compiled from portal-junction structure: complete.
