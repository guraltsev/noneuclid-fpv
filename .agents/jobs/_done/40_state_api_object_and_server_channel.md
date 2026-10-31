# Job 40 - The public API object, the server channel, and `npm run cdp` for any device

Status: done, needs review on 2026-10-31.
Resolves: -. Implements stage S1 of [design 012](../../_docs/design/012-engine-api.md) (section 6).

**Priority:** comes right after job 39, before every other queued job (maintainer, 2026-10-31).

## Goal

1. A **public API object**, `window.noneuclid.api`, whose functions are calls on the app's state. It is the first
   slice of the engine API of design 012. Today its functions wrap the existing debug helpers.
2. A **channel** between pages served by the local server (job 39) and that server, over WebSockets, so an **admin**
   (password) can call any function of any connected device's API, or of all devices at once.
3. **`npm run cdp` with a second backend**: besides desktop Edge over the DevTools Protocol (as today), any device
   through the server, with the same subcommands plus `devices`, `call` and `help`.

Agreed in design 012 (2026-10-31): there is nothing remote about the calls, they are calls on the state, and the
network is only one transport; all public functions are exposed; no registry: a call is a literal function call on the
API object; the admin interface is a command-line tool like `npm run cdp`.

## Depends on

Job 39.

## Before you start

Read `.agents/knowledge/index.md` and its notes. Read design 012, section 6 (S1 and its agreed points) and P5 (two
deployment modes, admin password). Read `src/main.ts` (`startApp`, `restartApp`: changing world or config disposes the
app and creates a new one), `src/render/three/appDebugHelpers.ts` (the three console APIs and their install/uninstall
functions) and where `createThreeApp.ts` installs them (`installGeneralDebugHelpers`, around line 1229 and 1967;
`installGeometryDebugHelpersIfAvailable`, around line 1885; uninstall on dispose, around line 2140). Read
`scripts/debug/cdp.mjs` and `_docs/interactive-browser-debugging.md`.

## Background

- The app exposes three console APIs: `window.noneuclidDebug` (general helpers, under snake_case and PascalCase names,
  including `placeObjectAt`), `window.noneuclidPortalDebug` (portal paths, camera pose, live `state` getter) and
  `window.noneuclidGeometry` (torus skew, only in torus-skew worlds). `npm run smoke` pokes these; they must keep
  working.
- Changing world, config or reloading restarts the app (`main.ts` `restartApp`), so anything that must survive (the
  API object, the channel) lives at the `main.ts` level; per-run functions are installed and removed with each app.
- Layer rules (`scripts/docs/lib.mjs`): `runtime` and `glue` may import each other; `root` (`main.ts`) may import
  anything; `glue` may not import `render`.
- Some debug results contain `Map`s and typed arrays, which do not survive JSON.

## Decisions

### The API object

1. **Shape.** `window.noneuclid = { api }`, created once in `main.ts`. `api` is a plain object of namespaces of
   functions; only functions are called, never properties:
   - `api.app` (installed by `main.ts`, survives restarts): `info()` returns
     `{ worldId, configName, userAgent, xrPresenting }`; `changeWorld(worldId)`, `changeConfig(configName)`,
     `reload()` call the existing `main.ts` restart paths.
   - `api.debug` (installed by `createThreeApp`, removed on dispose): `dumpGeodesicCreatures()`, `dumpAllGeodesics()`,
     `dumpGeodesicPath(geodesicId?)`, `dumpLockedGeodesicWords()`, `placeObjectAt(id, cellId, x, y, yawDegrees)`,
     each wrapping the existing callback (one camelCase name each, no snake_case duplicates).
   - `api.portal` (same lifetime): `checkCellPath(text)`, `showCellPath(text)`, `hideCellPaths()`,
     `dumpCameraPose()`, `state()` (returns what the `state` getter returns). Not `candidateTables` or `staticCull`
     (too large).
   - `api.geometry` (same lifetime, only when the torus-skew helpers are installed): `setTorusSkew(m)`,
     `stepTorusSkew(dm)`, `cancel()`, `state()`.
   - `api.view` (same lifetime): `screenshot()` renders one frame and returns `canvas.toDataURL("image/jpeg", 0.85)`
     in the same call; while presenting in XR it throws `Error("screenshot is not available while presenting in XR")`.
2. **Keep the old globals** (`window.noneuclidDebug`, `noneuclidPortalDebug`, `noneuclidGeometry`) unchanged; the new
   namespaces are installed and uninstalled next to them.
3. **Dispatch** is a pure module `src/runtime/apiCall.ts` (header comment and JSDoc as `docs:check` requires):
   - `callApi(api, path: readonly string[], args: readonly unknown[]): Promise<unknown>` walks `path` through own
     properties of plain objects, calls the function with `args`, awaits the result and returns `toPlainData(result)`.
     Errors: unknown path segment, a non-function at the end, a path segment `__proto__`, `prototype` or `constructor`
     (`Error("no such API function: a.b")` and similar).
   - `listApi(api)` returns the nested names (`{ app: ["changeConfig", ...], ... }`), sorted.
   - `toPlainData(value)`: `Map` with all-string keys to an object, other `Map` to an array of `[key, value]`; `Set`
     to an array; typed arrays to arrays; `Error` to `{ name, message }`; functions dropped; a cycle throws
     `Error("result is not plain data (cycle)")`; plain objects, arrays and primitives kept.

### The channel

4. **Protocol**: JSON messages over a WebSocket at `/__noneuclid/channel` on the job-39 server (`ws` package, added as
   a dev dependency; Node has no WebSocket server built in). Why WebSocket (maintainer agreed, 2026-10-31): the server
   must push calls to devices; Server-Sent Events plus HTTP POST would suffice for S1 without a dependency, but
   presence (S2) and the shared world (S4) send many messages per second in both directions, which WebSocket carries
   on one connection. Every request carries an `id`; every reply carries the
   same `id` and either `{ ok: true, value }` or `{ ok: false, error }`.
   - device to server: `{ type: "hello", role: "device", info }` with `info = api.app.info()`;
     `{ type: "console", level, text }` while console forwarding is on; replies to calls.
   - admin to server: `{ type: "hello", role: "admin", password }`; then `{ type: "devices" }`;
     `{ type: "call", target, path, args }` with `target` a device id or `"all"`; `{ type: "list", target }`;
     `{ type: "eval", target, expression }`; `{ type: "console", target, on }`.
   - server to device: `call`, `list`, `eval`, `console` (on or off), each with an `id`.
5. **Devices** get server-assigned ids `d1`, `d2`, ... in connection order; `devices` returns
   `[{ id, info, connectedAt }]`. For `target: "all"` the reply value is `{ [deviceId]: { ok, value | error } }`.
6. **Admin password** from the environment variable `NONEUCLID_ADMIN_PASSWORD` when the server starts. The server keeps
   only a scrypt hash with a random salt and compares with `crypto.timingSafeEqual`. If the variable is unset, admin
   connections are refused (the server prints this at start). A wrong password: wait one second, reply with an error,
   close. Devices need no password.
7. **Eval** (arbitrary expressions) is refused by the server unless it was started with `--dev` (job 39's flag). On the
   device, `eval` runs `(0, eval)(expression)`, awaits it and returns `toPlainData` of the result.
8. **Console forwarding**: when an admin turns it on for a device, the device forwards `console.log/info/warn/error`
   (arguments joined, each stringified, truncated to 2000 characters) until it is turned off or the admin
   disconnects; the original console output is unchanged.
9. **Page side**: `src/glue/serverChannel.ts` exports `startServerChannel({ api, socketFactory?, location?, document? })`.
   It connects only if `document` has `<meta name="noneuclid-server">`, using `wss:` (or `ws:` for `http:` pages) to
   the meta's `content` on the page's host; reconnects with a delay that doubles from 1 s up to 30 s; answers `call`
   and `list` with `callApi`/`listApi` and `eval` as in Decision 7. `socketFactory` (default `url => new WebSocket(url)`)
   is injectable for tests. `main.ts` creates `window.noneuclid` and calls `startServerChannel` once in `startApp`.

### The command-line tool

10. **`scripts/debug/cdp.mjs` gets a server backend**, chosen by `--server <url>` or the environment variable
    `NONEUCLID_SERVER` (for example `wss://192.168.1.50:11446`); it needs `NONEUCLID_ADMIN_PASSWORD`. Without them,
    the tool behaves exactly as today (DevTools Protocol). New and changed subcommands:
    - `devices`: lists device ids and info (DevTools backend: the one attached page).
    - `call <path> [args...]`: each argument is parsed as JSON, or taken as a string if it is not valid JSON; prints
      the JSON result. DevTools backend: evaluates `noneuclid.api.<path>(...args)` in the page.
    - `help [path]`: prints `listApi` (DevTools backend: evaluated in the page).
    - `eval`, `console`, `shot`, `record` keep their meaning; on the server backend they take `--device <id>`
      (required when more than one device is connected; `call` also accepts `--device all`). `shot` uses
      `api.view.screenshot` and writes the decoded JPEG; `record` polls `call` (or `eval` in dev mode) every 100 ms.
11. **Self-signed certificates**: `--ca <file>` trusts that certificate; without it the tool accepts the server's
    certificate and prints a one-line warning.

## Steps

Part A, the API object (no network).

1. Baseline: `npm run typecheck`, `npm test`.
2. `src/runtime/apiCall.ts` with `callApi`, `listApi`, `toPlainData` (Decision 3); tests in
   `tests/runtime/apiCall.test.ts`: nested call, async function awaited, unknown path, non-function, forbidden segments,
   `listApi` sorted, each `toPlainData` rule, cycle error.
3. `main.ts`: create `window.noneuclid.api` with `api.app` (Decision 1). `createThreeApp`: install `api.debug`,
   `api.portal`, `api.geometry` (when available) and `api.view` where the old globals are installed, and remove them
   on dispose. Keep the old globals (Decision 2).
4. `npm run build` and `npm run smoke -- --world cube`; check in the dev server's console that
   `noneuclid.api.app.info()` and `noneuclid.api.debug.dumpAllGeodesics()` work.

Part B, the channel.

5. Add `ws` as a dev dependency. Extend `scripts/server/localServer.mjs` with the channel (Decisions 4 to 8), keeping
   its exports from job 39.
6. `src/glue/serverChannel.ts` (Decision 9) and its call in `main.ts`; tests in `tests/glue/serverChannel.test.ts`
   with a fake socket: no connection without the meta; answers `call`, `list`, `eval`; reconnect delay doubles and
   caps at 30 s.
7. Server tests in `tests/server/channel.test.ts` (plain HTTP server from job 39, `ws` clients standing in for a device
   and an admin): admin with a wrong or missing password is rejected; `devices` lists a connected device; a `call` to
   one device and to `"all"` is routed and answered; `eval` is refused without `dev` and allowed with it; console
   forwarding is relayed only while on.

Part C, the command-line tool and documentation.

8. Server backend in `scripts/debug/cdp.mjs` (Decisions 10, 11), and `call` and `help` for the DevTools backend.
9. Documentation: `_docs/interactive-browser-debugging.md` gets a section on the server backend (start the server,
   connect a device, `devices`, `call`, `help`, `--device`, dev mode); `_docs/DEPLOYMENT.md` mentions
   `NONEUCLID_ADMIN_PASSWORD`.

## Tests and checks

The test files named in the steps; then `npm run typecheck`, `npm test`, `npm run docs:check` (run
`npm run docs:generate` if generated documents are stale), `npm run build`, `npm run smoke -- --world cube` (must stay
green: the smoke server sends no marker, so no channel starts).

End-to-end on the desktop: `npm run build`, start `npm run server -- --http --dev` with `NONEUCLID_ADMIN_PASSWORD`
set, open the printed address in a browser, then `npm run cdp -- --server ws://localhost:11446 devices`,
`... call app.info`, `... call debug.dumpAllGeodesics`, `... shot out.jpg`. Record the outputs in the report.

Manual, if a headset is available: the same over HTTPS with the Quest connected; `call app.changeWorld '"cube"'`
switches the headset's world. Record under `### Uncertain` if not done.

## Do not

- Do not remove or rename the existing console globals.
- Do not expose module internals: only the `api` object is reachable through `callApi`.
- Do not add argument validation or a call registry; the design chose literal calls.
- Do not start a channel on pages without the server marker.

## Done when

`window.noneuclid.api` exists with the namespaces of Decision 1, a page served by the local server appears in
`npm run cdp -- devices`, `call`, `help`, `shot` and (in dev mode) `eval` work through the server, the DevTools backend
also supports `call` and `help`, all tests and checks are green, and the two documents describe the new workflow.

## Report

### Done
`src/runtime/apiCall.ts` (`callApi`, `listApi`, `toPlainData`), `src/runtime/publicApi.ts` (holder of `window.noneuclid.api`), `src/glue/serverChannel.ts`, namespaces `app` (main.ts), `debug`, `portal`, `geometry`, `view` (installed and removed next to the old globals), the channel in `scripts/server/localServer.mjs` (`ws` and `@types/ws` as dev dependencies), the server backend plus `devices`/`call`/`help` in `scripts/debug/cdp.mjs`, tests (`tests/runtime/apiCall.test.ts`, `tests/glue/serverChannel.test.ts`, `tests/server/channel.test.ts`), documentation in `_docs/interactive-browser-debugging.md` (section 3a) and `_docs/DEPLOYMENT.md`. Generated docs regenerated. Not committed.
End-to-end (headless Edge, `npm run server -- --http --dev`, port 11447): `devices` listed `d1`; `call app.info` returned the world and config; `help` listed `app`, `debug`, `portal`, `view`; `call debug.dumpAllGeodesics` returned the dump; `eval "1+2"` gave `3`; `shot` wrote a 31 KB JPEG.
### Deviations
`listApi` lists functions directly on the API object under the key `""`, and nested objects under dotted keys. `record` on the server backend treats a dotted identifier as a call path and anything else as an `eval` expression (the job left this open). `startServerChannel` also accepts `setTimer` (for tests) and returns `{ enabled, close }`.
### Uncertain
The DevTools backend's new `call` and `help` were not run against Edge. `app.changeWorld` over the channel and the headset (Quest, HTTPS) were not tried. `placeObjectAt` and `geometry` namespaces were not called.
### Not done
-
### Checks
New test files pass (27 tests plus 7 for the channel page side); `npm run typecheck`, `npm test` (147 files passed), `npm run docs:check`, `npm run build`, `npm run smoke -- --world cube` green.
