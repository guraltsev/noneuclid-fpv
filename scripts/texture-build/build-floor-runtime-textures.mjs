import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { floorTextureBuildConfig, resolveFromRepoRoot } from "./floor-texture-config.mjs";

const require = createRequire(import.meta.url);
const uniqueEntries = new Map();

for (const entry of floorTextureBuildConfig) {
  uniqueEntries.set(entry.runtimePath, entry);
}

const ktx = await loadKtxModule();

for (const entry of uniqueEntries.values()) {
  const sourcePath = resolveFromRepoRoot(entry.sourcePath);
  const runtimePath = resolveFromRepoRoot(entry.runtimePath);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const image = jpeg.decode(sourceBuffer, { useTArray: true });
  const mipChain = buildMipChain(image.data, image.width, image.height);
  const createInfo = new ktx.textureCreateInfo();
  createInfo.baseWidth = image.width;
  createInfo.baseHeight = image.height;
  createInfo.baseDepth = 1;
  createInfo.numDimensions = 2;
  createInfo.numLevels = mipChain.length;
  createInfo.numLayers = 1;
  createInfo.numFaces = 1;
  createInfo.isArray = false;
  createInfo.generateMipmaps = false;
  createInfo.vkFormat = ktx.VkFormat.R8G8B8A8_SRGB;

  const texture = new ktx.texture(createInfo, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
  texture.primaries = ktx.khr_df_primaries.SRGB;
  texture.oetf = ktx.khr_df_transfer.SRGB;
  texture.addKVPairString(ktx.WRITER_KEY, "noneuclid-fpv texture-build");

  for (const [level, mip] of mipChain.entries()) {
    const result = texture.setImageFromMemory(level, 0, 0, mip.data);
    ensureSuccess(ktx, result, `setImageFromMemory(${entry.name}, level=${level})`);
  }

  const basisParams = new ktx.basisParams();
  basisParams.uastc = entry.basisEncoding === "uastc";
  basisParams.noSSE = true;
  basisParams.verbose = false;
  basisParams.qualityLevel = entry.qualityLevel;
  basisParams.compressionLevel = ktx.ETC1S_DEFAULT_COMPRESSION_LEVEL;

  ensureSuccess(ktx, texture.compressBasis(basisParams), `compressBasis(${entry.name})`);

  const serialized = texture.writeToMemory();
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, Buffer.from(serialized));
  console.info(
    `Encoded ${entry.name}: ${normalizePath(entry.sourcePath)} -> ${normalizePath(entry.runtimePath)} (${serialized.byteLength} bytes, ${mipChain.length} mip levels)`,
  );
}

function buildMipChain(imageData, width, height) {
  const chain = [{ data: imageData, width, height }];

  while (width > 1 || height > 1) {
    const previous = chain[chain.length - 1];
    const nextWidth = Math.max(1, previous.width >> 1);
    const nextHeight = Math.max(1, previous.height >> 1);
    const nextData = new Uint8Array(nextWidth * nextHeight * 4);

    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let samples = 0;

        for (let offsetY = 0; offsetY < 2; offsetY += 1) {
          for (let offsetX = 0; offsetX < 2; offsetX += 1) {
            const sourceX = Math.min(previous.width - 1, x * 2 + offsetX);
            const sourceY = Math.min(previous.height - 1, y * 2 + offsetY);
            const sourceIndex = (sourceY * previous.width + sourceX) * 4;
            red += previous.data[sourceIndex];
            green += previous.data[sourceIndex + 1];
            blue += previous.data[sourceIndex + 2];
            alpha += previous.data[sourceIndex + 3];
            samples += 1;
          }
        }

        const targetIndex = (y * nextWidth + x) * 4;
        nextData[targetIndex] = Math.round(red / samples);
        nextData[targetIndex + 1] = Math.round(green / samples);
        nextData[targetIndex + 2] = Math.round(blue / samples);
        nextData[targetIndex + 3] = Math.round(alpha / samples);
      }
    }

    chain.push({
      data: nextData,
      width: nextWidth,
      height: nextHeight,
    });
    width = nextWidth;
    height = nextHeight;
  }

  return chain;
}

function ensureSuccess(ktx, result, label) {
  if (result !== ktx.ErrorCode.SUCCESS) {
    throw new Error(`${label} failed with ${String(result)}.`);
  }
}

async function loadKtxModule() {
  const source = fs.readFileSync(resolveFromRepoRoot("tools/libktx.js"), "utf8");
  const context = {
    console,
    require,
    process,
    __dirname: resolveFromRepoRoot("tools"),
    module: {},
    exports: {},
  };

  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__createKtxModule = createKtxModule;`, context);

  return context.__createKtxModule({
    locateFile(filePath) {
      return resolveFromRepoRoot(path.join("tools", filePath));
    },
  });
}

function normalizePath(relativePath) {
  return relativePath.replace(/\\/g, "/");
}
