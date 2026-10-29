# 81 - Floor texture slides under objects during deformation; tile size depends on cell span

Status: closed on 2026-10-29.

Priority: P1 (correctness, visible in `torus-moduli`). Related: issue 53 (pose transport), issue 82 (commit cost; this
issue's fix removes one of its costs).

Jobs: [10](../../.agents/jobs/_done/10_floor_texture_in_lattice_coordinates.md).

## Outcome

Fixed by job 10. `tileSizeMeters` is now a true period: floor UVs are (x/T, y/T) and the texture repeat is always 1
(`src/render/three/buildCellMesh.ts`, `src/cell-complex/floorUv.ts`). In the `torus-skew` family the floor UVs are
(nU*alpha, nV*beta) in the lattice frame of the current state, with whole tile counts fixed from the base state
(`torusSkewDeformation.ts#floorUvFrames`, passed down by `rebuildCellMeshes`). The floor moves with the objects and is
seamless across portals. Stock tile sizes were divided by 15 to keep the shipped look.

## Closing evidence

- `tests/runtime/torusSkewDeformation.test.ts`: "keeps the floor UV of a mapped point across commits" (rest to a = 15 and
  to (30, 7.5), 1e-9); "keeps floor UVs seamless across every torus portal" (rest and both deformed states).
- `tests/render-contract/buildCellMesh.test.ts`: "gives floor textures a period of tileSizeMeters meters" (cell sizes 10
  and 40); "requests the floor texture with repeat 1"; "uses lattice UVs when a floor UV frame is given".
- `tests/render-contract/cellRenderArchetypes.test.ts`: "passes the floor UV frame through to the floor archetype".
- `tests/cell-complex/floorUv.test.ts` (3 tests) covers the UV formulas.
- Manual sweep in the browser: not run.

## Status update 2026-10-28

Filed today; references re-checked and still accurate. The floor is still a `ShapeGeometry` with raw-meter UVs
(`src/render/three/buildCellMesh.ts:107`) and `floorTextureRepeat` (`:151-163`) still divides the bounding-box span by
the tile size; `river_pebbles` has `defaultTileSizeMeters: 40` (`src/world-assets/floorTextures.ts:64-69`). Nothing is
implemented yet. The lattice-UV proposal assumes the lattice-coordinate transport of issue 53; if 53 or 54 change the
frame (footprint read from the vertices, or a reduced basis), the UV frame must follow.

## Summary

During a torus deformation the floor pebbles visibly swim under the house, bench and mouse. Two defects in the floor
UV mapping cause this; they add up.

1. **The texture rescales with the cell's bounding box.** The repeat is `span / tileSizeMeters`, but
   `THREE.ShapeGeometry` UVs are raw meters, not normalized. The effective tile is `tileSizeMeters / span` meters, and
   it changes whenever the footprint changes.
2. **The texture is anchored to Euclidean cell coordinates, while objects follow lattice coordinates.** A commit maps
   every object (and the player) by the affine lattice map A. The floor is rebuilt with UVs taken from Euclidean
   positions, so objects slide relative to the texture by (A − I)·p.

A side effect: the texture is not continuous across portals, even before any deformation.

## Evidence

- UVs and repeat: `src/render/three/buildCellMesh.ts:94-148` builds the floor as a `ShapeGeometry` (UV = (x, y) in
  meters) and sets `repeat = floorTextureRepeat(baseVertices, tileSizeMeters)` (`:151-163`), i.e. the larger
  bounding-box extent divided by the tile size.
- Object transport: `torusSkewDeformation.ts:149-155` (`mapPoint`) keeps lattice coordinates (α, β) with
  p = o + α·u + β·v, about the cell-centred origin o = −(u + v)/2.
- Concrete numbers in `torus-moduli` (`river_pebbles`, `defaultTileSizeMeters` 40, w = b = 15):
  - Rest state: span 15, repeat 0.375, tile period 40/15 ≈ 2.67 m (not 40 m).
  - At a = 15: vertices span x ∈ [−15, 15], span 30, repeat 0.75, period 1.33 m. The texture zooms by 2× about the
    cell centre. A point at x = 6 m moves from texture coordinate 2.25 to 4.5: it slides over 2.25 tiles.
  - Each 0.08 m step rebuilds the floor with a new repeat, so this is a continuous swim, not a single jump.
- Seams: a portal crossing translates by u or v. u / period = 15 / 2.67 = 5.625 tiles, not an integer, so there is a
  seam at rest. With v = (a, b) varying, the seam offset changes continuously, reinforcing the sense of motion.
- Other worlds: the tile size in meters depends on each cell's span, so pebble size jumps across portals between cells
  of different sizes, and `tileSize` in `floorTexture(..., { tileSize })` does not mean what it says.

## Proposed change

1. **Fix the tile-size semantics everywhere.** Generate floor UVs explicitly instead of relying on
   `ShapeGeometry`'s raw-meter UVs, and make the texture configuration independent of the footprint (repeat 1, UV
   scale folded into the geometry). A `tileSizeMeters` of 40 must give 40 m tiles.
2. **For deformable translation-surface families, use lattice UVs.** For the torus: uv = n·(α, β), with an integer
   number n of tiles per lattice vector, chosen from the base state so that the tile is close to `tileSizeMeters`.
   - The texture is carried by the same affine map as the objects, so nothing slides.
   - It is seamless across every portal at every deformation.
   - Cost: pebbles shear visibly. That is honest, since the Teichmüller map is not an isometry, and it visualizes the
     deformation.
   - The alternative, metric UVs with a fixed tile size, keeps pebbles undistorted but has objects move relative to
     the floor by design and leaves seams at the portals. Not recommended for this family.
3. Expose the UV policy through the deformation family (for example `floorUvFrame(state, cellId)`) so
   `buildCellMesh` does not hard-code torus knowledge. Non-deformable worlds keep metric UVs from (1).

## Acceptance criteria

- Unit test: for `torus-moduli`, the floor UV at the mapped image of a point equals the UV at the original point,
  across a commit from (a, b) = (0, 15) to (15, 15) and (30, 7.5), to 1e-9.
- Unit test: UVs on the two sides of every portal agree modulo ℤ² at the rest state and at the deformed states above.
- Unit test: a non-deformable world with `tileSize` 4 produces a 4 m texture period, independent of cell size.
- Manual: during a full sweep, the house, bench and flowers stay on the same pebbles.
