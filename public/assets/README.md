# Public Assets

This directory holds the runtime asset graph used by the browser build.

Before adding, moving, or reusing an asset, read the canonical
[third-party asset provenance and notices](../../docs/ASSET_PROVENANCE.md).
Vite copies everything in this directory into a release, so a source file under
`public/assets` is public even when the application never requests it.

The older ad hoc bundle remains under `public/assets/_legacy/`; some current
example worlds still load models from it. New work should use the source/runtime
split below instead of extending that bundle.

## Texture Layout

Floor textures should keep authoring files separate from runtime files:

```text
public/assets/textures/
  forest_leaves_02_4k/
    source/
      ...
    textures/
      original_4k_maps...
    runtime/
      forest_leaves_02_color.ktx2
```

For existing textures we are adding `runtime/` first and leaving the source
folders in place temporarily. Issue 34 will move source material outside the
public build input without separating it from its provenance record.

## Runtime Policy

- Use KTX2 for tiled floor color textures.
- Generate mipmaps during texture build.
- Store color textures with sRGB metadata.
- Do not put EXR normals, bump maps, or roughness maps in the default runtime
  floor asset path.
- Keep a meaningful `floorColor` fallback in TypeScript definitions even when a
  texture is present.

## Commands

Run the local inventory script to measure the current source/runtime set:

```bash
npm run textures:floor:inventory
```

Copy Three.js Basis transcoder support files into the public runtime tree:

```bash
npm run textures:ktx2:sync-transcoder
```

Build the runtime floor KTX2 files with the checked-in `tools/libktx.js` +
`tools/libktx.wasm` writer bundle:

```bash
npm run textures:floor:build
```

The build script decodes the source JPGs, generates a full mip chain in JS, and
encodes KTX2 Basis ETC1S output using per-texture settings from
`scripts/texture-build/floor-texture-config.mjs`.

## Adding Another Floor Texture

When adding a new tiled floor texture, follow this order:

1. Put the original authoring asset under `public/assets/textures/<name>/textures/`
   or keep the existing source layout if the folder already exists.
2. Add a `runtime/<name>_color.ktx2` target path in
   `scripts/texture-build/floor-texture-config.mjs`.
3. Point the matching floor definition at that runtime `.ktx2` file.
4. Run `npm run textures:floor:build`.
5. Run `npm run textures:floor:inventory` to record source and runtime sizes.
6. Verify the texture in the worlds that use it before treating the encoding as final.

## Re-encoding Advice

- Start with `basisEncoding: "etc1s"` and `qualityLevel: 200`.
- Keep floor runtime textures color-only unless a later lighting change proves
  that extra maps materially improve play.
- Preserve full mip chains. Repeated floor textures shimmer quickly when mipmaps
  are missing or weak.
- Use sRGB color textures for floor albedo maps.
- Prefer keeping the source resolution at `4096x4096` for this project’s current
  floor set, then let Basis compression reduce the runtime size.

Switch a texture from ETC1S to UASTC when you see one or more of these during
real movement, especially in VR:

- block artifacts in low-contrast areas,
- obvious pattern breakup on large repeated surfaces,
- blurry near-field detail that looks worse than the current source JPG,
- seams that appear only after compression,
- unstable detail during locomotion that is not explained by normal mip blur.

If you need to promote a texture, change `basisEncoding` from `"etc1s"` to
`"uastc"` in `scripts/texture-build/floor-texture-config.mjs`, rebuild, and
re-check only the affected worlds rather than changing the whole set blindly.

## Acceptance Check

Before merging a newly encoded floor texture, check:

- the world still starts without missing-texture diagnostics,
- the fallback `floorColor` still makes sense if the texture fails,
- no new seams appear at tile boundaries,
- motion does not reveal heavy mip shimmer,
- VR comfort is not reduced by noisy or unstable ground detail.
