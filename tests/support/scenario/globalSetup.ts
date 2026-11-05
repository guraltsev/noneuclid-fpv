/**
 * Global setup for the `release` Vitest project (`_docs/tests.md` §5, §6, §8.2, §8.5).
 *
 * Runs once for the whole `release` run: serves the built `dist/` under `/scenario/relocated/` (a sub-path, like
 * the smoke script, so nothing in a scenario assumes the site is at the root), with the files of
 * `tests/fixtures/scenario-site/` added (app configurations no deployment ships), and launches one headless
 * Chromium-based browser that every scenario file's `openApp()` (`tests/support/scenario/openApp.ts`) opens pages
 * in. The site URL and the browser's DevTools port are handed to scenario files through environment variables
 * (`sharedEnv.ts`); Vitest's global setup runs in the main process, before worker threads are spawned, so they see
 * what it wrote to `process.env`.
 *
 * Fails the whole run, rather than skipping it (hygiene rule H9, `_docs/tests_hygiene.md` §6), with a readable
 * message when `dist/` was not built or no Chromium-based browser is found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCENARIO_CDP_PORT_ENV, SCENARIO_SITE_URL_ENV } from "./sharedEnv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Plain ESM scripts, loaded by absolute file:// URL (Vitest's global setup does not resolve a relative import()
// specifier against this file's own directory the way a test module does) through a variable so tsc does not try
// to resolve them as modules (they are outside tsconfig.json's "include").
const cdpClientModulePath = pathToFileURL(path.join(repoRoot, "scripts", "lib", "cdpClient.mjs")).href;
const staticServerModulePath = pathToFileURL(path.join(repoRoot, "scripts", "smoke", "staticServer.mjs")).href;

interface StaticServerHandle {
  readonly siteUrl: string;
  close(): Promise<void>;
}

interface BrowserHandle {
  readonly port: number;
  readonly spawnError?: Error;
  close(): void;
}

interface CdpClientModule {
  spawnHeadlessBrowser(options?: { readonly browserPath?: string; readonly port?: number }): BrowserHandle;
  waitForBrowserPage(handle: BrowserHandle, options?: { readonly tries?: number; readonly intervalMs?: number }): Promise<unknown>;
}

interface StaticServerModule {
  startStaticServer(options: { readonly root: string; readonly base: string; readonly overlayRoot: string }): Promise<StaticServerHandle>;
}

/** Vitest global setup: returns the teardown function it runs once after every scenario file has finished. */
export default async function setup(): Promise<() => Promise<void>> {
  const distIndexHtml = path.join(repoRoot, "dist", "index.html");
  if (!fs.existsSync(distIndexHtml)) {
    throw new Error('release tier needs a build; dist/index.html is missing (run "npm run build" first).');
  }

  const { startStaticServer } = (await import(/* @vite-ignore */ staticServerModulePath)) as StaticServerModule;
  const server = await startStaticServer({
    root: path.join(repoRoot, "dist"),
    base: "/scenario/relocated/",
    overlayRoot: path.join(repoRoot, "tests", "fixtures", "scenario-site"),
  });

  const { spawnHeadlessBrowser, waitForBrowserPage } = (await import(/* @vite-ignore */ cdpClientModulePath)) as CdpClientModule;
  const browserHandle = spawnHeadlessBrowser();
  try {
    await waitForBrowserPage(browserHandle);
  } catch (error) {
    browserHandle.close();
    await server.close();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`release tier needs a Chromium-based browser; set BROWSER to its path (${reason})`);
  }

  process.env[SCENARIO_SITE_URL_ENV] = server.siteUrl;
  process.env[SCENARIO_CDP_PORT_ENV] = String(browserHandle.port);

  return async () => {
    browserHandle.close();
    await server.close();
  };
}
