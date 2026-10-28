# 36 - Add pre-merge CI and browser smoke coverage

Status: open as of 2026-08-03T14:24:10-05:00.

Priority: P1 release confidence.

## Problem

The current GitHub Actions workflow is triggered by pushes and manual dispatch,
then gates its jobs to the default branch. Pull requests therefore have no
dedicated typecheck/test/build validation before merge.

Vitest uses the Node environment. Contract tests cover many renderer adapters,
but no test opens the built application in a browser. Missing assets, wrong
Pages base paths, WebGL startup failures, browser API mistakes, pointer-lock
integration, and basic menu regressions can pass all Node tests.

## Required work

- Add a pull-request workflow that runs install, typecheck, unit/contract tests,
  and a production/Pages build.
- Add a small Playwright or equivalent desktop browser smoke suite.
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
