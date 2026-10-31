/**
 * Runs one benchmark script under `scripts/bench/`.
 *
 *   npm run bench -- <name>   runs scripts/bench/<name>.bench.ts with vite-node
 *
 * A benchmark is a plain script, not a test (_docs/tests.md §4.7): it prints a table for a person to read, run on
 * purpose, and is never part of `npm test`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const [name] = process.argv.slice(2);

if (!name) {
  console.error("usage: npm run bench -- <name>");
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

const result = spawnSync("npx", ["vite-node", scriptPath], { stdio: "inherit", shell: true });

process.exit(result.status ?? 1);
