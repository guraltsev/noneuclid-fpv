/**
 * Headless-browser smoke test over the Chrome DevTools Protocol.
 *
 * Loads the app at the given URL, waits for it to finish loading, exercises the console debug helpers (which touch the
 * geodesic, portal-debug and geometry code paths) and prints console output and uncaught exceptions. It exits non-zero
 * when an exception was thrown or no canvas was created.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke/browser-smoke.mjs "http://localhost:4173/?config=full&world=cube&debugLevel=verbose" label
 *
 * Environment: BROWSER (path to a Chromium-based browser; defaults to Edge on Windows, else `chromium`), WAIT_MS.
 */
import { spawn } from "node:child_process";

const [url, label] = [process.argv[2], process.argv[3] ?? "run"];
const edge = process.env.BROWSER ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "chromium");
const port = 9300 + Math.floor(Math.random() * 500);
const profile = process.env.TEMP + "/edgeprof-" + label + "-" + port;
const proc = spawn(edge, [
  "--headless=new", "--no-sandbox", "--user-data-dir=" + profile, "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--remote-debugging-port=" + port, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(500);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    logs.push(`[${msg.params.type}] ${text}`.slice(0, 300));
  } else if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ""}`.slice(0, 600));
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(Number(process.env.WAIT_MS ?? 25000));
const evalRes = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `JSON.stringify({
    canvases: document.querySelectorAll('canvas').length,
    loading: !!document.querySelector('.loading-screen'),
    loadingText: document.querySelector('.loading-screen')?.innerText ?? '',
    helpers: Object.keys(window).filter(k => /noneuclid/i.test(k)),
  })`,
});
console.log("PAGE:", evalRes.result?.value);
// poke a few debug helpers to exercise moved code paths
const poke = await send("Runtime.evaluate", {
  returnByValue: true,
  awaitPromise: false,
  expression: `(() => {
    const out = {};
    const g = window;
    for (const key of Object.keys(g)) {
      if (/noneuclid/i.test(key) && typeof g[key] === 'object' && g[key]) out[key] = Object.keys(g[key]);
    }
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
  })()`,
});
console.log("POKE:", poke.result?.value);
await sleep(1500);
console.log("LOGS (" + logs.length + "):");
for (const l of logs.filter((l) => !/geodesic creature dump|geodesic dump|camera pose/i.test(l)).slice(0, 40)) console.log("  " + l);
ws.close();
proc.kill();
const pageInfo = JSON.parse(evalRes.result?.value ?? "{}");
const exceptions = logs.filter((l) => l.startsWith("[EXCEPTION]"));
const failed = exceptions.length > 0 || !pageInfo.canvases || pageInfo.loading;
console.log(failed ? "SMOKE FAILED" : "SMOKE OK");
process.exit(failed ? 1 : 0);
