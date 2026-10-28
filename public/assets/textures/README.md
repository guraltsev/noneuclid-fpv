# Texture Runtime Conversion

Floor textures are currently kept in their original downloaded folders, but the runtime should load the compressed color map from each texture's `runtime/` directory. The runtime files are KTX2/Basis textures with mipmaps, which are much quicker for the browser and GPU to load than the original 4K JPG source maps. The original folders are source-only material and remain temporarily public until issue 34 moves them; preserve their entry in [the asset provenance manifest](../../../docs/ASSET_PROVENANCE.md) when doing so.

## Add a new floor texture

1. Put the downloaded texture folder under `public/assets/textures/`.
2. Add one entry to `scripts/texture-build/floor-texture-config.mjs`.
   - Use the texture's color or diffuse JPG as `sourcePath`.
   - Write the output to a sibling `runtime/<texture>_color.ktx2` path.
   - Use `basisEncoding: "etc1s"` and `qualityLevel: 200` to match the current runtime floor textures.
   - Leave `worldIds: []` until the texture is used by a world.
3. Run:

   ```sh
   npm run textures:floor:build
   ```

4. Check the output sizes:

   ```sh
   npm run textures:floor:inventory
   ```

5. If a world should use the texture, add a matching entry in `src/world-assets/floorTextures.ts` whose `colorTexturePath` points at the new `runtime/*.ktx2` file.

Only the color map is currently converted for floor runtime loading. Keep normal, displacement, roughness, metalness, and authoring files in the source folder for future material work, but do not point runtime floors at the raw 4K JPGs.
