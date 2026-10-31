/**
 * Command line for the local server: `npm run server -- [--dist dir] [--host h] [--port n] [--pfx file] [--http] [--dev]`.
 * The pfx passphrase comes from NONEUCLID_PFX_PASSPHRASE (default: the local test setting of _docs/DEPLOYMENT.md).
 */
import fs from "node:fs";
import os from "node:os";
import { startLocalServer } from "./localServer.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);

const dist = opt("--dist", "dist");
const host = opt("--host", "0.0.0.0");
const port = Number(opt("--port", "11446"));
const pfxFile = opt("--pfx", "wwwserver/server-certificate.pfx");
const http = flag("--http");
const dev = flag("--dev");
const passphrase = process.env.NONEUCLID_PFX_PASSPHRASE ?? "my-super-secure-password";

if (!fs.existsSync(dist)) {
  console.error(`The folder "${dist}" does not exist. Run "npm run build" first.`);
  process.exit(1);
}
let pfx;
if (http) {
  console.warn("Warning: serving plain HTTP. Headsets need HTTPS (WebXR requires a secure context).");
} else {
  if (!fs.existsSync(pfxFile)) {
    console.error(`Certificate "${pfxFile}" not found. See "Local HTTPS server for a headset" in _docs/DEPLOYMENT.md, or use --http.`);
    process.exit(1);
  }
  pfx = fs.readFileSync(pfxFile);
}

const adminPassword = process.env.NONEUCLID_ADMIN_PASSWORD || undefined;
const server = await startLocalServer({ dist, host, port, pfx, passphrase, dev, adminPassword });
const scheme = pfx ? "https" : "http";
console.log(`Serving ${dist} (dev mode ${dev ? "on" : "off"}) at:`);
console.log(
  adminPassword
    ? "Admin access to the channel is on (NONEUCLID_ADMIN_PASSWORD)."
    : "Admin access to the channel is OFF: set NONEUCLID_ADMIN_PASSWORD to enable it.",
);
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) console.log(`  ${scheme}://${a.address}:${server.port}/`);
  }
}
console.log(`  ${scheme}://localhost:${server.port}/`);
