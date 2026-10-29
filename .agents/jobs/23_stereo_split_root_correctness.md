# Job 23 - Correct stereo rendering with split eye roots

Status: queued.
Resolves: issue [59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md).

## Goal

With different eye roots, each eye's root cell is clipped in the other eye, and union overflow does not favour eye 0
([issue 59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md), including the items merged from issue 21).

## Depends on

[job 19](19_vr_palette_and_in_headset_debug.md) (in-headset debug readout for the headset checks).

## Steps

[issue 59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md) §Proposed change; add left-only, right-only and both-eye counts to renderer debug state.

## Verification

Acceptance criteria of [issue 59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md), a split-root contract test, and the manual headset checks listed in its "Merged from
issue 21" section.
