import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceDir = path.resolve(repoRoot, "node_modules/three/examples/jsm/libs/basis");
const targetDir = path.resolve(repoRoot, "public/assets/ktx2");

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
  console.info(`Copied ${fileName} -> ${path.join(targetDir, fileName)}`);
}
