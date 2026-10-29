import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { starterWorldSpecs } from "../../src/authoring/worldCatalog";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { collectWorldAssetPaths } from "../../src/render/three/preloadWorldAssets";

const publicDir = path.resolve("public");
const srcDir = path.resolve("src");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_EXTENSIONS = new Set([
  ".blend", ".blend1", ".zip", ".7z", ".rar", ".exr", ".hdr", ".psd", ".fbx", ".obj", ".tif", ".tiff", ".max", ".ma", ".mb",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string, base = publicDir) => path.relative(base, file).split(path.sep).join("/");
const publicFiles = walk(publicDir);

describe("public/ asset policy", () => {
  it("contains no authoring or archive files", () => {
    const bad = publicFiles.filter((file) => FORBIDDEN_EXTENSIONS.has(path.extname(file).toLowerCase()));
    expect(bad.map((file) => rel(file))).toEqual([]);
  });

  it("keeps only runtime KTX2 files under assets/textures", () => {
    const bad = publicFiles
      .map((file) => rel(file))
      .filter((file) => file.startsWith("assets/textures/"))
      .filter((file) => file !== "assets/textures/README.md" && !/^assets\/textures\/[^/]+\/runtime\/[^/]+\.ktx2$/.test(file));
    expect(bad).toEqual([]);
  });

  it("keeps every file under 5 MiB", () => {
    const big = publicFiles
      .map((file) => ({ file: rel(file), bytes: fs.statSync(file).size }))
      .filter((entry) => entry.bytes >= MAX_FILE_BYTES);
    expect(big.map((entry) => `${entry.file} (${entry.bytes} bytes)`)).toEqual([]);
  });

  it("keeps only referenced _legacy entries", () => {
    const legacyDir = path.join(publicDir, "assets", "_legacy");
    const sources = walk(srcDir)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const unreferenced = fs
      .readdirSync(legacyDir)
      .filter((name) => name !== "README.md")
      .filter((name) => !sources.includes(`_legacy/${name}`));
    expect(unreferenced).toEqual([]);
  });

  it("provides every asset the bundled worlds preload", () => {
    const missing: string[] = [];
    for (const spec of starterWorldSpecs) {
      for (const assetPath of collectWorldAssetPaths(compileCellComplex(spec))) {
        if (!fs.existsSync(path.join(publicDir, "assets", assetPath))) {
          missing.push(assetPath);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
