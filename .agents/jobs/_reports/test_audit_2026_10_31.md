# Test suite audit, 2026-10-31

Input for jobs 41–45. Made read-only against commit `d7dd51d` by measuring files with scripts and reading about a third
of them in full. Verdicts are proposals for the implementing model, judged against [tests.md](../../../_docs/tests.md);
a verdict marked *(inf.)* was inferred from names and imports only. Line numbers drift: search by name.

## 1. Numbers

- 160 test files, 1,071 tests, all passing. About 25.5k lines of tests and support for about 46.7k lines of `src/`.
- Summed file time is about 75 s. `tests/cell-complex/portalPaths.test.ts` takes 62.5 s of it, almost all in the case
  "builds cube paths to depth 10 without NaN transforms". After it come `server/channel` (2.1 s),
  `visiblePortalPaths.property` (2.0 s), `docs/moduleImportRules` (1.8 s) and `segmentWalk.property` (1.1 s).
- No test file has a module comment that describes its feature. The single exception is
  `render-contract/frameAllocations`.
- About 62 test names carry plan ids or issue or job numbers. 156 of 611 names outside `render` are over 70 characters,
  and 29 are over 90.
- No fast-check property sets a seed, so each run draws different inputs (Q6).
- Two benchmarks are gated by environment variables and assert nothing: `cell-complex/staticCullBenchmark`
  (`STATIC_CULL_BENCH`) and `render-contract/funnelStaticCullBenchmark` (`FUNNEL_CULL_BENCH`). 012 cites the second as
  the way to rerun its measurement.
- Untested core: `src/render/three/geodesicCannonTools.ts` (1,271 lines), `toolObjectRuntimes.ts` (360),
  `carriedGeodesicCannon.ts` and `createThreeApp.ts` (3,580) have no test at all.

## 2. Per-file verdicts, outside `render-contract`

| File | Lines | Cases | Verdict | Main rule |
|---|---|---|---|---|
| assets/publicAssetPolicy | 76 | 5 | move to project | Q5: greps `src/*.ts` for `_legacy/` |
| authoring/compileWorldScript | 82 | 3 | keep | – |
| authoring/exampleWorlds | 399 | 12 | keep; collapse the per-world `it.each` | Q4: overlaps compileCellComplex; Q8: "corrected small scale" |
| authoring/worldBuilder | 245 | 10 | keep | – |
| cell-complex/compileCellComplex | 391 | 8 | rewrite; drop the example-world and seam blocks | Q4 |
| cell-complex/compilePortalTransforms.property | 70 | 3 | merge into compilePortalTransforms | Q4: 2 of 3 cases are plain loops |
| cell-complex/compilePortalTransforms | 45 | 1 | keep, as the home | – |
| cell-complex/describeGeometry | 18 | 2 | keep | – |
| cell-complex/developedDisk | 134 | 5 | keep | – |
| cell-complex/floorUv | 26 | 3 | keep | – |
| cell-complex/portalPathDebug | 115 | 6 | keep | – |
| cell-complex/portalPaths.property | 70 | 2 | merge into portalPaths (no fast-check in it) | Q9 |
| cell-complex/portalPaths | 112 | 7 | keep; shrink the depth-10 cube case | Q7 |
| cell-complex/prismCells | 40 | 2 | keep | – |
| cell-complex/segmentWalk.property | 133 | 3 | keep; cut numRuns of 300 and 150 | Q7 |
| cell-complex/segmentWalk | 235 | 9 | keep; rename the "issue-62" case | Q8 |
| cell-complex/staticCullBenchmark | 43 | 1 | move to `scripts/bench/` | H9: env gate, no assertion |
| cell-complex/staticLineCone | 213 | 10 | keep | – |
| cell-complex/staticPortalPathCull.property | 125 | 3 | keep | – |
| cell-complex/staticPortalPathCull | 231 | 10 | keep; shrink the dodecahedron depth-10 case | Q7 |
| cell-complex/validateCellComplexSpec | 112 | 7 | keep; drop the all-examples case | Q4 |
| docs/documentation | 25 | 1 | move to project | – |
| docs/moduleImportRules | 53 | 2 | move to project | – |
| glue/debugSettings | 99 | 7 | rewrite with one case per class | §4.4: six `toBe(true)` instances |
| glue/geometrySelection | 79 | 7 | merge into readLaunchOptions (same function) | Q4; Q8 "legacy" |
| glue/launchOptionsUrl | 55 | 4 | keep | – |
| glue/readLaunchOptions | 203 | 11 | keep; collapse the 3-config `it.each` | §4.4 |
| glue/serverChannel | 126 | 7 | keep: a model of the socket fake | – |
| math/intersections(.property) | 49+37 | 6+1 | keep; merge into one file | – |
| math/planes | 20 | 2 | keep | – |
| math/polygons(.property) | 35+59 | 3+3 | keep; merge | – |
| math/rigidTransform3(.property) | 78+85 | 6+5 | keep; drop the example cases the properties cover; merge | Q4 |
| math/vec2 | 25 | 4 | keep | – |
| math/vec3(.property) | 33+45 | 3+3 | keep; merge | – |
| movement/collision | 77 | 6 | keep; rename the case named after a helper | Q9 |
| movement/depenetrateDynamicObject | 150 | 7 | keep; rename "issue-53" | Q8 |
| movement/developedObstacles | 101 | 4 | keep | – |
| movement/moveDynamicObject(.property) | 824+49 | 34+1 | rewrite and split by behaviour; merge | Q8 (issues 61–63), Q1 (a constant check), Q10 |
| movement/movementNumerics | 89 | 2 | merge into moveDynamicObject; shrink the 10^5 crossings | Q8 "(issue 65)", Q7 |
| movement/movePlayer | 282 | 9 | keep; rename vague cases | Q9 |
| movement/portalCrossing(.property) | 47+38 | 1+1 | merge | – |
| movement/sweptCollision | 139 | 9 | keep; drop the corner case that repeats moveDynamicObject | Q4, Q8 |
| runtime/apiCall | 92 | 13 | keep | – |
| runtime/runtimeCommands | 74 | 4 | keep | – |
| runtime/runtimeMenuState | 382 | 19 | keep | – |
| runtime/torusSkewDeformation | 341 | 24 | keep; shrink the depth-10 case | Q7, Q8 "still accepts" |
| runtime/worldGeometryComputedObjects | 359 | 4 | rewrite (about 90 lines per case) | Q10, Q8 |
| runtime/worldGeometryDeformations(.property) | 235+44 | 13+2 | keep; drop the identity property; fix the "without importing Three.js" name | Q4, Q9 |
| runtime/worldGeometryRuntimeTransforms | 150 | 5 | keep | – |
| runtime/worldGeometrySession | 241 | 9 | keep: a model of an injected client | – |
| scripts/checkDistSize | 51 | 3 | move to project | – |
| server/channel | 245 | 7 | move to project, `process` tier; inject the 1 s delay | Q6: real delay and two 150 ms sleeps |
| server/localServer | 97 | 7 | move to project, `process` tier | – |
| smoke/smokeArgs | 76 | 7 | move to project; drop the "legacy page-url form" case if the form is retired | Q8 |
| smoke/staticServer | 62 | 3 | move to project, `process` tier | Q4: overlaps localServer |
| support/arbitraries.test | 97 | 8 | retire; the preconditions become assertions in the generators | §3 |
| ui/* (6 files) | 361 | 22 | keep | – |
| world-objects/geodesicMarmot | 147 | 4 | keep; drop the ownership case | Q4: the registry owns the rule |
| world-objects/library | 272 | 12 | keep; one asset per class, not 9 instances | §4.4 |
| world-objects/measureLengthTool | 90 | 2 | keep | – |
| world-objects/placedFlags | 249 | 11 | keep | – |
| world-objects/protractorTool | 351 | 12 | keep | – |
| world-objects/runtimeObjectRegistry | 333 | 20 | keep: it owns the ownership rule | – |
| world-objects/simpleGeoCreature | 624 | 17 | rewrite the names (numbered 1.–8., 7a–7c); stop using `leaderForDebug` | Q5, Q9 |
| world-objects/worldObjectOwner | 95 | 5 | keep; drop the duplicate ownership case | Q4 |
| geodesic/cannon | 338 | 9 | keep | – |
| geodesic/carry | 932 | 22 | rewrite: split by behaviour, drop job names | Q8, Q10 |
| geodesic/curveShortening | 940 | 28 | rewrite: drop plan ids B1–D8 and "issue 31/32", "job 06"; drop the perf-counter assertions | Q8, Q5 |
| geodesic/geodesicPortalWord.property | 54 | 2 | keep | – |
| geodesic/geodesicTracingKernel | 250 | 11 | rewrite; move its intersections block to intersections; stop importing `geodesicTerminalFromWalkPiece` ("exported for tests") | Q8, Q4, H4 |
| geodesic/intersections | 430 | 11 | keep; rename | Q8 |
| geodesic/performance | 209 | 7 | retire, or rewrite as outcome tests | Q5: a spy plus internal counters |
| geodesic/sleeve | 216 | 10 | keep; drop the A1–A9 prefixes | Q9 |
| geodesic/trace | 521 | 20 | keep | – |

Behaviours tested in several places (keep the owner):
- Portal reciprocity: owned by compilePortalTransforms.
- "Every example world compiles": owned by authoring/exampleWorlds.
- Writes to an owned object throw: owned by runtimeObjectRegistry.
- Geodesic intersections: owned by geodesic/intersections.
- Walled-room corners: owned by moveDynamicObject.
- Static file serving: `scripts/server/localServer.mjs` and `scripts/smoke/staticServer.mjs` are two implementations
  of the same thing. Record that; do not merge the code in a test job.

## 3. Per-file verdicts, `render-contract` (becomes `render`)

Abbreviations: `r3/` = `src/render/three/`.

| File | Lines | Cases | Verdict | Main rule |
|---|---|---|---|---|
| aimCrossMarker | 41 | 2 | keep | – |
| aimTarget | 1108 | 37 | keep in render until job 32 moves `aimTarget`; thin the near-duplicate priority cases; drop the `vi.fn` call count (:896) and the tuning-constant checks | Q4, Q5, Q1 |
| buildCellMesh | 428 | 10 | rewrite: drop object-name and child-count lookups (31) and use the shared assets builder | Q5, Q10 |
| buildDecorationMesh | 59 | 2 | keep; rename "old twelve boxes" | Q8 |
| cellRenderArchetypes | 253 | 6 | keep | – |
| debugCollisionWireframes | 89 | 3 | keep | – |
| debugOverlay | 73 | 5 | keep in render (the code is in `r3/`) | – |
| debugVisualization | 89 | 1 | rewrite: no cache-by-identity check | Q5 |
| desktopControls | 180 | 7 | keep (moves with code in job 32) | – |
| desktopScenePaletteInput | 198 | 6 | keep; rename "older inset cursor bounds" | Q8 |
| frameAllocations | 188 | 4 | move to `scripts/bench/` as an allocation benchmark (it mocks the `three` module to count constructors) | Q5, §4.7 |
| frameErrorGuard | 105 | 5 | keep | – |
| frameRenderSnapshot | 39 | 2 | merge into runtimeObjectInstanceSync | Q4 |
| funnelStaticCullBenchmark | 129 | 1 | move to `scripts/bench/`; update the path cited in 012 | H9 |
| geodesicCannonAimTarget | 22 | 2 | keep | – |
| geodesicCannonRenderer | 226 | 11 | keep | – |
| geodesicCarryPortalTransition | 86 | 2 | keep | – |
| geodesicCreatureDebug | 212 | 4 | keep | – |
| geodesicEmitterLabelController | 32 | 1 | rewrite through the public function, or retire | Q5: writes the internal map |
| measureLengthRenderer | 58 | 1 | keep | – |
| placedFlagRenderer | 170 | 4 | keep; use the shared canvas fake | – |
| playerRoverModel | 46 | 1 | merge into runtimeObjectGhostRecords | Q4 |
| portalClipData | 242 | 11 | keep; one owner for stereo ranking | Q4 |
| portalClipMaterial | 112 | 4 | slim: no GLSL substring assertions | Q5 |
| portalClipPlanes | 369 | 7 | keep; fewer random pixels (20,000) | Q7 |
| portalClipPolygonOverlay | 10 | 1 | keep | – |
| portalEyeActivation | 78 | 4 | keep; use the renderer fake | – |
| portalEyeFrameTransforms | 118 | 7 | keep; merge overlaps with portalClipData | Q4 |
| portalFunnel | 204 | 10 | keep (moves in job 32) | – |
| portalInstanceBuffers | 324 | 9 | keep | – |
| portalWallTexture | 22 | 1 | keep | – |
| preloadWorldAssets | 196 | 7 | keep; drop the "_legacy stays out" case | Q8 |
| prerenderCells | 66 | 2 | trim the `userData` flag assertions | Q5 |
| protractorAngleRenderer | 75 | 2 | keep | – |
| protractorToolFeedback | 27 | 2 | retire or merge (checks a cache signature) | Q1 |
| renderCameraClip | 15 | 1 | merge into renderQuality | Q1 |
| renderQuality | 94 | 6 | keep | – |
| runtimeObjectGhostRecords | 173 | 8 | keep | – |
| runtimeObjectInstanceSync | 322 | 10 | rewrite the stats-counter cases (:130–144) and the `traverse` spy (:245) | Q5 |
| runtimeObjectPortalInstances | 513 | 13 | keep | – |
| runtimeObjectRenderArchetypes | 34 | 2 | keep | – |
| runtimeSceneDispose | 52 | 3 | keep (dispose is a boundary) | – |
| sceneLighting | 61 | 3 | keep | – |
| scenePaletteLibraryAdapter | 402 | 11 | move the menu-content cases to `ui` (paletteDefinition is the owner); keep 1–2 adapter cases | Q3 |
| scenePaletteTooltip | 22 | 2 | keep | – |
| scenePointers | 53 | 2 | keep | – |
| staticAssetRenderRoot | 106 | 3 | keep; rename "legacy marmot" | Q8 |
| stereoSplitRoot | 174 | 6 | keep | Q4 (:131) |
| visiblePortalPaths.property | 170 | 1 | keep; drop the wall-time assertion (:107); fewer ray walks | Q6, Q7 |
| visiblePortalPaths | 688 | 23 | keep; turn the six "captured camera pose" cases into classes; drop the cached-matrix identity check (:546) | §4.4, Q5 |
| vrComfort | 45 | 4 | keep | – |
| vrLocomotion | 371 | 19 | keep; drop the dead-zone and eye-root cases that xrControls and xrPortalEye own | Q4 |
| vrPaletteHeaderActions | 43 | 3 | keep | – |
| vrPalettePlacement | 67 | 5 | keep | – |
| worldResultBadge | 24 | 1 | keep | – |
| xrControllerHandModels | 80 | 2 | keep | – |
| xrControls | 207 | 14 | keep; use the XR fake | – |
| xrDebugPanel | 71 | 5 | keep | – |
| xrPortalEye | 130 | 4 | keep | – |
| xrScenePaletteInput | 95 | 3 | keep; rename the case that explains the design | Q9 |
| xrSessionRestart | 80 | 4 | keep; use the XR fake | – |
| xrSessionState | 74 | 6 | keep; use the XR fake | – |

Repeated fakes to extract into `tests/support/`:
- WebGL renderer: portalClipMaterial, renderQuality, portalEyeActivation, prerenderCells, aimTarget.
- Canvas 2D: placedFlagRenderer.
- XR navigator and session: xrSessionState, xrSessionRestart, and the gamepads in xrControls.
- Prepared assets: 14 inline fakes in 8 files.
- The two-room spec is retyped in 8 files and the square base in 10; there are 8 separate camera builders.

## 4. Manual checks

Classes, following the ladder of [tests.md](../../../_docs/tests.md) §6.4:
- **A**: possible now through `window.noneuclid.api` plus headless Edge (rung 3);
- **B**: needs a new API function;
- **C**: needs the engine split, or job 32, for a Node scenario (rungs 1–2);
- **D**: needs a person (rung 5).

| # | Sources | Check | Class | Live? |
|---|---|---|---|---|
| 1 | acceptance-checklists.md (headset smoke); jobs/_done/03, 04; DEPLOYMENT.md | Deployed URL opens, `?config=001` loads, assets resolve under the base path | A (`npm run smoke -- --url … --config 001`) | yes |
| 2 | _done/03, 39 | The local Node server serves over HTTPS | A on desktop; D on Quest | yes |
| 3 | _done/39, 40; 012 §6 | Quest opens the server, accepts the certificate, enters VR; `call app.changeWorld` switches its world | D (rung 4 for the call) | yes |
| 4 | _done/40 | `call`/`help` on the DevTools backend; `placeObjectAt` and `geometry` through the channel | A | yes |
| 5 | acceptance; 010; issues _closed/15, 17, 19 | Desktop controls and fallback still work | A (synthetic keys; pose read needs B) | yes |
| 6 | 010; _closed/15, 17 | XR unavailable or insecure context gives a readable message | A | yes |
| 7 | acceptance; _done/04; 010; 011 | Enter VR offered only when supported and works; exit; reload and re-enter | D | yes |
| 8 | acceptance; 010; _closed/15, 17 | Walls, floor, ceiling and forbidden zones block | B (`player.setPose`, `player.move`, last move result); VR part D | yes |
| 9 | acceptance; 010; 006 | Portal crossing lands in the seen cell with the right orientation | B | yes |
| 10 | _done/13; issues 61, 62, 63 | Walk into a room corner and a cube vertex: slide, never vanish | B (core already unit-tested; the wiring is not) | yes |
| 11 | _done/09 | torus-moduli: 0.45 m from a corner at A=30, B=8, walk away | B (pose plus existing `geometry.setTorusSkew`) | yes |
| 12 | _closed/64; _done/08 | Mover wiring in `createThreeApp` (XR slide replay, marmot heading, object trap) | C; XR slide D | yes |
| 13 | acceptance; 010; _done/38 | Reset returns player and assets to the authored, deformation-mapped pose | B (`world.reset`); VR button D | yes |
| 14 | 010; _closed/15, 17 | Head look, room scale, joystick, continuous turn without drift, controller mapping | D (rig maths in vrLocomotion) | yes |
| 15 | acceptance; _done/04 | 30 s of looking and walking in VR without stutter | D | yes |
| 16 | _done/36, 13 | A creature walks round a cube-vertex zone on its geodesic's side and continues | A if a bundled world has the creature (not checked); unit-tested in simpleGeoCreature | yes |
| 17 | acceptance; llm-handoff | Firing stops at walls, zones, max distance ("straight ray" wording is stale) | B / C | partly |
| 18 | _done/15; issue 69 | Long wrapped geodesic and its length label | B (fire plus `debug.dumpGeodesicPath`); label look D | yes |
| 19 | _done/25 | Two cannons: shoot, carry through a portal, tie and detach a loop | B / C | yes |
| 20 | _done/26; issue 67 | torus-moduli: two emitters, tie and detach, one locked geodesic in one frame, never `unresolved` | C (curveShortening covers synthetic set-ups); B in a browser | yes |
| 21 | _done/26 | Cube: the tied result bends at a corner, stays pinned while carried, no "could not be straightened" | C / B | yes |
| 22 | _done/27; issue 70 | Carrying an emitter with loops: balloons follow, one balloon per crossing, stable numbering | B / C for structure; smoothness D | yes |
| 23 | _done/13 | Carry a cannon through two portals in one frame | C / B | yes |
| 24 | acceptance | Markers placed and cleared, invalid ones rejected, traces cell-tagged, raw measurements ("discovery log" probably stale) | C (world-objects tests cover flags and measuring) | partly |
| 25 | _done/16; issue 72 | Aim at a flag through a portal; a wall beside the portal highlights nothing | B (`aim.pick`) or C (aimTarget "ray walk"); XR part D | yes |
| 26 | 011; _done/04; DEVELOPMENT | Right mouse opens the palette centred; Escape closes it | B (palette state query); the input already happens in smoke | yes |
| 27 | 011; _closed/27 | Palette navigation (settings, back, world selector, reload, debug toggle), mouse-look frozen while open, the next click fires the tool | A with screenshots / B (`menu.state`, `tool.selected`) | yes |
| 28 | 011 | Using the palette does not break locomotion, reset, collision or portals | B | yes |
| 29 | 011 | Reload and world change go through the shared runtime commands | A (`app.*`; the dispatcher is unit-tested) | yes |
| 30 | DEVELOPMENT | `?config=001/002/default` load and the menu works; a placed tool works | A load and menu; B tools | yes |
| 31 | _done/19; _closed/27, 30; 011; acceptance | XR palette: side trigger per hand, hover, select, back, carry buttons, stick locomotion, firing (palm-up dwell is stale) | D | yes |
| 32 | _done/19; 011 | In-headset debug panel follows the overlay toggle, readable, steady | D (the visibility rule can be a unit test) | yes |
| 33 | acceptance; 006; _closed/13, 21 | Portals show connected cells and object copies; windows clip; nested clipping | A (robust pixel measure at the spawn pose); B for other poses | yes |
| 34 | acceptance | The overlay shows the current cell, last movement result, path count | A (overlay text is not the API; prefer B queries) | yes |
| 35 | acceptance | Lowering max depth changes recursion predictably | A if a URL option exists (not checked), else B | yes |
| 36 | interactive-browser-debugging | No flicker at portal edges while moving | A (held key plus a record of `portal.state` counts); B for determinism | yes |
| 37 | _done/20; issue 56 | Depth-10 corner view: nothing disappears versus the previous build | B (pose plus pixel measure); property-tested | yes |
| 38 | _done/21; issue 57 | Grazing doorway: no clear-colour jamb lines; turning in a doorway never blinks | B (pose, then a count of clear-colour pixels) | yes |
| 39 | _done/22; issue 58 | Hardware clip: no leak, no missing view, `clip` counter 0 while turning fast | A / B | yes |
| 40 | _done/22 | Forced fragment-clip fallback (needed a temporary code edit) | B (a debug option forcing the fallback) | yes |
| 41 | issue 58 | Clip leakage at most 1 px for tiny polygons | B | yes |
| 42 | issue 73; _done/17 | An object straddling a portal: no flicker or z-fighting on the overhang | D in a headset; desktop A/B | yes |
| 43 | _done/38, 29 | `placeObjectAt` moves model, wireframe and tooltip together; the model stays with its collision after a commit | A / B | yes |
| 44 | _closed/81; _done/10 | Skew sweep: floor pebbles stay under objects | A (pixel measure) / D | yes |
| 45 | _closed/29 | Live torus skew by hand, desktop and XR | A desktop; D XR | yes |
| 46 | _closed/18 | Floor texture formats: faster first render, no missing-asset messages; visual quality | A (load time, console); D quality | probably |
| 47 | _closed/22 | Collision wireframes cause no FPS collapse | A (frame timing, a report) | probably |
| 48–54 | issues 59, 71, 75; _done/21, 22, 23, 28, 29; _closed/21, 33 | Stereo: head across a portal, edges, recursion depth per eye, budget counters while straddling, per-eye instancing, mono-XR re-root, `gl_ClipDistance` on the Quest driver | D | yes |
| 55 | 010; _closed/17 | Both eyes share the first-pass mono render state | – | stale |
| 56 | issues 58, 59; _done/22, 23 | `portal ms` and GPU time before and after, desktop and Quest | A desktop report; D Quest | yes |
| 57 | issue 71; _done/28 | 40 flags for 10 s: frame ms versus the parent commit | B (`objects.spawn`); a report | yes |
| 58 | issue 75; _done/29 | 20 flags: `webgl: N calls` before and after | B; a report | yes |
| 59 | issue 75; _done/29 | Allocation sampling: listed hot functions do not allocate | A (CDP HeapProfiler) as a benchmark | yes |
| 60 | issues 82, 55 | Sweep a = 0–30 m: no frame over 20 ms from a commit | A as a report | yes |
| 61 | issue 82 | `renderer.info.memory.textures` unchanged after 100 deformation steps | B (`view.rendererInfo`) | yes |
| 62 | _closed/74; _done/04 | `renderer.info.memory` returns to baseline after create, dispose, create | B (`view.rendererInfo` plus `app.reload`) | yes |
| 63 | acceptance; _done/04, 01; _closed/74 | After 30 failed frames an immersive session ends; the scene is still drawn after a frame error | B (`debug.injectFrameError`); XR end D | yes |
| 64 | 006 | Depth above 3 without stencil exhaustion; depth 10 stable under budget | A desktop; D Quest | yes |
| 65 | jobs/24 (open) | Start-up to first frame, heap after a 60 s scripted walk, path ids stable | A report; deterministic walk B | yes |
| 66 | jobs/34 (open) | Copied `worker-*.js` ever instantiated; uikit and Inter load only when the palette shows | A (CDP Network) | yes |
| 67 | jobs/33; DEVELOPMENT | Smoke after each slice; smoke in pre-push | A (exists) | yes |
| 68 | `src/render/three/appDebugLogging.ts` | The printed command list matches the installed helpers (kept in sync by hand) | A or unit | yes |
| 69 | DEPLOYMENT | Asset provenance review before publishing | D (partly enforced by publicAssetPolicy) | yes |
| 70 | acceptance (stages 07, 09, 10) | Preflight status, discovery-log export, QR separation | – (no `preflight` in `src/`) | stale |

Open issues waiting only on manual checks: 56, 57, 58, 59, 71, 73, 75. The headset smoke checklist in
`_docs/acceptance-checklists.md` has never been run. Issue `_closed/81` contradicts itself: line 3 says the maintainer
checked it in the browser, line 26 says "not run".

## 5. The API today (for jobs 44 and 45)

`window.noneuclid.api` holds these namespaces:
- `app`: `info`, `changeWorld`, `changeConfig`, `reload`. Permanent, installed by `src/main.ts`.
- `debug`: `dumpGeodesicCreatures`, `dumpAllGeodesics`, `dumpGeodesicPath`, `dumpLockedGeodesicWords`, `placeObjectAt`.
- `portal`: `checkCellPath`, `showCellPath`, `hideCellPaths`, `dumpCameraPose`, `state`. **Only with the
  `portal-path-debug` option.**
- `geometry`: `setTorusSkew`, `stepTorusSkew`, `cancel`, `state`. Only in torus-skew worlds, or when debugLevel is not
  off.
- `view`: `screenshot`. Throws while presenting XR.

Facts that limit scenarios:
- `app.changeWorld` returns before the world has loaded.
- The simulation runs only inside `renderFrameUnguarded` in `createThreeApp.ts`, so nothing runs headless in Node.
- The browser smoke (`scripts/smoke/browser-smoke.mjs`) pokes the old globals, not the API. Its CDP helpers are inline,
  not reusable.

The API functions that would unlock most of class B are a **proposal**, not agreed. They belong to the engine API of
012 (P2 semantic commands, P8 host-chosen step):
- player: `player.getPose`, `player.setPose`, `player.move` (with explicit steps), `player.lastMoveResult`;
- time: `sim.pause`, `sim.step(n, dt)`, `sim.frame`;
- world: `world.reset`, and `app.changeWorld` resolving once the world is loaded;
- tools: `tool.select`, `geodesic.fire`, `geodesic.tie`, `carry.pickUp`, `carry.drop`, `aim.pick`;
- objects: `objects.spawn`;
- views and debugging: `ui.paletteState`, `view.rendererInfo`, `debug.injectFrameError`, and a debug option that
  forces the fragment-clip fallback;
- the pose read of `portal.dumpCameraPose`, available in every build.
