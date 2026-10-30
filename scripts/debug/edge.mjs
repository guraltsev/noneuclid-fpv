/**
 * Opens a Chromium-based browser (Edge on Windows) on the dev server with a remote-debugging port and a throwaway
 * profile, for scripts/debug/cdp.mjs to attach to (see _docs/interactive-browser-debugging.md).
 *
 *   npm run edge -- [--world cube] [--config full] [--debug-level verbose] [--port 5173] [--cdp-port 9222]
 *
 * The profile directory is deleted on start, so every run begins clean. Environment: BROWSER (browser path).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const browser =
  process.env.BROWSER ??
  (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "chromium");
const profile = path.join(os.tmpdir(), "noneuclid-edge-debug");
fs.rmSync(profile, { recursive: true, force: true });

const url = `http://localhost:${flag("port", 5173)}/?config=${flag("config", "full")}&world=${flag("world", "cube")}&debugLevel=${flag("debug-level", "verbose")}`;
spawn(
  browser,
  [`--remote-debugging-port=${flag("cdp-port", 9222)}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", url],
  { detached: true, stdio: "ignore" },
).unref();
console.log(`opened ${url} with debugging port ${flag("cdp-port", 9222)}; do not sign in to anything in that window.`);
