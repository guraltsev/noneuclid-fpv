# Job 29 - Frame-loop allocation and per-object draw calls

Status: queued.
Resolves: issue [75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md).

## Goal

Remove per-frame allocation churn and per-object draw calls outside the visibility core ([issue 75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md)).

## Depends on

[job 28](28_frame_snapshot_instance_sync.md).

## Steps

[issue 75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md) §Proposed change (all seven items), plus the per-frame palette serialisation merged from issue 41 (replace
with a version counter).

## Verification

Acceptance criteria of [issue 75](../../_issues/75_frame_loop_allocation_and_per_object_draw_calls.md).
