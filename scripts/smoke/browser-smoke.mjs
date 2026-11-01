/**
 * Headless-browser smoke test over the Chrome DevTools Protocol.
 *
 * Serves dist/ itself under the build's base path (real 404s, like GitHub Pages), loads one page per world, waits for
 * the loading screen to go away, checks the public API (window.noneuclid.api: app.info() reports the requested
 * world, and the debug namespace is installed), opens and closes the in-scene menu (right click, Escape) and fails
 * on: uncaught exceptions, contained frame errors, the built-in-defaults config fallback, failed requests, a loading
 * error or a stuck loading screen, a missing canvas, or the API check itself failing.
 *
 *   npm run build:pages
 *   npm run smoke -- --world cube,dodecahedron,torus-moduli
 *
 * Flags: --world <id[,id...]> (default cube), --config <name> (default full), --debug-level <off|basic|verbose>,
 *   --dist <dir> (default dist), --url <site-url> (check a running site instead of serving dist/),
 *   --timeout-ms <n> (default 60000), --label <text>.
 * Legacy: node scripts/smoke/browser-smoke.mjs "<full page url>" [label] loads only that page.
 * Environment: BROWSER (path to a Chromium-based browser; defaults to Edge on Windows, else `chromium`).
 */
import fs from "node:fs";
import path from "node:path";
import { collectFailureReasons, createCdpSession, spawnHeadlessBrowser, waitForBrowserPage } from "../lib/cdpClient.mjs";
import { buildPageUrl, parseSmokeArgs } from "./smokeArgs.mjs";
import { detectBaseFromIndexHtml, startStaticServer } from "./staticServer.mjs";

const USAGE = `usage: npm run smoke -- [--world cube,dodecahedron] [--config full] [--debug-level verbose] [--dist dist]
                       [--url https://host/base/] [--timeout-ms 60000] [--label text]
       node scripts/smoke/browser-smoke.mjs "<full page url>" [label]`;

let options;
try {
  options = parseSmokeArgs(process.argv.slice(2));
} catch (error) {
  console.error(`smoke: ${error.message}`);
  console.error(USAGE);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server;
let pages;
if (options.pageUrl) {
  pages = [{ name: options.label, url: options.pageUrl }];
} else {
  let siteUrl = options.siteUrl;
  if (!siteUrl) {
    const indexPath = path.resolve(options.dist, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error(`smoke: ${options.dist}/index.html not found; run "npm run build" first.`);
      process.exit(2);
    }
    const detected = detectBaseFromIndexHtml(fs.readFileSync(indexPath, "utf8"));
    // A relocatable build ("./") is served under a sub-path on purpose, which checks that nothing assumes the root.
    const base = detected.startsWith(".") ? "/smoke/relocated/" : detected;
    server = await startStaticServer({ root: path.resolve(options.dist), base });
    siteUrl = server.siteUrl;
    console.log(`smoke: serving ${options.dist} at ${siteUrl}`);
  }
  pages = options.worlds.map((worldId) => ({
    name: worldId,
    url: buildPageUrl(siteUrl, { configName: options.configName, worldId, debugLevel: options.debugLevel }),
  }));
}

const browserHandle = spawnHeadlessBrowser();

let session;
let failedPages = 0;
try {
  const target = await waitForBrowserPage(browserHandle);
  session = await createCdpSession(target.webSocketDebuggerUrl);
  const { evaluate, send, events } = session;

  const STATE_EXPR = `JSON.stringify({
    canvases: document.querySelectorAll('canvas').length,
    loading: !!document.querySelector('.loading-screen'),
    loadError: !!document.querySelector('.loading-screen-error'),
    loadingText: document.querySelector('.loading-screen')?.innerText ?? '',
  })`;
  // Pokes the public API (window.noneuclid.api), not the retired debug globals: app.info() must report the world
  // this page was asked to load, and the debug namespace (installed once a world has finished loading) must exist.
  const API_CHECK_EXPR = `JSON.stringify({
    info: window.noneuclid?.api?.app?.info ? window.noneuclid.api.app.info() : undefined,
    hasDebugNamespace: typeof window.noneuclid?.api?.debug === 'object',
  })`;

  for (const page of pages) {
    events.reset();
    console.log(`\n=== ${page.name}: ${page.url}`);
    await session.navigate(page.url);

    let state = {};
    const started = Date.now();
    while (Date.now() - started < options.timeoutMs) {
      await sleep(500);
      try {
        state = JSON.parse((await evaluate(STATE_EXPR)) ?? "{}");
      } catch {
        state = {};
      }
      if (state.loadError || (state.canvases > 0 && !state.loading)) break;
    }
    const ready = state.canvases > 0 && !state.loading && !state.loadError;

    const reasons = [];
    if (ready) {
      await sleep(3000);
      let apiCheck = {};
      try {
        apiCheck = JSON.parse((await evaluate(API_CHECK_EXPR)) ?? "{}");
      } catch (error) {
        reasons.push(`window.noneuclid.api check failed: ${error.message}`);
      }
      console.log("API:", apiCheck);
      if (!apiCheck.hasDebugNamespace) reasons.push("window.noneuclid.api.debug is not installed");
      // options.pageUrl (the legacy single-URL form) carries no expected world id to compare against.
      if (!options.pageUrl && apiCheck.info?.worldId !== page.name) {
        reasons.push(`api.app.info() reports worldId "${apiCheck.info?.worldId}", expected "${page.name}"`);
      }

      const rect = JSON.parse(
        (await evaluate(`JSON.stringify((() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)) ?? "{}",
      );
      const mouse = { button: "right", clickCount: 1, x: rect.x ?? 100, y: rect.y ?? 100 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouse.x, y: mouse.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
      await sleep(1000);
      const escape = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...escape });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...escape });
      await sleep(1000);
    }

    reasons.push(...collectFailureReasons(events, { loadState: state, timeoutMs: options.timeoutMs }));

    for (const e of events.exceptions) console.log("  [EXCEPTION] " + e);
    const shown = events.consoleLines;
    console.log(`CONSOLE (${shown.length}):`);
    for (const l of shown.slice(0, 40)) console.log(`  [${l.type}] ${l.text}`);
    for (const r of events.failedRequests) console.log("  FAILED REQUEST: " + r);
    if (reasons.length > 0) {
      failedPages++;
      console.log(`SMOKE FAILED ${page.name}: ${reasons.join("; ")}`);
    } else {
      console.log(`SMOKE OK ${page.name}`);
    }
  }
  console.log(failedPages === 0 ? `\nSMOKE OK (${pages.length} page(s))` : `\nSMOKE FAILED (${failedPages} of ${pages.length} page(s))`);
} catch (error) {
  console.error(`smoke: ${error.message}`);
  failedPages = failedPages || 1;
} finally {
  try { session?.close(); } catch {}
  browserHandle.close();
  if (server) await server.close();
  await sleep(500);
}
process.exit(failedPages === 0 ? 0 : 1);
