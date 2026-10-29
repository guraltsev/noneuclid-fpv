# Job 15 - Geodesic tracing on the segment-walk kernel

Status: queued.
Resolves: issue [69](../../_issues/69_geodesic_tracing_kernel_numerics.md).

## Goal

Geodesic tracing uses the segment-walk kernel instead of the 10⁻⁴ m nudge, and its disk and intersection tests are
exact ([issue 69](../../_issues/69_geodesic_tracing_kernel_numerics.md)).

## Depends on

[job 12](12_segment_walk_kernel.md).

## Steps

[issue 69](../../_issues/69_geodesic_tracing_kernel_numerics.md) §Proposed change: trace through the kernel, precompute inverse portal transforms, fix the outward-start disk
test (`c <= 0` false hit), and find intersections that the current tests miss.

## Verification

Acceptance criteria of [issue 69](../../_issues/69_geodesic_tracing_kernel_numerics.md); no drift that grows with the number of portal crossings.
