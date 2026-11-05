/**
 * `npm run dev`: starts the vite dev server and, once it is ready, opens the debug Edge of scripts/debug/edge.mjs
 * (remote-debugging port, throwaway profile) on it, so `npm run cdp` can attach (see _docs/interactive-browser-debugging.md).
 *
 *   npm run dev -- [--world cube] [--config full] [--debug-level verbose] [--port 5173] [--cdp-port 9222]
 *
 * The flags are passed on to edge.mjs; `--port` is also the server's port. Press Ctrl+C to stop the server.
 * The old behaviour (vite opens the default browser) is `npm run dev:plain`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 && args[portIndex + 1] ? args[portIndex + 1] : "5173";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const edgeScript = path.join(root, "scripts", "debug", "edge.mjs");

const server = spawn(process.execPath, [viteBin, "--port", port, "--strictPort"], { cwd: root, stdio: ["inherit", "pipe", "inherit"] });

let opened = false;
server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (opened || !chunk.toString().includes("localhost:")) return;
  opened = true;
  spawn(process.execPath, [edgeScript, ...args], { cwd: root, stdio: "inherit" });
});

server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
