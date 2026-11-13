# Job 82 - Discoveries, curiosity markers and "Show edges"

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 9.4, 9.5,
9.6 (F26, F27).

## Goal

The app notices remarkable events in the sandbox and celebrates each with a toast and a question; Help → Discoveries
lists the found ones and teasers for the rest. Authors can place curiosity markers at interesting places. A Settings
switch shows the glued edges.

## Depends on

Jobs 71, 79 (the Discoveries page placeholder), 81. Branch `dev`.

## Before you start

- Design 017 section 9.4: the table is the specification of the first discoveries.
- The module system (design 013): how a module reads world state and the change journal (`src/engine/`, and a small
  existing module such as `src/modules/geodesicMeasurements/module.ts` for derived state and queries).
- Where the player's current cell (face) is known each frame, and where a beam's trace ends (stop reasons: a corner
  stop exists), the curve-shortening completion, and the deformation commit.

## Decisions

1. A client-side module `src/modules/discoveries/` with detectors, each a pure function of events or state it already
   gets, and a session record of found ids. Found discoveries reset with Start over and are not saved across reloads.
2. Ship these detectors (cheap ones from the table): `across-an-edge` (first face change), `back-where-you-started`
   (return to the spawn face by a different edge than the one used to leave), `beam-came-home` (a beam's trace passes
   within the laser's hit radius of its own laser), `beam-hits-corner` (a trace ends with the corner stop reason),
   `tight-string` (curve shortening finished on a string), `new-shape` (a deformation commit). The moderate ones
   (`meeting-twice`, `around-a-corner`) are in the design but not in this job: list them under `### Not done` as
   follow-ups.
3. Each discovery has `{ id, name, question, teaser }` text in the vocabulary module, taken from the design table.
   On detection: toast "Discovery!" and the name followed by a second toast with the question, and the Discoveries page
   updates.
4. Discoveries page: found ones with name and question; not-found ones as "??? · <teaser>". No order is imposed.
5. Authoring: `discoveries: { disable: [...ids], add: [{ id, name, question, teaser, detector, marker? }] }` on the
   world, where `detector` is one of `{ visitFace: "<face name>" }` or `{ approach: { face, position, radius } }` for
   this job. Validate in `validateAuthoringSpec.ts`.
6. Curiosity marker: a small glowing "?" disc on the floor at `marker.face`/`marker.position`; within 3 m it shows the
   teaser as a floating label; when its discovery is found, it shows a tick. Add markers to: 001 at one cube corner
   (approach detector, question about the three squares), 004 genus 2 at the corner point, 005 next to the shape
   machine (paired with `new-shape`).
7. "Show edges" in Settings (off by default): draws the glued edges as a thin line on the floor using existing portal
   geometry. After `across-an-edge`, its entry on the Discoveries page offers "Show edges" as a button.

## Steps

1. Baseline.
2. Module skeleton and the `across-an-edge` detector, with a unit test driven by a scripted face change.
3. The other detectors one at a time, each with a unit test.
4. Toasts and the Discoveries page.
5. Authoring additions and markers; world script markers.
6. Show edges.
7. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP on `?config=001`: `noneuclid.api.motion.walkTo` across one edge records `across-an-edge` and the toast text
  appears in `document.body.innerText`.

## Do not

- Add goal checking, scores, or anything that blocks or orders play. Discoveries only notice.

## Done when

The six detectors work and are tested, the page lists found and teaser entries, markers exist in the three worlds,
Show edges works, checks pass, commit on `dev`, report appended.

## Report

### Done

Commit: COMMIT_HASH on `dev`.

- Module `src/modules/discoveries/` (a client-side module: pure code, no engine module registered): `api.ts` (plain data:
  `DiscoveryDefinition`, `DiscoveryFrame`, `DiscoveryPageEntry`), `catalog.ts` (built-in discoveries from the vocabulary,
  minus the world's `disable`, plus its `add`, plus markers; mistakes come back as `problems`, never throw),
  `tracker.ts` (the session record and the six detectors), `events.ts` (beam events read from the frame's journal writes),
  `pageEntries.ts`, `index.ts`. Detectors: `across-an-edge` (any portal crossed, so a one-face torus counts),
  `back-where-you-started` (leave the start face through side S, re-enter it through a side other than S; a crossing of a
  face into itself is neither), `beam-came-home` (a beam piece whose terminal is an emitter hit on the emitter its beam
  leaves from; the tracer already uses the laser's 0.3 m hit radius for that), `beam-hits-corner` (a piece ending in a
  `forbidden-zone-hit`), `tight-string` (joined beams went from "still moving" to "at rest", or to no joined vertex while
  beams remain), `new-shape` (the shell's geometry commit). Authored detectors `visitFace` and `approach` work the same
  way. Found discoveries reset with Start over and are not stored.
- Words (`src/world-objects/vocabulary.ts`): `builtinDiscoveryText` (name, question, teaser per discovery, from the
  design table) and `discoveryText` (toast, teaser line, page intro, count, Show edges texts). `disabledReasons.noDiscoveriesYet` is
  gone (the Discoveries hub button is now always open).
- Shell (`src/render/three/discoveryController.ts`, `createThreeApp.ts`): the controller is shown the player's face and
  position, the portals crossed (collected in `recordCellTransition` from every move: walking, scripted, XR physical),
  and the frame's registry writes, once per frame in a guarded phase; it pushes "Discovery!" and the name (5 s) then the
  question (9 s) as toasts. Start over resets it; a deformation commit tells it the shape changed. The Discoveries
  page entries are filled in by `dispatchRuntimeCommand` for `show-discoveries`.
- Discoveries page: page id `discoveries`, `RuntimeMenuState.discoveriesOptions`, command `show-discoveries` (does
  nothing without entries), `showRuntimeMenuDiscoveries`, payload cleared in `closeRuntimeMenu`,
  `showRuntimeMenuMainPage` and `showRuntimeMenuQuestionHelp`, back returns to the Help hub; palette content
  `DiscoveriesPaletteContent` (`paletteDefinition.ts`), page builder `palette/pages/discoveries.ts`, hub button wired
  through `onQuestionHelpDiscoveriesRequested`. Found entries show name and question; the rest "??? - teaser" in
  a scrolling column; "Across an edge" shows "Want to see where the faces are glued?" and the Show edges / Hide edges
  button.
- Show edges: `RuntimeMenuState.showEdgesEnabled` (off by default, not remembered across reloads), command
  `set-show-edges`, a switch in Settings > Display and the button above; `src/render/three/edgeLines.ts` draws a
  flat 8 cm strip on the floor along every side that has a portal, one group per face root (rebuilt with the cell
  meshes, shown or hidden per frame from the setting). Tooltips for both ids in `paletteTooltips.ts`.
- Authoring: world-script call `discoveries({ disable, add, markers })` (`worldBuilder.ts`, `compileWorldScript.ts`),
  spec types in `cell-complex/specs.ts` (`WorldDiscoveriesSpec`, `AuthoredDiscoverySpec`, `DiscoveryMarkerSpec`),
  validation in `validateCellComplexSpec.ts` (the shipped `validateAuthoringSpec` is an alias of it): faces exist,
  numbers finite, radius positive, ids unique and non-empty. `add` entries take `detector: { visitFace }` or
  `{ approach: { face, position, radius } }` and an optional `marker`.
- Curiosity markers (`src/render/three/curiosityMarkers.ts`): a pulsing orange disc with a "?" on the floor (turned to
  read upright from where the player stands), a wrapped teaser label within 3 m, a green tick disc once found; placed in
  the player's frame through up to two portals like the help cube's label. Worlds: 001 (marker and approach detector at
  (6.4, -6.4) of "front", a cube corner, question about the three squares), genus-2 octagon ("genus-2-corner" near the
  corner point, 2 m inside vertex 0), torus-moduli (a marker for the built-in `new-shape` at (-3.7, -5.0), beside the shape
  machine). `new-shape` is disabled in 001, 002, the five plain Platonic worlds, genus-2 and the plain torus (no shape machine);
  `back-where-you-started` in the two one-face tori.
- Tests added: `tests/modules/discoveries.test.ts` (19: each detector from scripted frames, catalog, page entries),
  `tests/render/discoveryController.test.ts`, `tests/ui/discoveriesPage.test.ts` (page, commands, Show edges),
  `tests/authoring/discoveries.test.ts` (builder, validator, shipped worlds, markers off the corners),
  `tests/render/curiosityMarkers.test.ts`, `tests/render/edgeLines.test.ts`.
- Headless Chrome (`.temp/check82.mjs`, `.temp/check82b.mjs`, gitignored; 1280x960, stubbed pointer lock): on
  `?config=001`, `noneuclid.api.motion.walk(3)` from (0, 6) in "front" crosses to "top"; `document.body.innerText` then
  contains "Discovery! Across an edge" and "Which face did you land on? Was it the one you expected?". Standing at the
  marker gives "Discovery! Where three squares meet" and its question. Screenshots read by eye: the disc and its teaser
  label at 2 m, the label gone and a tick after the find, the Discoveries page (1 of 6 found, the invitation and the button),
  the yellow edge line after pressing Show edges.

### Deviations

- Existing tests changed because the placeholder is gone: `tests/runtime/runtimeMenuState.test.ts` (the hub's
  Discoveries option is `disabled: false`) and `tests/ui/helpPages.test.ts` (the same, and the test name).
- The teaser line is "??? - " and the teaser, with a hyphen, not the design's middle dot: the palette font draws U+00B7 as a
  box (seen in the page screenshot).
- The spec wanted `discoveries: {...}` "on the world"; as a world-script call it is `discoveries({...})`. It also takes a
  `markers` list (marker for a discovery by id) so that a built-in one (`new-shape` in 005) can have a marker; `add`
  entries can carry `marker` as the job says.
- `RuntimeMenuState` and `RuntimeCommand` import a type from `modules/discoveries` (allowed by the layer rules).

### Uncertain

- `tight-string` is a heuristic: a string that was straightening and then has no tied vertex left while beams remain is
  taken as finished; deleting one string among several beams would also count. The curve module offers no "finished" event.
- A discovery by crossing: any portal crossing counts for `across-an-edge`, also in a one-face world, where the question
  "which face did you land on" is odd.
- Detection reads the registry writes of the frame; a beam that is rebuilt every frame (carried laser) triggers
  `beam-hits-corner` the first frame it ends in a zone. That is intended, but a corner stop during a preview that is
  not drawn would count too.
- Markers stand at the cell-local floor point; in 004 the octagon is 66 m wide, so the marker is far from the start
  (the label shows only within 3 m, the disc within 30 m). 004 and 005 were checked by unit tests of the data, not in the browser.
- The curiosity markers are drawn in the scene root like the help cube's label, so they are not clipped by portals
  (a marker seen through an edge is placed by an image route of at most two hops).
- Show edges draws only the current face's own sides (the neighbour seen through an edge has none); not remembered
  across reloads; VR has the switch in Settings but no VR headset check.
- The discovery toasts compete with the two-toast limit: another toast pushes the question out early.

### Not done

- `meeting-twice` and `around-a-corner` (moderate detectors of design 017 section 9.4): follow-ups, as the job says.
- No headset (VR) check of the markers, the toasts or the Discoveries page.
- The authoring guide in `_docs` was not extended with `discoveries(...)`.
- GitHub Pages checks skipped (`gh` is disabled).

### Checks

- Baseline (from the coordinator): typecheck, docs:check and 2051 unit tests green.
- After: `npm run typecheck` clean; `npm run docs:generate` then `npm run docs:check` all ok; `npx vitest run --project unit`
  226 files, 2102 tests passed (a first run failed `tests/project/testHygiene.test.ts` H6 on four test names over 90
  characters; renamed); `npm run build` then `npm run smoke -- --config 001`: SMOKE OK cube.
- `tests/app/*.release.test.ts` not run (they fail with "CDP command ... got no response within 6000 ms" in this
  environment, pre-existing); the intermittent timeout in `tests/project/moduleImportRules.test.ts` did not occur.
