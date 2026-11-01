/**
 * Environment variable names `globalSetup.ts` writes and `openApp.ts` reads, to hand the running site's URL and the
 * shared headless browser's DevTools port from the release project's one-time setup to each scenario file (Vitest
 * global setup runs in the main process, before worker threads are spawned, so they inherit the environment it
 * wrote). Not read or written anywhere else.
 */
export const SCENARIO_SITE_URL_ENV = "NONEUCLID_SCENARIO_SITE_URL";
export const SCENARIO_CDP_PORT_ENV = "NONEUCLID_SCENARIO_CDP_PORT";
