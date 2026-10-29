# Job 04 - Local browser smoke coverage

Status: queued.
Former issue: 36 (converted to a job on 2026-10-28).
Resolves: no open issue.

Priority: P1 release confidence.

## Goal

Make `npm run smoke` a dependable local release check. It serves the built `dist/` under the same base path that
GitHub Pages uses, with real 404s, and loads several worlds in a headless Chromium-based browser. It fails on uncaught
exceptions, contained frame errors, failed requests, a stuck or failed loading screen, or a missing canvas. It also
exercises the right-click menu. It takes the world and options as separate arguments, so no URL with `&` has to pass
through cmd.exe. Document it, and add a manual headset checklist.

## Depends on

Job 03, for `npm run build:pages -- --base <name>` and the base-path documentation in `_docs/DEPLOYMENT.md`.
Job 02 is not required, but after it `dist/` is about 27 MB smaller, so runs load faster.

## Before you start

Read:

- `.agents/jobs/README.md`: the rules for the implementing model and the `## Report` format.
- `scripts/smoke/browser-smoke.mjs` (all, 99 lines).
- `src/main.ts:40-56` and `:58-148` (start-up, loading screen and error path).
- `src/glue/loadingStatus.ts:27-82` (the `loading-screen` and `loading-screen-error` classes).
- `src/glue/readLaunchOptions.ts:51-80` (URL parameters `world`, `debugLevel`, ...), `src/glue/appConfig.ts:115-160`
  (`config` parameter and the warning on a failed config load).
- `src/render/three/createThreeApp.ts:1225-1257` (frame-error reporting), `:1845-1847` (desktop listeners),
  `:2153-2186` (right-click and Escape), `:3225-3237` (`openContextMenuFromAim`).
- `src/render/three/desktopScenePaletteInput.ts:134-142` (`reduceDesktopScenePaletteToggle`).
- `src/authoring/worldCatalog.ts:33-48` (world ids).
- `tests/docs/documentation.test.ts:1-15`: how a test imports a plain `.mjs` script without type errors.
- `_docs/DEVELOPMENT.md:36-50`, `_docs/testing.md:79-82`, `_docs/DEPLOYMENT.md` ("Check a build locally first" and
  "HTTPS and WebXR", as rewritten by job 03), `_docs/acceptance-checklists.md:84-98`.

Baseline (record results under `### Checks`):

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. Check that a Chromium-based browser exists. On Windows the script
defaults to `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` (`browser-smoke.mjs:16`), which exists on
the owner's machine. If you have none, do every step anyway, and record under `### Not done` that the browser runs
were not possible.

## Background

### The current smoke script

`scripts/smoke/browser-smoke.mjs` uses only Node built-ins and the global `fetch`/`WebSocket` of Node 24 (the
project runs Node 24.22). It drives the browser over the Chrome DevTools Protocol (CDP); there is no Playwright.
`package.json` has `"smoke": "node scripts/smoke/browser-smoke.mjs"`.

- `:15`: arguments are positional: `const [url, label] = [process.argv[2], process.argv[3] ?? "run"];`.
- `:16`: browser from env `BROWSER`, else Edge on Windows, else `chromium`.
- `:17-22`: a random debugging port 9300-9799, and a profile dir `process.env.TEMP + "/edgeprof-" + label + "-" + port`
  that is never deleted (`TEMP` is undefined on Linux). The browser is spawned with
  `--headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --remote-debugging-port=<port> about:blank`.
- `:24-35`: polls `http://127.0.0.1:<port>/json` up to 40 x 500 ms, then opens the page's WebSocket. If no page
  appears, `targets` is undefined and the script crashes, leaving the browser running.
- `:39-51`: collects `Runtime.consoleAPICalled` (as `[type] text`) and `Runtime.exceptionThrown` (as `[EXCEPTION] ...`).
- `:53-56`: enables `Runtime` and `Page`, navigates, then sleeps a fixed `WAIT_MS` (default 25 s).
- `:57-66`: reads the canvas count, whether `.loading-screen` exists, and its text.
- `:67-89`: calls the debug helpers `noneuclidDebug.DumpAllGeodesics()` etc. inside `try`, printing results.
- `:95-99`: fails if there was any exception, no canvas, or a loading screen still present.

It does not enable the `Network` domain, so it cannot see failed requests. It never presses a key or clicks.

### Why it misses missing assets today

The documented run (`_docs/DEVELOPMENT.md:42-47`) serves the build with `npx vite preview`. Vite preview answers
**200 with the HTML fallback page** for a missing file. Verified 2026-10-28: `GET /noneuclid-fpv/assets/nope.glb`
returned `200 text/html`. A missing model therefore shows up only as a confusing loader error, not as a 404. Vite
preview also needs `VITE_BASE` set at preview time to serve a subpath build (see job 03). GitHub Pages returns a real
404. So the smoke run should use its own small static server that behaves like Pages.

### The `&` problem on Windows

On Windows, `npm run smoke -- "<url with &>"` and the Volta `node` shim both go through cmd.exe, which cuts the
argument at the first `&`. The run then silently uses the default world. If the script builds the URL itself from
separate arguments (`--world cube --config full`), no `&` ever appears on a command line.

### What the page exposes

- The loading screen is a `div.loading-screen` (`src/glue/loadingStatus.ts:33`). It is removed when the app is
  ready (`main.ts:137`). On failure it stays, gains the class `loading-screen-error`
  (`loadingStatus.ts:75-77`), and shows `Could not load world: <message>`. `main.ts:145` also logs
  `console.error(error)`.
- A contained frame error is logged as ``console.error(`[noneuclid] frame error in ${phase}; the loop continues.`, error)``
  (`createThreeApp.ts:1239`). After 30 failed frames in a row, the app logs
  `[noneuclid] 30 frames in a row failed; ending any immersive session.` (`:1248-1251`). These do not appear as
  uncaught exceptions, because job 01 contains them, so the smoke script must look for them in the console.
- If the app config fails to load, the app falls back silently, with
  `console.warn("[noneuclid] using built-in defaults; unable to load app config", error)` (`appConfig.ts:134`).
- URL parameters: `config` (`appConfig.ts:140-143`), `world` (`readLaunchOptions.ts:57`; ids in
  `worldCatalog.ts:33-42`, for example `cube`, `dodecahedron`, `torus-moduli`), and `debugLevel` (`off`, `basic`
  or `verbose`; `readLaunchOptions.ts:76-77`). The app removes them from the visible address after reading them
  (`main.ts:34`).
- The menu is a 3D palette inside the WebGL scene, not DOM. A right mouse button press on the canvas opens it
  (`createThreeApp.ts:2157-2168` -> `openContextMenuFromAim`, `:3225-3237`). Escape closes it
  (`:2170-2185`; `reduceDesktopScenePaletteToggle` returns `"close"` when open, `"none"` when closed). Both
  listeners are on `window` (`:1845`, `:1847`). Nothing in the DOM or on `window` shows whether the palette is open,
  so the smoke run can only check that opening and closing it throws nothing.
- Job 01's report (`_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md`, "Closing evidence")
  lists two checks it could not automate: ending an XR session after persistent frame failure, and
  `renderer.info.memory` returning to baseline after create/dispose/create. The renderer is not reachable from
  `window`, and headless Chromium has no XR device.

### How tests import `.mjs` scripts

`tsconfig.json` includes only `src` and `tests`, so a static import of a `.mjs` file fails `tsc`. Use the pattern in
`tests/docs/documentation.test.ts:4-13`:

```ts
const modulePath = "../../scripts/smoke/staticServer.mjs";
const load = async () => (await import(/* @vite-ignore */ modulePath)) as StaticServerModule;
```

Declare a small TypeScript interface for the functions you call.

## Decisions

1. **Serve `dist/` from the smoke script.** Decided: by default the script serves `dist/` itself, with a small
   `node:http` server on `127.0.0.1` and a free port. It uses the base path read from `dist/index.html`, returns
   real 404s, and has no HTML fallback. Why: this matches GitHub Pages, catches missing files, needs no second
   terminal, and the base always matches the build. Alternative considered: keep `vite preview` and treat `text/html`
   answers for non-HTML URLs as missing (indirect, and needs `VITE_BASE` at preview time).
2. **Arguments.** Decided: named flags: `--world <id[,id...]>` (default `cube`), `--config <name>` (default `full`),
   `--debug-level <off|basic|verbose>` (default: not sent), `--dist <dir>` (default `dist`), `--url <site-url>` (use
   an already running site such as `https://guraltsev.github.io/noneuclid-fpv/` instead of serving `dist/`),
   `--timeout-ms <n>` (default 60000) and `--label <text>` (default `smoke`). The old form
   `node scripts/smoke/browser-smoke.mjs "<full page url>" [label]` keeps working: a first argument that does not
   start with `--` is a full page URL, and only that one page is loaded. Why: no `&` on any command line, and old
   notes keep working. Alternative considered: a config file.
3. **Default worlds in the documentation.** Decided: document `--world cube,dodecahedron,torus-moduli` as the
   release check. Why: job 01's verification used these three, and they cover a flat cube, a hyperbolic gluing and
   the deformable torus. Alternative considered: all ten worlds (slow).
4. **Failure rules.** Decided: a world fails if any of these happen:
   - an uncaught exception;
   - a console message containing `[noneuclid] frame error` or `frames in a row failed`;
   - a console message containing `[noneuclid] using built-in defaults`;
   - a request that ends with HTTP status >= 400, or a `Network.loadingFailed` that is not `canceled`, except URLs
     ending in `/favicon.ico`;
   - `.loading-screen-error` appears;
   - the loading screen is still present after `--timeout-ms`;
   - no `canvas` element.
   Other console errors and warnings are printed but do not fail the run. Why: these are the signals the app emits
   for broken start-up, broken frames and missing assets. Alternative considered: fail on every `console.error`
   (WebGL and SwiftShader print harmless errors).
5. **Ready detection.** Decided: poll every 500 ms until there is a canvas and no `.loading-screen`, or until
   `.loading-screen-error` appears, or until the timeout. Then wait 3000 ms more, so a few hundred frames run before
   the checks. Why: replaces the fixed 25 s wait, and is faster when the app is quick. Alternative considered: a
   ready flag in `src/` (a source change for a test).
6. **Menu interaction.** Decided: after the app is ready, dispatch a right mouse press and release at the canvas
   centre over CDP (`Input.dispatchMouseEvent`), wait 1000 ms, dispatch Escape (`Input.dispatchKeyEvent`,
   keyDown/keyUp), and wait 1000 ms. The pass condition is only that the failure rules above still hold. Why: the
   palette state is not observable from the page (see Background). Alternative considered: expose the menu state on
   `window` (a source change; out of scope).
7. **Job 01 leftovers.** Decided: do not automate either check in this job. Record the XR persistent-failure check
   as "not covered" in the headset checklist. Mention the `renderer.info.memory` check in the job report under
   `### Not done`. Why: both need a test hook in `src/` (and the XR one needs a headset). Alternative considered: add
   a `noneuclidDebug` helper that returns `renderer.info.memory` (the owner can order that as a separate job).
8. **No CI.** Decided: the smoke run is manual, before a release or after risky changes. It is not added to
   `.githooks/pre-push` (it needs a build and a browser, about a minute per world). Why: the owner gates pushes
   locally with typecheck and tests only, and does not use GitHub CI. Alternative considered: a pull-request
   workflow (rejected by the owner on 2026-10-28).
9. **Headset checklist location.** Decided: a new section at the end of `_docs/acceptance-checklists.md`. Why: that
   file already holds the manual stage checklists. Alternative considered: a new document.

## Steps

1. **Argument parser.** New file `scripts/smoke/smokeArgs.mjs` (plain ESM, leading comment). Exports:
   - `parseSmokeArgs(argv)`, where `argv` is `process.argv.slice(2)`. It returns
     `{ pageUrl, siteUrl, dist, configName, worlds, debugLevel, timeoutMs, label }`:
     - If `argv[0]` exists and does not start with `--`: `pageUrl = argv[0]`, `label = argv[1] ?? "smoke"`, and
       `worlds = []`; the other fields take their defaults. Return.
     - Otherwise read the flags of Decision 2. Each takes the next element as its value, and `--flag=value` also
       works. `worlds` is the comma-split, trimmed, non-empty list. `timeoutMs` is `Number(...)` and must be a
       positive integer. `--url` sets `siteUrl`; add a trailing `/` if missing.
     - Throw `Error` with a clear message on an unknown flag, a flag without a value, a `--debug-level` other than
       `off`, `basic` or `verbose`, or a bad `--timeout-ms`.
   - `buildPageUrl(siteUrl, { configName, worldId, debugLevel })`. It does `const url = new URL(siteUrl)`, then
     `url.searchParams.set("config", configName)`, `url.searchParams.set("world", worldId)`, and, if `debugLevel` is
     set, `url.searchParams.set("debugLevel", debugLevel)`. It returns `url.toString()`.
   - New test `tests/smoke/smokeArgs.test.ts`:
     - `[]` gives `worlds: ["cube"]`, `configName: "full"`, `dist: "dist"`, `timeoutMs: 60000`, `label: "smoke"`,
       and `debugLevel`, `siteUrl` and `pageUrl` all `undefined`;
     - `["--world", "cube, dodecahedron,torus-moduli"]` gives the three ids;
     - `["--world=torus", "--debug-level", "verbose"]` works;
     - `["--url", "https://example.org/x"]` gives `siteUrl: "https://example.org/x/"`;
     - `["http://h/?config=full&world=cube", "lbl"]` gives that `pageUrl` and `label: "lbl"`;
     - `["--nope"]`, `["--world"]`, `["--debug-level", "loud"]` and `["--timeout-ms", "0"]` each throw;
     - `buildPageUrl("http://127.0.0.1:5000/noneuclid-fpv/", { configName: "full", worldId: "cube", debugLevel: "verbose" })`
       equals `"http://127.0.0.1:5000/noneuclid-fpv/?config=full&world=cube&debugLevel=verbose"`.
   - Check: `npx vitest run tests/smoke/smokeArgs.test.ts` passes.

2. **Static server.** New file `scripts/smoke/staticServer.mjs` (plain ESM, leading comment). Exports:
   - `detectBaseFromIndexHtml(html)` returns the part of the first `<script ... src="...">` value before `assets/`.
     Use the regex `/<script[^>]*\ssrc="([^"]*?)assets\/[^"]*"/`. Return `"/"` if there is no match.
     Examples: `src="/noneuclid-fpv/assets/index-x.js"` gives `/noneuclid-fpv/`; `src="/assets/index-x.js"` gives `/`.
   - `contentTypeFor(filePath)`, a lookup by lowercase extension:

     | Extensions | Content type |
     | --- | --- |
     | `.html` | `text/html; charset=utf-8` |
     | `.js`, `.mjs` | `text/javascript; charset=utf-8` |
     | `.css` | `text/css; charset=utf-8` |
     | `.json` | `application/json` |
     | `.wasm` | `application/wasm` |
     | `.glb` | `model/gltf-binary` |
     | `.gltf` | `model/gltf+json` |
     | `.bin` | `application/octet-stream` |
     | `.png` | `image/png` |
     | `.jpg`, `.jpeg` | `image/jpeg` |
     | `.svg` | `image/svg+xml` |
     | `.ktx2` | `image/ktx2` |
     | `.txt` | `text/plain; charset=utf-8` |
     | `.md` | `text/markdown; charset=utf-8` |
     | anything else | `application/octet-stream` |

   - `startStaticServer({ root, base, host = "127.0.0.1", port = 0 })` returns a promise of
     `{ siteUrl, close }`. `siteUrl` is `http://<host>:<actual port><base>`, and `close()` returns a promise that
     resolves when the server has closed. For each request:
     - Only `GET` and `HEAD`; others get 405.
     - Take the path part (drop `?...`) and `decodeURIComponent` it. Answer 404 if decoding throws or the path does
       not start with `base`.
     - Strip `base`. An empty rest, or one ending in `/`, means that folder's `index.html`.
     - Resolve against `root`. Answer 404 if the resolved path is outside `root` (`path.relative(root, file)` starts
       with `..` or is absolute).
     - Answer 404 if the file does not exist or is a directory.
     - Otherwise answer 200 with `contentTypeFor` and the file body (no body for `HEAD`). Add
       `Cache-Control: no-store`.
     - A 404 has `Content-Type: text/plain` and the body `Not found: <path>`.
   - New test `tests/smoke/staticServer.test.ts`. In `beforeEach`, create a temporary root with
     `fs.mkdtempSync(path.join(os.tmpdir(), "smoke-server-"))` containing `index.html` (with
     `<script type="module" src="/base-x/assets/a.js"></script>`), `assets/a.js` and `assets/model.glb`. Start the
     server with `base: "/base-x/"`. In `afterEach`, `await close()` and remove the folder. Assert with `fetch`:
     - `detectBaseFromIndexHtml` on that HTML gives `/base-x/`, and on `<script src="/assets/a.js">` gives `/`;
     - `GET <siteUrl>` gives 200 `text/html...`;
     - `GET <siteUrl>?config=full&world=cube` gives 200 `text/html...`;
     - `assets/a.js` gives 200 `text/javascript...`, and `assets/model.glb` gives `model/gltf-binary`;
     - `assets/missing.glb` gives 404;
     - `http://127.0.0.1:<port>/other/` gives 404;
     - `<siteUrl>%2e%2e/%2e%2e/etc/passwd` gives 404;
     - a `POST` gives 405.
   - Check: `npx vitest run tests/smoke/staticServer.test.ts` passes.

3. **Rewrite `scripts/smoke/browser-smoke.mjs`.** Keep the CDP approach and the browser flags of `:19-22`. Replace
   the header comment with the new usage (the commands in step 5). Structure:
   - Parse arguments with `parseSmokeArgs`. On error, print `smoke: <message>` and the usage, then exit 2.
   - Work out the pages to visit:
     - if `pageUrl` is set: the single page `{ name: label, url: pageUrl }`;
     - else if `siteUrl` is set: one page per world, built with `buildPageUrl(siteUrl, ...)`;
     - else read `<dist>/index.html` (resolved from the current directory). If it is missing, print
       `smoke: <dist>/index.html not found; run "npm run build:pages -- --base <name>" or "npm run build" first.`
       and exit 2. Otherwise `detectBaseFromIndexHtml`, `startStaticServer({ root: <dist>, base })`, print
       `smoke: serving <dist> at <siteUrl>`, and build one page per world.
   - Profile folder: `fs.mkdtempSync(path.join(os.tmpdir(), "noneuclid-smoke-"))`.
   - Wrap everything after the browser spawn in `try { ... } finally { ... }`. The `finally` closes the WebSocket,
     kills the browser, awaits the server `close()`, and removes the profile folder with
     `fs.rmSync(profile, { recursive: true, force: true })` inside its own `try/catch` (Edge may still hold files).
   - If no page target appears after 40 polls, throw `Error("browser did not start: <browser path>")`. Do not
     crash on `undefined`.
   - After connecting, send `Runtime.enable`, `Page.enable` and `Network.enable`.
   - Collect into per-page arrays, reset before each navigation:
     - `exceptions` from `Runtime.exceptionThrown`;
     - `consoleLines` from `Runtime.consoleAPICalled`, keeping the type;
     - `failedRequests` from `Network.responseReceived` with `params.response.status >= 400` (URL and status) and
       from `Network.loadingFailed` with `!params.canceled`. For the URL, keep a `requestId -> url` map filled from
       `Network.requestWillBeSent`. Skip URLs ending in `/favicon.ico`.
   - For each page:
     1. `Page.navigate`.
     2. Poll every 500 ms with `Runtime.evaluate` (`returnByValue: true`) of
        `JSON.stringify({ canvases: document.querySelectorAll('canvas').length, loading: !!document.querySelector('.loading-screen'), loadError: !!document.querySelector('.loading-screen-error'), loadingText: document.querySelector('.loading-screen')?.innerText ?? '' })`.
        Stop when `loadError`, or when `canvases > 0 && !loading`, or after `timeoutMs`.
     3. If ready, sleep 3000 ms, then run the existing debug-helper poke (old `:67-89`) and print its result.
     4. If ready, run the menu interaction of Decision 6. Get the canvas centre from
        `document.querySelector('canvas').getBoundingClientRect()`. Send `Input.dispatchMouseEvent` with
        `type: "mouseMoved"`, then `"mousePressed"` and `"mouseReleased"`, each with `button: "right"`,
        `clickCount: 1`, `x`, `y`. Sleep 1000 ms. Send `Input.dispatchKeyEvent` with `type: "keyDown"`, then
        `"keyUp"`, each with `key: "Escape"`, `code: "Escape"`, `windowsVirtualKeyCode: 27`. Sleep 1000 ms.
     5. Apply the failure rules of Decision 4. Print up to 40 console lines (filter the dump noise as old `:92`
        does), every failed request, and then either `SMOKE OK <name>` or `SMOKE FAILED <name>: <reason>; <reason>`.
   - At the end print `SMOKE OK (<n> page(s))` or `SMOKE FAILED (<k> of <n> page(s))`, and exit 0 or 1.
   - Check: `node --check scripts/smoke/browser-smoke.mjs` succeeds. `npm run typecheck` and `npm test` pass.

4. **Run it.** In Git Bash:

   ```sh
   npm run build:pages -- --base noneuclid-fpv
   npm run smoke -- --world cube,dodecahedron,torus-moduli
   ```

   All three must print `SMOKE OK`. Then prove that the checks bite, without committing anything:
   - Rename one used model, for example `mv dist/assets/rover/rover.glb dist/assets/rover/rover.glb.off`. Run
     `npm run smoke -- --world cube`. It must fail and list a 404 for `rover.glb`. Rename it back.
   - Run `npm run smoke -- --world cube --config does-not-exist`. It must fail with the `using built-in defaults`
     rule, or with a 404 for `does-not-exist.config.js`.

   Record every output summary under `### Checks`. If the good run fails because of a real app problem (not the
   script), do not fix the app: record the failing world and messages under `### Uncertain` and continue. If a
   failure rule fires on noise you believe is harmless, do not loosen the rule silently: record it under
   `### Uncertain` with the exact message. Finally run `npm run build` to put `dist/` back to base `/`.

5. **Documentation.**
   - `_docs/DEVELOPMENT.md:36-50`: replace the smoke paragraph and code block with:

     ```sh
     npm run build:pages -- --base noneuclid-fpv
     npm run smoke -- --world cube,dodecahedron,torus-moduli
     ```

     Explain:
     - the script serves `dist/` itself under the build's base path, with real 404s like GitHub Pages;
     - list the failure rules (Decision 4) in one sentence each;
     - list the flags of Decision 2;
     - `BROWSER` selects the browser;
     - `--url https://guraltsev.github.io/noneuclid-fpv/` checks the live site;
     - because the script builds the URL itself, no `&` is needed on the command line.
   - `_docs/testing.md:79-82` ("Browser Smoke Tests"): replace the Playwright sentence. Browser smoke tests are
     `scripts/smoke/browser-smoke.mjs` (CDP, no Playwright). They check start-up and integration only, never
     mathematical correctness, and run by hand (see `DEVELOPMENT.md`).
   - `_docs/DEPLOYMENT.md`: in "Publishing a change", add an optional step before pushing a release:
     `npm run build:pages -- --base noneuclid-fpv` then `npm run smoke -- --world cube,dodecahedron,torus-moduli`.
     After a deploy, the live site can be checked with `npm run smoke -- --url https://guraltsev.github.io/noneuclid-fpv/ --world cube`.
     Also link the headset checklist from "HTTPS and WebXR".
   - `_docs/acceptance-checklists.md`: append a section `## Headset smoke checklist (manual)` with:
     - a line `Latest run: none recorded. Record as: <date>, <device and browser>, <commit>, <URL>, <result>.`
     - these checks:
       - the site opens under its deployment URL;
       - `?config=001` loads;
       - Enter VR is offered and works;
       - 30 s of looking and walking without stutter;
       - walking through one portal;
       - opening the palette with a controller, firing one geodesic, and closing the palette;
       - exiting VR returns to the desktop view;
       - reloading the page and entering VR again.
     - a "Not covered" line: ending an XR session after repeated frame failures (job 01) needs a test hook and is
       not checked.
   - `.agents/jobs/README.md`, rule 7 ("Windows shell"): add that `npm run smoke` now takes `--world`/`--config`
     flags, so no URL with `&` is needed.
   - Check: `npm run docs:check` passes.

## Tests and checks

- New: `tests/smoke/smokeArgs.test.ts` and `tests/smoke/staticServer.test.ts` (the cases in steps 1 and 2).
- No existing tests change.
- Commands (Git Bash):

  ```sh
  npm run typecheck
  npm test
  npm run docs:check
  node --check scripts/smoke/browser-smoke.mjs
  npm run build:pages -- --base noneuclid-fpv
  npm run smoke -- --world cube,dodecahedron,torus-moduli     # expect SMOKE OK (3 page(s))
  npm run smoke -- --world cube --config does-not-exist       # expect SMOKE FAILED
  npm run build
  ```

## Do not

- Do not add Playwright, Puppeteer or any other dependency. Use Node built-ins and CDP only.
- Do not add a GitHub Actions workflow, and do not add the smoke run to `.githooks/pre-push`.
- Do not change anything under `src/` (no ready flag, no menu-state hook, no renderer hook). If you believe one is
  needed, write it under `### Uncertain`.
- Do not "fix" the app if a world fails the smoke run. Record it.
- Do not loosen a failure rule just to get `SMOKE OK`.
- Do not leave a renamed or deleted file in `dist/`. Rebuild at the end.
- Do not commit `dist/`, browser profiles or temporary folders.
- Do not change `scripts/build-pages.mjs` or `vite.config.ts`.

## Done when

- [ ] Steps 1-5 are done, or each skipped step is explained under `### Not done`.
- [ ] `npm run typecheck`, `npm test` and `npm run docs:check` pass.
- [ ] The good smoke run prints `SMOKE OK (3 page(s))`, and both bite tests fail as expected. If no browser was
      available, this is recorded under `### Not done`.
- [ ] `src/` is unchanged, so `npm run docs:generate` is not needed. If you did change `src/`, run it and explain
      under `### Deviations`.
- [ ] No issue to close: this job resolves no open issue.
- [ ] This file is moved to `.agents/jobs/_done/04_local_browser_smoke_coverage.md`, and its relative links are
      fixed. Its `Status:` line reads `Status: done on <date>.` if `### Uncertain` and `### Not done` are empty,
      otherwise `Status: done, needs review on <date>.` (`### Not done` will at least mention the
      `renderer.info.memory` check of Decision 7. That is expected, so the status is "needs review".)
- [ ] A `## Report` section is appended with these subsections:
  - `### Done`: what changed, with files and commit hashes;
  - `### Deviations`: where the work differs from the steps, and why;
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them;
  - `### Not done`: anything skipped, and why;
  - `### Checks`: the commands run and their results, including failures and the smoke summaries.
- [ ] The job 04 row in `.agents/jobs/README.md` links to `_done/04_...`, and its title is struck through and marked
      `(done)` or `(done, needs review)`.
- [ ] Everything is committed. Each message ends with the co-author line the repository uses.

## History

Converted from issue 36 on 2026-10-28. That day the owner decided against GitHub CI. The tracked pre-push hook
(`.githooks/pre-push`, installed by `scripts/setup-git-hooks.mjs` from `npm install` or `npm run setup:hooks`, with
LF line endings kept by `.gitattributes`) runs `npm run typecheck` and `npm test`. The old items "pull-request
workflow" and "pull requests receive required statuses" are superseded by the hook. Production deployment is
already limited to `main`: `.github/workflows/deploy-pages.yml` runs on push to `main` and manual dispatch only.
Since commit 64b3797 it runs no tests. The manual CDP smoke script was added in commit d2ee130 and used for job 01's
verification.
