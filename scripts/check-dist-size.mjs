import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Maximum total size of `dist/` in bytes (64 MiB). */
export const DIST_BUDGET_BYTES = 64 * 1024 * 1024;

/** Walks `dir` recursively; returns the total size and every file (forward-slash relative path), largest first. */
export function measureDirectory(dir) {
  const files = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relative);
      } else {
        files.push({ path: relative, bytes: statSync(full).size });
      }
    }
  };
  walk(dir, "");
  files.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

/** Checks the total size of `dir` against `budgetBytes`; throws when `dir` does not exist. */
export function checkDistSize(dir, budgetBytes = DIST_BUDGET_BYTES) {
  if (!existsSync(dir)) {
    throw new Error(`${dir} does not exist; run a build first.`);
  }
  const { totalBytes, files } = measureDirectory(dir);
  return { ok: totalBytes <= budgetBytes, totalBytes, budgetBytes, largest: files.slice(0, 10) };
}

/** Formats a {@link checkDistSize} result as a multi-line report. */
export function formatDistSizeReport(result) {
  const mb = (result.totalBytes / 1e6).toFixed(1);
  const mib = (result.budgetBytes / (1024 * 1024)).toFixed(1);
  const lines = [`dist size: ${mb} MB of ${mib} MiB budget - ${result.ok ? "OK" : "OVER BUDGET"}`];
  for (const file of result.largest) {
    lines.push(`  ${String(file.bytes).padStart(10)}  ${file.path}`);
  }
  if (!result.ok) {
    lines.push(
      "Remove unused files from public/ (see _docs/ASSET_PROVENANCE.md) or, after review, raise DIST_BUDGET_BYTES in scripts/check-dist-size.mjs.",
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const result = checkDistSize(resolve(scriptDir, "..", "dist"));
  console.log(formatDistSizeReport(result));
  if (!result.ok) {
    process.exit(1);
  }
}
