# Job 07 - One forward-heading convention: marmot heading and deformation transport

Status: queued.
Resolves: issue [64](../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md), issue [53](../../_issues/53_torus_deformation_commit_transport_defects.md).

## Goal

Forward is R·e_y everywhere. Fix both places that use another vector, together, so authored and live objects agree
after a deformation commit.

## Steps

1. Marmot ([issue 64](../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) item 2): `yawFromVelocity` (`src/world-objects/geodesicMarmot.ts`) becomes
   `Math.atan2(-velocity.x, velocity.y)`. **Owner decision needed:** flip the authored marmot velocities (and the
   anchor-crossing test that encodes the mirror) so the worlds look the same, or accept the new directions. Un-skip
   "walks along its body +y axis in the authored velocity direction" (`tests/world-objects/geodesicMarmot.test.ts`).
2. Marmot freeze at a zone ([issue 64](../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) item 2): turn or reflect the heading on a `forbidden-zone` block so the marmot
   does not stay blocked forever.
3. Deformation heading ([issue 53](../../_issues/53_torus_deformation_commit_transport_defects.md) item 2): `transformRigidPoseWithMap`
   (`src/runtime/worldGeometryDeformations.ts`) transports f' = normalize(A·R·e_y) instead of the right vector, and
   the marmot velocity uses the same path. Update the test "maps a vertical-lattice heading into the skewed heading".
4. Document the convention in `_docs/MATHEMATICAL_MODEL.md` §9 and remove the "mirrored marmot" known gap.

## Verification

- Marmot test: velocity (1, 0) gives Δx > 0; a marmot aimed at a zone moves on at least 90% of later frames.
- [issue 53](../../_issues/53_torus_deformation_commit_transport_defects.md) acceptance: a creature with forward (1, 0) keeps forward (1, 0) after a = 0 → 15 at b = 15.
