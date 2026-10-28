import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(scriptDir, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const fallbackBase = normalizeBase(`/${packageJson.name ?? ""}/`);
const configuredBase = normalizeBase(process.env.VITE_BASE);

const result = spawnSync(...buildCommand(), {
  cwd: resolve(scriptDir, ".."),
  env: {
    ...process.env,
    VITE_BASE: configuredBase ?? fallbackBase,
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

function normalizeBase(value) {
  if (!value || value === "/") {
    return value ? "/" : undefined;
  }

  return `/${String(value).replace(/^\/+/, "").replace(/\/+$/, "")}/`;
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
