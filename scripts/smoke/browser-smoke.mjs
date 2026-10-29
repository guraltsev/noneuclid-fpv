/**
 * Headless-browser smoke test over the Chrome DevTools Protocol.
 *
 * Serves dist/ itself under the build's base path (real 404s, like GitHub Pages), loads one page per world, waits for
 * the loading screen to go away, pokes the console debug helpers, opens and closes the in-scene menu (right click,
 * Escape) and fails on: uncaught exceptions, contained frame errors, the built-in-defaults config fallback, failed
 * requests, a loading error or a stuck loading screen, or a missing canvas.
 *
 *   npm run build:pages -- --base noneuclid-fpv
 *   npm run smoke -- --world cube,dodecahedron,torus-moduli
 *
 * Flags: --world <id[,id...]> (default cube), --config <name> (default full), --debug-level <off|basic|verbose>,
 *   --dist <dir> (default dist), --url <site-url> (check a running site instead of serving dist/),
 *   --timeout-ms <n> (default 60000), --label <text>.
 * Legacy: node scripts/smoke/browser-smoke.mjs "<full page url>" [label] loads only that page.
 * Environment: BROWSER (path to a Chromium-based browser; defaults to Edge on Windows, else `chromium`).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
      console.error(`smoke: ${options.dist}/index.html not found; run "npm run build:pages -- --base <name>" or "npm run build" first.`);
      process.exit(2);
    }
    const base = detectBaseFromIndexHtml(fs.readFileSync(indexPath, "utf8"));
    server = await startStaticServer({ root: path.resolve(options.dist), base });
    siteUrl = server.siteUrl;
    console.log(`smoke: serving ${options.dist} at ${siteUrl}`);
  }
  pages = options.worlds.map((worldId) => ({
    name: worldId,
    url: buildPageUrl(siteUrl, { configName: options.configName, worldId, debugLevel: options.debugLevel }),
  }));
}

const browser = process.env.BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "chromium");
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "noneuclid-smoke-"));
const proc = spawn(browser, [
  "--headless=new", "--no-sandbox", "--user-data-dir=" + profile, "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--remote-debugging-port=" + port, "about:blank",
], { stdio: "ignore" });
proc.on("error", () => {});

let ws;
let failedPages = 0;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = targets.find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(500);
  }
  if (!target) throw new Error("browser did not start: " + browser);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  let exceptions = [];
  let consoleLines = [];
  let failedRequests = [];
  const requestUrls = new Map();
  const isIgnoredUrl = (url) => !url || url.endsWith("/favicon.ico");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
      return;
    }
    const p = msg.params;
    switch (msg.method) {
      case "Runtime.consoleAPICalled": {
        const text = p.args.map((a) => a.value ?? a.description ?? "").join(" ");
        consoleLines.push({ type: p.type, text: text.slice(0, 300) });
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails;
        exceptions.push(`${d.text} ${d.exception?.description ?? ""}`.slice(0, 600));
        break;
      }
      case "Network.requestWillBeSent":
        requestUrls.set(p.requestId, p.request.url);
        break;
      case "Network.responseReceived":
        if (p.response.status >= 400 && !isIgnoredUrl(p.response.url)) failedRequests.push(`${p.response.status} ${p.response.url}`);
        break;
      case "Network.loadingFailed":
        if (!p.canceled) {
          const url = requestUrls.get(p.requestId);
          if (!isIgnoredUrl(url)) failedRequests.push(`failed ${url} (${p.errorText})`);
        }
        break;
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { returnByValue: true, expression })).result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");

  const STATE_EXPR = `JSON.stringify({
    canvases: document.querySelectorAll('canvas').length,
    loading: !!document.querySelector('.loading-screen'),
    loadError: !!document.querySelector('.loading-screen-error'),
    loadingText: document.querySelector('.loading-screen')?.innerText ?? '',
  })`;
  const POKE_EXPR = `(() => {
    const out = {};
    const g = window;
    const tryCall = (label, fn) => { try { const v = fn(); out[label] = v === undefined ? 'ok' : (typeof v === 'object' ? 'ok:' + Object.keys(v).length : String(v)); } catch (e) { out[label] = 'ERR ' + e; } };
    tryCall('dumpAll', () => g.noneuclidDebug.DumpAllGeodesics());
    tryCall('dumpPath', () => g.noneuclidDebug.DumpGeodesicPath());
    tryCall('dumpLocked', () => g.noneuclidDebug.DumpLockedGeodesicWords());
    tryCall('dumpCreatures', () => g.noneuclidDebug.DumpGeodesicCreatures());
    tryCall('cameraPose', () => g.noneuclidPortalDebug?.DumpCameraPose());
    tryCall('portalState', () => g.noneuclidPortalDebug?.state);
    tryCall('hideCellPaths', () => g.noneuclidPortalDebug?.HideCellPaths());
    tryCall('geometryState', () => g.noneuclidGeometry?.state);
    return JSON.stringify(out);
  })()`;

  for (const page of pages) {
    exceptions = [];
    consoleLines = [];
    failedRequests = [];
    requestUrls.clear();
    console.log(`\n=== ${page.name}: ${page.url}`);
    await send("Page.navigate", { url: page.url });

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

    if (ready) {
      await sleep(3000);
      console.log("POKE:", await evaluate(POKE_EXPR));
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

    const reasons = [];
    if (exceptions.length > 0) reasons.push(`${exceptions.length} uncaught exception(s)`);
    const frameErrors = consoleLines.filter((l) => /\[noneuclid\] frame error|frames in a row failed/.test(l.text));
    if (frameErrors.length > 0) reasons.push(`${frameErrors.length} contained frame error message(s)`);
    if (consoleLines.some((l) => l.text.includes("[noneuclid] using built-in defaults"))) reasons.push("app config failed to load (built-in defaults used)");
    if (failedRequests.length > 0) reasons.push(`${failedRequests.length} failed request(s)`);
    if (state.loadError) reasons.push(`loading error: ${state.loadingText}`);
    else if (state.loading) reasons.push(`loading screen still present after ${options.timeoutMs} ms`);
    if (!state.canvases) reasons.push("no canvas");

    for (const e of exceptions) console.log("  [EXCEPTION] " + e);
    const shown = consoleLines.filter((l) => !/geodesic creature dump|geodesic dump|camera pose/i.test(l.text));
    console.log(`CONSOLE (${shown.length}):`);
    for (const l of shown.slice(0, 40)) console.log(`  [${l.type}] ${l.text}`);
    for (const r of failedRequests) console.log("  FAILED REQUEST: " + r);
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
  try { ws?.close(); } catch {}
  proc.kill();
  if (server) await server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(failedPages === 0 ? 0 : 1);
