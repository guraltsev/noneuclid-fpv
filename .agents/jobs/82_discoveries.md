# Job 82 - Discoveries, curiosity markers and "Show edges"

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 9.4, 9.5,
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
   On detection: toast "Discovery! <name>" followed by a second toast with the question, and the Discoveries page
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
