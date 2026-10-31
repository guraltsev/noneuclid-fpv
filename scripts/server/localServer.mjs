/**
 * Local server for the built app (`dist/`). It serves the site root over HTTPS (or plain HTTP for tests) on the local
 * network, so desktops and headsets can open it, and marks every `index.html` it serves so the page knows it came from
 * this server. GitHub Pages, the Vite dev server and the smoke server never send the marker.
 * It also hosts the channel (a WebSocket at `/__noneuclid/channel`): pages join as devices; an admin, with the admin
 * password, calls functions of the devices' public API (src/runtime/apiCall.ts), and, in dev mode, evaluates
 * expressions.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { contentTypeFor } from "../smoke/staticServer.mjs";

/** The path of the channel WebSocket named by the server marker. */
export const CHANNEL_PATH = "/__noneuclid/channel";

/** Insert the server marker right after `<head>`, once. HTML without `<head>` is returned unchanged. */
export function injectServerMarker(html) {
  const marker = `<meta name="noneuclid-server" content="${CHANNEL_PATH}">`;
  return html.replace(/<head(\s[^>]*)?>/i, (open) => open + marker);
}

const WRONG_PASSWORD_DELAY_MS = 1000;

/** Hash the admin password with a random salt; returns `matches(candidate)` using a constant-time comparison. */
function createPasswordCheck(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return (candidate) => {
    if (typeof candidate !== "string") return false;
    return crypto.timingSafeEqual(crypto.scryptSync(candidate, salt, 32), hash);
  };
}

/**
 * The channel: routes admin requests to devices and device replies back. `attach(server)` hooks the WebSocket upgrade.
 * Devices get ids d1, d2, ... in connection order.
 */
function createChannel({ adminPassword, dev, callTimeoutMs }) {
  const checkPassword = adminPassword ? createPasswordCheck(adminPassword) : undefined;
  const wss = new WebSocketServer({ noServer: true });
  const devices = new Map(); // id -> { id, ws, info, connectedAt, pending: Map, watchers: Set<admin ws> }
  let nextDeviceNumber = 1;
  let nextRequestId = 1;

  const send = (ws, message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  /** Ask one device and resolve with `{ ok, value | error }`. */
  const askDevice = (device, message) =>
    new Promise((resolve) => {
      const id = nextRequestId++;
      const timer = setTimeout(() => {
        device.pending.delete(id);
        resolve({ ok: false, error: "timeout waiting for the device" });
      }, callTimeoutMs);
      device.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply.ok ? { ok: true, value: reply.value } : { ok: false, error: reply.error });
      });
      send(device.ws, { ...message, id });
    });

  const targets = (target) => {
    if (target === "all") return [...devices.values()];
    const device = devices.get(target);
    return device ? [device] : undefined;
  };

  const updateWatching = async (device, watching) => {
    await askDevice(device, { type: "console", on: watching });
  };

  const handleAdmin = async (ws, message) => {
    const reply = (body) => send(ws, { id: message.id, ...body });
    if (message.type === "devices") {
      reply({
        ok: true,
        value: [...devices.values()].map(({ id, info, connectedAt }) => ({ id, info, connectedAt })),
      });
      return;
    }
    const chosen = targets(message.target);
    if (!chosen) {
      reply({ ok: false, error: `no such device: ${message.target}` });
      return;
    }
    if (message.type === "eval" && !dev) {
      reply({ ok: false, error: "eval is disabled; start the server with --dev" });
      return;
    }
    if (message.type === "console") {
      for (const device of chosen) {
        const wasWatched = device.watchers.size > 0;
        if (message.on) device.watchers.add(ws);
        else device.watchers.delete(ws);
        const isWatched = device.watchers.size > 0;
        if (wasWatched !== isWatched) await updateWatching(device, isWatched);
      }
      reply({ ok: true, value: null });
      return;
    }
    if (message.type !== "call" && message.type !== "list" && message.type !== "eval") {
      reply({ ok: false, error: `unknown message type: ${message.type}` });
      return;
    }
    const forward = { type: message.type, path: message.path, args: message.args, expression: message.expression };
    if (message.target === "all") {
      const entries = await Promise.all(chosen.map(async (device) => [device.id, await askDevice(device, forward)]));
      reply({ ok: true, value: Object.fromEntries(entries) });
    } else {
      reply(await askDevice(chosen[0], forward));
    }
  };

  wss.on("connection", (ws) => {
    let role;
    let device;
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (role === undefined) {
        if (message.type !== "hello") return;
        if (message.role === "device") {
          role = "device";
          device = {
            id: `d${nextDeviceNumber++}`,
            ws,
            info: message.info ?? {},
            connectedAt: new Date().toISOString(),
            pending: new Map(),
            watchers: new Set(),
          };
          devices.set(device.id, device);
          send(ws, { type: "hello", ok: true, role, id: device.id });
        } else if (message.role === "admin") {
          if (!checkPassword) {
            send(ws, { type: "hello", ok: false, error: "admin access is disabled (NONEUCLID_ADMIN_PASSWORD is not set)" });
            ws.close();
          } else if (checkPassword(message.password)) {
            role = "admin";
            send(ws, { type: "hello", ok: true, role });
          } else {
            role = "rejected";
            setTimeout(() => {
              send(ws, { type: "hello", ok: false, error: "wrong admin password" });
              ws.close();
            }, WRONG_PASSWORD_DELAY_MS);
          }
        }
        return;
      }
      if (role === "device") {
        if (message.type === "console") {
          for (const admin of device.watchers) {
            send(admin, { type: "console", device: device.id, level: message.level, text: message.text });
          }
        } else if (message.id !== undefined) {
          const resolve = device.pending.get(message.id);
          if (resolve) {
            device.pending.delete(message.id);
            resolve(message);
          }
        }
      } else if (role === "admin") {
        handleAdmin(ws, message).catch((error) => send(ws, { id: message.id, ok: false, error: String(error?.message ?? error) }));
      }
    });
    ws.on("close", () => {
      if (role === "device") {
        devices.delete(device.id);
        for (const resolve of device.pending.values()) resolve({ ok: false, error: "device disconnected" });
        device.pending.clear();
      } else if (role === "admin") {
        for (const other of devices.values()) {
          if (other.watchers.delete(ws) && other.watchers.size === 0) void updateWatching(other, false);
        }
      }
    });
  });

  return {
    attach(server) {
      server.on("upgrade", (req, socket, head) => {
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname !== CHANNEL_PATH) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      });
    },
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

/**
 * Start serving `dist` at the site root. With `pfx` it serves HTTPS, without it plain HTTP.
 * `adminPassword` enables admin connections to the channel (without it they are refused); `dev` allows `eval`.
 * Resolves to `{ url, port, dev, server, close }`.
 */
export function startLocalServer({
  dist = "dist",
  host = "0.0.0.0",
  port = 11446,
  pfx,
  passphrase,
  dev = false,
  adminPassword,
  callTimeoutMs = 30_000,
} = {}) {
  const absRoot = path.resolve(dist);
  const handler = (req, res) => {
    const reply = (status, text) => {
      res.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end(text);
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const rawPath = (req.url ?? "/").split("?")[0].split("#")[0];
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      reply(404, `Not found: ${rawPath}`);
      return;
    }
    let rest = decoded.replace(/^\/+/, "");
    if (rest === "" || rest.endsWith("/")) rest += "index.html";
    const file = path.resolve(absRoot, rest);
    const rel = path.relative(absRoot, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      reply(403, "Forbidden");
      return;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      reply(404, `Not found: ${decoded}`);
      return;
    }
    if (!stat.isFile()) {
      reply(404, `Not found: ${decoded}`);
      return;
    }
    const type = contentTypeFor(file);
    if (rel === "index.html") {
      const body = Buffer.from(injectServerMarker(fs.readFileSync(file, "utf8")), "utf8");
      res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Cache-Control": "no-store" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };
  const secure = pfx !== undefined;
  const server = secure ? https.createServer({ pfx, passphrase }, handler) : http.createServer(handler);
  const channel = createChannel({ adminPassword, dev, callTimeoutMs });
  channel.attach(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        url: `${secure ? "https" : "http"}://${host === "0.0.0.0" ? "localhost" : host}:${actual}/`,
        port: actual,
        dev,
        server,
        close: () =>
          new Promise((r) => {
            channel.close();
            server.close(() => r());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
