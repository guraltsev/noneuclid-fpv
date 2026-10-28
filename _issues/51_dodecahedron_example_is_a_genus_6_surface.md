# 51 - The "dodecahedron" example world is a genus-6 surface, not a dodecahedron

Status: open as of 2026-10-08.

Priority: P1 (correctness of bundled content; it is also the world the static-cull tests use).

## Summary

`src/examples/dodecahedron.world.js` glues 12 regular pentagons with 30 reciprocal portals. The portals are valid
(equal side lengths, reciprocal pairs), but the side pairing is not the dodecahedron's. Its vertex classes give
V = 8, so χ = V − E + F = 8 − 30 + 12 = −10: a closed orientable flat cone surface of **genus 6**. A dodecahedron has
V = 20, χ = 2, and 20 cone points of angle 3·108° = 324°. The other platonic examples (tetrahedron, cube, octahedron,
icosahedron) and the torus and genus-2 worlds have the expected invariants.

## Evidence

Vertex classes were computed from the compiled complex. A portal on side i of cell A, glued to side j of cell B,
identifies corner (A, i) with (B, j+1) and corner (A, i+1) with (B, j), because the gluing reverses the tangent
(`src/cell-complex/compilePortalTransforms.ts:65-79`). For each class the script summed interior angles and checked
Gauss–Bonnet, Σ(2π − θ_v) = 2πχ. It also checked numerically that `transformToTarget` sends vertex i to vertex j+1
(error ≤ 1.5e-14 in every example).

| world | F | E | V | χ | cone angles (deg × corners per class) |
| --- | --- | --- | --- | --- | --- |
| cube / 001-basic-cube | 6 | 12 | 8 | 2 | 270×3 (8 classes) |
| tetrahedron / 002 | 4 | 6 | 4 | 2 | 180×3 (4 classes) |
| octahedron | 8 | 12 | 6 | 2 | 240×4 (6 classes) |
| icosahedron | 20 | 30 | 12 | 2 | 300×5 (12 classes) |
| **dodecahedron** | 12 | 30 | **8** | **−10** | **1620×15, 2700×25, 540×5, 324×3 (5 classes)** |
| genus-2-torus | 1 | 4 | 1 | −2 | 1080×8 |
| torus, torus-moduli | 1 | 2 | 1 | 0 | 360×4 (flat) |

Root cause, `src/examples/dodecahedron.world.js:35-57`. Corner 0 of `upper-k` is identified with corner 1 of
`upper-(k+1)` through `top`. The third face at that vertex must therefore glue `upper-k` side 4 to `upper-(k+1)` side 1.
The script glues `upper-k` side 1 to `upper-(k+1)` side 4, which runs the ring in the wrong direction. The
`upper→lower` cross links (`:47-51`), the lower ring (`:53-57`) and the bottom face (`:59-63`) inherit the same error.

Tests do not catch it. `tests/cell-complex/compileCellComplex.test.ts:32-40` counts only cells, sides and portals.
`tests/cell-complex/staticPortalPathCull.test.ts:228` profiles culling on this genus-6 surface. The catalog text
(`src/authoring/exampleWorlds.ts:31`, `worldCatalog.ts:36`) calls it a dodecahedron.

## Proposed change

Replace lines 29-63 with this pairing. It was checked with the same script: V = 20, χ = 2, all 20 classes are 324°×3.

```js
for (k = 0; k < 5; k += 1) {
  Portal("top", k, "upper-" + k, 0);
  Portal("upper-" + k, 4, "upper-" + ((k + 1) % 5), 1);
  Portal("upper-" + k, 2, "lower-" + k, 0);
  Portal("upper-" + k, 3, "lower-" + ((k + 1) % 5), 1);
  Portal("lower-" + k, 4, "lower-" + ((k + 1) % 5), 2);
  Portal("bottom", (5 - k) % 5, "lower-" + k, 3);
}
```

Write the 30 calls out explicitly if loops are unwanted in examples. The icosahedron script already uses loops.
If a genus-6 world is wanted for teaching, keep the old pairing as a separate `genus-6-pentagons.world.js` and
describe it accurately.

Add an invariant test over every bundled world. Reuse the vertex-class routine from issue 52 so the test and the
compiler share one implementation. The test asserts the expected `{χ, multiset of cone angles}` per world, for example
dodecahedron `{2, 20×324°}` and genus-2 `{−2, 1×1080°}`.

## Acceptance criteria

- The dodecahedron world has χ = 2 and 20 vertex classes of angle 324°.
- A test asserts χ and the cone-angle multiset for every file in `src/examples/`.
- The dodecahedron static-cull test is re-baselined. Its `≤ 12 000` kept-path bound may need adjusting.
