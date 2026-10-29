# Job 17 - Multi-hop portal ghosts and XR eye re-rooting

Status: queued.
Resolves: issue [73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md).

## Goal

Ghost records and XR eye re-rooting look further than one portal hop, and re-rooting does not depend on array order
([issue 73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md)).

## Depends on

[job 12](12_segment_walk_kernel.md).

## Steps

[issue 73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md) §Proposed change: compute ghosts from the kernel walk of the body's extent; give objects without collision
bounds a ghost; resolve each eye root by walking from the head to the eye.

## Verification

Acceptance criteria of [issue 73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md).
