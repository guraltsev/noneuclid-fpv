import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Plain ESM script; load through a variable path so tsc does not need declarations.
const modulePath = "../../scripts/server/localServer.mjs";

interface LocalServerModule {
  injectServerMarker(html: string): string;
  startLocalServer(o: { dist: string; host?: string; port?: number }): Promise<{ url: string; port: number; close(): Promise<void> }>;
}
const load = async () => (await import(/* @vite-ignore */ modulePath)) as LocalServerModule;

const MARKER = '<meta name="noneuclid-server" content="/__noneuclid/channel">';
const HTML = "<!doctype html><html><head><title>x</title></head><body></body></html>";

/** GET with the path sent verbatim (fetch would normalise `..`). */
function rawGet(port: number, rawPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("local server", () => {
  let root: string;
  let server: { url: string; port: number; close(): Promise<void> };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "local-server-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "index.html"), HTML);
    fs.writeFileSync(path.join(root, "assets", "a.js"), "export {};");
    const { startLocalServer } = await load();
    server = await startLocalServer({ dist: root, host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("serves index.html with the marker right after <head>", async () => {
    for (const p of ["/", "/index.html"]) {
      const r = await rawGet(server.port, p);
      expect(r.status).toBe(200);
      expect(r.body).toContain(`<head>${MARKER}<title>`);
    }
  });

  it("serves other files with their type and without the marker", async () => {
    const r = await rawGet(server.port, "/assets/a.js");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(r.body).toBe("export {};");
  });

  it("answers 404 for a missing file", async () => {
    expect((await rawGet(server.port, "/nope.js")).status).toBe(404);
  });

  it("never serves files outside dist", async () => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json"]) {
      const r = await rawGet(server.port, p);
      expect([403, 404]).toContain(r.status);
      expect(r.body).not.toContain('"noneuclid-fpv"');
    }
  });

  it("sends Cache-Control: no-store on every response", async () => {
    for (const p of ["/", "/assets/a.js", "/nope.js", "/%2e%2e/package.json"]) {
      expect((await rawGet(server.port, p)).headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("injectServerMarker", () => {
  it("inserts exactly once", async () => {
    const { injectServerMarker } = await load();
    const out = injectServerMarker(HTML);
    expect(out.split(MARKER).length - 1).toBe(1);
    expect(out).toBe(HTML.replace("<head>", `<head>${MARKER}`));
  });

  it("leaves HTML without <head> unchanged", async () => {
    const { injectServerMarker } = await load();
    expect(injectServerMarker("<p>hi</p>")).toBe("<p>hi</p>");
  });
});
