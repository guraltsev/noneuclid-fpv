# 59 - Stereo with split roots: each eye's root cell is drawn unclipped in the other eye; union overflow favors eye 0

Status: open; re-verified 2026-10-28.

Priority: P2 (correctness, XR only). Related to issue 21 (closed 2026-10-28; its remaining stereo items are merged here). That issue covered stereo union and allocation; it did not
cover these defects.

Jobs: [23](../.agents/jobs/23_stereo_split_root_correctness.md).

## Status update 2026-10-28

Nothing in the proposal is implemented, and the defects are confirmed in the current code. In the split-root branch of
`syncStereoPortalInstanceRender` (`createThreeApp.ts:2397`), each eye runs `computeVisiblePortalPaths` with
`includeRootCell: true`. `remapStereoPortalPathIds` (`portalEyeFrameTransforms.ts:59-90`) hands out ids in first-seen
order, eye 0 first. `updateCellRenderArchetypeInstances` (`renderPortalInstances.ts:195-224`) still writes
`unclippedPortalClipIndex` (-2) for every depth-0 path, and both shader modes skip the clip test for -2
(`portalClipMaterial.ts:263`, `:318`). `portalClipData.updateStereo` still sorts the union by remapped id and slices it
to `maxVisiblePaths` (`portalClipData.ts:129-131`). Archetype capacity is still the per-single-root maximum
(`deriveCellRenderArchetypeCapacities`, `cellRenderArchetypes.ts:146-165`). Line numbers below have been updated. No
test of the split-root case exists yet.

## Summary

When the two eyes resolve to different root cells (the head straddles a portal, `xrPortalEye.ts:53-74`), both roots'
depth-0 paths end up in the instance union with clip index -2, which means "unclipped in every eye". Eye 1's root cell
is then drawn without restriction in eye 0, and eye 0's in eye 1. When the union overflows the clip-texture or
archetype capacity, eye 1's unique paths are always the ones dropped.

## Evidence

- `createThreeApp.ts:2457-2486`: with different roots, each eye runs `computeVisiblePortalPaths` with
  `includeRootCell: true`. `remapStereoPortalPathIds` (`portalEyeFrameTransforms.ts:59-90`) maps `A:0 -> 0` and
  `B:0 -> n`.
- `renderPortalInstances.ts:211` and `:275`: `path.depth === 0 ? unclippedPortalClipIndex : ...`. Both depth-0
  instances get -2, and `portalClipMaterial.ts:263` (and `:318` in smooth mode) skips the clip test for -2 in *every* eye.
- Consequence: in eye 0 (in cell A), cell B is drawn at B's placement with no clip.
  - Rays from eye 0 that leave A through a portal other than p_AB should see the neighbor D across that portal.
  - Around a vertex whose angle sum exceeds 2π, the developed wedge of B overlaps the wedge of D. The worlds in this
    repository are cone-manifolds, so such vertices occur.
  - B's walls and floor are then depth-tested against D's clipped instance, and wherever they are nearer they win.
  - The result is wrong geometry in one eye while the head is in a doorway. Without excess angle (flat tilings) the
    overlap is empty, which is why it goes unnoticed.
- `portalClipData.ts:129-131`: the union is sorted by remapped id and cut to `maxVisiblePaths`. Every id remapped from eye 1
  is larger than every id from eye 0, so eye 1's unique paths are dropped first. The same ordering decides the
  per-cell capacity cut in `updateCellRenderArchetypeInstances` (`renderPortalInstances.ts:203`).
- `cellRenderArchetypes.ts:151-155`: capacity is the maximum over *single* roots of the paths ending at a cell. The union
  of two roots' visible sets can exceed it. Overflow is recorded but silently truncates.
- Even with a shared root, each eye can return up to `maxVisiblePaths` = 2000 paths, so the union can reach 4000, but
  `portalClipData` has only `maxVisiblePaths` clip slots (`portalClipData.ts:63`).

## Proposed change

1. Use -2 only when every eye shares the root. Otherwise give each depth-0 path a normal clip slot. Its row is the full
   NDC square (or the four "always true" planes of issue 58) in its own eye and an empty row (count 0, which
   discards) in the other eye. One line in `updateCellRenderArchetypeInstances` plus a per-eye "root slot" in
   `updateStereo`.
2. Choose survivors of the union by per-eye rank, not by remapped id. Merge the two eyes' sorted lists round-robin
   (depth-then-area within each eye) until the clip-slot or capacity budget is exhausted. Size the clip slots as
   `eyes x maxVisiblePaths`, or cap each eye at `floor(maxVisiblePaths / eyes)` up front.
3. Derive the archetype capacity as `min(maxVisiblePaths x eyes, max over root pairs (r, r') adjacent through a portal
   of |paths_r(cell)| + |paths_r'(cell)|)`. Alternatively, grow the `InstancedMesh` on demand by doubling and
   reallocating.

## Acceptance criteria

- Test: a cone-manifold world with a vertex of angle sum 5π/2. Place the two eye cameras on opposite sides of a portal
  near that vertex. A readPixels test (or a CPU emulation of the clip rows) shows no fragment of the other eye's root
  cell outside that eye's portal region.
- With the union over budget, the number of paths dropped per eye differs by at most 1.
- `capacityOverflowCount` stays at 0 in the existing stereo contract tests when the eyes straddle a portal.

## Merged from issue 21 (2026-10-28)

Remaining stereo items from issue 21:

- Debug state exposes per-eye totals (`PortalEyeRenderDebugState`) and the union through `portalInstances`, but not
  left-only, right-only and both-eye counts. Add them to renderer debug state. The in-headset readout is tracked in
  issue [20](../.agents/jobs/19_vr_palette_and_in_headset_debug.md).
- Manual headset checks, to record when the split-root fix lands:
  - Stand near a portal boundary and move the headset sideways. A portal image may be visible in one eye, but it must
    not blink out of both.
  - Left and right portal edges stay stable and do not fight.
  - Recursive views reach the same depth as the desktop settings allow.
  - Compare `portal ms` before and after, in the same world and viewpoint.
