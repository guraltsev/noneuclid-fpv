# 75 - Frame-loop allocation churn and per-object draw calls outside the portal-visibility core

Status: open as of 2026-10-08.

Priority: P2 (performance; matters most at 72-120 Hz in XR).

## Summary

Issue 21 covers allocation inside `visiblePortalPaths`. The shell around it still allocates per draw call, per
visible path and per object every frame, and gives every runtime object its own `InstancedMesh` per sub-mesh. The
items below are independent and can land separately. Issue 71 covers record collection; issue 72 covers aim
recomputation.

## Evidence

Per draw call, per eye:

- Every cell and runtime-object archetype has an `onBeforeRender` (`createThreeApp.ts:2244-2247`, `:2685-2688`) that
  calls `updatePortalClipMaterialViewportFromRenderer`. That function allocates `new THREE.Vector4()` on each call
  (`portalClipMaterial.ts:91`).
- In stereo, `findPortalEyeRenderState` adds 2-4 `Matrix4` comparisons per call. When the matrices do not match, it
  allocates a `Vector4` and a `Vector2` (`:2559-2560`). They never match for a re-rooted eye, because `state.camera`
  is the portal-transformed clone (`xrPortalEye.ts:83-97`) and not the XR sub-camera. Re-rooted eyes therefore always
  take the allocating viewport fallback.
- Scale: 200 archetypes x 2 eyes x 90 Hz is about 36k-108k short-lived objects per second.

Per visible path:

- `transformVisiblePortalResultToRenderFrame` clones a `Matrix4` per path and builds a new `Map`
  (`portalEyeFrameTransforms.ts:46-54`), even when `renderFromRootMatrix` is the identity. That is the desktop case
  (`createThreeApp.ts:1423`, `new THREE.Matrix4()` every frame) and the usual XR case.
- `remapStereoPortalPathIds` maps and rebuilds again (`:63-79`).
- `buildVisiblePathsByDestinationCell` runs twice per mono frame (`:2489`, `:2525`). In mono mode,
  `getRuntimeObjectVisiblePaths` rebuilds groups, flattens and sorts on every call (`:2742-2756`), and aim calls it
  3-6 times per frame.

Per object, per frame:

- `runtimeObjectRegistry.getAll()` copies the array, and `getObjectsInCell` builds 3 arrays
  (`runtimeObjectRegistry.ts:226-249`). Both are called dozens of times per frame.
- `updateGeodesicEmitterLabels` allocates a `Quaternion` and a `Set` per frame and scans `getAll()`
  (`geodesicEmitterLabelController.ts:54-58`).
- With the protractor tool selected, `createProtractorToolFeedback` builds a new `Group`, `TorusGeometry` and
  materials every frame (`protractorToolFeedback.ts:48-60`, `:76-86`). `syncProtractorToolFeedback` then disposes
  them when the signature is unchanged (`createThreeApp.ts:3385-3387`). The signature should be computed *before*
  building anything.
- `xrPortalEye.ts:46`, `:51` and `:78` allocate a `Matrix4` and `Vector3` per eye per frame. `:84` runs
  `camera.clone()` (which includes children) per re-rooted eye per frame.
- `updateRuntimeObjectRenderArchetypeInstances` and `updateCellRenderArchetypeInstances` set `needsUpdate = true` on
  all three instance buffers of every archetype every frame (`renderPortalInstances.ts:215-218`, `:281-284`). Each
  re-uploads `capacity`-sized buffers even when the path set and poses are unchanged, for example when standing still.

Draw calls and material variants:

- `runtimeObjectArchetypeKeyPrefix` includes the object id (`runtimeSceneUtils.ts:133-139`), so archetypes are
  per object, per sub-mesh. Each clones its geometry and material and patches the material separately
  (`runtimeObjectRenderArchetypes.ts:75-81`).
  - A marmot has about 13 meshes, each with its own cloned material (`buildDecorationMesh.ts:112-146`), so 10 marmots
    cost about 130 draw calls per eye.
  - Every placed flag is likewise a set of separate instanced meshes, with capacity `records x maxVisiblePaths` each
    (`:137-143`).
- Archetypes with `count = 0` stay `visible` and `frustumCulled = false` (`runtimeObjectRenderArchetypes.ts:86-87`,
  `cellRenderArchetypes.ts:91`). In three r0.164, such a mesh still runs `onBeforeRender`, `setProgram` and uniform
  upload. Only `renderInstances` bails out at `primcount === 0` (`WebGLBufferRenderer.js:19-21`). Off-screen cells
  and objects therefore cost CPU per eye.

## Proposed change

1. Use module-scope scratch objects (`Vector4`, `Vector2`) in `updatePortalClipMaterialViewportFromRenderer` and
   `findPortalEyeRenderState`. Match eyes by `XRView` index or the `ArrayCamera` sub-camera identity, recorded once
   per frame, instead of comparing matrices of the possibly cloned camera. Do the eye switch once per eye in
   `scene.onBeforeRender`/`camera` hooks, not once per mesh.
2. Fast path when `renderFromRoot` is the identity: return the result unchanged. Otherwise transform into a pooled
   per-eye matrix array. Cache `visiblePathsByDestinationCell` and the flattened object-path list once per frame
   (see issue 71).
3. Keep a persistent clone per eye in `xrPortalEye` and update it in place. Return the shared identity matrix
   instead of `new Matrix4()`.
4. Give the registry an `objectsByCell` read-only view and a `version` counter instead of copying arrays. Have
   labels, measured lengths and hitbox debug skip work when the version and the player cell are unchanged.
5. Compute the protractor-feedback signature first, and build geometry only on change.
6. Track a per-archetype "dirty" flag, set when the path list, a record matrix or the clip-index map changes. Only
   then set `needsUpdate`. Use `addUpdateRange` for the written prefix (`count` instances) instead of a
   full-capacity upload.
7. Share runtime-object archetypes by model: key by `(kind or flagType or assetId, meshIndex)` and not by object id.
   Records from all objects of that model fill one `InstancedMesh`, so draw calls scale with model types instead of
   object count. Per-flag text stays a per-flag mesh, or moves to a text atlas with a per-instance UV offset
   attribute.
   - Merge the marmot's constant-colour boxes into one geometry with vertex colours: 1 draw call instead of about 13.
   - Set `mesh.visible = mesh.count > 0` after each instance update, for both cell and object archetypes.

## Acceptance criteria

- A test harness steps 600 frames of the desktop loop with mocked WebGL. With no player input, it reports zero
  `THREE.Vector*`, `Matrix4` and `Group` constructions per frame after warm-up. Count them by wrapping the
  constructors in the test.
- Standing still in a world with 10 marmots and 20 flags: `renderer.info.render.calls` drops by at least 50% versus
  the current build. Record the numbers in the PR.
- Instance buffers are not re-uploaded on frames where the visible path set and object poses are unchanged. Verify
  with a spy on `needsUpdate`.
- Stereo XR visual output is unchanged, per the contract tests from issue 21 and a headset check.
