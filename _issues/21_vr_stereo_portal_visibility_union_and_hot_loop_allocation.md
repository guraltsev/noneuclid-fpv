# 21 - VR stereo portal visibility union and hot-loop allocation reduction

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: archive candidate after a current headset visual/performance check.

Priority: P2 for manual regression verification.

The renderer computes per-eye portal visibility, builds a conservative union
for frame-level instances, preserves per-eye clip results, and exposes per-eye
debug counts. Contract tests compare independent-camera visibility. The
remaining evidence is headset-only: confirm there is no eye conflict, blinking,
or mono clipping regression, then archive.

## Goal

Optimize XR portal visibility and portal instance rendering without changing the mathematical rendering contract.

The renderer must preserve true stereo portal correctness: each eye has its own camera, portal-root resolution, projected apertures, accumulated clip polygons, and clip texture rows. Performance work may share camera-independent work, reduce allocation, and cull invisible render work, but it must not collapse the two eyes into a mono or conservative substitute that makes the eyes disagree visually.

The key culling rule for stereo XR is:

> A portal path or destination cell image is render-relevant if it is visible from at least one headset eye.

In other words, stereo culling should use an OR over the two eyes for inclusion. If the left eye sees a portal image and the right eye does not, the instance still exists for the frame, but the per-eye clip data must make it render only in the eye where it is visible.

## Problem

Current XR portal rendering can be CPU-heavy on headset hardware. Debug data has shown large frame costs in the portal visibility phase, especially when both eyes separately walk deep visible-path tables and allocate many temporary geometry objects every frame.

Naive optimizations are dangerous here:

- using one shared mono render root for both eyes can make portal images blink or conflict,
- using one conservative clip polygon for both eyes can draw geometry in the wrong eye,
- silently lowering depth or visible-path budgets changes the world students are meant to inspect,
- dropping paths visible in only one eye creates stereo mismatch near portal boundaries.

The optimization must therefore target duplicated work and hot-loop allocation, not the correctness model.

## Correctness Model

For each XR frame:

- resolve the left and right eye render roots independently,
- compute visibility per eye using that eye's camera and projection matrix,
- keep each eye's accumulated clip polygon separate,
- include a path in the frame-level instance set when either eye marks it visible,
- write clip texture rows per eye, so an eye that does not see a path gets no valid clip region for that path,
- keep portal crossing and player movement semantics independent of render-only eye roots.

If both eyes resolve to the same root cell, the renderer may share camera-independent work such as path-table traversal, parent-child relationships, source portal aperture corners, and root-space aperture transforms.

If the eyes resolve to different root cells, the renderer must keep separate per-root computations. This can happen near a portal boundary and is exactly the case where correctness matters most.

## Scope

In scope:

- stereo OR visibility for portal path and destination-cell instance inclusion,
- per-eye clip data that preserves left/right visibility differences,
- hierarchical visible-child traversal,
- shared camera-independent work when both eyes share the same root,
- allocation reduction in the portal visibility hot loop,
- debug output that makes stereo union behavior inspectable,
- contract tests proving optimized visibility matches the existing per-eye result.

Out of scope:

- changing player movement, collision, or portal crossing,
- replacing true stereo portal rendering with a mono path,
- reducing XR depth or visible-path budgets as the main optimization,
- changing authored world geometry or portal topology,
- adding foveated rendering or platform-specific headset APIs.

## Implementation Plan

### 1. Preserve Independent Per-Eye Visibility

Keep the current semantic result equivalent to running:

```ts
computeVisiblePortalPaths(leftEye)
computeVisiblePortalPaths(rightEye)
```

An optimized batched path is acceptable only if tests prove that each eye's result matches the separate per-eye computation for:

- visible path ids,
- destination cell ids,
- path depths,
- accumulated clip polygons,
- clip rectangles,
- screen-area values,
- budget exhaustion and rejection counts.

### 2. Use OR Culling For Frame-Level Inclusion

Build the frame instance set as the union of visible paths from all active XR eyes.

Required behavior:

- path visible in left only: instance is present; left clip row is valid; right clip row rejects/discards,
- path visible in right only: instance is present; right clip row is valid; left clip row rejects/discards,
- path visible in both eyes: instance is present once; both clip rows are valid and eye-specific,
- path visible in neither eye: instance is absent.

Do not use AND culling. A path visible to only one eye is still visually meaningful and must not disappear.

### 3. Add Hierarchical Visible-Child Traversal

Avoid scanning every statically kept path when most ancestors are invisible.

The traversal should:

- start from the root path,
- test children only when their parent path is visible before final render-budget truncation,
- preserve the current depth limit,
- preserve current area clipping behavior,
- preserve final sorting and `maxVisiblePaths` budget behavior,
- produce the same visible result as the current full-table scan.

Important: child expansion must be based on pre-budget visibility, not only the paths that survive the final sorted budget. Otherwise deep paths could incorrectly vanish.

### 4. Reduce Allocation In Hot Loops

This is a required part of the issue, not optional polish.

The portal visibility loop runs every XR frame and often runs once per eye. It must avoid unnecessary per-path allocation.

Targets:

- avoid allocating new `THREE.Vector3` objects for every aperture corner projection when reusable scratch vectors will do,
- avoid allocating aperture corner arrays for paths that can reuse cached root-space apertures during the frame,
- avoid cloning matrices or polygon arrays until a path survives visibility checks,
- reuse scratch polygon buffers for near-plane clipping and convex clipping,
- keep final result objects stable and safe for downstream renderer code,
- avoid creating transient maps in inner loops where arrays indexed by path id are sufficient.

Document any scratch-buffer ownership rules in code comments, especially where a function returns data that must not be mutated later.

### 5. Make Debug Data Useful

Expose compact XR portal debug data that distinguishes:

- visible paths per eye,
- union visible paths,
- paths visible to left only,
- paths visible to right only,
- paths visible to both eyes,
- allocation-sensitive counters if practical, such as reused scratch buffers or per-frame created visible-path objects.

The debug panel does not need to show all of this at once, but renderer debug state should make it inspectable during headset performance work.

## Required Files

Likely touched files:

- `src/render/three/visiblePortalPaths.ts`
- `src/render/three/renderPortalInstances.ts`
- `src/render/three/portalClipData.ts`
- `src/render/three/createThreeApp.ts`
- `src/render/three/renderState.ts`
- `src/render/three/xrDebugPanel.ts`

Likely tests:

- `tests/render-contract/visiblePortalPaths.test.ts`
- `tests/render-contract/portalInstanceBuffers.test.ts`
- `tests/render-contract/portalClipData.test.ts`
- `tests/render-contract/xrDebugPanel.test.ts`

## Acceptance Criteria

- XR portal rendering remains true stereo.
- A path visible from at least one eye is included in the frame-level instance set.
- Paths visible from only one eye render only in that eye.
- The optimized per-eye visibility result matches separate per-eye computation in contract tests.
- Hierarchical traversal produces the same visible path set as full path-table scanning.
- Hot-loop allocation reduction is implemented and documented in code comments where scratch buffers are reused.
- Debug state can distinguish per-eye counts from union counts.
- The headset no longer shows eye conflict, blinking, or mono portal artifacts from culling.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Manual Headset Checks

- Stand near a portal boundary and move the headset laterally.
- Confirm a portal image can be visible in one eye without blinking out of both eyes.
- Confirm left/right portal edges remain stable and do not fight each other.
- Confirm recursive portal views still appear to the same depth as desktop settings allow.
- Confirm XR debug shows per-eye counts and union counts that make sense.
- Compare `portal ms` before and after the optimization in the same world and viewpoint.

## Notes

The performance target is to do less duplicate work while preserving the same mathematical result. The right mental model is not "one answer for two eyes." It is "two correct eye answers, computed with shared topology and low allocation where possible."
