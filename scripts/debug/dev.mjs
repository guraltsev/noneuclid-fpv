/**
 * `npm run dev`: starts the vite dev server, warms it up, and only then opens the debug Edge of scripts/debug/edge.mjs
 * (remote-debugging port, throwaway profile) on it, so `npm run cdp` can attach (see _docs/interactive-browser-debugging.md).
 *
 *   npm run dev -- [--world cube] [--config full] [--debug-level verbose] [--port 5173] [--cdp-port 9222]
 *
 * Vite compiles modules on request, so a browser opened as soon as the server listens sits on a long, half-loaded page.
 * Warming up means requesting the page and crawling its module graph (static and literal dynamic imports) from
 * /src/main.ts over HTTP, which makes vite pre-bundle the dependencies and transform every module; the browser then
 * loads from vite's cache. The crawl is retried when vite re-optimizes dependencies mid-crawl (HTTP 504).
 *
 * The flags are passed on to edge.mjs; `--port` is also the server's port. Press Ctrl+C to stop the server.
 * The old behaviour (vite opens the default browser at once) is `npm run dev:plain`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 && args[portIndex + 1] ? args[portIndex + 1] : "5173";
const origin = `http://localhost:${port}`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const edgeScript = path.join(root, "scripts", "debug", "edge.mjs");

const server = spawn(process.execPath, [viteBin, "--port", port, "--strictPort"], { cwd: root, stdio: ["inherit", "pipe", "inherit"] });

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from "y", export * from "y"
  /\bimport\s*["']([^"']+)["']/g, // import "y"
  /\bimport\(\s*["']([^"']+)["']\s*\)/g, // import("y")
];

/** Requests every module reachable from the entry; returns the number of modules and whether any came back 504. */
async function crawl() {
  const seen = new Set();
  let outdated = false;
  const visit = async (url) => {
    if (seen.has(url)) return;
    seen.add(url);
    const response = await fetch(url).catch(() => null);
    if (!response) return;
    if (response.status === 504) outdated = true;
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    // Pre-bundled dependencies are compiled as a whole; their text can also contain import-like strings.
    if (!response.ok || !type.includes("javascript") || new URL(url).pathname.startsWith("/node_modules/")) return;
    const children = new Set();
    for (const pattern of IMPORT_PATTERNS)
      for (const match of body.matchAll(pattern)) {
        const child = new URL(match[1], url);
        if (child.origin === origin) children.add(child.href);
      }
    await Promise.all([...children].map(visit));
  };
  await fetch(`${origin}/`).then((r) => r.text()).catch(() => {});
  await Promise.all([`${origin}/@vite/client`, `${origin}/src/main.ts`].map(visit));
  return { count: seen.size, outdated };
}

async function warmUp() {
  const started = Date.now();
  console.log("[dev] warming up vite (compiling the module graph) before opening the browser...");
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { count, outdated } = await crawl();
    if (!outdated) {
      console.log(`[dev] ${count} modules ready in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return;
    }
    console.log(`[dev] vite re-optimized dependencies; crawling again (attempt ${attempt + 1})`);
  }
}

let opened = false;
server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (opened || !chunk.toString().includes("localhost:")) return;
  opened = true;
  warmUp()
    .catch((error) => console.warn(`[dev] warm-up failed (${error.message}); opening the browser anyway`))
    .finally(() => spawn(process.execPath, [edgeScript, ...args], { cwd: root, stdio: "inherit" }));
});

server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
