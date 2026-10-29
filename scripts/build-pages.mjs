import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePagesBase } from "./pagesBase.mjs";
import { checkDistSize, formatDistSizeReport } from "./check-dist-size.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

let pagesBase;
try {
  pagesBase = resolvePagesBase({ argv: process.argv.slice(2), env: process.env });
} catch (error) {
  console.error(`build:pages: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log(`build:pages: base ${pagesBase.base} (from ${pagesBase.source})`);

const result = spawnSync(...buildCommand(), {
  cwd: resolve(scriptDir, ".."),
  env: {
    ...process.env,
    VITE_BASE: pagesBase.base,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(resolve(scriptDir, "..", "dist", ".nojekyll"), "\n");

const sizeResult = checkDistSize(resolve(scriptDir, "..", "dist"));
console.log(formatDistSizeReport(sizeResult));
if (!sizeResult.ok) {
  process.exit(1);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function buildCommand() {
  if (process.platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", `${npmCommand()} run build`]];
  }

  return [npmCommand(), ["run", "build"]];
}
