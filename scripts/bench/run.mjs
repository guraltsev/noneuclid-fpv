/**
 * Runs one benchmark script under `scripts/bench/`.
 *
 *   npm run bench -- <name> [flags]   runs scripts/bench/<name>.bench.ts with vite-node
 *
 * A benchmark is a plain script, not a test (_docs/tests.md §4.7): it prints a table for a person to read, run on
 * purpose, and is never part of `npm test`. Node runs with `--expose-gc` (through NODE_OPTIONS) so benchmarks can
 * force a collection before measuring the heap. Flags after the name reach the script in the BENCH_ARGS environment
 * variable (for example `--record` and `--check` of moduleStep).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const [name, ...flags] = process.argv.slice(2);

if (!name) {
  console.error("usage: npm run bench -- <name> [flags]");
  console.error(
    `available: ${fs
      .readdirSync(benchDir)
      .filter((file) => file.endsWith(".bench.ts"))
      .map((file) => file.replace(/\.bench\.ts$/, ""))
      .join(", ")}`,
  );
  process.exit(2);
}

const scriptPath = path.join(benchDir, `${name}.bench.ts`);

if (!fs.existsSync(scriptPath)) {
  console.error(`no such benchmark: ${scriptPath}`);
  process.exit(2);
}

const nodeOptions = [process.env.NODE_OPTIONS, "--expose-gc"].filter(Boolean).join(" ");
const result = spawnSync("npx", ["vite-node", "--config", path.join(benchDir, "vite.config.ts"), scriptPath], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_OPTIONS: nodeOptions, BENCH_ARGS: flags.join(" ") },
});

process.exit(result.status ?? 1);
