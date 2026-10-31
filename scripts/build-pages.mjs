// Production build for publishing: `npm run build` (the site uses a relative base, so one build works from any path),
// then `.nojekyll` and the dist size budget. Used by scripts/publish (publish.config.json) and runnable by hand.
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDistSize, formatDistSizeReport } from "./check-dist-size.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const result = spawnSync(...buildCommand(), {
  cwd: resolve(scriptDir, ".."),
  env: process.env,
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
