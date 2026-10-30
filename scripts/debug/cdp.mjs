/**
 * Attaches to the page opened by scripts/debug/edge.mjs over the Chrome DevTools Protocol (see
 * _docs/interactive-browser-debugging.md).
 *
 *   npm run cdp -- eval "<expression>"
 *   npm run cdp -- shot <file.jpg|file.png>
 *   npm run cdp -- console [seconds]
 *   npm run cdp -- record "<expression>" [seconds]
 *
 * Environment: CDP_PORT (default 9222), CDP_MATCH (substring of the page url, default "localhost:").
 */
import fs from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const USAGE = `usage: npm run cdp -- eval "<expression>" | shot <file> | console [seconds] | record "<expression>" [seconds]`;
async function attach() {
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
  return { ws, send, evaluate, listeners };
}

async function run(command, args) {
  const { ws, send, evaluate, listeners } = await attach();
  try {
    if (command === "eval") {
      console.log(await evaluate(args[0]));
    } else if (command === "shot") {
      const png = args[0].endsWith(".png");
      const { data } = await send("Page.captureScreenshot", png ? { format: "png" } : { format: "jpeg", quality: 70 });
      fs.writeFileSync(args[0], Buffer.from(data, "base64"));
      console.log("wrote", args[0]);
    } else if (command === "console") {
      listeners.push((m) => {
        if (m.method === "Runtime.consoleAPICalled") {
          console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
        } else if (m.method === "Runtime.exceptionThrown") {
          console.log("[exception]", (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
        }
      });
      await send("Runtime.enable");
      await sleep(Number(args[0] ?? 10) * 1000);
    } else if (command === "record") {
      // Evaluates the expression once per animation frame while you move and prints only the frames where it changed.
      const seconds = Number(args[1] ?? 10);
      await evaluate(`(() => {
        window.__rec = [];
        let n = 0;
        const stop = performance.now() + ${seconds * 1000};
        const tick = () => {
          let v;
          try { v = JSON.stringify((${args[0]})); } catch (e) { v = "ERR " + e.message; }
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
          console.log(n, value);
          last = value;
        }
      }
      console.log("frames:", frames.length);
    }
  } finally {
    ws.close();
  }
}

const [command, ...args] = process.argv.slice(2);
if (["eval", "shot", "console", "record"].includes(command) && (command === "console" || args[0])) {
  await run(command, args);
} else {
  console.error(USAGE);
  process.exitCode = 2;
}
