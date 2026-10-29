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

Vite prints the local URL. Visit it, choose a scenario with `?config=001`,
`?config=002`, `?config=default`, or `?config=full`, and confirm that the world
loads and that the menu and a placed tool work.

`git push` runs `npm run typecheck` and `npm test` through the pre-push hook in
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
interaction you changed. For a scripted check, build, serve the build, and run
the headless smoke test (needs a Chromium-based browser; set `BROWSER` if it is
not in the default location):

```sh
npm run build
npx vite preview --port 4173 &
npm run smoke -- "http://localhost:4173/?config=full&world=cube&debugLevel=verbose" local
```

It reports console output and uncaught exceptions and exits non-zero if the app
throws or never creates a canvas.

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
- [Testing guide](testing.md) explains what each kind of test should prove.
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
