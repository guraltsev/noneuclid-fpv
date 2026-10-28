# 18 - GPU texture optimization guideline

Status: closed on 2026-08-03.

## Outcome

Runtime floor textures now use KTX2 color maps with preload, mipmap, color-space,
conversion-script, and documentation support. Raw authoring assets remaining in
`public` are a separate deployment-footprint problem tracked by
[issue 34](../34_reduce_deployment_and_repository_asset_footprint.md).

## Closing evidence

The repository audit at `09dafe7` inspected the runtime definitions, preload
path, conversion tooling, documentation, and focused tests. Node/npm were
unavailable in the audit environment, so the suite was not rerun for this
documentation-only closure.

## Goal

Reduce first-load texture cost and GPU memory pressure without noticeably reducing the visible quality of the current worlds.

The current floor lighting makes normal, bump, and roughness detail read as essentially flat in ordinary play. The runtime should therefore treat the floor color texture as the visible material signal and optimize that path well. This issue should not introduce a `renderQuality=on` texture mode.

## Current State

Textured floor materials in `src/world-assets/floorTextures.ts` reference full 4K material sets:

- color JPG,
- normal EXR,
- displacement PNG used as bump,
- roughness JPG or displacement PNG.

`src/render/three/preloadWorldAssets.ts` preloads every referenced floor map before first render. The loads are concurrent, but the browser still must download, decode, and upload all referenced images before the world starts. Large EXR normal maps and displacement maps are especially poor runtime assets for the current visual result.

The floor shader path in `src/render/three/buildCellMesh.ts` clones and configures each prepared texture per floor mesh. The image data is shared by Three.js, but each clone is still a separate texture object with repeat/wrap state and can increase upload and sampler work.

## Scope

This issue covers runtime texture asset policy and implementation work for floor and portal-wall textures.

In scope:

- define a runtime-ready texture asset format policy,
- make floor materials color-only by default,
- convert runtime floor color maps to GPU-friendly compressed textures,
- remove EXR normals and displacement/bump maps from the default floor preload path,
- keep the authored `floorTexture(...)` API stable,
- add tests that lock in the lighter preload contract,
- document the asset conversion commands and source/runtime asset split.

Out of scope:

- a `renderQuality=on` path for restoring full material maps,
- lighting redesign to make material normal maps more visible,
- procedural material generation,
- changing world authoring syntax,
- changing model/GLB optimization, except where embedded texture compression becomes a follow-up.

## Design Direction

### Runtime texture tiers

Use separate source and runtime assets.

Source assets may remain large, lossless, layered, or authoring-tool native:

- `.blend`,
- `.zip`,
- original 4K texture folders,
- EXR normals,
- displacement maps,
- source PNG/JPG maps.

Runtime assets should be browser and GPU friendly:

- KTX2/Basis Universal for repeated floor color textures,
- power-of-two dimensions,
- mipmaps included,
- sRGB color space for color maps,
- no EXR files in the default runtime path,
- no displacement/bump maps in the default runtime path.

### Floor materials

Floor material definitions should keep the semantic idea of a named texture, but the default runtime material should only reference a color map:

```ts
{
  name: "forest_leaves",
  floorColor: "#59633d",
  defaultTileSizeMeters: 48,
  colorTexturePath: "textures/forest_leaves_02/runtime/forest_leaves_02_color.ktx2",
}
```

Do not keep normal, bump, or roughness paths in the active default definitions unless the lighting changes enough that they produce a clear visible improvement.

### Compression target

Prefer KTX2 with Basis Universal supercompression.

KTX2 is the best fit because Three.js supports it through `KTX2Loader`, and the transcoder can select an efficient GPU-native format for the current device. This should reduce:

- network transfer size,
- image decode cost,
- GPU upload cost,
- GPU memory use.

The exact encoder settings should be verified visually, but start with:

- UASTC for maximum quality when artifacts are visible,
- ETC1S for smaller files when tiled floor detail remains stable,
- mipmap generation enabled,
- sRGB metadata for color textures.

## Required Files

Likely files to change:

- `src/world-assets/floorTextures.ts`
- `src/render/three/preloadWorldAssets.ts`
- `src/render/three/buildCellMesh.ts`
- `src/glue/assetUrls.ts` if path conventions need tightening
- `tests/authoring/worldBuilder.test.ts`
- `tests/authoring/compileWorldScript.test.ts`
- `tests/render-contract/buildCellMesh.test.ts`
- `tests/render-contract/preloadWorldAssets.test.ts` or equivalent new test
- `public/assets/README.md`
- `docs/design/009-asset-system.md`

Likely files or directories to add:

- `public/assets/textures/<texture-name>/runtime/*.ktx2`
- `scripts/texture-build/` or a documented npm script for conversion
- a small manifest or helper if runtime/source paths become repetitive

## Implementation Plan

### 1. Measure the current texture set

Inventory all floor texture assets loaded by the example worlds.

Record for each loaded asset:

- source path,
- file type,
- dimensions,
- byte size,
- whether the asset is color, normal, bump, or roughness,
- which example worlds reference it.

This measurement should produce a short before/after table in the issue closing notes.

### 2. Define the runtime asset layout

Move toward an explicit source/runtime split:

```text
public/assets/textures/
  forest_leaves_02/
    source/
      ...
    runtime/
      forest_leaves_02_color.ktx2
```

If moving source files is too much churn for this issue, add only the `runtime/` folder first and update documentation so future assets follow the split.

### 3. Add KTX2 loading support

Update `preloadWorldAssets` to recognize `.ktx2` texture paths.

Use Three.js `KTX2Loader` and configure it with the renderer-supported transcoder path. Because `preloadWorldAssets` currently runs before `createThreeApp` creates the renderer, decide between these two approaches:

- create the renderer before asset preload and pass it to `preloadWorldAssets`,
- or split asset collection from GPU texture preparation so KTX2 transcoder support can be detected after renderer creation.

Prefer the smallest clean change that keeps startup readable. The final design must avoid loading fallback PNG/JPG copies when KTX2 succeeds.

### 4. Convert floor definitions to color-only runtime paths

Update `floorTextureDefinitions` so active floor textures only provide `colorTexturePath`.

Remove the default references to:

- `normalTexturePath`,
- `bumpTexturePath`,
- `roughnessTexturePath`.

The TypeScript type can keep these optional fields if they are still useful for later experimentation, but the default library should not cause those maps to preload.

### 5. Convert color textures

Generate KTX2 runtime color textures for each named floor material:

- `forest_leaves`,
- `river_pebbles`,
- `gravelly_sand`,
- `red_mud_stones`,
- `snow`.

Check the result in the example worlds with tiled repeat values. Watch especially for:

- block artifacts in low-contrast ground texture,
- shimmering at distance,
- color-space shifts,
- visible seams at tile boundaries,
- blurry near-field floor detail in VR.

If ETC1S is visibly degraded on repeated floors, switch the affected texture to UASTC rather than increasing resolution by default.

### 6. Cache configured repeated textures

Avoid cloning and configuring a new repeated texture for every floor mesh when the source texture path and repeat value are identical.

A small cache can live near floor mesh construction or in the prepared asset object. The cache key should include:

- texture path,
- color space,
- wrap mode,
- repeat X,
- repeat Y.

Do not add a broad material system unless repeated texture reuse is genuinely clearer that way.

### 7. Keep fallback colors meaningful

Every named floor texture already includes `floorColor`. Preserve that contract.

If KTX2 fails to load, the renderer should still show the configured fallback color with a useful diagnostics error. Do not replace the whole world with a blank or failed startup when a non-critical floor texture is unavailable unless that remains the established asset-loading behavior.

### 8. Update tests

Add or update tests so they prove the optimized contract:

- floor texture definitions do not preload normal, bump, or roughness maps by default,
- `.ktx2` paths are classified as texture assets,
- KTX2 loading is routed through the texture preload path rather than GLTF loading,
- floor mesh construction still sets sRGB color space for color maps,
- fallback color remains present in compiled world specs,
- existing world authoring tests continue to pass without changing author syntax.

Use lightweight mocks for KTX2 loading where possible. Do not make unit tests depend on real GPU texture transcoding.

### 9. Update docs

Update asset documentation with:

- source/runtime directory guidance,
- accepted runtime texture formats,
- when to use KTX2,
- why EXR normals are not runtime floor assets,
- how to regenerate runtime textures,
- expected visual acceptance checks.

Document that quality should be judged by the current lighting and locomotion experience, not by source texture inspection in isolation.

## Acceptance Criteria

- Example worlds load floor textures from runtime color maps only.
- No default floor material preloads EXR normals, displacement maps, bump maps, or roughness maps.
- KTX2 texture paths are supported by the preload system.
- Runtime floor color textures include mipmaps and render with the correct sRGB color space.
- Startup loads fewer bytes for textured example worlds than before this issue.
- GPU texture memory pressure is lower for textured floors than before this issue.
- The visible floor appearance remains close to the current appearance under existing lighting.
- World authoring scripts using `floorTexture("grass1")` and the other named floor textures keep working.
- Tests cover the lighter preload contract.
- Documentation explains how to add future runtime-ready floor textures.

## Manual Verification

Run the app locally and inspect these worlds:

- `cube`,
- `dodecahedron`,
- `torus`,
- `twoPrismLoop`.

For each world, check:

- first visible render happens faster than before,
- floors have stable color and tiling,
- no obvious compression blocks,
- no mip shimmer during motion,
- no seams introduced by compression,
- portal wall texture still loads,
- console diagnostics do not show missing required assets.

For VR/headset checks, prefer comfort and motion clarity over close-up material inspection.

## Risks

KTX2 setup may force a small renderer/preload lifecycle change because Three.js needs renderer capability detection for transcoding.

Compression can introduce repeating artifacts that are more noticeable on large tiled floors than on single-use object textures.

Removing roughness maps may make floors less materially varied if lighting changes later. That should be handled by a future lighting/material issue, not by keeping expensive maps in the current default runtime.

## Non-goals

Do not add a parallel high-quality texture mode.

Do not keep EXR normal maps in the default runtime asset graph.

Do not optimize source assets by deleting originals unless license and provenance are already documented.

Do not change gameplay, collision, portal traversal, or WebXR input behavior.

## Notes For Implementers

Keep the first pass boring and measurable: color-only KTX2 floor textures, loader support, tests, docs.

If KTX2 integration becomes too large, land the color-only preload reduction first with optimized PNG/WebP/JPG runtime textures, then follow with KTX2 in a second PR. The final target for this issue remains GPU-compressed runtime textures.
