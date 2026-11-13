# Job 70 - One student vocabulary: the vocabulary module, the renames and the retired-terms check

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) section 6 (findings F18, F21).

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
