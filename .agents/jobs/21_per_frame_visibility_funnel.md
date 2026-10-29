# Job 21 - Per-frame visibility: visible-parent traversal and the exact funnel

Status: queued.
Resolves: issue [57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md).

## Goal

Per-frame visibility visits only the children of visible parents and uses the exact 2.5D funnel, with fewer
allocations and no background holes ([issue 57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md), including the steps merged from issue 21).

## Depends on

[job 20](20_exact_static_cull.md) (shared oriented-portal representation).

## Steps

[issue 57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md) §Proposed change and its "Merged from issue 21" section: pre-budget child expansion, the funnel as at most
four planes through the eye, scratch buffers with documented ownership, and one place for the 16 px threshold
(today `createThreeApp.ts:2369/2440/2469`).

## Verification

Acceptance criteria of [issue 57](../../_issues/57_per_frame_portal_visibility_funnel_and_traversal.md); the visible set equals the full-table scan in mono and in the shared-root stereo
pass.
