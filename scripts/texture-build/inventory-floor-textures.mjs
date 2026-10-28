import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { floorTextureBuildConfig, resolveFromRepoRoot } from "./floor-texture-config.mjs";

const rows = floorTextureBuildConfig.map((entry) => {
  const sourcePath = resolveFromRepoRoot(entry.sourcePath);
  const runtimePath = resolveFromRepoRoot(entry.runtimePath);
  const sourceStats = safeStat(sourcePath);
  const runtimeStats = safeStat(runtimePath);
  const dimensions = sourceStats ? readJpegDimensions(sourcePath) : undefined;

  return {
    texture: entry.name,
    sourcePath: normalizePath(entry.sourcePath),
    role: entry.role,
    sourceType: path.extname(entry.sourcePath).slice(1) || "unknown",
    sourceDimensions: dimensions ? `${dimensions.width}x${dimensions.height}` : "unknown",
    sourceBytes: sourceStats?.size ?? "missing",
    runtimePath: normalizePath(entry.runtimePath),
    runtimeType: path.extname(entry.runtimePath).slice(1) || "missing",
    runtimeBytes: runtimeStats?.size ?? "missing",
    basisEncoding: entry.basisEncoding,
    worlds: entry.worldIds.join(","),
  };
});

console.table(rows);

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

function readJpegDimensions(filePath) {
  const decoded = jpeg.decode(fs.readFileSync(filePath), { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
  };
}

function normalizePath(relativePath) {
  return relativePath.replace(/\\/g, "/");
}
