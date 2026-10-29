/**
 * Argument parsing for the browser smoke script. Plain ESM so it can run under Node without a build step.
 * Named flags avoid putting `&` on a command line (cmd.exe cuts arguments there).
 */

const DEBUG_LEVELS = ["off", "basic", "verbose"];
const FLAGS = new Set(["world", "config", "debug-level", "dist", "url", "timeout-ms", "label"]);

/** Parse `process.argv.slice(2)` into the smoke options. Throws Error on bad input. */
export function parseSmokeArgs(argv) {
  const result = {
    pageUrl: undefined,
    siteUrl: undefined,
    dist: "dist",
    configName: "full",
    worlds: ["cube"],
    debugLevel: undefined,
    timeoutMs: 60000,
    label: "smoke",
  };
  if (argv.length > 0 && !argv[0].startsWith("--")) {
    result.pageUrl = argv[0];
    result.label = argv[1] ?? "smoke";
    result.worlds = [];
    return result;
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    let name = arg.slice(2);
    let value;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (!FLAGS.has(name)) throw new Error(`unknown flag: --${name}`);
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`flag --${name} needs a value`);
      i++;
    }
    switch (name) {
      case "world":
        result.worlds = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "config":
        result.configName = value;
        break;
      case "debug-level":
        if (!DEBUG_LEVELS.includes(value)) throw new Error(`--debug-level must be one of ${DEBUG_LEVELS.join(", ")}`);
        result.debugLevel = value;
        break;
      case "dist":
        result.dist = value;
        break;
      case "url":
        result.siteUrl = value.endsWith("/") ? value : value + "/";
        break;
      case "timeout-ms": {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) throw new Error("--timeout-ms must be a positive integer");
        result.timeoutMs = n;
        break;
      }
      case "label":
        result.label = value;
        break;
    }
  }
  return result;
}

/** Build the page URL for one world. */
export function buildPageUrl(siteUrl, { configName, worldId, debugLevel }) {
  const url = new URL(siteUrl);
  url.searchParams.set("config", configName);
  url.searchParams.set("world", worldId);
  if (debugLevel) url.searchParams.set("debugLevel", debugLevel);
  return url.toString();
}
