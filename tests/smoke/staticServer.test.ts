import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Plain ESM script; load through a variable path so tsc does not need declarations.
const modulePath = "../../scripts/smoke/staticServer.mjs";

interface StaticServerModule {
  detectBaseFromIndexHtml(html: string): string;
  startStaticServer(o: { root: string; base: string }): Promise<{ siteUrl: string; close(): Promise<void> }>;
}
const load = async () => (await import(/* @vite-ignore */ modulePath)) as StaticServerModule;

const HTML = '<html><script type="module" src="/base-x/assets/a.js"></script></html>';

describe("static smoke server", () => {
  let root: string;
  let server: { siteUrl: string; close(): Promise<void> };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-server-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "index.html"), HTML);
    fs.writeFileSync(path.join(root, "assets", "a.js"), "export {};");
    fs.writeFileSync(path.join(root, "assets", "model.glb"), "glb");
    server = await (await load()).startStaticServer({ root, base: "/base-x/" });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects the base", async () => {
    const { detectBaseFromIndexHtml } = await load();
    expect(detectBaseFromIndexHtml(HTML)).toBe("/base-x/");
    expect(detectBaseFromIndexHtml('<script src="/assets/a.js">')).toBe("/");
  });

  it("serves files with content types", async () => {
    let r = await fetch(server.siteUrl);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    r = await fetch(server.siteUrl + "?config=full&world=cube");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    r = await fetch(server.siteUrl + "assets/a.js");
    expect(r.headers.get("content-type")).toMatch(/^text\/javascript/);
    r = await fetch(server.siteUrl + "assets/model.glb");
    expect(r.headers.get("content-type")).toBe("model/gltf-binary");
  });

  it("answers 404 and 405 like Pages", async () => {
    expect((await fetch(server.siteUrl + "assets/missing.glb")).status).toBe(404);
    const origin = new URL(server.siteUrl).origin;
    expect((await fetch(origin + "/other/")).status).toBe(404);
    expect((await fetch(server.siteUrl + "%2e%2e/%2e%2e/etc/passwd")).status).toBe(404);
    expect((await fetch(server.siteUrl, { method: "POST" })).status).toBe(405);
  });
});
