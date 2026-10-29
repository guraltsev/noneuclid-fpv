# 41 - Defects and inconsistencies found while documenting the code

Status: closed on 2026-10-28.

Priority: mixed; grouped and rated. Each item cites the module (`src/...`) where the behavior was read; re-verify before
fixing. Fixed items are listed at the end so the history is visible.

## Outcome

Merged. The fixed items are listed at the end of this file. Every item still open moved to the audit issue that owns
that area, under a "Merged from issue 41 (2026-10-28)" section. The `TODO(issue 41)` comments in the source were
renamed to the new owners.

- Static cull soundness: [56](../56_exact_static_cull_by_oriented_line_stabbing.md).
- Culled path ids: [60](../../.agents/jobs/24_lazy_path_trie.md).
- Unequal cell heights across a portal: [52](../52_compile_time_vertex_classes_and_gluing_validation.md).
- Wall overlap at a crossing: [62](../62_segment_based_portal_traversal_and_swept_motion.md).
- Curve-shortening defects: short free loops stall in [66](66_curve_shortening_stalls_at_high_frame_rate.md); a free loop crossing a portal in [68](68_loop_endpoint_crossing_must_conjugate_portal_word.md);
  emitter orientation and rollbacks in [67](../67_exact_curve_shortening_via_sleeve_funnel.md); O(n²) intersections in [70](../70_geodesic_module_performance_and_split.md).
- Marmot heading: [64](64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md).
- XR input and palette: [20](../../.agents/jobs/19_vr_palette_and_in_headset_debug.md).
- Per-frame palette serialisation: [75](../75_frame_loop_allocation_and_per_object_draw_calls.md).
- Texture lifetimes: [74](74_frame_loop_error_containment_and_dispose_leaks.md).
- `DesktopFlagEditor`, dead code, duplication and naming: [38](../../.agents/jobs/33_decompose_runtime_monoliths.md).
- Layering debt: [78](../78_enforce_layer_dag_and_move_domain_logic_out_of_render.md).

## Closing evidence

- On 2026-10-28, `npm run typecheck`, `npm test` (608 passed, 9 skipped) and `npm run docs:check` all passed.
- The `TODO(issue 41)` comments were renamed:
  - to issue 56 at `src/cell-complex/staticPortalPathCull.ts:199`, `:376` and `:702`;
  - to issues 66, 68, 67 and 70 at `src/world-objects/geodesicCannon.ts:3727`, `:3755`, `:3955` and `:5240`.
- The marmot reference in `_docs/MATHEMATICAL_MODEL.md` §9 now points to issue 64.

## Status update 2026-10-28

Every open item below was re-read against the current code. Newly done:

- `VrPaletteAnchorKind` is now `"viewer"` only (`render/three/vrPalettePlacement.ts:12`).
- The beam height is no longer a literal in `aimTarget.ts` (it imports `geodesicRayBeamHeightMeters` from
  `world-objects/geodesicCannon.ts`) or `geodesicEmitterLabels.ts`.

Still open, unchanged: all P1 items (the `TODO(issue 41)` markers are at `staticPortalPathCull.ts:199`, `:376`, `:702` and
`geodesicCannon.ts:3727`, `:3755`, `:3955`, `:5240`); all P2 items; the remaining P3 items; eleven layering baseline edges.
One new P1 marker (`geodesicCannon.ts:3727`, free loops between `GEODESIC_MIN_LENGTH_METERS` and
`4 * curveShorteningMinStepMeters` stall) is added below. `npm run typecheck`, `npm test` (608 passed, 9 skipped) and
`npm run docs:check` pass. Overlaps: static cull with issue 56; the free loop crossing a portal with issue 68; the
O(n^2) intersections with issue 70; the marmot heading with issue 64; the wall-overlap item with issues 62 and 63; layering with
issue 78; the `DesktopFlagEditor` item and the geodesic split with issues 38 and 76.

## Open - P1 geometric correctness / soundness

- **Static visibility cull is not provably conservative** (`cell-complex/staticPortalPathCull.ts`): the aperture slack
  (at least 0.075 m) rejects *more* as it grows; the projective tau/sigma stage never tests sight lines that cross the line
  sent to infinity; `toleranceMeters` is compared against dimensionless quantities; parallelism thresholds differ between
  projection construction and the intersection test. `// TODO(issue 41)` comments mark the spots. Needs a design review
  with rendering comparisons, not a blind change.
- **Culled path ids** from `buildStaticallyCulledPortalPathTables` are sparse and differ from `buildPortalPathTables`
  (now documented in its JSDoc, `staticPortalPathCull.ts:181`, but not changed).
- **Unequal cell heights across a portal** are not modelled (aperture is the smaller height) and not rejected (the
  `validateCellComplexSpec.ts` header states it does not check them).
- **Wall overlap at portal crossings** is not tested in the target cell (floor, ceiling and exclusion zones are). Now
  documented as deliberate in `movement/moveDynamicObject.ts:112` (corner straddling); decide whether to accept it.
- **Curve shortening** (`world-objects/geodesicCannon.ts`): a free loop that crosses a portal probably stalls (only one of
  its two roles has its word updated); a free loop whose length lies between `GEODESIC_MIN_LENGTH_METERS` and
  `4 * curveShorteningMinStepMeters` stalls (marker at :3727); the emitter-at-`end` orientation is assumed to be
  emitter-at-`start` in several helpers; `tieAndDetachGeodesicEndpoints` deletes geodesics on a forbidden-zone rebuild
  failure instead of rolling back; a rejected (lengthening) step is skipped, not rolled back to a fused geodesic;
  `intersections` are an O(n^2) scan that does not pair segments across a portal boundary.

## Open - P2 behavior that is probably wrong

- **Marmot heading is mirrored.** `world-objects/geodesicMarmot.ts#yawFromVelocity` uses `atan2(vx, vy)`, so the marmot
  walks along `(-vx, vy)`. The fix is one line, but it flips every authored marmot and an existing test encodes the current
  direction; decide whether to fix the data or the code. The intended behavior is now written down as a skipped test
  (`tests/world-objects/geodesicMarmot.test.ts:100`, "walks along its body +y axis in the authored velocity direction").
- **XR input** (`render/three/xrControls.ts`): `isCarryActionPressed` always returns false, so carry is unreachable from XR
  (needs a button-binding decision); `menuTogglePressed` is always false in both palette input modules
  (`xrScenePaletteInput.ts` computes it in `createControllerSources` but `createXrScenePaletteInput` returns `false`).
- **Palette:** `scenePaletteController` serialises the whole definition every frame to detect changes; legacy `xrPalette*`
  userData keys still exist beside `scenePalette*` (writers in `vrPaletteLibraryAdapter.ts`, fallback readers in
  `scenePaletteController.ts` and `scenePointers.ts`); `xrScenePaletteInput` shares a module-level `controllerObjects` set
  across instances.
- **Texture lifetimes:** `buildCellMesh.buildTextPlane` allocates a 1024x512 canvas texture per portal debug label that is
  shared into cloned archetype materials and never disposed; `preloadWorldAssets` never disposes loaded textures.
- **`DesktopFlagEditor.open()` is never called**, so the editor can never open (and would need the key-capture guard that
  now exists).

## Open - P3 dead code, duplication, naming

- Unused: the dithered smooth-edge clip-shader path (`portalClipEdgeSmoothingEnabled` is `false`), ~~non-`viewer`
  `VrPaletteAnchorKind`s~~ (done: the type is `"viewer"` only), `onGeometryComputerSetTargetRequested` (wired through
  `scenePaletteController.ts` but never invoked by `vrPaletteLibraryAdapter.ts`), `applyJoystickDeadZone` and
  `nextAcceptedHeadLocalMeters` (only tests use them), `createGeodesicSegmentTooltip` has identical branches.
- Duplicated helpers: remaining private `disposeObject3D` copies (`buildDecorationMesh`, `helpLensRenderer`,
  `xrControllerHandModels` — they dispose different subsets, so merging needs care), `formatVec3`/`roundNumber` in
  `debugOverlay.ts` vs `appDebugHelpers.ts`, and a third private `roundNumber` in `geodesicCreatureDebug.ts`.
- Naming: the `"geodesci-marmot"` kind literal; `ShowCellPathRendersInstances` capitalisation; ~~the beam height `1.08` is
  still a literal in `aimTarget.ts` and `geodesicEmitterLabels.ts`~~ (done: only `geodesicRayBeamHeightMeters` in
  `geodesicCannon.ts:556` remains).

## Open - layering debt

Eleven imports still break the intended layering (mostly `world-objects -> render` mesh builders and
`world-objects -> runtime`). They are frozen in `scripts/docs/layering-baseline.json` and listed in
`_docs/generated/ARCHITECTURE_REFERENCE.md`; delete baseline entries as they are fixed.

## Fixed (2026-10-09)

- **Validation** (`cell-complex/validateCellComplexSpec.ts`, moved from `authoring`): non-finite heights/vertices, two portals
  on one side, self-targeting portals and glued sides of unequal length (1e-6 m) are rejected; `compileCellComplex` enforces
  all of it by default (`allowUnequalGluedSides` is a test-only escape hatch). All catalog worlds pass.
- **Movement:** a body pushed out of one wall that now overlaps a second wall is returned to its original pose; a portal
  crossing that would violate the target cell's floor, ceiling or exclusion zones is refused; requesting the unimplemented
  `"bounds"` crossing mode throws; the identical-branch `MovementCoordinateFrame` code was removed.
- **Culling:** the never-produced `outside-ancestor-portal-slab` reason was removed; `staticallyCullPortalPathTables` never
  keeps a path whose parent was rejected; `checkPortalPathString` resolves tokens by side index first and warns on the
  array-index fallback.
- **Curve shortening:** monotone-length check (`curveShorteningLengthIncreaseToleranceMeters`) with the step skipped, not
  committed, on increase; no false "changed" reports; degenerate free loops are deleted; failed fusion reverts the pair to
  `moving`; free ends are recognised by object kind; lifted-chord rebuild rejects wall hits; rays starting inside an
  exclusion zone hit at `t = 0`.
- **Deformation / runtime:** the initial torus state is inferred from the spec; width/depth 0 is no longer treated as unset;
  state equality is key-order independent; marmot velocity is transported as its real walking direction; `nudge()` after
  dispose is ignored; help/tutorial text rewriting is one shared helper; goal pages get a "Goal" title.
- **Render lifecycle / leaks:** `dispose()` ends the XR session and removes its listener; `updateDebugSettings` keeps the
  menu in sync; removing a placed flag drops its instanced archetypes; measured-length refresh sees pure translations;
  collision wireframes reappear when bounds return; palette tooltip textures and the path-trace source geometry are
  disposed; `sceneRayObjects` is per instance; several duplicate dispose/roundRect/threePointToWorld helpers were merged;
  the emitter beam height uses the shared constant in the renderer.
- **Input:** the desktop controls clear held keys on blur and ignore keystrokes aimed at editable elements; XR reset is
  edge-triggered and NaN stick axes become 0; placed flags face the player who placed them (mirrored yaw fixed).
- **Dead code removed:** `isWorldFloorMaterialSpec`, `LibraryCollisionOptions`, `RuntimeDesktopToolId`, an unused
  parameter in `playerRoverModel`; `RuntimeInputFrame` and `DesktopInputFrame` can no longer drift.
- **Layering:** five edges removed (`cell-complex -> authoring`, `authoring -> root`, `ui -> root`, `runtime -> render`,
  `glue -> render`) by moving the validator, `helpHubCopy` and the pure VR comfort options.

## Acceptance criteria for closing

- Every remaining item above is fixed (with a test where the defect is behavioral) or explicitly accepted.
- `npm run docs:check` stays green; layering baseline entries are deleted, never added.
