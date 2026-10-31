/**
 * Debug tool for the running app, with two backends (see _docs/interactive-browser-debugging.md).
 *
 * DevTools backend (default): attaches to the page opened by scripts/debug/edge.mjs over the Chrome DevTools Protocol.
 * Server backend: `--server <url>` (or NONEUCLID_SERVER, for example wss://192.168.1.50:11446) talks to any device
 * connected to the local server (scripts/server/localServer.mjs); needs NONEUCLID_ADMIN_PASSWORD.
 *
 *   npm run cdp -- devices
 *   npm run cdp -- call <path> [args...]       e.g. call app.changeWorld '"cube"'; args are JSON, else strings
 *   npm run cdp -- help [path]
 *   npm run cdp -- eval "<expression>"         (server backend: needs the server started with --dev)
 *   npm run cdp -- shot <file.jpg|file.png>
 *   npm run cdp -- console [seconds]
 *   npm run cdp -- record "<expression or call path>" [seconds]
 *
 * Options (server backend): --device <id> (required with several devices; `call` also takes `all`), --ca <file>
 * (trust that certificate; otherwise the server's certificate is accepted with a warning).
 * Environment (DevTools backend): CDP_PORT (default 9222), CDP_MATCH (substring of the page url, default "localhost:").
 */
import fs from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const USAGE = `usage: npm run cdp -- [--server <url>] [--device <id>|all] [--ca <file>] devices | call <path> [args...] | help [path] | eval "<expression>" | shot <file> | console [seconds] | record "<expression|path>" [seconds]`;
const COMMANDS = ["devices", "call", "help", "eval", "shot", "console", "record"];

/** Parse an argument as JSON, or take it as a string if it is not valid JSON. */
function parseArgument(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Reduce the nested listing `{ namespace: [names] }` to what falls under `path` (dotted), if given. */
function filterListing(listing, path) {
  if (!path) return listing;
  const result = {};
  for (const [namespace, names] of Object.entries(listing)) {
    if (namespace === path || namespace.startsWith(`${path}.`)) result[namespace] = names;
    else if (names.includes(path.split(".").pop()) && namespace === path.split(".").slice(0, -1).join(".")) {
      result[namespace] = [path.split(".").pop()];
    }
  }
  return result;
}

/** Decode a `data:image/...;base64,` URL to bytes. */
function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) throw new Error("not a data URL");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

// ---- DevTools backend ----

async function attachDevTools() {
  const port = process.env.CDP_PORT ?? 9222;
  const match = process.env.CDP_MATCH ?? "localhost:";
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    console.error(`nothing listens on ${port}; run "npm run edge" first.`);
    process.exit(2);
  }
  const target = targets.find((t) => t.type === "page" && t.url.includes(match));
  if (!target) {
    console.error("no page matching", match, "among", targets.map((t) => t.url));
    process.exit(2);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const listExpression = `(() => {
    const out = {};
    const visit = (o, p) => {
      for (const k of Object.keys(o).sort()) {
        const v = o[k];
        if (typeof v === "function") (out[p] ??= []).push(k);
        else if (v && typeof v === "object") visit(v, p ? p + "." + k : k);
      }
    };
    visit(noneuclid.api, "");
    return out;
  })()`;
  return {
    name: "devtools",
    async devices() {
      return [{ id: target.id, info: { url: target.url, title: target.title } }];
    },
    async call(path, args) {
      return evaluate(`noneuclid.api.${path.join(".")}(...${JSON.stringify(args)})`);
    },
    async list() {
      return evaluate(listExpression);
    },
    evaluate: (expression) => evaluate(expression),
    async screenshot(file) {
      const png = file.endsWith(".png");
      const { data } = await send("Page.captureScreenshot", png ? { format: "png" } : { format: "jpeg", quality: 70 });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    async streamConsole(seconds, print) {
      listeners.push((m) => {
        if (m.method === "Runtime.consoleAPICalled") {
          print(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
        } else if (m.method === "Runtime.exceptionThrown") {
          print("[exception]", (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
        }
      });
      await send("Runtime.enable");
      await sleep(seconds * 1000);
    },
    async record(expression, seconds, print) {
      // Evaluates the expression once per animation frame while you move and prints only the frames where it changed.
      await evaluate(`(() => {
        window.__rec = [];
        let n = 0;
        const stop = performance.now() + ${seconds * 1000};
        const tick = () => {
          let v;
          try { v = JSON.stringify((${expression})); } catch (e) { v = "ERR " + e.message; }
          window.__rec.push([n++, v]);
          if (performance.now() < stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
      })()`);
      await sleep(seconds * 1000 + 500);
      const frames = await evaluate("window.__rec");
      let last;
      for (const [n, value] of frames) {
        if (value !== last) {
          print(n, value);
          last = value;
        }
      }
      print("frames:", frames.length);
    },
    close: () => ws.close(),
  };
}

// ---- Server backend ----

async function attachServer({ url, device, ca }) {
  const password = process.env.NONEUCLID_ADMIN_PASSWORD;
  if (!password) {
    console.error("the server backend needs NONEUCLID_ADMIN_PASSWORD.");
    process.exit(2);
  }
  const { default: WebSocketClient } = await import("ws");
  const base = url.replace(/^http/, "ws").replace(/\/$/, "");
  const secure = base.startsWith("wss:");
  if (secure && !ca) {
    console.warn("warning: accepting the server's certificate without checking it (use --ca <file> to trust one).");
  }
  const ws = new WebSocketClient(`${base}/__noneuclid/channel`, secure ? (ca ? { ca: fs.readFileSync(ca) } : { rejectUnauthorized: false }) : {});
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  const consoleListeners = [];
  let helloResolve;
  const hello = new Promise((resolve) => (helloResolve = resolve));
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "hello") helloResolve(message);
    else if (message.type === "console") for (const listener of consoleListeners) listener(message);
    else if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  ws.send(JSON.stringify({ type: "hello", role: "admin", password }));
  const helloReply = await hello;
  if (!helloReply.ok) {
    console.error(helloReply.error);
    ws.close();
    process.exit(2);
  }
  const request = (message) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (reply) => (reply.ok ? resolve(reply.value) : reject(new Error(reply.error))));
      ws.send(JSON.stringify({ ...message, id }));
    });
  const devices = () => request({ type: "devices" });
  const resolveDevice = async (allowAll = false) => {
    if (device === "all" && allowAll) return "all";
    if (device) return device;
    const list = await devices();
    if (list.length === 0) throw new Error("no device is connected to the server.");
    if (list.length > 1) throw new Error(`several devices are connected (${list.map((d) => d.id).join(", ")}); pass --device <id>.`);
    return list[0].id;
  };
  return {
    name: "server",
    devices,
    async call(path, args, { allowAll = false } = {}) {
      return request({ type: "call", target: await resolveDevice(allowAll), path, args });
    },
    async list() {
      return request({ type: "list", target: await resolveDevice() });
    },
    async evaluate(expression) {
      return request({ type: "eval", target: await resolveDevice(), expression });
    },
    async screenshot(file) {
      const dataUrl = await request({ type: "call", target: await resolveDevice(), path: ["view", "screenshot"], args: [] });
      fs.writeFileSync(file, decodeDataUrl(dataUrl));
    },
    async streamConsole(seconds, print) {
      const target = await resolveDevice(true);
      consoleListeners.push((m) => print(`[${m.device} ${m.level}]`, m.text));
      await request({ type: "console", target, on: true });
      await sleep(seconds * 1000);
      await request({ type: "console", target, on: false });
    },
    async record(expression, seconds, print) {
      // A dotted identifier is a call path; anything else is an expression (dev mode).
      const isPath = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(expression);
      const stop = Date.now() + seconds * 1000;
      let last;
      let n = 0;
      while (Date.now() < stop) {
        let value;
        try {
          value = JSON.stringify(isPath ? await this.call(expression.split("."), []) : await this.evaluate(expression));
        } catch (error) {
          value = `ERR ${error.message}`;
        }
        if (value !== last) {
          print(n, value);
          last = value;
        }
        n += 1;
        await sleep(100);
      }
      print("samples:", n);
    },
    close: () => ws.close(),
  };
}

// ---- Commands ----

async function run(backend, command, args, flags) {
  const print = (...parts) => console.log(...parts);
  try {
    if (command === "devices") {
      print(JSON.stringify(await backend.devices(), null, 2));
    } else if (command === "call") {
      const [path, ...rest] = args;
      const result = await backend.call(path.split("."), rest.map(parseArgument), { allowAll: flags.device === "all" });
      print(JSON.stringify(result, null, 2));
    } else if (command === "help") {
      print(JSON.stringify(filterListing(await backend.list(), args[0]), null, 2));
    } else if (command === "eval") {
      const value = await backend.evaluate(args[0]);
      print(typeof value === "string" ? value : JSON.stringify(value));
    } else if (command === "shot") {
      await backend.screenshot(args[0]);
      print("wrote", args[0]);
    } else if (command === "console") {
      await backend.streamConsole(Number(args[0] ?? 10), print);
    } else if (command === "record") {
      await backend.record(args[0], Number(args[1] ?? 10), print);
    }
  } finally {
    backend.close();
  }
}

/** Split `--server`, `--device`, `--ca` out of the arguments. */
function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (["--server", "--device", "--ca"].includes(argv[i])) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}

const { flags, rest } = parseFlags(process.argv.slice(2));
const [command, ...args] = rest;
const needsArgument = ["call", "eval", "shot", "record"].includes(command);
if (COMMANDS.includes(command) && (!needsArgument || args[0])) {
  const server = flags.server ?? process.env.NONEUCLID_SERVER;
  try {
    const backend = server
      ? await attachServer({ url: server, device: flags.device, ca: flags.ca })
      : await attachDevTools();
    await run(backend, command, args, flags);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  console.error(USAGE);
  process.exitCode = 2;
}
