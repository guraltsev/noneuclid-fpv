/**
 * Opens one page of the built site for a release-tier scenario (`_docs/tests.md` §6, §8.5) and returns a handle to
 * drive it through `window.noneuclid.api` alone: `api.ns.fn(...)` calls the API function and returns its plain
 * result (a page exception rejects with its message, never a raw DevTools stack); `api.waitFor(query, predicate)`
 * calls `query` (an `api` call, or a few of them) again as soon as it returns and rejects after a bounded number
 * of attempts, so a scenario never waits on wall-clock time or a fixed sleep; `keyDown(code)`, `keyUp(code)` and
 * `pressKey(code)` are a person's keyboard, through the DevTools input domain, for what the API does not offer;
 * `consoleLines()` reads what the page has logged; `screenshot()` and `close()` round out the handle. `close()`
 * applies the browser
 * smoke's failure rules (`scripts/lib/cdpClient.mjs`) to the page's console and network activity since it opened,
 * so a scenario that never explicitly checks for a frame error or a failed request still fails on one.
 *
 * Reaches the browser `tests/support/scenario/globalSetup.ts` launched for the whole `release` run, through the
 * environment variables of `sharedEnv.ts`.
 */
import { SCENARIO_CDP_PORT_ENV, SCENARIO_SITE_URL_ENV } from "./sharedEnv";

// Plain ESM script; loaded through a variable path so tsc does not try to resolve it as a module (see
// globalSetup.ts and tests/project/smokeArgs.test.ts).
const cdpClientModulePath = "../../../scripts/lib/cdpClient.mjs";

interface PageTarget {
  readonly id: string;
  readonly webSocketDebuggerUrl: string;
}

interface EvaluateResult {
  readonly exceptionDetails?: { readonly exception?: { readonly description?: string }; readonly text: string };
  readonly result?: { readonly value?: unknown };
}

interface EventCollector {
  reset(): void;
  readonly exceptions: readonly string[];
  readonly consoleLines: readonly { readonly type: string; readonly text: string }[];
  readonly failedRequests: readonly string[];
}

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<EvaluateResult & Record<string, unknown>>;
  evaluate(expression: string, options?: { readonly awaitPromise?: boolean; readonly returnByValue?: boolean }): Promise<unknown>;
  readonly events: EventCollector;
  navigate(url: string): Promise<void>;
  screenshot(options?: { readonly format?: "png" | "jpeg"; readonly quality?: number }): Promise<Buffer>;
  close(): void;
}

interface CdpClientModule {
  openNewPage(port: number, url: string): Promise<PageTarget>;
  closeTarget(port: number, targetId: string): Promise<void>;
  createCdpSession(webSocketDebuggerUrl: string): Promise<CdpSession>;
  collectFailureReasons(events: EventCollector, options?: Record<string, unknown>): readonly string[];
}

/**
 * The page's current CDP session, reconnectable: a WebSocket connection has occasionally stopped answering
 * `Runtime.evaluate` at all after enough round trips on it, on this machine, well before the page itself (or the
 * app running in it) was at fault — see `.agents/knowledge/scenario-runner-browser-limits.md`. Every call in this
 * file goes through `box.current`, so a reconnect (same target, a fresh WebSocket) is invisible to the rest of
 * the runner and to scenarios, which never see a `CdpSession` directly.
 */
interface SessionBox {
  current: CdpSession;
  reconnect(): Promise<void>;
}

async function createSessionBox(webSocketDebuggerUrl: string, cdpClient: CdpClientModule): Promise<SessionBox> {
  const box: SessionBox = {
    current: await cdpClient.createCdpSession(webSocketDebuggerUrl),
    async reconnect() {
      const stale = box.current;
      box.current = await cdpClient.createCdpSession(webSocketDebuggerUrl);
      try {
        stale.close();
      } catch {
        // already gone
      }
    },
  };
  return box;
}

/** A namespace function of `window.noneuclid.api`, reachable through any depth of dotted path. */
export interface ScenarioApiCallable {
  (...args: readonly unknown[]): Promise<unknown>;
  readonly [name: string]: ScenarioApiCallable;
}

/** Bounds a `waitFor` poll: it rejects after this many attempts rather than any wall-clock time. */
export interface WaitForOptions {
  readonly frames?: number;
}

/** `window.noneuclid.api`, as reached by the scenario runner, plus `waitFor` merged onto the same object. */
export type ScenarioApi = ScenarioApiCallable & {
  readonly waitFor: <T>(query: () => Promise<T>, predicate: (value: T) => boolean, options?: WaitForOptions) => Promise<T>;
};

/** Handle to one opened page, returned by {@link openApp}. */
export interface ScenarioApp {
  readonly api: ScenarioApi;
  readonly waitFor: ScenarioApi["waitFor"];
  screenshot(): Promise<Buffer>;
  /** Holds a key down, as a person does; `code` is a `KeyboardEvent.code`, such as `"KeyW"`. */
  keyDown(code: string): Promise<void>;
  /** Lets a held key go. */
  keyUp(code: string): Promise<void>;
  /** Presses a key and lets it go. */
  pressKey(code: string): Promise<void>;
  /** The text of what the page has logged since it opened (since the last reconnect, if a connection was lost). */
  consoleLines(): readonly string[];
  /** Closes the page; throws if the page's console or network activity since it opened broke the smoke's failure rules. */
  close(): Promise<void>;
}

/** Which world, app config and debug settings to load the page with; all are optional (the app's own defaults apply). */
export interface OpenAppOptions {
  readonly world?: string;
  readonly config?: string;
  readonly debugLevel?: string;
  /** A comma-separated list of debug option ids; they need a `debugLevel` other than `off`. */
  readonly debugOptions?: string;
}

const defaultWaitForFrames = 600;
// A load has taken well under 100 frames in practice; this is a generous bound, not a measured timing. Keeping it
// well short of the test timeout matters: a page that never finishes loading would otherwise go on rendering (and
// competing for the one shared, software-rendered browser's CPU) for the rest of this bound even after Vitest has
// already timed the test out and abandoned it, slowing every scenario that runs afterwards.
const defaultLoadFrames = 1200;

/** Every page this process has opened and not yet closed, so an abandoned one (its test timed out) can still be
 * closed by {@link closeAbandonedPages} instead of going on rendering for the rest of the run. */
const openPages = new Map<string, { readonly port: number; readonly targetId: string; readonly close: () => void }>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; openApp() must run inside the release project (tests/support/scenario/globalSetup.ts sets it).`);
  }
  return value;
}

function buildSceneUrl(siteUrl: string, options: OpenAppOptions): string {
  const url = new URL(siteUrl);
  if (options.config) url.searchParams.set("config", options.config);
  if (options.world) url.searchParams.set("world", options.world);
  if (options.debugLevel) url.searchParams.set("debugLevel", options.debugLevel);
  if (options.debugOptions) url.searchParams.set("debugOptions", options.debugOptions);
  return url.toString();
}

async function evaluateRaw(box: SessionBox, expression: string): Promise<unknown> {
  const result = await box.current.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

/** The API functions that submit a world command. */
const worldCommandFunctions: ReadonlySet<string> = new Set([
  "world.submit",
  "geodesicEmitters.place",
  "geodesicEmitters.shoot",
  "geodesicEmitters.extend",
  "geodesicEmitters.deleteGeodesic",
  "geodesicEmitters.remove",
  "geodesicModel.tieAndDetach",
]);

async function callApiPath(box: SessionBox, pathSegments: readonly string[], args: readonly unknown[]): Promise<unknown> {
  // The page catches its own exception and reports it as plain data, so the call rejects with exactly the page
  // error's message, never a DevTools exception description (a multi-line stack trace).
  const expression = `(async () => {
    try {
      const value = await window.noneuclid.api.${pathSegments.join(".")}(...${JSON.stringify(args)});
      return { ok: true, value };
    } catch (error) {
      return { ok: false, message: (error && error.message) ? String(error.message) : String(error) };
    }
  })()`;

  // A round trip has occasionally gone unanswered altogether (cdpClient.mjs's own command timeout then rejects it
  // cleanly instead of hanging forever; see `.agents/knowledge/scenario-runner-browser-limits.md`), unlike the poll
  // loops below, this single call had no recovery at all before: one reconnect-and-retry gives it the same chance,
  // which is safe for restart commands, state reads and debug queries, which are idempotent: calling one twice after a
  // lost response is never worse than calling it once. A function that submits a world command is not: its first
  // try may have run, so a lost answer is a failure.
  let raw: unknown;
  try {
    raw = await evaluateRaw(box, expression);
  } catch (firstError) {
    if (worldCommandFunctions.has(pathSegments.join("."))) {
      throw firstError;
    }
    await box.reconnect().catch(() => {});
    try {
      raw = await evaluateRaw(box, expression);
    } catch {
      throw firstError;
    }
  }

  const value = raw as { readonly ok: boolean; readonly value?: unknown; readonly message?: string } | undefined;
  if (!value || value.ok === false) {
    throw new Error(value?.message ?? "api call returned no result");
  }
  return value.value;
}

/** Waits for one animation frame to elapse in the page; never a fixed sleep. */
async function waitForAnimationFrame(box: SessionBox): Promise<void> {
  await evaluateRaw(box, "new Promise((resolve) => requestAnimationFrame(() => resolve(true)))");
}

// A single round trip to the browser has occasionally gone unanswered (cdpClient.mjs's own command timeout then
// rejects it cleanly); one such blip does not mean the page is stuck, so a poll loop tolerates a few in a row
// before giving up. It never tolerates the same failure for the whole frame budget, so a truly broken page still
// fails in bounded time. Partway through that tolerance, it reconnects (a fresh WebSocket to the same target):
// recovering a session whose connection has stopped answering matters more than the small risk of losing some of
// the console/network history close() checks for calls made before the reconnect.
const maxConsecutivePollFailures = 5;
const reconnectAfterFailures = 2;

async function waitForCondition<T>(
  box: SessionBox,
  query: () => Promise<T>,
  predicate: (value: T) => boolean,
  { frames = defaultWaitForFrames }: WaitForOptions = {},
): Promise<T> {
  let lastValue: T | undefined;
  let consecutiveFailures = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    try {
      await waitForAnimationFrame(box);
      lastValue = await query();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures === reconnectAfterFailures) {
        await box.reconnect().catch(() => {});
      }
      if (consecutiveFailures > maxConsecutivePollFailures) {
        throw error;
      }
      continue;
    }
    if (predicate(lastValue)) {
      return lastValue;
    }
  }
  throw new Error(`waitFor: condition not met after ${frames} frame(s); last value: ${JSON.stringify(lastValue)}`);
}

function createApiProxy(pathSegments: readonly string[], box: SessionBox, waitFor: ScenarioApi["waitFor"]): ScenarioApiCallable {
  const target = ((...args: readonly unknown[]) => callApiPath(box, pathSegments, args)) as ScenarioApiCallable;
  return new Proxy(target, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      if (pathSegments.length === 0 && prop === "waitFor") {
        return waitFor;
      }
      return createApiProxy([...pathSegments, prop], box, waitFor);
    },
  });
}

/** The loading screen (`src/glue/loadingStatus.ts`) is gone and `api.debug` exists, within a bounded number of frames. */
async function waitForAppLoaded(box: SessionBox): Promise<void> {
  // One round trip per frame, not two: the animation-frame wait and the state read are one expression (a page
  // has stopped answering Runtime.evaluate at all after enough round trips on it; halving them matters).
  const loadStateExpression = `new Promise((resolve) => requestAnimationFrame(() => resolve(JSON.stringify({
    canvases: document.querySelectorAll('canvas').length,
    loading: !!document.querySelector('.loading-screen'),
    loadError: !!document.querySelector('.loading-screen-error'),
    loadingText: document.querySelector('.loading-screen')?.innerText ?? '',
    hasDebugNamespace: typeof window.noneuclid?.api?.debug === 'object',
  }))))`;

  let consecutiveFailures = 0;
  for (let frame = 0; frame < defaultLoadFrames; frame += 1) {
    let raw: string | undefined;
    try {
      raw = (await evaluateRaw(box, loadStateExpression)) as string | undefined;
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures === reconnectAfterFailures) {
        await box.reconnect().catch(() => {});
      }
      if (consecutiveFailures > maxConsecutivePollFailures) {
        throw error;
      }
      continue;
    }
    const state = raw ? (JSON.parse(raw) as {
      readonly canvases: number;
      readonly loading: boolean;
      readonly loadError: boolean;
      readonly loadingText: string;
      readonly hasDebugNamespace: boolean;
    }) : undefined;
    if (state?.loadError) {
      throw new Error(`the app failed to load: ${state.loadingText}`);
    }
    if (state && state.canvases > 0 && !state.loading && state.hasDebugNamespace) {
      return;
    }
  }
  throw new Error(`the app did not finish loading within ${defaultLoadFrames} frames`);
}

/**
 * Opens a new page of the built site (served by `globalSetup.ts`) with the given world/config, waits for it to
 * load, and returns a handle driving it only through `window.noneuclid.api`.
 */
export async function openApp(options: OpenAppOptions = {}): Promise<ScenarioApp> {
  const siteUrl = requireEnv(SCENARIO_SITE_URL_ENV);
  const port = Number(requireEnv(SCENARIO_CDP_PORT_ENV));
  const url = buildSceneUrl(siteUrl, options);

  const cdpClient = (await import(/* @vite-ignore */ cdpClientModulePath)) as CdpClientModule;
  const { closeTarget, collectFailureReasons } = cdpClient;

  const target = await cdpClient.openNewPage(port, url);
  const box = await createSessionBox(target.webSocketDebuggerUrl, cdpClient);
  openPages.set(target.id, { port, targetId: target.id, close: () => box.current.close() });

  let waitFor!: ScenarioApi["waitFor"];
  waitFor = (query, predicate, waitOptions) => waitForCondition(box, query, predicate, waitOptions);
  const api = createApiProxy([], box, waitFor) as ScenarioApi;

  async function closeThisPage(): Promise<void> {
    box.current.close();
    openPages.delete(target.id);
    await closeTarget(port, target.id);
  }

  try {
    await waitForAppLoaded(box);
  } catch (error) {
    await closeThisPage();
    throw error;
  }

  const sendKey = async (type: "keyDown" | "keyUp", code: string): Promise<void> => {
    await box.current.send("Input.dispatchKeyEvent", { type, code });
  };

  return {
    api,
    waitFor,
    screenshot: () => box.current.screenshot(),
    keyDown: (code) => sendKey("keyDown", code),
    keyUp: (code) => sendKey("keyUp", code),
    async pressKey(code) {
      await sendKey("keyDown", code);
      await sendKey("keyUp", code);
    },
    consoleLines: () => box.current.events.consoleLines.map((line) => line.text),
    async close() {
      const reasons = collectFailureReasons(box.current.events, {});
      await closeThisPage();
      if (reasons.length > 0) {
        throw new Error(`scenario failed the smoke's failure rules: ${reasons.join("; ")}`);
      }
    },
  };
}

/**
 * Closes every page {@link openApp} has opened and not yet closed — a safety net for a page whose test timed out
 * (Vitest abandons the test's promise, but the page's own load-wait loop, and its render loop once loaded, keep
 * running until something closes it). `tests/support/scenario/releaseSetup.ts` calls this after every test.
 */
export async function closeAbandonedPages(): Promise<void> {
  const pending = [...openPages.values()];
  openPages.clear();
  for (const page of pending) {
    page.close();
  }
  if (pending.length === 0) {
    return;
  }
  const { closeTarget } = (await import(/* @vite-ignore */ cdpClientModulePath)) as CdpClientModule;
  await Promise.all(pending.map((page) => closeTarget(page.port, page.targetId)));
}
