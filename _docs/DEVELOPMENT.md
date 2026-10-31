# Development guide

This guide is for people changing the project. It is deliberately separate from
the main README, which is written for learners and educators.

## Prerequisites

- Node.js 20 or later and npm.
- A current Chromium-, Firefox-, or Safari-based browser for manual checks.
- A headset only for WebXR work; ordinary development and tests do not require
  one.

## Install, run, and check

From the repository root:

```sh
npm ci
npm run dev
```

`npm run dev` opens the browser on `?config=full` (every world, tool and the debug menu). Choose another scenario with
`?config=001`, `?config=002` or `?config=default`, and confirm that the world loads and that the menu and a placed
tool work.

`git push` runs `npm run typecheck`, `npm test`, `npm run build` and a headless smoke test of the cube and torus-moduli worlds (skipped with a warning when no Chromium-based browser is found) through the pre-push hook in
`.githooks/` (enabled by `npm install`, or by hand with `npm run setup:hooks`,
which runs `scripts/setup-git-hooks.mjs` to set `core.hooksPath`) and refuses
the push on failure. Run the full set yourself before sharing a change:

```sh
npm run typecheck
npm test
npm run build
```

The test suite checks mathematical and renderer contracts and the documentation
rules (`tests/docs`). It does not replace a short browser check of the
interaction you changed. For a scripted check, build and run the
headless smoke test (needs a Chromium-based browser):

```sh
npm run build:pages
npm run smoke -- --world cube,dodecahedron,torus-moduli
```

The script serves `dist/` itself under a sub-path (`/smoke/relocated/`, which checks that the build is relocatable), with real 404s like GitHub Pages (no HTML fallback), loads one page per world, opens and closes the menu (right click, Escape), and prints `SMOKE OK` or `SMOKE FAILED` per world. A world fails on:

- an uncaught exception;
- a console message with `[noneuclid] frame error` or `frames in a row failed`;
- a console message with `[noneuclid] using built-in defaults` (the app config did not load);
- a request answered with HTTP status 400 or more, or a network failure that was not cancelled (`/favicon.ico` is ignored);
- a loading screen with the error class;
- a loading screen still present after the timeout;
- no `canvas` element.

Other console errors and warnings are printed but do not fail the run. Flags:

- `--world <id[,id...]>` (default `cube`);
- `--config <name>` (default `full`);
- `--debug-level <off|basic|verbose>`;
- `--dist <dir>` (default `dist`);
- `--url <site-url>`, to check a running site such as `--url https://guraltsev.github.io/noneuclid-fpv/` instead of serving `dist/`;
- `--timeout-ms <n>` (default 60000);
- `--label <text>`.

Set `BROWSER` to the path of a Chromium-based browser if it is not in the default location (Edge on Windows, else `chromium`). The script builds the URL itself, so no `&` is needed on the command line. The old form `node scripts/smoke/browser-smoke.mjs "<page url>" [label]` still loads one page.

After changing code, run `npm run docs:generate` and commit the regenerated
`_docs/generated` files. `npm run docs:coverage` lists missing documentation.

## Where to start reading

- [Documentation home](Readme.md) lists the living guides and design records.
- [Implementation reading order](implementation-reading-order.md) is the best
  route through the runtime for a new contributor.
- [Architecture](ARCHITECTURE.md) and [mathematical model](MATHEMATICAL_MODEL.md)
  explain what the program computes and how it is organised.
- [Development overview](Development_guide.md) records the project boundaries
  and repository map.
- [Test policy](tests.md) explains what a good test is, where it goes, its tier, and how manual checks become API tests; [test hygiene](tests_hygiene.md) how the suite stays healthy.
- [Asset provenance](ASSET_PROVENANCE.md) is required reading before adding,
  moving, or redistributing an asset.

## Project identity and issue tracking

`noneuclid-fpv` is the long-lived project identity. Names such as
`camp-2026-VR` are replaceable classroom or yearly deployment instances; do
not rename the source project merely to match an instance.

Problems live in [`_issues`](../_issues/): what is wrong, the evidence and the
impact. Work orders live in [`.agents/jobs`](../.agents/jobs/README.md), numbered
in the order they should be carried out; each names the issues it resolves. An
item that is mainly "carry out this change" is a job, not an issue. Move an issue
to [`_issues/_closed`](../_issues/_closed/) and a job to `.agents/jobs/_done/`
only when the work and its verification are actually complete.

For GitHub Pages builds, HTTPS/WebXR expectations, and base-path details, use
the [deployment guide](DEPLOYMENT.md).
