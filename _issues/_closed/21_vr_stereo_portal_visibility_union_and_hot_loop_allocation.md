# 21 - VR stereo portal visibility union and hot-loop allocation reduction

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: closed on 2026-10-28.

Priority: P2 for manual regression verification.

## Outcome

Merged. The correctness model is done: per-eye roots, per-eye visibility, the OR union, per-eye clip rows, the
shared-root pass and per-eye debug counts. The unfinished parts are tracked in the issues that already covered them:

- Hierarchical traversal and allocation (steps 3 and 4) are in [57](../57_per_frame_portal_visibility_funnel_and_traversal.md).
- The split-root defects, the left-only/right-only/both-eye counts and the manual headset checks are in [59](../59_stereo_split_root_unclipped_roots_and_union_budget.md).
- The in-headset debug readout is in [20](../20_vr_palette_menu_from_shared_definition.md).

## Closing evidence

- `resolveXrPortalEyeRenderRoot` (`src/render/three/xrPortalEye.ts`) resolves each eye's root on its own.
- `buildUnionVisiblePathById` (`portalEyeFrameTransforms.ts`) builds the union, and `portalClipData.updateStereo`
  writes one row block per eye.
- Two contract tests cover this:
  - "matches separate per-eye visibility when computed in one independent-camera pass" in
    `tests/render-contract/visiblePortalPaths.test.ts`;
  - "stores stereo clip polygons in stable per-eye rows for the same path id" in
    `tests/render-contract/portalClipData.test.ts`.
- Each open item has a "Merged from issue 21 (2026-10-28)" section in 57, 59 and 20.

## Status update 2026-10-28

The audit note above overstated progress. The correctness model (steps 1, 2) holds. The two performance steps (3, 4)
were never done, and the 2026-10-09 audit found split-root defects in the union.

Done:

- Per-eye roots: `resolveXrPortalEyeRenderRoot` (`src/render/three/xrPortalEye.ts`) resolves each eye's root
  independently. `syncStereoPortalInstanceRender` (`createThreeApp.ts`) computes visibility per eye.
- Shared camera-independent work when both eyes share a root: `computeIndependentVisiblePortalPaths`
  (`visiblePortalPaths.ts`) builds each path's root-space aperture once and projects it per camera. Test
  "matches separate per-eye visibility when computed in one independent-camera pass" in
  `tests/render-contract/visiblePortalPaths.test.ts`.
- OR union: `buildUnionVisiblePathById` (`portalEyeFrameTransforms.ts`) feeds one instance set.
  `portalClipData.updateStereo` writes one row block per eye, so an eye that does not see a path has an empty row
  (count 0, discard). Test "stores stereo clip polygons in stable per-eye rows for the same path id" in
  `tests/render-contract/portalClipData.test.ts`.
- Per-eye debug counts: `PortalEyeRenderDebugState` (`renderState.ts`) and `formatPortalEyeLine` (`debugOverlay.ts`,
  `portal eyes: 0:n@d 1:n@d`). The union count is the instance total in `portalInstances`.

Remaining:

- Step 3, hierarchical traversal: not done. Both `computeVisiblePortalPaths` and `computeIndependentVisiblePortalPaths`
  still loop over the whole kept table (`for (const path of input.pathTable.paths)`). The concrete design is in issue
  [57](../57_per_frame_portal_visibility_funnel_and_traversal.md).
- Step 4, allocation: not done. Per-path `rigidTransformToThreeMatrix`, NDC projection arrays, Sutherland-Hodgman
  arrays and a per-path matrix `clone()` in `transformVisiblePortalResultToRenderFrame` are still allocated every
  frame. No scratch buffers exist. Also covered by issue 57, step 5.
- Step 5: left-only, right-only and both-eye counts are not exposed. Only per-eye totals are.
- Split roots are not correct yet. When the eyes have different roots, each root's depth-0 path is drawn unclipped in
  the other eye, and union overflow drops eye 1 first. See issue
  [59](../59_stereo_split_root_unclipped_roots_and_union_budget.md). The acceptance item "paths visible from only one eye
  render only in that eye" therefore fails for root cells in that case.
- Headset visual/performance check: not recorded.
- `xrDebugPanel.ts` and its test, listed under Required Files, were removed. Debug output is the DOM
  `debugOverlay.ts`, which is not visible inside an immersive session (issue
  [20](../20_vr_palette_menu_from_shared_definition.md)).

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
- ~~`src/render/three/xrDebugPanel.ts`~~ removed as unused; debug output is `debugOverlay.ts`

Likely tests:

- `tests/render-contract/visiblePortalPaths.test.ts`
- `tests/render-contract/portalInstanceBuffers.test.ts`
- `tests/render-contract/portalClipData.test.ts`
- ~~`tests/render-contract/xrDebugPanel.test.ts`~~ not present

## Acceptance Criteria

- ~~XR portal rendering remains true stereo.~~ done: per-eye roots and per-eye clip rows.
- ~~A path visible from at least one eye is included in the frame-level instance set.~~ done: `buildUnionVisiblePathById`, subject to the budget bias of issue 59.
- Paths visible from only one eye render only in that eye. Holds for depth >= 1. Fails for the depth-0 root paths when the eyes have different roots (issue 59).
- ~~The optimized per-eye visibility result matches separate per-eye computation in contract tests.~~ done: `visiblePortalPaths.test.ts`.
- Hierarchical traversal produces the same visible path set as full path-table scanning. Not done; there is no hierarchical traversal (issue 57).
- Hot-loop allocation reduction is implemented and documented in code comments where scratch buffers are reused. Not done (issue 57).
- ~~Debug state can distinguish per-eye counts from union counts.~~ done: `portalEyes` per eye, union through `portalInstances`. Left-only/right-only counts are still missing.
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
