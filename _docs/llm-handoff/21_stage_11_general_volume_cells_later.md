# 21 - Stage 11: General volume cells later

## Goal

Add true arbitrary 3D cells only after prism-cell exploration works.

This file describes the future seam. It is not an instruction to implement volume cells now.

## Why later

If the software does not compute curvature, general 3D cells are more feasible than a full 3D geometry theorem engine. Still, they add real complexity:

- arbitrary polygonal portal faces,
- collision against slanted faces,
- edge and vertex corner cases,
- robust portal crossing at many orientations,
- more complex rendering apertures,
- more complicated authoring validation.

These are solvable engineering problems, but they should not delay the first classroom-usable environment.

## Future cell type

Possible future type:

```ts
export interface PolyhedronCellSpec {
  kind: "polyhedron";
  id: CellId;
  vertices: readonly Vec3[];
  faces: readonly PolyhedronFaceSpec[];
  decorations?: readonly DecorationSpec[];
}
```

A face may be wall or portal, similar to prism side faces.

## Required validation

A future polyhedron compiler must validate:

- face vertex indices exist,
- each face polygon is planar,
- face winding is consistent,
- cell volume is positive or at least consistently oriented,
- portal faces are compatible,
- portal transforms are rigid and frame-consistent,
- forbidden zones are generated where multiple portal faces meet,
- collision surfaces are explicit.

## Portal junctions for volume cells

For volume cells, a portal junction is an edge or vertex incident to two or more portal faces.

The same forbidden-zone and object-footprint rule applies:

```text
player and tools may not enter the forbidden neighborhood of portal junctions
```

The implementation may approximate edge zones with capsules and vertex zones with spheres.

## Tests required before enabling

Required tests:

- simple cube cell compiles,
- tetrahedron cell compiles,
- non-planar face is rejected,
- portal between compatible square faces compiles,
- incompatible portal faces are rejected,
- movement collides with slanted wall,
- movement crosses arbitrary oriented portal,
- forbidden zone exists where two portal faces meet,
- straight ray crosses arbitrary oriented portal.

## Integration rule

Do not rewrite prism cells as a special case of arbitrary polyhedra until the arbitrary implementation proves clearer.

It is acceptable for the project to have:

```ts
CellSpec = PrismCellSpec | PolyhedronCellSpec
```

later, with separate compiler branches that share public contracts.

## Exit criteria

A general volume cell should be enabled only when it supports movement, collision, portal crossing, straight rays, rendering, and forbidden zones at the same reliability level as prism cells.
