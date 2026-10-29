# Job 09 - Make torus deformation commits safe

Status: queued.
Resolves: issue [53](../../_issues/53_torus_deformation_commit_transport_defects.md).

## Goal

A deformation commit must never leave a body inside an obstacle, must reject footprints it cannot map, and must
reach every target it accepts ([issue 53](../../_issues/53_torus_deformation_commit_transport_defects.md) items 1, 3 and 4).

## Steps

1. After each commit, depenetrate every transported body (player, creatures, flags) as in [issue 53](../../_issues/53_torus_deformation_commit_transport_defects.md) §Proposed change 1.
   If job 18 has already removed the cylinders at flat vertices, the torus case may already be gone; keep the general
   depenetration anyway.
2. Read the lattice frame from the footprint vertices (or make `validateTorusSkewBaseSpec` reject footprints that do
   not match `buildTorusParallelogramVertices(inferred)`).
3. `nextTorusSkewStep`: keep the width fixed or interpolate (w, a, b) jointly in (a/w, b/w).

## Verification

The four acceptance criteria of [issue 53](../../_issues/53_torus_deformation_commit_transport_defects.md) that concern the trap, the frame and the width step.
