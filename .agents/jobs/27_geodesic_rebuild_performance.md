# Job 27 - Per-frame cost of geodesic rebuilds

Status: queued.
Resolves: issue [70](../../_issues/70_geodesic_module_performance_and_split.md).

## Goal

Carrying an emitter and ticking curve shortening do not rescan, copy and re-intersect the whole registry several
times per frame ([issue 70](../../_issues/70_geodesic_module_performance_and_split.md)).

## Depends on

[job 25](25_split_geodesic_cannon_modules.md) (module split) and [job 26](26_exact_curve_shortening.md).

## Steps

[issue 70](../../_issues/70_geodesic_module_performance_and_split.md) §Proposed change items 1-4, plus the cross-portal intersection pairing merged from issue 41.

## Verification

Acceptance criteria of [issue 70](../../_issues/70_geodesic_module_performance_and_split.md) (the 200-segment benchmark).
