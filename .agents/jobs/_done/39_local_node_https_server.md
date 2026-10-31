# Job 39 - Local Node server: serve the built app over HTTPS on the local network

Status: done, needs review on 2026-10-31.
Resolves: -. Implements stage S0 of [design 012](../../_docs/design/012-engine-api.md) (section 6, "the local server is
top priority").

**Priority:** the maintainer made the local server top priority (2026-10-31). Jobs 39 and 40 come before every other
queued job; see the note in the [queue](README.md#queue).

## Goal

One Node program, `npm run server`, serves the built app (`dist/`) over HTTPS on the local network, so desktops and
Quest headsets can open it, and marks every page it serves so that the page knows it came from the local server. It is
the multiplayer-mode server of design 012 (two deployment modes: static site for single player, local server for
multiplayer), without any multiplayer yet. Job 40 adds the channel.

## Depends on

Nothing.

## Before you start

Read `.agents/knowledge/index.md` and the notes it lists for testing and the Windows shell. Read design 012, section 6
(stages S0 to S4) and P5 ("two deployment modes"). Read `scripts/smoke/staticServer.mjs` (a small static server you may
reuse) and `_docs/DEPLOYMENT.md`, "Local HTTPS server for a headset" (today's Rebex setup and its certificate).

## Background

- Today headsets load the app from the Windows-only Rebex Tiny Web Server in `wwwserver/` (HTTPS port 11446,
  certificate `wwwserver/server-certificate.pfx`, built with `npm run build`, base `/`). WebXR needs a secure context,
  so plain HTTP on the network does not work on a headset.
- `scripts/smoke/staticServer.mjs` exports `contentTypeFor` and `startStaticServer` (HTTP only, base-aware, real 404s).
  It is used by `npm run smoke` and tested by `tests/smoke/staticServer.test.ts`.
- Node can serve HTTPS from a `.pfx` file with `https.createServer({ pfx, passphrase })`.

## Decisions

1. **Location and command.** `scripts/server/localServer.mjs` exports `startLocalServer(options)`;
   `scripts/server/cli.mjs` parses arguments and calls it; `package.json` gets `"server": "node scripts/server/cli.mjs"`.
2. **Options** of `startLocalServer`: `{ dist = "dist", host = "0.0.0.0", port = 11446, pfx?, passphrase?, dev = false }`.
   Returns `{ url, port, close() }` (a promise of it). With `pfx` it serves HTTPS; without `pfx` it serves plain HTTP
   (used by tests and by `--http`).
3. **CLI flags**: `--dist <dir>`, `--host <h>`, `--port <n>`, `--pfx <file>` (default
   `wwwserver/server-certificate.pfx`), `--http` (plain HTTP; prints a warning that headsets need HTTPS), `--dev`
   (stored and printed; job 40 gives it meaning). The pfx passphrase comes from the environment variable
   `NONEUCLID_PFX_PASSPHRASE`; if unset, use `my-super-secure-password`, the documented local test setting of
   `_docs/DEPLOYMENT.md`. If the pfx file is missing and `--http` is not given, exit with a message pointing to
   `_docs/DEPLOYMENT.md`.
4. **Serving.** Files from `dist/` at the site root (base `/`; the app must be built with `npm run build`). Reuse
   `contentTypeFor` from `scripts/smoke/staticServer.mjs` (import it; do not copy the table). Real 404s for missing
   files, no HTML fallback. Reject any request path that resolves outside `dist/` (403). `Cache-Control: no-store`
   on every response, so headsets never run a stale build.
5. **Server marker.** When serving `index.html` (for `/` and `/index.html`), insert
   `<meta name="noneuclid-server" content="/__noneuclid/channel">` right after `<head>`. Nothing else is rewritten.
   Job 40's page code connects only when this marker is present; GitHub Pages, the Vite dev server and the smoke server
   never send it.
6. **Startup output**: the URL for every non-internal IPv4 address (`os.networkInterfaces()`), for example
   `https://192.168.1.50:11446/`, and whether dev mode is on.
7. **Rebex stays** documented for now as an alternative; the Node server becomes the recommended way.

## Steps

1. Baseline: `npm run typecheck`, `npm test`.
2. Write `scripts/server/localServer.mjs` (header comment saying what it is for, as in `scripts/smoke/staticServer.mjs`)
   with `startLocalServer` and a pure exported helper `injectServerMarker(html)` (Decision 5).
3. Write `scripts/server/cli.mjs` (Decision 3, 6) and the `package.json` script.
4. Tests in `tests/server/localServer.test.ts` (plain HTTP, `port: 0`, a temporary `dist` directory with an
   `index.html` and one `.js` file):
   - `/` and `/index.html` return the HTML with the marker right after `<head>`;
   - the `.js` file is served with `text/javascript; charset=utf-8` and without the marker;
   - a missing file gives 404; `/../package.json` (and an encoded `%2e%2e` variant) gives 403 or 404, never the file;
   - every response has `Cache-Control: no-store`;
   - `injectServerMarker` inserts exactly once and leaves HTML without `<head>` unchanged.
5. Documentation: in `_docs/DEPLOYMENT.md`, under "Local HTTPS server for a headset", add the Node server as the
   recommended way (`npm run build`, then `npm run server`, open the printed address on the headset, accept the
   certificate), keeping the certificate instructions and listing Rebex as the alternative.

## Tests and checks

`npx vitest run tests/server/localServer.test.ts`; then `npm run typecheck`, `npm test`, `npm run docs:check`,
`npm run build`, and `npm run smoke -- --world cube` (must stay green: the smoke server sends no marker).
Manual, if a headset is available: `npm run build`, `npm run server`, open the printed address on the Quest, accept
the certificate, enter VR. Record under `### Uncertain` if not done.

## Do not

- Do not change the app (`src/`); job 40 does.
- Do not remove `wwwserver/` or the Rebex documentation.
- Do not commit certificate files.

## Done when

`npm run server` serves the built app over HTTPS with the marker, the tests above pass, all checks are green, and
`_docs/DEPLOYMENT.md` documents it.

## Report

### Done
`scripts/server/localServer.mjs` (`startLocalServer`, `injectServerMarker`), `scripts/server/cli.mjs`, `npm run server`,
`tests/server/localServer.test.ts` (7 tests), `_docs/DEPLOYMENT.md` (Node server recommended, Rebex alternative). Not committed.
### Deviations
`startLocalServer` also resolves `dev`, `server` and, from job 40, takes `adminPassword` and `callTimeoutMs`.
### Uncertain
HTTPS with the real pfx and a headset were not tried (no headset); only plain HTTP was exercised (tests and an end-to-end run with headless Edge).
### Not done
-
### Checks
`npx vitest run tests/server/localServer.test.ts`, `npm run typecheck`, `npm test` (147 files passed), `npm run docs:check`, `npm run build`, `npm run smoke -- --world cube` all green.
