# 17 - Stage 07: Environment tools

## Goal

Add simple tools that help students explore and record observations without turning the software into a theorem tutor.

The tools provide raw environmental affordances: markers, path traces, distances, and angles.

## Files to create

```text
src/tools/markers.ts
src/tools/pathTrace.ts
src/tools/measurements.ts
src/tools/toolState.ts
src/render/three/drawMarkers.ts
src/render/three/drawPathTrace.ts
src/render/three/drawMeasurements.ts
src/classroom/discoveryLog.ts
tests/tools/markers.test.ts
tests/tools/pathTrace.test.ts
tests/tools/measurements.test.ts
```

## Marker tool

Required behavior:

- place marker at valid local point,
- reject marker inside forbidden zone,
- reject marker outside current cell,
- store cell id and local position,
- allow optional label or simple color.

Do not require accounts or student identity.

## Path trace tool

Required behavior:

- start recording current movement path,
- append local segments tagged by cell id,
- stop recording,
- clear recording,
- render the trace.

A path trace should preserve cell-local segments. Do not flatten traces into one global coordinate system.

## Distance measurement

First pass behavior:

- measure straight-line distance between two points in the same cell,
- optionally measure path-trace length by summing local segments.

Do not infer shortest paths across portals.

## Angle measurement

First pass behavior:

- measure angle between two rays or two local segments sharing a point in the same cell,
- display the numeric angle.

Do not compute triangle defects or curvature.

## Discovery log

The discovery log should record actions:

- marker placed,
- ray fired,
- path trace started/stopped,
- measurement made,
- world reset.

Keep it local. Export as JSON later if needed.

Do not collect personal data.

## Tests to write

Required tests:

- marker placement succeeds in valid space,
- marker placement fails inside forbidden zone,
- path trace stores cell-tagged segments,
- path-trace length sums segment lengths,
- distance between two local points is correct,
- angle between two local segments is correct,
- discovery log records action objects in order.

## UI rule

The UI may show raw values:

```text
length: 3.42 m
angle: 87 deg
ray stopped: wall
```

The UI should not say:

```text
You have discovered Gauss-Bonnet.
The curvature enclosed is ...
The holonomy equals ...
```

## Exit criteria

Students can leave evidence in the world and compare observations without the software explaining the mathematics.
