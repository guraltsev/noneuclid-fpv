# 13 - Compile portal transforms from side identifications

Status: closed on 2026-05-25.

## Outcome

Portal rigid transforms are now compiled from authored side identifications rather than supplied by authored world data.

Stage-03 prism worlds now author only:

- cells,
- convex prism base polygons,
- side-to-side portal pairings,
- visuals and placed objects.

Runtime movement continues to consume compiled portal transforms, but authoring no longer needs to provide them.

## Implemented changes

### Authoring and compilation split

- [src/cell-complex/specs.ts](../../src/cell-complex/specs.ts) separates authored portal data from compiled portal data.
- `AuthoredPortalSpec` now contains only topology-level portal information.
- `CompiledPortal` carries the runtime `transformToTarget`.

### Dedicated portal-transform compiler

- [src/cell-complex/compilePortalTransforms.ts](../../src/cell-complex/compilePortalTransforms.ts) derives seam transforms from compiled side geometry.
- The compiler maps:
  - source side midpoint to target side midpoint,
  - source tangent to reversed target tangent,
  - source outward crossing direction to target inward direction,
  - and preserves the shared `y` axis.

### Compiled runtime wiring

- [src/cell-complex/compileCellComplex.ts](../../src/cell-complex/compileCellComplex.ts) now runs the portal-transform compilation pass.
- [src/cell-complex/prismCells.ts](../../src/cell-complex/prismCells.ts) exposes compiled portal data through compiled sides and lookup maps.
- [src/movement/portalCrossing.ts](../../src/movement/portalCrossing.ts) and [src/movement/moveDynamicObject.ts](../../src/movement/moveDynamicObject.ts) continue to use compiled transforms without needing authoring-level math.

### Example worlds

The stage examples now rely on authored topology only:

- [src/cell-complex/examples/twoPrismLoop.ts](../../src/cell-complex/examples/twoPrismLoop.ts)
- [src/cell-complex/examples/torus.ts](../../src/cell-complex/examples/torus.ts)
- [src/cell-complex/examples/cube.ts](../../src/cell-complex/examples/cube.ts)
- [src/cell-complex/examples/tetrahedron.ts](../../src/cell-complex/examples/tetrahedron.ts)

`cube` and `tetrahedron` are now meaningful traversable runtime worlds under the same compiled portal logic used by the simpler examples.

## Verification

### Automated

- [tests/cell-complex/compileCellComplex.test.ts](../../tests/cell-complex/compileCellComplex.test.ts) verifies:
  - derived transforms exist for compiled portals,
  - `twoPrismLoop` and `torus` produce the expected wraparound translations,
  - every example portal satisfies seam-geometry consistency checks,
  - reciprocal transforms compose back to near identity.
- [tests/movement/moveDynamicObject.test.ts](../../tests/movement/moveDynamicObject.test.ts) verifies dynamic-object portal crossing in:
  - `twoPrismLoop`,
  - `cube`,
  - `tetrahedron`.

### Manual

- Browser smoke testing confirmed that the implemented worlds behave correctly interactively.

### Final checks

- `npm test`
- `npm run build`

Both passed on 2026-05-25.

## Acceptance criteria status

- Authored prism worlds no longer supply `transformToTarget`: complete.
- Compiled portal data always includes `transformToTarget`: complete.
- `compileCellComplex(...)` derives portal transforms from side geometry: complete.
- Runtime movement consumes compiled portal transforms rather than authoring specs: complete.
- `cube` is traversable under the stage-03 movement contract: complete.
- `tetrahedron` is traversable under the same compiled logic: complete.
- `torus` and `twoPrismLoop` still work after authoring simplification: complete.
- Tests verify seam geometry consistency rather than only successful compilation: complete.
