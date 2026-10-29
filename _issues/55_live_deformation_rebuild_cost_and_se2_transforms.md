# 55 - Live-deformation rebuild cost, worker pipeline, and an SE(2) transform type

Status: open; re-verified 2026-10-28.

- Job 12 (2026-10-29): the segment-walk kernel uses `RigidTransform3`; no `Iso2` was introduced (job 30 owns it).

Priority: P2 (performance / design).

Jobs: [30](../.agents/jobs/30_deformation_rebuild_pipeline.md).

## Status update 2026-10-28

Nothing in "Proposed change" is implemented:

- The session is still serial: `scheduleNextBuild` (`src/runtime/worldGeometrySession.ts:144-223`) returns while a
  build is in flight or a snapshot is ready, and only `pollReadySnapshot` (`:260-271`) schedules the next one.
- Steps are still fixed in parameter units. The app now passes `maxStepMeters: 0.04`
  (`src/render/three/createThreeApp.ts:792`), half the session default of 0.08 m (`worldGeometrySession.ts:120-123`),
  so at the same build time the sweep a = 0 → 30 m needs about 750 builds, twice the estimate below.
- `cancel()` (`:253-259`) still only clears local state; the worker (`worldGeometryWorker.ts:109`) has no cancel or
  init message, recompiles `baseWorld` per request (`:70`), and the client (`worldGeometryWorkerClient.ts:73-110`) keeps
  the stale resolver in `pending`.
- No `src/math/iso2.ts`; `RigidTransform3` is unchanged, and `compilePortalTransforms.ts:133-162` still has private
  `multiplyMat3`, `multiplyMat3Vec3` and `transposeMat3` alongside the ones in `src/math/rigidTransform3.ts:133-162`.

The build times in the table were not re-measured. Issue 82 covers the main-thread side of each commit (scene rebuild,
floor texture re-upload) and proposes the same cheap intermediate steps as item 2 here.

## Summary

Each 0.08 m deformation step costs a full compile plus a full static portal-path cull, about 100 ms. Steps run
strictly one after another, and the next step is only requested after the render thread has committed the previous
one. As a result, deformation speed depends on the device, and a full sweep takes tens of seconds on desktop and longer
on a headset. Three further costs:

- Each response is structured-cloned; part of that cost lands on the render thread.
- Cancelling does not stop the worker.
- All transforms are 3×3-matrix objects, although the model guarantees they lie in SE(2) × {id_z}.

## Evidence

Measured with `buildWorldGeometrySnapshotForRequest` on `torus-moduli`, using the app's options (depth 10,
`maxKeptPathsPerRoot` 50 000; `createThreeApp.ts:761-768`), Node 25:

| (a, b) | build | kept paths | `structuredClone(response)` |
| --- | --- | --- | --- |
| (0, 15) | 127 ms | 1793 | 9.3 ms |
| (0.08, 15) | 107 ms | 1793 | 9.6 ms |
| (15, 15) | 100 ms | 1793 | 9.4 ms |
| (30, 7.5) | 96 ms | 1793 | 9.6 ms |

`compileCellComplex` itself costs 0.02 ms, so the build is almost entirely `buildStaticallyCulledPortalPathTables`.

- Serial pipeline. `worldGeometrySession.ts:144-153` (`scheduleNextBuild`) builds only when no snapshot is pending. `pollReadySnapshot`
  (`:260-271`) triggers the next build only after the commit. The parameter speed is therefore
  0.08 m / (build + ≤ 1 frame) ≈ 0.7 m/s here. The sweep a = 0 → 30 m takes 375 builds, about 40 s, and several
  times longer on a mobile XR SoC.
- The step size is fixed in parameter units (`:120-123`), not in time, so the deformation speed varies with the device.
- Cancel does not reach the worker. `cancel()` (`:253-259`) only forgets `activeRequestId`. The worker
  (`worldGeometryWorker.ts:109`) still finishes the stale build, and the next `postMessage`
  (`worldGeometryWorkerClient.ts:110`) queues behind it. Its `pending` resolver is never removed.
- Every request re-sends `baseSpec` and recompiles `baseWorld` (`worldGeometryWorker.ts:70`). This is cheap today but
  redundant by design.
- Transforms. `RigidTransform3` (`src/math/rigidTransform3.ts:26-29`) is a nested object with 12 numbers.
  - `composeRigidTransform3` makes 27 multiplies for R plus a `vec3` allocation per row (`:86-91`, helpers at `:133-162`).
  - Path tables compose and invert once per candidate path (`portalPaths.ts:197,215`;
    `staticPortalPathCull.ts:263,281,486,571`).
  - `compilePortalTransforms.ts:133-162` keeps its own copies of `multiplyMat3`, `transposeMat3` and
    `multiplyMat3Vec3`.
  - Every gluing is a yaw plus a horizontal translation (MATHEMATICAL_MODEL §1), so 8 of the 12 entries are
    structurally 0 or 1.
  - Numerical drift is *not* a current defect. Reciprocity error is ≤ 2e-14 in every example, and depth-10 products
    drift by about 1e-15 relative.

## Proposed change

1. **Decouple stepping from build time.**
   - Choose each step so that parameter velocity is constant: Δ = v_param · (measured build ms + frame ms), clamped.
     Better still, use the Teichmüller step of issue 54.
   - Pipeline speculatively. `nextStep` is a pure function of the state, so build step k+1 while step k waits for
     commit. Keep at most 2 in flight.
2. **Cheap intermediate steps.**
   - For intermediate states, reuse the previous kept *word set* and recompute only the developed transforms:
     O(paths) SE(2) compositions, microseconds.
   - Run the full static cull only at the target, or every N steps.
   - This is safe for correctness. Static culling only prunes candidates, and per-frame aperture clipping
     (`visiblePortalPaths.ts`) stays exact, so a stale set can cause pop-in but never wrong drawing.
3. **Worker protocol.**
   - Add an `init { baseSpecVersion, baseSpec }` message so the worker caches the base world.
   - Make cancel real: send `{ cancel: requestId }` and check it between root cells in the cull. Also drop the
     resolver from `pending`.
   - Return path tables as `Float64Array` (4 numbers per transform, see 4) plus `Int32Array` parent and portal ids,
     posted as Transferables, so the render thread does not deserialize object graphs.
4. **`Iso2` transform type** in `src/math/iso2.ts`: `{c, s, x, y}` with c + is = e^{iθ}, acting by
   p ↦ (c·p_x − s·p_y + x, s·p_x + c·p_y + y), z unchanged.
   - Composition: (c, s) = (c₁c₂ − s₁s₂, s₁c₂ + c₁s₂) and t = R₁t₂ + t₁. That is 10 flops and 1 allocation.
   - Inverse: (c, −s, −(c·x + s·y), s·x − c·y).
   - Portal gluing in closed form: ρ = −t′·t̄ (complex, with unit tangents t and t′), g(z) = m′ + ρ(z − m).
   - Renormalize (c, s) by 1/hypot(c, s) whenever it is used to build a holonomy angle, for the loop products in
     issue 52.
   - Convert to `RigidTransform3` / `THREE.Matrix4` only at the render boundary (`worldAxes.ts`).
   - This makes "gluing fixes z" a type-level fact instead of a documented assumption.

## Acceptance criteria

- On the benchmark above, the sweep a = 0 → 30 m (b = 15) completes in ≤ 5 s of wall time with no frame over 20 ms
  attributable to commits.
- `cancel()` followed by `setTarget()` starts the new build within one frame: a test with a fake worker that records
  message order.
- Path tables built with `Iso2` match the current `RigidTransform3` tables to 1e-12 on every example world. The
  static-cull build time on `torus-moduli` drops measurably; record the number in the PR.
- No duplicate `Mat3` helpers remain outside `src/math`.
