// Resolves the GitHub Pages base path for `npm run build:pages` from explicit input only
// (`--base <name>` or the VITE_BASE environment variable). Pure functions, unit-tested in
// tests/scripts/pagesBase.test.ts.

/** Turns "x", "/x", "x/" or "/x/" into "/x/"; "/" and "." into "/"; empty or missing into undefined. */
export function normalizeBase(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (trimmed === "") return undefined;
  if (trimmed === "/" || trimmed === ".") return "/";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

/**
 * Resolves the Pages base from `--base <v>` / `--base=<v>` in argv, then env.VITE_BASE.
 * Returns { base, source } where source is "--base" or "VITE_BASE"; throws an Error with a readable message otherwise.
 */
export function resolvePagesBase({ argv, env }) {
  let raw;
  let source;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--base=")) {
      raw = arg.slice("--base=".length);
      source = "--base";
      break;
    }
    if (arg === "--base") {
      if (i + 1 >= argv.length) {
        throw new Error("--base needs a value, for example --base noneuclid-fpv.");
      }
      raw = argv[i + 1];
      source = "--base";
      break;
    }
  }
  if (source === undefined) {
    raw = env.VITE_BASE;
    source = "VITE_BASE";
  }
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error(
      'No Pages base path given. Run "npm run build:pages -- --base <repository-name>" (for example --base noneuclid-fpv), or "--base ." for a site at the domain root.',
    );
  }
  const trimmed = String(raw).trim();
  if (/^[A-Za-z]:[\/]/.test(trimmed)) {
    throw new Error(
      `The base "${raw}" looks like a Windows path. Git Bash rewrites values that start with "/"; write the repository name without a leading slash, for example --base noneuclid-fpv.`,
    );
  }
  const base = normalizeBase(trimmed);
  if (!base || !/^\/([A-Za-z0-9._-]+\/)*$/.test(base)) {
    throw new Error(`The base "${raw}" is not a valid Pages path; use letters, digits, ".", "_" or "-".`);
  }
  return { base, source };
}
