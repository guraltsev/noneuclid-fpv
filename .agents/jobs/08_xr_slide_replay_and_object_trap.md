# Job 08 - XR slide replay and the player trapped by objects

Status: queued.
Resolves: issue [64](../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md).

## Goal

Fix the two remaining mover-integration bugs in [issue 64](../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md): the XR room-scale slide replayed every frame, and the player
who cannot leave an overlap with a runtime object.

## Steps

1. Add `appliedDisplacement` (source-cell frame, before any crossing) to `MoveDynamicObjectResult` / `MoveResult`.
   In `acceptPhysicalMove` (`src/render/three/xrPlayerRig.ts`) advance the head baseline by the applied part, so
   applied motion is never replayed.
2. `blockPlayerMoveAgainstRuntimeObjects` (`createThreeApp.ts`) accepts a move that does not increase penetration:
   for each overlapping body, `|c_new - c_o| >= min(|c_old - c_o|, r + r_o)`.

## Verification

- XR unit test: a constant head offset into a wall gives zero body motion on frames 2..N.
- Player test: starting inside a static body, a step away increases separation on the first frame.
