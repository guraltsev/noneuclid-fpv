# Job 44 - API scenario runner, first scenarios, and the manual checklist

Status: queued.
Resolves: nothing fully. It moves the manual checks of issues 56, 57, 58, 59, 71, 73 and 75 into `tests/manual_smoke.md`,
where they can be run and recorded.

## Goal

Turn manual checks into tests through the public API (`window.noneuclid.api`), as `_docs/tests.md` §6 describes:
1. a scenario runner for the `release` tier, which serves the built site, drives headless Edge, and hands each scenario
   an `api` object whose calls run in the page;
2. the browser smoke moved onto the API;
3. scenarios for the class-A checks of the audit that the API can already observe;
4. `tests/manual_smoke.md`, holding every check that needs a person, each with its setup.

This is stage S3 of `_docs/design/012-engine-api.md` §6 ("manual headset checks become scripts"), as far as today's API
allows. Checks that need new API functions are job 45.

## Depends on

Job 41 (the `release` project and `npm run test:release`). It does not depend on jobs 42 or 43.

## Before you start

Read:

| File | What to look at |
| --- | --- |
| `_docs/tests.md` | §6 (all), §8.5 (the API and scenarios), §8.6 (manual checks) |
| `.agents/jobs/_reports/test_audit_2026_10_31.md` | §4 (the manual checks, classified), §5 (the API today) |
| `src/runtime/publicApi.ts`, `src/runtime/apiCall.ts` | the API object and its dispatch |
| `src/render/three/appDebugHelpers.ts`, `src/main.ts` | where namespaces are installed, and when |
| `scripts/smoke/browser-smoke.mjs`, `scripts/smoke/staticServer.mjs` | launching Edge, CDP, serving `dist/` under a sub-path, the failure rules |
| `scripts/debug/cdp.mjs` | the `call` implementation on the DevTools backend |
| `_docs/acceptance-checklists.md` | the "Headset smoke checklist (manual)" section |
| `.agents/knowledge/headless-edge-end-to-end.md`, `windows-shell.md`, `test-and-smoke-timing.md` | the browser flags; the load flake |

Baseline: `npm run typecheck`, `npm test`, and `npm run test:release` (it passes with no `release` tests).

## Decisions

1. **One CDP client.** Extract the DevTools code (launch Edge, find the page, `send`, `evaluate`, console and exception
   capture, screenshot) into `scripts/lib/cdpClient.mjs`.
   - `browser-smoke.mjs` and `scripts/debug/cdp.mjs` use it.
   - Their command-line behaviour does not change; `tests/project/smokeArgs.test.ts` (or `tests/smoke/smokeArgs.test.ts`
     if job 42 has not run) stays green.
2. **The runner** lives in `tests/support/scenario/`:
   - **`globalSetup.ts`** (release project): serves `dist/` with `staticServer.mjs` under `/scenario/relocated/` and
     launches one headless Edge with the flags of `browser-smoke.mjs`.
     - When no Chromium-based browser is found, the project **fails** with
       `release tier needs a Chromium-based browser; set BROWSER to its path`.
     - A missing browser is never a skip (rule H9).
   - **`openApp({ world, config })`**: opens a new page, waits until the app has loaded, and returns
     `{ api, waitFor, screenshot, close }`.
     - "Loaded" means: the loading screen has gone (the smoke's rule) **and** `api.debug` exists in the API listing.
   - **`api`**: a proxy. `api.ns.fn(...args)` evaluates `window.noneuclid.api.ns.fn(...JSON args)` in the page with
     `awaitPromise` and `returnByValue`, and returns the plain result. A page exception rejects with its message.
   - **`waitFor(query, predicate, { frames = 600 })`**: polls a query once per animation frame in the page, and rejects
     after `frames` frames with the last value. A fixed sleep is never used.
   - **Errors:** every page records console and exception events. A scenario fails at `close` on the smoke's failure
     rules (frame errors, config fallback, 4xx, uncaught exceptions).
3. **Scenarios** live in `tests/app/<feature>.release.test.ts`, with these rules:
   - Each has a module comment like any test (`_docs/tests.md` §4.2), and calls only `api` (no DOM selectors, no
     `evaluate` of other expressions, no old globals).
   - Each scenario body is a function `(api) => Promise<void>`, so it can later run over the server channel or in
     process unchanged.
   - Assertions tolerate frame timing, because the frame loop uses wall-clock `dt` (`_docs/tests.md` §8.5).
4. **Scenarios to write** (audit §4 numbers in brackets). Each line is one test:
   - `appLoading`: every config (`full`, `001`, `002`, `default`) loads, and `app.info()` reports it [1, 30].
   - `appCommands`:
     - `app.changeWorld("cube")`, `app.changeConfig(...)` and `app.reload()` restart the app on the requested world and
       config [29];
     - after each, `waitFor` sees `app.info()` report it, and `debug` is installed again.
   - `torusDeformation`:
     - in `torus-moduli`, `geometry.setTorusSkew(m)` leads to `geometry.state()` reporting the committed target;
     - `geometry.cancel()` during a build leaves the previous geometry [11 partly, 45 desktop];
     - read the shape of `geometry.state()` first; assert only fields it documents.
   - `objectPlacement`: `debug.placeObjectAt` returns `true` for an existing owned object and `false` for an unknown id
     [43 partly]. Assert nothing about the object's pose: no query reads it yet (job 45).
   - `creatures` [16]: only if some bundled world has a geodesic creature (check `src/authoring/exampleWorlds.ts`).
     - After 300 frames, `debug.dumpGeodesicCreatures()` reports it still exists and has moved.
     - If no world has one, skip writing it and record that.
   - `bundleLoading` (in `tests/project/`, a release test of the built site, not a scenario) [66]: from CDP network
     events, list which `worker-*.js` files and which uikit or Inter files load when the palette is never opened.
     - Write it as a test only if the result is a stable rule (for example, "no uikit file loads before the palette
       opens").
     - Otherwise write the facts under `### Uncertain` for job 34.
5. **The renderer fake's contract** (left by job 43): if `tests/support/fakeRenderer.ts` exists, add
   `tests/render/fakeRendererContract.release.test.ts`.
   - In a page of the built site, read `renderer.info` and the properties the fake implements, through one `evaluate`
     against the app's renderer if the API exposes it.
   - If the API does not expose it, leave the `TODO(job44)` and record it for job 45.
6. **Smoke on the API.** In `browser-smoke.mjs`, replace `POKE_EXPR` (old globals) with a check that
   `window.noneuclid.api.app.info()` returns the requested world and that the `debug` namespace is installed. Keep the
   other failure rules. Update `_docs/DEVELOPMENT.md` where it describes the smoke.
7. **`tests/manual_smoke.md`.** Create it with the format of `_docs/tests.md` §8.6. One entry per class-D group of the
   audit, merging duplicates:

   | Entry | Covers (audit §4 numbers) |
   | --- | --- |
   | M1 | headset start, from acceptance-checklists: site, server certificate, enter, exit, re-enter VR [2 Quest, 3, 7] |
   | M2 | head, room scale, joystick, turn without drift, controller mapping [14] |
   | M3 | 30 s comfort and stutter [15] |
   | M4 | XR palette and buttons [31] |
   | M5 | in-headset debug panel [32] |
   | M6 | stereo across a portal: both eyes, wrong room, edges, recursion depth per eye, straddling counters [48–51] |
   | M7 | per-eye instancing and mono-XR flag re-root [52, 53] |
   | M8 | straddling object overhang in a headset [42] |
   | M9 | `gl_ClipDistance` on the Quest driver [54] |
   | M10 | frame time on the Quest: portal ms and GPU time in two or three worlds [56 Quest, 64 Quest] |
   | M11 | look of floor textures and models [44, 46 quality] |
   | M12 | asset provenance review before publishing [69] |

   Each entry has:
   - **Setup:** a URL, or a `npm run cdp -- --server ... call ...` line when the API can set the state.
   - **Do:** what the person does.
   - **Judge:** what they judge.
   - **Failure:** what counts as a failure.
   - **Sources:** where the check came from.
   - **Runs:** an empty log.
8. **Remove the moved checks from the living documents.**
   - Replace the "Headset smoke checklist (manual)" section of `_docs/acceptance-checklists.md` with one line pointing
     to `tests/manual_smoke.md`.
   - In each of issues 56, 57, 58, 59, 71, 73 and 75, add one line: `Manual check: tests/manual_smoke.md M<n>.`
   - Do not edit `_done` jobs or `_reports`: they are history.
9. **Stale checks** [55, 70] are not converted. List them in the report.
10. **Indicators.** `npm run test:report` counts the `M` entries. Report how many class-A checks became scenarios, and
    which class-A checks did not convert and why.

## Steps

1. Extract `scripts/lib/cdpClient.mjs` (decision 1). Run `npm run smoke -- --world cube` and `npm test`.
2. Write the runner (decision 2) and one scenario, `appLoading`. Prove it: break the load on purpose (for example, ask
   for a world id that does not exist) and see a readable failure. Run `npm run test:release`.
3. Write the other scenarios (decisions 3–5). Prove each one fails when its behaviour is broken: a wrong expected
   value, or a temporary edit in `src/`.
4. Move the smoke onto the API (decision 6).
5. Write `tests/manual_smoke.md` and update the living documents (decisions 7–8).
6. Run `npm run test:release` three times in a row. Any failure that does not repeat is a flake: make the wait condition
   explicit, or record it under `### Uncertain`. Do not add retries inside tests.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run test:release` (three runs), `npm run smoke -- --world cube,torus-moduli`,
`npm run docs:check`.

## Do not

- Add or change functions of `window.noneuclid.api`. That is job 45, after the maintainer agrees them.
- Read the DOM, the debug overlay, the old globals or `__noneuclidDiagnostics` in a scenario.
- Use a fixed sleep, or a wall-clock time limit as an assertion.
- Close issues: their checks are now runnable, but not yet run on a headset.

## Done when

- `npm run test:release` runs the scenarios against the built site and passes three times in a row.
- The smoke uses the API.
- `tests/manual_smoke.md` holds M1–M12, and no living document keeps its own copy of those checks.
- The report lists, for every class-A check of the audit, the scenario that covers it or why none does.
