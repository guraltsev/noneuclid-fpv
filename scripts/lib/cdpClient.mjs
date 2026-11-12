/**
 * Shared Chrome DevTools Protocol client: launching a headless Chromium-based browser, finding and opening page
 * targets over its HTTP endpoint, a WebSocket session with `send`/`evaluate` and console/exception/network event
 * collection, and the browser-smoke failure rules (uncaught exceptions, contained frame errors, the app-config
 * fallback, failed requests, a stuck or failed loading screen).
 *
 * Used by `scripts/smoke/browser-smoke.mjs`, `scripts/debug/cdp.mjs` and `tests/support/scenario/` (the release-tier
 * scenario runner), so the three never duplicate this plumbing. Knows nothing about any one of its callers' CLIs or
 * test files.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Default Chromium-based browser path: `BROWSER`, else Edge on Windows, else the `chromium` command. */
export function defaultBrowserPath() {
  return (
    process.env.BROWSER ??
    (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "chromium")
  );
}

/**
 * Spawns a headless Chromium-based browser with a throwaway profile and a remote-debugging port (the flags
 * `browser-smoke.mjs` has always used: SwiftShader software GL, no sandbox). Does not wait for it to be ready
 * (see {@link waitForBrowserPage}); `close()` kills the process and removes the profile directory.
 */
export function spawnHeadlessBrowser({ browserPath = defaultBrowserPath(), port } = {}) {
  const resolvedPort = port ?? 9300 + Math.floor(Math.random() * 500);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "noneuclid-cdp-"));
  const proc = spawn(
    browserPath,
    [
      "--headless=new",
      "--no-sandbox",
      "--user-data-dir=" + profileDir,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--remote-debugging-port=" + resolvedPort,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let spawnError;
  proc.on("error", (error) => {
    spawnError = error;
  });
  return {
    proc,
    port: resolvedPort,
    browserPath,
    get spawnError() {
      return spawnError;
    },
    close() {
      try {
        proc.kill();
      } catch {
        // already dead
      }
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

/**
 * Polls `handle`'s DevTools HTTP endpoint until a page target appears, returning it; throws a readable error (naming
 * `handle.browserPath`) if the process reports a spawn error (for example "not found") or no target appears within
 * `tries * intervalMs`.
 */
export async function waitForBrowserPage(handle, { tries = 40, intervalMs = 500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (handle.spawnError) {
      throw new Error(`browser did not start (${handle.browserPath}): ${handle.spawnError.message}`);
    }
    try {
      const targets = await listTargets(handle.port);
      const target = targets.find((t) => t.type === "page");
      if (target) {
        return target;
      }
    } catch {
      // DevTools endpoint not listening yet
    }
    await sleep(intervalMs);
  }
  throw new Error(`browser did not start (${handle.browserPath}): no page target on port ${handle.port}`);
}

// A DevTools HTTP request has occasionally not answered at all (seen while writing the release-tier scenario
// runner); every such request gets its own deadline, so a caller gets a clean rejection instead of hanging.
const devToolsHttpTimeoutMs = 12000;

/** Lists the DevTools targets on `port` (`GET /json`). */
export async function listTargets(port) {
  return await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(devToolsHttpTimeoutMs) })).json();
}

/** Finds the first page target whose URL contains `match`. */
export function findPageTarget(targets, match) {
  return targets.find((target) => target.type === "page" && target.url.includes(match));
}

/** Opens a new page target navigated to `url` (`PUT /json/new`), returning its target info. */
export async function openNewPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
    signal: AbortSignal.timeout(devToolsHttpTimeoutMs),
  });
  return await response.json();
}

/** Closes the page target `targetId` (`GET /json/close/<id>`); does not throw if the request itself fails or
 * times out (the caller is cleaning up, and the browser process will be killed regardless). */
export async function closeTarget(port, targetId) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { signal: AbortSignal.timeout(devToolsHttpTimeoutMs) });
  } catch {
    // best effort
  }
}

/**
 * Collects `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and failing `Network.*` events from a stream of raw
 * CDP messages (its `handleMessage` is meant to be registered on a session's `onMessage`). `reset()` clears
 * everything, for a client that reuses one page across several checks (the smoke script's per-world loop).
 */
export function createEventCollector() {
  let exceptions = [];
  let consoleLines = [];
  let failedRequests = [];
  let requestUrls = new Map();

  const isIgnoredUrl = (url) => !url || url.endsWith("/favicon.ico");

  function handleMessage(message) {
    const p = message.params;
    switch (message.method) {
      case "Runtime.consoleAPICalled": {
        const text = p.args.map((a) => a.value ?? a.description ?? "").join(" ");
        consoleLines.push({ type: p.type, text: text.slice(0, 300) });
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails;
        exceptions.push(`${d.text} ${d.exception?.description ?? ""}`.slice(0, 600));
        break;
      }
      case "Network.requestWillBeSent":
        requestUrls.set(p.requestId, p.request.url);
        break;
      case "Network.responseReceived":
        if (p.response.status >= 400 && !isIgnoredUrl(p.response.url)) {
          failedRequests.push(`${p.response.status} ${p.response.url}`);
        }
        break;
      case "Network.loadingFailed":
        if (!p.canceled) {
          const url = requestUrls.get(p.requestId);
          if (!isIgnoredUrl(url)) {
            failedRequests.push(`failed ${url} (${p.errorText})`);
          }
        }
        break;
      default:
        break;
    }
  }

  return {
    handleMessage,
    reset() {
      exceptions = [];
      consoleLines = [];
      failedRequests = [];
      requestUrls = new Map();
    },
    get exceptions() {
      return exceptions;
    },
    get consoleLines() {
      return consoleLines;
    },
    get failedRequests() {
      return failedRequests;
    },
  };
}

/**
 * The browser-smoke failure rules, shared by `browser-smoke.mjs` and the release-tier scenario runner: uncaught
 * exceptions, a contained frame-error message, the app-config fallback-to-defaults message, failed (4xx or network)
 * requests, and (when `loadState` is given) a failed or stuck loading screen, or no canvas. Returns the reasons a
 * page failed (empty when it did not).
 */
export function collectFailureReasons(events, { loadState, timeoutMs } = {}) {
  const reasons = [];
  if (events.exceptions.length > 0) {
    reasons.push(`${events.exceptions.length} uncaught exception(s)`);
  }
  const frameErrors = events.consoleLines.filter((line) => /\[noneuclid\] frame error|frames in a row failed/.test(line.text));
  if (frameErrors.length > 0) {
    reasons.push(`${frameErrors.length} contained frame error message(s)`);
  }
  if (events.consoleLines.some((line) => line.text.includes("[noneuclid] using built-in defaults"))) {
    reasons.push("app config failed to load (built-in defaults used)");
  }
  if (events.failedRequests.length > 0) {
    reasons.push(`${events.failedRequests.length} failed request(s)`);
  }
  if (loadState) {
    if (loadState.loadError) {
      reasons.push(`loading error: ${loadState.loadingText}`);
    } else if (loadState.loading) {
      reasons.push(`loading screen still present${timeoutMs ? ` after ${timeoutMs} ms` : ""}`);
    }
    if (!loadState.canvases) {
      reasons.push("no canvas");
    }
  }
  return reasons;
}

/**
 * Opens a CDP session on `webSocketDebuggerUrl`: a WebSocket connection with `send` (any CDP method), `evaluate`
 * (`Runtime.evaluate` with `awaitPromise`/`returnByValue`, rejecting with the page's exception message), `navigate`,
 * `screenshot`, an `events` collector (already wired to the session's messages) and `onMessage` for a caller that
 * wants the raw stream too (`scripts/debug/cdp.mjs`'s `console`/`record` commands). Enables `Runtime`, `Page` and
 * `Network`. `close()` closes the socket only; the caller owns the browser process and any opened page target.
 */
// The WebSocket connect handshake itself has occasionally never called `onopen` or `onerror` at all (the browser's
// DevTools agent accepted the TCP connection but stalled completing it), unlike every other wait in this module,
// which already has a deadline. Without one here, a caller (including `SessionBox.reconnect()` in
// `tests/support/scenario/openApp.ts`, which exists specifically to recover from a stuck session) could hang
// forever with no way to notice or retry.
const connectTimeoutMs = 6000;

export async function createCdpSession(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.onopen = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // already in a bad state; nothing more to clean up
      }
      reject(new Error(`WebSocket to ${webSocketDebuggerUrl} did not open within ${connectTimeoutMs} ms`));
    }, connectTimeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });

  let nextId = 0;
  const pending = new Map();
  const messageListeners = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      for (const listener of messageListeners) listener(message);
    }
  };

  // A command has occasionally gone unanswered altogether (seen while writing the release-tier scenario runner,
  // under a software-rendered headless browser): without a deadline, that silently hangs the caller forever. Kept
  // short (not the DevTools HTTP endpoint's more generous devToolsHttpTimeoutMs above) because a retry loop
  // (tests/support/scenario/openApp.ts's waitForCondition/waitForAppLoaded) can hit this more than once per call
  // and reconnect, and its own outer test timeout must still have room left after several worst-case misses.
  const commandTimeoutMs = 6000;

  // `timeoutMs` lengthens the deadline for one command that is expected to take long (an awaited page call such as a scripted walk).
  const send = (method, params = {}, { timeoutMs = commandTimeoutMs } = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command "${method}" (id ${id}) got no response within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression, { awaitPromise = true, returnByValue = true, timeoutMs } = {}) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue }, timeoutMs === undefined ? {} : { timeoutMs });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  const events = createEventCollector();
  messageListeners.push(events.handleMessage);

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");

  return {
    send,
    evaluate,
    events,
    onMessage(listener) {
      messageListeners.push(listener);
    },
    async navigate(url) {
      await send("Page.navigate", { url });
    },
    async screenshot({ format = "jpeg", quality = 70 } = {}) {
      const { data } = await send(
        "Page.captureScreenshot",
        format === "png" ? { format } : { format, quality },
      );
      return Buffer.from(data, "base64");
    },
    close() {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}
