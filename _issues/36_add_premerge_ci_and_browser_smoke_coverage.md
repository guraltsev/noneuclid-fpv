# 36 - Add pre-merge CI and browser smoke coverage

Status: open; re-verified 2026-10-28.

Priority: P1 release confidence.

## Status update 2026-10-28

Done (partly):

- A manual headless smoke script exists: `scripts/smoke/browser-smoke.mjs`
  (`npm run smoke -- <url> <label>`). It drives a Chromium-based browser over the
  Chrome DevTools Protocol (no Playwright), loads one URL, calls the
  `noneuclidDebug`/`noneuclidPortalDebug`/`noneuclidGeometry` console helpers,
  and exits non-zero on an uncaught exception, no canvas, or a loading screen
  still shown. `_docs/DEVELOPMENT.md` documents running it against
  `npx vite preview --port 4173`.
- Production deployment is restricted to `main`:
  `.github/workflows/deploy-pages.yml` runs on `push` to `main` and
  `workflow_dispatch` only.

Still open:

- There is no pull-request workflow. The only workflow is
  `deploy-pages.yml`, and since commit 64b3797 ("Stop running tests in the Pages
  deploy workflow") it runs no typecheck or tests at all; `npm run build`
  (`tsc --noEmit && vite build`) is the only check before deploy.
  `_docs/DEPLOYMENT.md` tells the maintainer to run `npm test` locally.
- The smoke script is not run in CI, does not detect required-asset 404s, does
  not exercise a menu interaction, uses a fixed 25 s wait, and its documented
  invocation serves the build at `/` rather than under the Pages base path.
- No headset checklist with the date/device of the latest run is recorded.
- `_docs/testing.md` ("Browser Smoke Tests") still says Playwright is
  "reserved for later" and does not mention the existing script.

## Problem

At filing time the GitHub Actions workflow was triggered by pushes and manual
dispatch, then gated its jobs to the default branch. It now triggers only on
pushes to `main` (and manual dispatch) and no longer runs tests. Pull requests
therefore have no dedicated typecheck/test/build validation before merge.

Vitest uses the Node environment. Contract tests cover many renderer adapters,
but no test opens the built application in a browser. Missing assets, wrong
Pages base paths, WebGL startup failures, browser API mistakes, pointer-lock
integration, and basic menu regressions can pass all Node tests.

## Required work

- Add a pull-request workflow that runs install, typecheck, unit/contract tests,
  and a production/Pages build.
- Add a small Playwright or equivalent desktop browser smoke suite. (Partly
  done: `scripts/smoke/browser-smoke.mjs`, manual only.)
- Start with app startup, one representative config URL, no uncaught errors,
  no required-asset 404s, visible canvas/UI, and a basic menu interaction.
- Keep mathematical correctness in Vitest; browser tests should cover
  integration and startup only.
- Keep headset-specific stereo and comfort validation manual, but record a
  repeatable checklist and the date/device of the latest run.
- Publish useful failure logs without deploying pull-request artifacts to
  production.

## Acceptance criteria

- Pull requests receive required typecheck, test, build, and smoke statuses.
- The smoke test loads the site using the same base-path behavior as Pages.
- At least one authored world starts without uncaught errors or missing required
  assets.
- Production deployment remains restricted to the default branch.
