# 41 - Defects and inconsistencies found while documenting the code

Status: partly resolved as of 2026-10-09; the items below are what remains open.

Priority: mixed; grouped and rated. Each item cites the module (`src/...`) where the behavior was read; re-verify before
fixing. Fixed items are listed at the end so the history is visible.

## Open - P1 geometric correctness / soundness

- **Static visibility cull is not provably conservative** (`cell-complex/staticPortalPathCull.ts`): the aperture slack
  (at least 0.075 m) rejects *more* as it grows; the projective tau/sigma stage never tests sight lines that cross the line
  sent to infinity; `toleranceMeters` is compared against dimensionless quantities; parallelism thresholds differ between
  projection construction and the intersection test. `// TODO(issue 41)` comments mark the spots. Needs a design review
  with rendering comparisons, not a blind change.
- **Culled path ids** from `buildStaticallyCulledPortalPathTables` are sparse and differ from `buildPortalPathTables`.
- **Unequal cell heights across a portal** are not modelled (aperture is the smaller height) and not rejected.
- **Wall overlap at portal crossings** is not tested in the target cell (floor, ceiling and exclusion zones are).
- **Curve shortening** (`world-objects/geodesicCannon.ts`): a free loop that crosses a portal probably stalls (only one of
  its two roles has its word updated); the emitter-at-`end` orientation is assumed to be emitter-at-`start` in several
  helpers; `tieAndDetachGeodesicEndpoints` deletes geodesics on a forbidden-zone rebuild failure instead of rolling back;
  a rejected (lengthening) step is skipped, not rolled back to a fused geodesic; `intersections` are an O(n^2) scan that
  does not pair segments across a portal boundary.

## Open - P2 behavior that is probably wrong

- **Marmot heading is mirrored.** `world-objects/geodesicMarmot.ts#yawFromVelocity` uses `atan2(vx, vy)`, so the marmot
  walks along `(-vx, vy)`. The fix is one line, but it flips every authored marmot and an existing test encodes the current
  direction; decide whether to fix the data or the code.
- **XR input** (`render/three/xrControls.ts`): `isCarryActionPressed` always returns false, so carry is unreachable from XR
  (needs a button-binding decision); `menuTogglePressed` is always false in both palette input modules.
- **Palette:** `scenePaletteController` serialises the whole definition every frame to detect changes; legacy `xrPalette*`
  userData keys still exist beside `scenePalette*` (writers in `vrPaletteLibraryAdapter.ts`, fallback readers in
  `scenePaletteController.ts` and `scenePointers.ts`); `xrScenePaletteInput` shares a module-level `controllerObjects` set
  across instances.
- **Texture lifetimes:** `buildCellMesh.buildTextPlane` allocates a 1024x512 canvas texture per portal debug label that is
  shared into cloned archetype materials and never disposed; `preloadWorldAssets` never disposes loaded textures.
- **`DesktopFlagEditor.open()` is never called**, so the editor can never open (and would need the key-capture guard that
  now exists).

## Open - P3 dead code, duplication, naming

- Unused: the dithered smooth-edge clip-shader path (`portalClipEdgeSmoothingEnabled` is `false`), non-`viewer`
  `VrPaletteAnchorKind`s, `onGeometryComputerSetTargetRequested`, `applyJoystickDeadZone` and
  `nextAcceptedHeadLocalMeters` (only tests use them), `createGeodesicSegmentTooltip` has identical branches.
- Duplicated helpers: remaining private `disposeObject3D` copies (`buildDecorationMesh`, `helpLensRenderer`,
  `xrControllerHandModels` — they dispose different subsets, so merging needs care), `formatVec3`/`roundNumber` in
  `debugOverlay.ts` vs `appDebugHelpers.ts`.
- Naming: the `"geodesci-marmot"` kind literal; `ShowCellPathRendersInstances` capitalisation; the beam height `1.08` is
  still a literal in `aimTarget.ts` and `geodesicEmitterLabels.ts`.

## Open - layering debt

Eleven imports still break the intended layering (mostly `world-objects -> render` mesh builders and
`world-objects -> runtime`). They are frozen in `scripts/docs/layering-baseline.json` and listed in
`docs/generated/ARCHITECTURE_REFERENCE.md`; delete baseline entries as they are fixed.

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
