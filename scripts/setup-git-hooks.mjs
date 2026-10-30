// Points Git at the tracked hooks in `.githooks/` (currently the pre-push check).
// Runs automatically from `npm install` (`prepare`); run it by hand with
// `npm run setup:hooks` or `node scripts/setup-git-hooks.mjs`.
// Outside a Git checkout (for example an extracted tarball) it only warns.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = ".githooks";

function git(...args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

if (git("rev-parse", "--is-inside-work-tree").stdout?.trim() !== "true") {
  console.warn("setup-git-hooks: not a Git checkout; hooks not installed.");
  process.exit(0);
}

if (!existsSync(resolve(repoRoot, hooksDir, "pre-push"))) {
  console.error(`setup-git-hooks: ${hooksDir}/pre-push is missing.`);
  process.exit(1);
}

const result = git("config", "core.hooksPath", hooksDir);
if (result.status !== 0) {
  console.error(`setup-git-hooks: git config failed: ${result.stderr.trim()}`);
  process.exit(1);
}

console.log(`setup-git-hooks: core.hooksPath = ${hooksDir} (pre-push runs typecheck, tests, build and a headless smoke test).`);
