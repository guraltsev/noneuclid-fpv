# Job 65 - Give modules a public API and write the scenarios that were waiting for it

Status: queued.
Resolves: the release scenarios left open by jobs 50, 53 and 54.

## Goal

A script can build an emitter scene, shoot, tie and wait for the flow through `window.noneuclid.api`, so manual checks become release scenarios.

## Depends on

Job 63. Job 64 for the carry and aim scenarios.

## Before you start

- Read 013 sections 5.3 and 5.7, `src/runtime/publicApi.ts`, `tests/app/*.release.test.ts`, [job 45](45_api_functions_for_scenarios.md) and
  `.agents/jobs/_reports/test_audit_2026_10_31.md` sections 4 and 5.

## Decisions

- `ModuleInstance.publicApi` as in 9.1: reads, or wrappers that submit a command and resolve with its result. Plain data only. The shell
  installs it as `api.<moduleId>`; composition fails when a `publicApi` name is not a function.
- `api.geodesicEmitters`: `place`, `shoot`, `extend`, `deleteGeodesic`, `remove`. `api.geodesicModel`: `tieAndDetach`, `arcsOfCurve`.
  `api.curveShortening`: `isAtRest`.
- This job does **not** decide job 45's other functions (`player.setPose`, `sim.pause`, and the rest): their names and shapes need the
  maintainer. Update job 45 to say which rows this job covered.

## Steps

1. `publicApi`, with tests, and `npm run docs:generate`.
2. Release scenarios: tie on a torus world until `isAtRest` (job 53, step 6); a world refusal shown when the emitters are disabled (job 54);
   carry through a portal (job 50); a tied curve around a corner is destroyed with its notice (job 55's manual check).
3. The `derived-verify` debug option on for a scenario of carry, shoot, tie and flow: no "differs from compute" error (job 59's manual check).

## Tests and checks

Release tier twice in a row. Known flake: issue 83. Record any failure, do not retry until green.

## Do not

Do not add a test back door (`_docs/tests.md` section 6.3): a function exists because a client could use it.

## Done when

The manual checks of jobs 53, 55 and 59 are gone from the batch report's list, and issue 86 can be closed with evidence.
