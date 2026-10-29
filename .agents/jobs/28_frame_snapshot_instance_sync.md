# Job 28 - Sync runtime-object instances once per frame against the rendered root

Status: queued.
Resolves: issue [71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md).

## Goal

Runtime-object instances are synced once per frame, against the root actually rendered ([issue 71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md)).

## Steps

[issue 71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md) §Proposed change: remove the second `syncRuntimeObjectPortalInstances()` call in `renderFrame`, key
`getRuntimeObjectVisiblePaths` by the rendered root, add a registry version counter, and rebuild hitbox debug only on
change. Compute the frame's derived values once from one snapshot (theme 7 of [issue 50](../../_issues/50_deep_code_audit_2026_10_09_index.md)).

## Verification

Acceptance criteria of [issue 71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md).
