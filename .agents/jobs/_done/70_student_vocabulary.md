# Job 70 - One student vocabulary: the vocabulary module, the renames and the retired-terms check

Status: done, needs review on 2026-11-12.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 6 (findings F18, F21).

## Goal

Every student-visible noun, verb and subtitle comes from one module, `src/ui/vocabulary.ts`, and uses the naming scheme
of design 017 section 6: Hand, Laser, laser, beam, linked beam, string, Ruler, Protractor, measurement, Sign, sign,
Map, help cube, shape machine, face, edge, corner. A check fails when a retired term appears in a student-visible
string. Code ids do not change.

## Depends on

Nothing in this batch. Branch `dev`.

## Before you start

- Read design 017 section 6 (all of it). The tables there are the specification.
- Read the tool descriptors: `src/modules/geodesicEmitters/client.ts` (label "Geodesic emitter"),
  `src/modules/geodesicMeasurements/client.ts` ("Length", "Protractor"), `src/modules/placedFlags/client.ts` ("Sign"),
  `src/modules/worldMap/client.ts` ("Map"), `src/modules/geodesicModel/tieTool.ts` ("Unite", "Unite & shorten"), and
  the `ToolDescriptor` type in `src/engine/moduleTypes.ts`.
- Read `src/ui/paletteTooltips.ts`, `src/ui/helpLensDefinition.ts`, `src/ui/worldInteractionDefinition.ts`,
  `src/world-objects/helpHubCopy.ts`, the default tutorial pages in `src/authoring/worldBuilder.ts` (the `title:` and
  `body:` strings near the top), and the palette pages under `src/render/three/palette/pages/`.
- Find where signs get their automatic names ("A1", "A2") in `src/modules/placedFlags/` and where emitter menu rows
  are labelled "G1" (`src/render/three/palette/pages/geodesicActions.ts` or `paletteDefinition.ts`).
- Check the layer of `src/ui/` and of `src/modules/` in `scripts/docs/lib.mjs`: the module descriptors must be allowed
  to import `src/ui/vocabulary.ts`. If they are not, put the vocabulary in the lowest layer both can import (for
  example `src/glue/` or wherever `src/ui` and `src/modules` both already import from) and record that.

## Decisions

1. `vocabulary.ts` exports plain constant records, no functions with logic beyond string templates:
   `toolNames` (by tool id: `{ name, subtitle }`), `objectNouns` (laser, beam, linked beam, string, measurement, sign,
   help cube, shape machine, face, edge, corner, with singular and plural), `objectActions` (Place, Extend, Aim,
   Add beam, Join, Pick up, Put down, Rename, Delete, Go home, Start over), `verbNames` (Use, Menu, Pick up,
   What's this?, Switch tool, Main menu), and `surfaceNames` (tool belt, main menu, Help, How to, Things to try,
   Discoveries). Also `retiredTerms`: the "Retire" columns of design 017 tables 6.2 and 6.3, as an array.
2. Tool descriptors take `label`, `badgeLabel`, `helpTitle` from the vocabulary. `badgeLabel` becomes the same as the
   name (no more "RAY"). `helpBody` and `helpRows` are rewritten in the new words.
3. Short ids: lasers L1, L2, ...; signs S1, S2, ... (design 6.1 rule 6). Emitter menu rows read "Beam 1", "Beam 2";
   the richer row text ("Beam 1 · 4.0 m · free") is job 78, not this job.
4. The help hub sentence becomes "Lost? Press Esc and choose Go home." for desktop. The VR variant is job 79; until
   then keep the desktop sentence for both.
5. Tutorial page texts in `worldBuilder.ts` are rewritten in the new vocabulary, keeping their meaning. Do not
   restructure the tutorial (job 79 does that). "the orange button" becomes "Join".
6. World scripts in `src/examples/*.world.js` and goal texts: replace retired terms in student-visible strings. In
   `torus-moduli.world.js`, "A" and "B" of the shape machine become "Shift" and "Height" in prose.
7. The check is a unit test, `tests/ui/vocabulary.test.ts`, not a docs check: it reads the source files listed in
   "Before you start" plus `src/examples/*.world.js` as text, extracts string literals, and fails on any retired term
   (whole word, case-insensitive) except inside comments and code ids (strings containing `/`, like
   `"geodesicEmitters/emitter"`). Keep an explicit allow-list array in the test for false positives, each with a reason.
8. Debug pages (`debugSettings.ts`, the debug overlay, `window.noneuclid.api` text) are not student-visible; leave
   them.
9. The terms are decided (the maintainer asked for a coherent scheme and this is it). Do not invent alternatives.

## Steps

1. Baseline: `npm run typecheck`, `npm test`.
2. Create `src/ui/vocabulary.ts` with its module header comment, and `tests/ui/vocabulary.test.ts` with only a shape
   test (every tool id of the five main tools has a name and subtitle). Run it.
3. Point the tool descriptors at the vocabulary and rewrite their help text. Run `npx vitest run tests/ui tests/modules`.
   Update test expectations that assert on the old labels; record each in `### Deviations`.
4. Rename the palette and tooltip strings, the help lens, the focus message, the help hub copy. Run `tests/ui` and
   `tests/render`.
5. Change sign auto-names to S1, S2 and emitter rows to "Beam n"; if lasers get no visible id today, add "L<n>" in the
   same way signs get theirs, reusing that code.
6. Rewrite the tutorial page strings and the world scripts.
7. Add the retired-terms scan to the vocabulary test; fix what it finds.
8. Finish as the README says.

## Tests and checks

- `tests/ui/vocabulary.test.ts` passes, including the retired-terms scan.
- `npm run smoke -- --config 001` still loads.

## Do not

- Rename code ids, module ids, object kinds, file names or API names.
- Change behavior. This job changes text only (plus the S/L prefixes).

## Done when

No retired term is left in student-visible strings, all of them come from the vocabulary module, the checks pass, the
commit is on `dev` and the report is appended.

## Report

### Done
- `src/world-objects/vocabulary.ts` (new): `toolNames` (Hand, Laser, Ruler, Protractor, Sign, Map, Join, each with its subtitle), `objectNouns`, `objectSubtitles`, `objectActions`, `verbNames`, `surfaceNames`, short-id helpers (`laserShortId`, `signShortId`, `beamName`, `laserLabel`), `lostGuidance` and `retiredTerms`. `src/ui/vocabulary.ts` re-exports it.
- Tool descriptors (`geodesicEmitters`, `geodesicMeasurements`, `placedFlags`, `worldMap` clients, `geodesicModel/tieTool.ts`) take `label`, `badgeLabel` and `helpTitle` from `toolNames`; help bodies and rows are rewritten. The core tools (`src/runtime/coreTools.ts`) say Pick up, Rotate beam and Aim beam.
- Palette tooltips, help lens (topics and the Hand text), focus messages, palette definition (beam rows "Beam n", Add beam, Pick up, How to, Things to try, shape machine text), palette pages (Laser menu title, Aim, Shape machine, Help, Go home, Start over), help hub sentence "Lost? Press Esc and choose Go home.", object tooltips and help messages (Beam n, Meeting point, Help cube, Shape machine, Rename sign), library help texts.
- Signs are named S1, S2, ... (both sign types share the numbering). Lasers placed on the floor or by cutting a beam get the tooltip "Laser L1", "Laser L2", ... (`nextLaserNumber` in `src/world-objects/geodesic/cannon.ts`; the label survives re-creation of the emitter). Beam labels, length labels and angle labels read "Beam 1".
- Tutorial pages and goal page text in `src/authoring/worldBuilder.ts` and the world scripts in `src/examples/*.world.js` rewritten (Shift and Height in `torus-moduli`). Module refusal messages shown to the student (`geodesicEmitters`, `geodesicModel`, `geodesicMeasurements` `module.ts`) reworded.
- `tests/ui/vocabulary.test.ts`: shape test, the retired-terms scan over the listed files plus the module, world-object and example files named in it, and tests of the scanner itself. Allow-list: Go home, carry on, length =, two debug-page switches (each with a reason). Strings that are arguments of `Error(` or a console call are skipped (author/developer text).
- New test: `tests/modules/geodesicEmitters/edit.test.ts` "names each placed laser with the next free short id".
- Generated documents regenerated (`npm run docs:generate`).
- Commits: a793495 (the work), and the commit after it that records the push in this report.

### Deviations
- The vocabulary lives in `src/world-objects/vocabulary.ts`, not `src/ui/vocabulary.ts`: the layer rules (`scripts/docs/lib.mjs`) let `modules` and `authoring` import neither `ui` nor `glue`, but both may import `world-objects` (where `helpHubCopy.ts` already lives). `src/ui/vocabulary.ts` is a re-export so the design's path works.
- Existing test expectations changed to the new words (each is a text change only): `tests/ui/paletteTooltips`, `helpLensDefinition`, `paletteDefinition`, `worldInteractionDefinition`; `tests/runtime/runtimeMenuState`; `tests/render/aimFeedback`, `xrControllerHandModels`; `tests/modules/geodesicEmitters/emitterTool`, `geodesicMeasurementTools`, `geodesicMeasurements.contract`, `geodesicModel/tieTool`, `placedFlags`; `tests/world-objects/placedFlags` (signs are S-numbered, one counter for both types: the "A8"/"B4" expectations became "S8"/"S9"), `runtimeObjectRegistry`, `geodesic/trace`, `cannon`, `segments`, `intersections`.
- The scan covers more than the files the job lists (module refusal messages, world-object help texts, `coreTools.ts`, the palette header), because those strings reach the student.
- Terms of one character (R, G, +) in `retiredTerms` are not scanned in prose (key names and symbols); the scan treats a string as prose when it has a space or is one capitalised word.
- The tie action in the laser menu is now labelled "Join" (was "Unite & shorten"); the Hand's tooltip for the old "Read" action is "Help".

### Uncertain
- Student words the design does not fix, chosen here; the maintainer should confirm or change them in `src/world-objects/vocabulary.ts` and the strings that use them: "Meeting point" (for a crossing of two beams; the design retires "vertex" and names no replacement), "Pick beam" / "Pick for protractor" / "Measure" (focus-message verbs; the closed verb list has no word for selecting with a tool), "Linked" (the disabled action on a linked beam), "Help" (the help cube's action), "Laser menu", "Rotate beam", the tutorial titles "The menu", "Lasers and beams", "Linked beams", "Join two beams", "Map", and the goal page title "Things to try".
- Beams are named "Beam n" with a global number (as the job says), not "L1 beam 2" as design 6.1 rule 6 describes; the menu row text is job 78.
- The palette Reload button is now named "Start over", because it restarts the app and removes what was placed (`onReloadRequested` -> `requestAppRestart`). Job 73 owns the guard and the key; confirm that "reload" here is not a page reload.
- Laser numbers exist only for lasers placed in the running app. Lasers authored in a world script, or lasers in a saved state from before this job, show "Laser" with no number, and the number is stored only in the tooltip label (no new field).
- Signs already placed with the text "A1" or "B2" keep their text; new signs continue from the largest "S<n>" only.
- Not looked for by the scan (not in the listed files): strings in `src/render/dom/`, loading and status text, VR panel text outside the palette pages, `src/runtime/` command messages, and other modules' refusal messages (`carry` and `curveShortening` are scanned and clean; `world`, `worldMap` have none). A grep found no retired term in them, but the scan does not guard them.

### Not done
- The shape machine panel still shows "A" and "B" step buttons ("A -1 m", "B +1 m"), the "X = ..., current white (a, b)" line, "Set skew"/"Step skew" tooltips and the lattice diagram labels; job 80 rebuilds that panel with Shift and Height, so they were left. They are not in a scanned file as retired terms.
- The VR variant of the lost sentence (job 79) and the richer beam row text (job 78).
- The Pages run was not checked: the `gh` CLI wrapper is disabled on this machine.
- No new tooltip numbering for lasers placed before this job (see Uncertain).

### Checks
- Baseline: `npm run typecheck` green; `npm test` before my changes: 3 failures, all caused by my own new files at that moment (missing test header comment H6, stale generated documents, documentation test); no baseline failure.
- `npx vitest run tests/ui tests/modules tests/world-objects tests/authoring tests/runtime tests/render` green after the test updates.
- Final: `npm run typecheck` green; `npm test`: 196 files, 1853 tests passed (the intermittent `moduleImportRules` timeout did not occur); `npm run docs:check` all ok after `npm run docs:generate`.
- `npm run smoke -- --config 001`: SMOKE OK.
