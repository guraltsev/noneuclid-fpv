/**
 * Small static file server for the smoke script. It behaves like GitHub Pages: files only under `base`, real 404s for
 * anything missing, and no HTML fallback.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/** Return the base path (for example `/noneuclid-fpv/`) a built index.html was made for. */
export function detectBaseFromIndexHtml(html) {
  const match = /<script[^>]*\ssrc="([^"]*?)assets\/[^"]*"/.exec(html);
  return match ? match[1] : "/";
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ktx2": "image/ktx2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function contentTypeFor(filePath) {
  return TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Start serving `root` under `base`. Resolves to `{ siteUrl, close }`. */
export function startStaticServer({ root, base, host = "127.0.0.1", port = 0 }) {
  const absRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    const notFound = (p) => {
      res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end(`Not found: ${p}`);
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const rawPath = (req.url ?? "/").split("?")[0].split("#")[0];
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      notFound(rawPath);
      return;
    }
    if (!decoded.startsWith(base)) {
      notFound(decoded);
      return;
    }
    let rest = decoded.slice(base.length);
    if (rest === "" || rest.endsWith("/")) rest += "index.html";
    const file = path.resolve(absRoot, rest);
    const rel = path.relative(absRoot, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      notFound(decoded);
      return;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      notFound(decoded);
      return;
    }
    if (!stat.isFile()) {
      notFound(decoded);
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(file), "Content-Length": stat.size, "Cache-Control": "no-store" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        siteUrl: `http://${host}:${actual}${base}`,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
