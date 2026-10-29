# Job 02 - Shrink the deployed assets and resolve unverified ones

Status: queued.
Former issue: 34 (converted to a job on 2026-10-28).
Resolves: issue [40](../../_issues/40_resolve_unverified_public_assets.md).

Priority: P0 deployment reliability and P1 legal release gate.

## Goal

Every file under `public/` is copied into every site build. Remove the unreferenced and unverified files from
`public/`. Replace the 22 MB portal-wall JPG of unknown origin with a small texture generated in code. Move the
texture-rebuild source paths out of `public/`. Add checks that stop these problems from coming back: a unit test on
`public/`, and a size budget that `npm run build:pages` enforces.

## Depends on

None.

## Before you start

Read these files (line numbers are as of 2026-10-28):

- `.agents/jobs/README.md`: the rules for the implementing model and the `## Report` format.
- `src/render/three/portalWallTexture.ts:1-66` (all of it).
- `src/render/three/preloadWorldAssets.ts:1-24`, `:88-125`, `:148-210`, `:316-335`.
- `src/render/three/buildPortalMesh.ts:27-51`.
- `tests/render-contract/buildCellMesh.test.ts:1-75` and `:310-335`.
- `tests/render-contract/preloadWorldAssets.test.ts:1-20` and `:115-152`.
- `tests/docs/documentation.test.ts:1-15`: how a test imports a plain `.mjs` script without type errors.
- `scripts/texture-build/floor-texture-config.mjs` (all), `scripts/texture-build/build-floor-runtime-textures.mjs:1-60`.
- `scripts/build-pages.mjs` (all, 50 lines).
- `_docs/ASSET_PROVENANCE.md` (all), `public/assets/README.md` (all), `public/assets/textures/README.md` (all).
- `.gitignore` (14 lines).

Then run the baseline and record the results under `### Checks` in the report:

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. `npm test` takes about a minute.

## Background

### What is in `public/` now

`git ls-files public` lists 173 files totalling 78,716,478 bytes (2026-10-28). Of that, `public/assets/_legacy/` is
36,277,874 bytes and `public/assets/textures/` is 34,973,749 bytes. A local `dist/` built from this tree is
80,674,890 bytes. The JS bundle is about 1.9 MB of that.

The raw texture sources (4K JPG, EXR, `.blend`, `.zip`) are already gone. Under `public/assets/textures/` only
`README.md` and twelve `*/runtime/*_color.ktx2` files are tracked. `.gitignore:12-14` ignores everything else there:

```gitignore
# Raw/source texture material is huge and never loaded at runtime; only runtime/*.ktx2 (and the README) are tracked (see _issues/34)
public/assets/textures/*/*
!public/assets/textures/*/runtime/
```

The Git pack is 1.32 GiB (`git count-objects -vH`). Old history is out of scope (see "Do not").

### Files to remove: unreferenced or unverified

These tracked files are not referenced anywhere in `src/` or `public/*.config.js`. To check, search `src` for the
folder or file name. The only `_legacy/` references in `src` are `_legacy/clock_low_poly/`,
`_legacy/low_poly_campfire/`, `_legacy/low_poly_rocks/`, `_legacy/low_poly_emergency_button/`
(`src/world-objects/library.ts:185-210`), `_legacy/racoon-animation/` (`src/render/three/buildDecorationMesh.ts:16`,
`src/world-objects/geodesicMarmot.ts:73`) and the portal-wall JPG (`src/render/three/portalWallTexture.ts:13,15`).

| Path under `public/assets/` | Bytes | Why it goes |
| --- | --- | --- |
| `_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg` | 22,889,714 | Unknown origin and license (blocked in the manifest). Replaced by a generated texture in this job. |
| `_legacy/car.gltf` | 104,322 | Unreferenced; blocked (no provenance). |
| `_legacy/scene.bin` | 1,356,480 | Unreferenced; blocked. |
| `_legacy/skybox-1.png`, `_legacy/skybox-2.jpg` ... `_legacy/skybox-6.jpg` | 2,120,350 total | Unreferenced; blocked. |
| `_legacy/house-low-poly/` (3 files) | 82,312 | Unreferenced (licensed CC BY 4.0, but unused). |
| `_legacy/imp/` (4 files) | 96,573 | Unreferenced (licensed, unused). |
| `_legacy/low_poly_cat_walk/` (3 files) | 249,669 | Unreferenced (licensed, unused). |
| `_legacy/low_poly_rabbit/` (4 files) | 308,904 | Unreferenced (licensed, unused). |
| `_legacy/low_poly_tree_wind/` (3 files) | 66,699 | Unreferenced (licensed, unused). |
| `WoodenSign2/Wooden Sign2.png` (note the space) | 30,826 | Byte-identical copy of `WoodenSign2/WoodenSign2.png` (checked with `cmp`). Code uses only the name without a space. |

Total about 27.3 MB. After removal, tracked `public/` is about 51.4 MB, and `dist/` about 53.4 MB.

The other models that the manifest marks "public only" (`cactus/`, `mapMarker/`, `simplesuitcase/`, `streetlight/`,
`flashlight/Flashlight.glb`) have full CC0/CC BY records and total about 1.1 MB. They stay (see Decisions).

### How the portal-wall texture works now

`src/render/three/portalWallTexture.ts:12-15`:

```ts
/** Asset-store path of the portal wall texture. */
export const PORTAL_WALL_TEXTURE_FILE = "_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg";
/** Public URL of the portal wall texture, recorded in material user data for debugging. */
export const PORTAL_WALL_TEXTURE_URL = legacyPublicAssetUrl("abstract-fractal-geometric-figure-background-with-texture.jpg");
```

`createPortalWallMaterial(repeatX, repeatY, assets)` (`:18-39`) builds a `MeshStandardMaterial`, sets
`material.userData.textureUrl = PORTAL_WALL_TEXTURE_URL`, and throws if `assets.getTexture(PORTAL_WALL_TEXTURE_FILE)`
is undefined. It then sets `material.map` to `assets.getConfiguredTexture({...})` (`:41-66`): a cached clone with
`RepeatWrapping`, sRGB, the given repeat, `name: "portal-wall-texture"` and
`userData: { textureUrl: PORTAL_WALL_TEXTURE_URL, repeatX, repeatY }`.

`preloadWorldAssets` downloads the JPG for every world, whatever the debug settings
(`src/render/three/preloadWorldAssets.ts:174-175`):

```ts
    await Promise.all([
      loadRequiredTexture(PORTAL_WALL_TEXTURE_FILE, textureLoader, textures, diagnostics),
```

`loadRequiredTexture` (`:316-335`) is used only on that line. The loaded texture goes into the `textures` map.
`dispose()` (`:269-280`) frees everything in `textures` and in `configuredTextures`.

The wall is visible only in debug mode. `buildCellMesh.ts:202` sets
`showPortalWall = debugLevel !== "off" && shouldRenderPortalWall(portalPanelMode)`, and `shouldRenderPortalWall` is
true only for the portal panel modes `"panel"` and `"panel-with-text"` (`src/glue/portalPanelMode.ts:44-46`). Still,
`buildPortalMesh` (`buildPortalMesh.ts:32-36`) always calls `createPortalWallMaterial`. So the texture must exist in
the asset lookup even when the wall is hidden, or the scene build throws.

Tests that name the current constants:

- `tests/render-contract/buildCellMesh.test.ts:8` imports `PORTAL_WALL_TEXTURE_URL`. `:66` and `:70-72` expect
  `portal.userData.textureUrl` and the portal mesh material's `userData.textureUrl` to equal it.
- `tests/render-contract/buildCellMesh.test.ts:315-316` returns the texture when `assetPath.includes("abstract-fractal")`.
- `tests/render-contract/preloadWorldAssets.test.ts:12` imports `PORTAL_WALL_TEXTURE_FILE`. `:139-144` requests a
  configured texture for it after `preloadWorldAssets`.

`legacyPublicAssetUrl` (`src/glue/assetUrls.ts:15-18`) is used only by `portalWallTexture.ts`.

### Texture-build scripts

`scripts/texture-build/floor-texture-config.mjs:3-121` lists 13 entries. Each `sourcePath` is under
`public/assets/textures/<folder>/...`, for example:

```js
    sourcePath: "public/assets/textures/forest_leaves_02_4k/textures/forest_leaves_02_diffuse_4k.jpg",
    runtimePath: "public/assets/textures/forest_leaves_02_4k/runtime/forest_leaves_02_color.ktx2",
```

`build-floor-runtime-textures.mjs:17-20` calls `fs.readFileSync(sourcePath)` for each entry and crashes on the first
missing source. Since no source is present, `npm run textures:floor:build` always crashes today.
`inventory-floor-textures.mjs` already handles missing sources (it prints `"missing"`).

### Out-of-date documents

- `public/assets/textures/README.md:3` says the source folders "remain temporarily public until issue 34 moves
  them". `:7` says "Put the downloaded texture folder under `public/assets/textures/`". Its link
  `../../../docs/ASSET_PROVENANCE.md` is broken: the folder is `_docs`, not `docs`.
- `public/assets/README.md:5-6` has the same broken link (`../../docs/ASSET_PROVENANCE.md`). `:14-35` show a source
  layout inside `public/assets/textures/` and say "Issue 34 will move source material". `:70-72` say to put the
  original asset under `public/assets/textures/<name>/textures/`.
- `_docs/ASSET_PROVENANCE.md`:
  - `:13-16` say source-only files "remain accidentally public until issue 34".
  - `:87-92` say the rest of each texture folder is "temporarily public".
  - `:128-138` list blocked files. Two of them (`photo-wall-texture-pattern.jpg`, `Ground037_1K-JPG*`) are already
    untracked. All the others are removed by this job.
  - "(public only)" markers that are now wrong: `stopsign/stop_sign.glb` (`:50`) is used by
    `src/world-objects/library.ts:151`, and `flashlight/Post.glb` (`:61`) by
    `src/render/three/geodesicCannonRenderer.ts:40`. `flashlight/Flashlight.glb` (`:59`) has no marker but is not
    referenced anywhere.
  - `:69-72` list which legacy folders are runtime and which are public only.
- `_docs/DEPLOYMENT.md:67-69` and `:85-92` link to this job and to issue 40 as open work.

### Size check: where it can run

The project does not use GitHub for CI. The only workflow, `.github/workflows/deploy-pages.yml`, runs
`npm ci` and `npm run build:pages` on every push to `main`, then deploys. A non-zero exit from `npm run build:pages`
stops the deploy, and the old site stays up. `scripts/build-pages.mjs` runs `npm run build` with `VITE_BASE` set, then
writes `dist/.nojekyll` (`:30`). So a size check at the end of `build-pages.mjs` runs both locally and before every
deploy. Job 03 later changes how `build-pages.mjs` picks the base path; keep the size check as a separate call at the
end so the two changes do not collide.

The local pre-push hook (`.githooks/pre-push`) runs `npm run typecheck` and `npm test` only. A test under `tests/`
therefore runs before every push.

### How tests import `.mjs` scripts

`tsconfig.json` includes `src` and `tests` only, with `strict`. A static `import` of a `.mjs` file from a test fails
type checking because the file has no declaration. `tests/docs/documentation.test.ts:4-13` loads the script through
a variable path instead, so the type checker sees `any`:

```ts
const checksPath = "../../scripts/docs/checks.mjs";
interface DocChecks { runAllChecks(): { results: Record<string, string[]> }; }
async function loadChecks(): Promise<DocChecks> {
  return (await import(/* @vite-ignore */ checksPath)) as DocChecks;
}
```

Use the same pattern for every new script test in this job.

### Documentation rules that will check your work

`npm test` includes `tests/docs/documentation.test.ts`. Every `src/` module needs a leading `/** ... */` header, and
every export needs JSDoc. `_docs/generated/*.md` must match `npm run docs:generate`. Backticked `src/...` paths in
`README.md` and `_docs/*.md` must exist.

## Decisions

1. **Raw texture sources.** Decided: keep them out of the repository. Their documented home is a gitignored folder
   `assets-src/textures/<same folder name as today>/...` at the repository root, outside `public/`. Maintainers
   download them again from the source URLs in `_docs/ASSET_PROVENANCE.md` when they need to rebuild a KTX2 file.
   Why: the sources are CC0 downloads that anyone can fetch again. Outside `public/`, Vite never copies them. Keeping
   them out of Git avoids growing the 1.32 GiB pack again. Alternative considered: Git LFS, or a separate
   source-asset archive repository. Both add tooling and hosting for files nobody needs at runtime.
2. **The 22 MB portal-wall JPG.** Decided: delete it and generate the wall texture in code. The new texture is a
   64 x 64 RGBA `THREE.DataTexture` with a two-colour checkerboard. Squares are 8 x 8 pixels. The colours are
   `#E6E6FA` (lavender) and `#6A5ACD` (slate blue), alpha 255. Pixel (0, 0) is lavender. A pixel (x, y) is slate
   blue when `(Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 1`. It is stored under the asset key
   `"generated/portal-wall-checker"`, so the existing `getTexture` / `getConfiguredTexture` / `dispose` plumbing is
   unchanged. Why: the wall is only a debug aid (visible only with a debug level and a panel mode). A generated
   texture has no license question, costs no download and is about 16 KB of memory. Alternatives considered: a plain
   colour without a map (loses the pattern that shows scale), or another downloaded CC0 image (a new provenance
   record for a debug aid).
3. **Other unreferenced `_legacy` models** (`house-low-poly`, `imp`, `low_poly_cat_walk`, `low_poly_rabbit`,
   `low_poly_tree_wind`). Decided: delete them and their manifest rows. Why: nothing loads them. Their records stay in
   Git history if someone wants them back. Alternative considered: keep them because their licenses are known.
4. **Licensed "public only" models outside `_legacy`** (`cactus/`, `mapMarker/`, `simplesuitcase/`, `streetlight/`,
   `flashlight/Flashlight.glb`). Decided: keep them, and correct the "(public only)" markers. Why: they are small
   (about 1.1 MB), fully documented, and candidates for world authoring. Alternative considered: delete them too.
5. **Size budget.** Decided: `dist/` may total at most 64 MiB (67,108,864 bytes). Also, no single file under
   `public/` may be 5 MiB (5,242,880 bytes) or larger. Why: after this job `dist/` is about 53.4 MB, so 64 MiB
   leaves room for a few more floor textures. The largest remaining file is 4,195,828 bytes
   (`forest_leaves_02_color.ktx2`). The 5 MiB limit catches another 22 MB image at once. Alternative considered:
   only a per-file limit (it misses many medium files).
6. **Where the size budget is enforced.** Decided: in a new script `scripts/check-dist-size.mjs`. `build-pages.mjs`
   calls it at the end, and it is also exposed as `npm run size:dist`. The `public/` rules are enforced by a unit
   test, so the pre-push hook runs them. Why: there is no GitHub CI, and `build:pages` is the step that runs before
   every deploy. Alternative considered: running a build in the pre-push hook (too slow).
7. **Constant names.** Decided: rename `PORTAL_WALL_TEXTURE_FILE` to `PORTAL_WALL_TEXTURE_KEY` and delete
   `PORTAL_WALL_TEXTURE_URL`. Keep the user-data field name `textureUrl` on the material and on the portal group, and
   store the key in it. Why: the floor code (`buildCellMesh.ts:129,137`) uses the same field for an asset path, and
   tests read it. Alternative considered: a new `textureKey` field (more churn for no gain).
8. **`legacyPublicAssetUrl`.** Decided: leave `src/glue/assetUrls.ts` unchanged, even though nothing uses the
   function afterwards. Why: this job does not change the URL helpers. Alternative considered: delete it.

## Steps

Do the steps in order. After each step, run the check it names.

1. **Generate the portal-wall texture.** In `src/render/three/portalWallTexture.ts`:
   - Remove the import of `legacyPublicAssetUrl`.
   - Replace the two constants with:

     ```ts
     /** Asset-lookup key of the generated portal wall texture; no file is downloaded for it. */
     export const PORTAL_WALL_TEXTURE_KEY = "generated/portal-wall-checker";
     ```

   - Add this exported function (keep the JSDoc):

     ```ts
     /** Width and height in pixels of the generated portal wall texture. */
     export const PORTAL_WALL_TEXTURE_SIZE = 64;

     const CHECKER_CELL_PIXELS = 8;
     const LIGHT_RGB = [0xe6, 0xe6, 0xfa] as const; // lavender
     const DARK_RGB = [0x6a, 0x5a, 0xcd] as const; // slate blue

     /**
      * Creates the 64 x 64 sRGB checkerboard used as the portal wall map (8-pixel squares, lavender at pixel 0,0).
      * The caller owns the texture and must dispose it; `preloadWorldAssets` does this for the app.
      */
     export function createPortalWallDataTexture(): THREE.DataTexture {
       const size = PORTAL_WALL_TEXTURE_SIZE;
       const data = new Uint8Array(size * size * 4);
       for (let y = 0; y < size; y += 1) {
         for (let x = 0; x < size; x += 1) {
           const dark = (Math.floor(x / CHECKER_CELL_PIXELS) + Math.floor(y / CHECKER_CELL_PIXELS)) % 2 === 1;
           const rgb = dark ? DARK_RGB : LIGHT_RGB;
           const index = (y * size + x) * 4;
           data[index] = rgb[0];
           data[index + 1] = rgb[1];
           data[index + 2] = rgb[2];
           data[index + 3] = 255;
         }
       }
       const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
       texture.name = "portal-wall-checker";
       texture.colorSpace = THREE.SRGBColorSpace;
       texture.needsUpdate = true;
       return texture;
     }
     ```

   - In `createPortalWallMaterial` and `configurePortalWallTexture`, replace every `PORTAL_WALL_TEXTURE_FILE` with
     `PORTAL_WALL_TEXTURE_KEY` and every `PORTAL_WALL_TEXTURE_URL` with `PORTAL_WALL_TEXTURE_KEY`. Keep the
     `textureUrl` field names. Keep both "was not preloaded" errors.
   - Rewrite the module header (`:1-6`). It must say the wall map is a generated checkerboard registered by
     `preloadWorldAssets` under `PORTAL_WALL_TEXTURE_KEY`, and that no image file is loaded.
   - Check: `npm run typecheck` now fails only in `preloadWorldAssets.ts` and the two test files. Step 2 fixes them.

2. **Register the generated texture in `preloadWorldAssets`.** In `src/render/three/preloadWorldAssets.ts`:
   - Change the import at `:15` to
     `import { createPortalWallDataTexture, PORTAL_WALL_TEXTURE_KEY } from "./portalWallTexture";`.
   - Delete the line `loadRequiredTexture(PORTAL_WALL_TEXTURE_FILE, textureLoader, textures, diagnostics),` (`:175`).
   - Directly after the `try { ... } finally { ktx2Loader?.dispose(); }` block (after `:209`, before `return {`), add:

     ```ts
     // The portal wall map is generated, not downloaded; registering it here lets dispose() free it with the rest.
     textures.set(PORTAL_WALL_TEXTURE_KEY, createPortalWallDataTexture());
     ```

   - Delete the function `loadRequiredTexture` (`:316-335`). Nothing else uses it, and `noUnusedLocals` would fail.
   - Update the module header (`:7-8`). Floor colour textures are optional and every other loaded asset is required.
     The portal wall texture is generated, not loaded. Update the JSDoc of `collectWorldAssetPaths` (`:92`) the same
     way ("...the portal wall texture, which is generated in code").
   - Check: `npm run typecheck` fails only in the two test files.

3. **Update the existing tests.**
   - `tests/render-contract/buildCellMesh.test.ts`: import `PORTAL_WALL_TEXTURE_KEY` instead of
     `PORTAL_WALL_TEXTURE_URL` (`:8`), and use it in the three expectations at `:66` and `:70-72`. At `:315-316`,
     replace `assetPath.includes("abstract-fractal")` with `assetPath === PORTAL_WALL_TEXTURE_KEY` and
     `request.assetPath.includes("abstract-fractal")` with `request.assetPath === PORTAL_WALL_TEXTURE_KEY`.
   - `tests/render-contract/preloadWorldAssets.test.ts`: import `PORTAL_WALL_TEXTURE_KEY` instead of
     `PORTAL_WALL_TEXTURE_FILE` (`:12`) and use it at `:140`.
   - These test edits are part of the job: list them under `### Done`, not under `### Deviations`.
   - Check: `npx vitest run tests/render-contract/buildCellMesh.test.ts tests/render-contract/preloadWorldAssets.test.ts`
     passes, and `npm run typecheck` passes.

4. **Add tests for the generated texture.**
   - New file `tests/render-contract/portalWallTexture.test.ts`, with the test
     `"generates a 64x64 sRGB checkerboard with 8-pixel squares"`. Call `createPortalWallDataTexture()`. Assert:
     `image.width === 64`, `image.height === 64`, `colorSpace === THREE.SRGBColorSpace`. Pixel (0, 0) is
     `[0xe6, 0xe6, 0xfa, 255]`, pixel (8, 0) is `[0x6a, 0x5a, 0xcd, 255]`, pixel (8, 8) is lavender again, pixel
     (63, 0) is slate blue. Read pixels from `texture.image.data` at index `(y * 64 + x) * 4`.
   - In `tests/render-contract/preloadWorldAssets.test.ts`, add the test
     `"registers the generated portal wall texture without downloading it"`. Run
     `preloadWorldAssets(compileCellComplex(cube), { createKtx2Loader: ... })` with the same fake KTX2 loader as the
     existing tests. Then assert:
     - `assets.getTexture(PORTAL_WALL_TEXTURE_KEY)` is an instance of `THREE.DataTexture`;
     - no URL passed to `loadTextureAsync` or `loadGltfAsync` contains `"_legacy/abstract"` or `"portal-wall"`. Read
       the URLs from `mock.calls`.
   - Check: `npx vitest run tests/render-contract` passes.

5. **Delete the files.** Run from the repository root (Git Bash):

   ```sh
   git rm public/assets/_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg \
     public/assets/_legacy/car.gltf public/assets/_legacy/scene.bin \
     public/assets/_legacy/skybox-1.png public/assets/_legacy/skybox-2.jpg public/assets/_legacy/skybox-3.jpg \
     public/assets/_legacy/skybox-4.jpg public/assets/_legacy/skybox-5.jpg public/assets/_legacy/skybox-6.jpg \
     "public/assets/WoodenSign2/Wooden Sign2.png"
   git rm -r public/assets/_legacy/house-low-poly public/assets/_legacy/imp public/assets/_legacy/low_poly_cat_walk \
     public/assets/_legacy/low_poly_rabbit public/assets/_legacy/low_poly_tree_wind
   ```

   - Check: `git ls-files public/assets/_legacy` lists only `README.md` and files under `clock_low_poly/`,
     `low_poly_campfire/`, `low_poly_emergency_button/`, `low_poly_rocks/`, `racoon-animation/`. Search the code for
     the deleted names (`abstract-fractal`, `car.gltf`, `skybox`, `house-low-poly`, `low_poly_cat_walk`,
     `low_poly_rabbit`, `low_poly_tree_wind`, `Wooden Sign2`) in `src`, `tests` and `public`. The only hits allowed
     are in `public/assets/README.md` or `_docs/`, which step 9 fixes. If anything under `src` or `tests` still
     names one of them, stop and fix it before going on. Record what you found under `### Uncertain`.

6. **Add the `public/` policy test.** New file `tests/assets/publicAssetPolicy.test.ts`. It walks the `public`
   folder on disk (not `git ls-files`) with `node:fs`, because Vite copies whatever is on disk. Paths are relative
   to the repository root, which is the working directory under `npm test`. Use
   `path.resolve("public")`. Tests:
   - `"contains no authoring or archive files"`: no file has one of these lowercase extensions:
     `.blend`, `.blend1`, `.zip`, `.7z`, `.rar`, `.exr`, `.hdr`, `.psd`, `.fbx`, `.obj`, `.tif`, `.tiff`, `.max`,
     `.ma`, `.mb`.
   - `"keeps only runtime KTX2 files under assets/textures"`: every file under `public/assets/textures/` is either
     `public/assets/textures/README.md` or matches `public/assets/textures/<folder>/runtime/<name>.ktx2`.
   - `"keeps every file under 5 MiB"`: every file is smaller than 5,242,880 bytes. The failure message must list the
     offending paths and sizes.
   - `"keeps only referenced _legacy entries"`: for every entry directly inside `public/assets/_legacy/` except
     `README.md`, the text `_legacy/<entry name>` appears in at least one file under `src/` (read all `.ts` and
     `.js` files under `src` recursively).
   - `"provides every asset the bundled worlds preload"`: import `starterWorldSpecs` from
     `src/authoring/worldCatalog`, `compileCellComplex` from `src/cell-complex/compileCellComplex` and
     `collectWorldAssetPaths` from `src/render/three/preloadWorldAssets`. For every spec, every path returned by
     `collectWorldAssetPaths(compileCellComplex(spec))` exists as `public/assets/<path>`. (Measured: compiling all
     ten worlds takes a few milliseconds.)
   - Check: `npx vitest run tests/assets` passes. To prove the test bites, temporarily copy any `.png` into
     `public/assets/textures/`, run it again, and see it fail. Then delete the copy.

7. **Add the size report and budget.** New file `scripts/check-dist-size.mjs` (plain ESM JavaScript, no
   TypeScript). Exports:
   - `export const DIST_BUDGET_BYTES = 64 * 1024 * 1024;`
   - `export function measureDirectory(dir)`: walks `dir` recursively and returns
     `{ totalBytes, files: [{ path, bytes }] }`. Use forward slashes in `path`, relative to `dir`, and sort `files`
     by `bytes`, largest first.
   - `export function checkDistSize(dir, budgetBytes = DIST_BUDGET_BYTES)` returns
     `{ ok: totalBytes <= budgetBytes, totalBytes, budgetBytes, largest: files.slice(0, 10) }`. If `dir` does not
     exist, throw `new Error(\`${dir} does not exist; run a build first.\`)`.
   - `export function formatDistSizeReport(result)` returns a multi-line string. The first line is
     `dist size: <MB with 1 decimal> MB of <budget MiB with 1 decimal> MiB budget - OK` (or `- OVER BUDGET`).
     Then comes one line per largest file. When over budget, add a last line:
     `Remove unused files from public/ (see _docs/ASSET_PROVENANCE.md) or, after review, raise DIST_BUDGET_BYTES in scripts/check-dist-size.mjs.`
   - When run directly (`if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)`):
     check `dist` relative to the repository root (resolve it from the script folder, as `build-pages.mjs:6-7`
     does). Print the report, and `process.exit(1)` if not `ok`.
   - In `package.json` `scripts`, add `"size:dist": "node scripts/check-dist-size.mjs"` after `"preview"`.
   - In `scripts/build-pages.mjs`, after `writeFileSync(... ".nojekyll" ...)` (`:30`), add a call that checks
     `resolve(scriptDir, "..", "dist")`, prints the report with `console.log`, and calls `process.exit(1)` when not
     `ok`. Import the functions at the top: `import { checkDistSize, formatDistSizeReport } from "./check-dist-size.mjs";`.
   - New test `tests/scripts/checkDistSize.test.ts`. Load the script with the variable-path pattern from
     `tests/docs/documentation.test.ts`. Write files into a fresh `fs.mkdtempSync(path.join(os.tmpdir(), "dist-size-"))`
     folder: one 3,000-byte file and one 1,000-byte file in a subfolder. Assert:
     - `measureDirectory` returns total 4,000, with the subfolder path in forward slashes, largest first;
     - `checkDistSize(dir, 4000).ok` is true and `checkDistSize(dir, 3999).ok` is false;
     - the report for the second contains `OVER BUDGET`;
     - `checkDistSize` on a missing folder throws.
     Remove the temporary folder in `afterEach`.
   - Check: `npx vitest run tests/scripts/checkDistSize.test.ts` passes. Then run `npm run build` and
     `npm run size:dist`, and record the printed size in the report. It should be about 53 MB and OK. If it is over
     64 MiB, do not raise the budget: record it under `### Uncertain` with the largest files.

8. **Move texture sources out of `public/`.**
   - `.gitignore`: replace the comment at `:12` with
     `# Raw texture sources live in assets-src/ (never committed); under public/ only runtime/*.ktx2 and the README are tracked (job 02).`
     Keep `:13-14`. Add a new line `assets-src/`.
   - `scripts/texture-build/floor-texture-config.mjs`: in every `sourcePath`, replace the prefix
     `public/assets/textures/` with `assets-src/textures/`. Do not change any `runtimePath`. Above the array, add a
     comment: sources are downloaded by hand into `assets-src/textures/<folder>/` (gitignored) from the URLs in
     `_docs/ASSET_PROVENANCE.md` ("Floor textures"); runtime output stays under `public/`.
   - `scripts/texture-build/build-floor-runtime-textures.mjs`: inside the loop (`:17`), before `readFileSync`, add a
     check. If `!fs.existsSync(sourcePath)`, print
     `` console.warn(`Skipped ${entry.name}: source not found at ${normalizePath(entry.sourcePath)}. Download it (see _docs/ASSET_PROVENANCE.md) and run again.`) ``,
     count it, and `continue`. After the loop, print `Built <n> texture(s), skipped <m>.`. Exit code stays 0.
   - Check: `npm run textures:floor:build` now prints 12 "Skipped" lines and `Built 0 texture(s), skipped 12.`
     (13 entries; two share a runtime path and are de-duplicated at `:11-13`). It must not touch any `.ktx2` file:
     afterwards `git status --short public` shows no change. `npm run textures:floor:inventory` still prints a table
     with `sourcePath` values under `assets-src/textures/`.

9. **Update the documents.**
   - `public/assets/textures/README.md`:
     - Rewrite `:3`: runtime loads `runtime/*.ktx2`, and sources live outside `public/` in the gitignored
       `assets-src/textures/<folder>/`.
     - Fix the link to `../../../_docs/ASSET_PROVENANCE.md`.
     - Change step 1 (`:7`) to "Download the texture folder into `assets-src/textures/` (create it; it is ignored
       by Git)".
     - Change `:9` so `sourcePath` points into `assets-src/textures/`.
     - Change the last paragraph (`:27`) so the other maps stay in the source folder under `assets-src/`.
   - `public/assets/README.md`:
     - Fix the link at `:5` to `../../_docs/ASSET_PROVENANCE.md`.
     - Replace the "Texture Layout" block (`:14-35`) with two trees: `assets-src/textures/<folder>/...`
       (sources, not committed) and `public/assets/textures/<folder>/runtime/<name>_color.ktx2` (committed). Drop
       the sentence about issue 34.
     - Change step 1 of "Adding Another Floor Texture" (`:70-72`) to `assets-src/textures/<name>/`.
   - `_docs/ASSET_PROVENANCE.md`:
     - `:13-16`: source-only files are no longer in the repository. They are downloaded into the gitignored
       `assets-src/` folder when needed.
     - `:21-23`: the Blocked bullet stays, but link to the closed issue path
       `../_issues/_closed/40_resolve_unverified_public_assets.md`.
     - Remove the `(public only)` marker from `stopsign/stop_sign.glb` (`:50`) and `flashlight/Post.glb` (`:61`), and
       add `(public only)` to `flashlight/Flashlight.glb` (`:59`).
     - Remove `WoodenSign2/Wooden Sign2.png` from the row at `:58`.
     - In "Legacy Sketchfab models", delete the rows for `house-low-poly`, `imp`, `low_poly_cat_walk`,
       `low_poly_rabbit` and `low_poly_tree_wind`. Rewrite `:69-72`: all five remaining folders are
       runtime-distributed.
     - "Floor textures" `:89-92`: only `runtime/*.ktx2` is in the repository. Sources go into `assets-src/textures/`.
       The table paths stay as they are.
     - Replace the table in "Blocked, unverified, or incorrect historical records" (`:136-138`) with one sentence:
       "None. On <date>, job 02 removed every listed file from `public/`, and the portal wall now uses a texture
       generated in code (`src/render/three/portalWallTexture.ts`)." Then list the removed paths in one line.
     - Add a new row to the "Icons and transcoder" table (or a one-line paragraph under it) saying the portal-wall
       checkerboard is project-generated in code and covered by the project MIT License.
   - `_docs/DEPLOYMENT.md`:
     - `:67-69`: link to the done job, `../.agents/jobs/_done/02_asset_footprint_and_provenance.md`. Say texture
       sources are not in the repository (see `public/assets/textures/README.md`).
     - `:85-92`: drop "tracked by issue 34/40". Say that `npm run build:pages` fails when `dist/` exceeds the 64 MiB
       budget (`npm run size:dist` prints the report), and that `tests/assets/publicAssetPolicy.test.ts` guards
       `public/`.
   - Check: `npm run docs:check` passes.

10. **Full verification.** Run `npm run typecheck`, `npm test`, `npm run docs:check` (run `npm run docs:generate`
    first if it reports stale generated files), and `npm run build`. Then run a browser check of three worlds with
    the existing smoke script. Start the preview server in a second terminal: `npx vite preview --port 4173`.
    Then run:

    ```sh
    npm run smoke -- "http://localhost:4173/?world=cube" cube
    npm run smoke -- "http://localhost:4173/?world=dodecahedron" dodecahedron
    npm run smoke -- "http://localhost:4173/?world=torus-moduli" torus-moduli
    ```

    Each URL has a single parameter on purpose: on Windows, cmd.exe cuts a URL at `&`. Each run must print
    `SMOKE OK`. If no Chromium-based browser is available, or the script fails for a reason unrelated to this job,
    record it under `### Not done` with the output. Optional: open
    `http://localhost:4173/?debugLevel=basic&portalPanels=panel` in a desktop browser and confirm that portal walls
    show a lavender and slate-blue checkerboard. Record what you saw under `### Checks`, or "not checked".

## Tests and checks

New tests:

- `tests/render-contract/portalWallTexture.test.ts`: "generates a 64x64 sRGB checkerboard with 8-pixel squares".
- `tests/render-contract/preloadWorldAssets.test.ts`: "registers the generated portal wall texture without
  downloading it".
- `tests/assets/publicAssetPolicy.test.ts`: the five tests in step 6.
- `tests/scripts/checkDistSize.test.ts`: measure, budget pass and fail, report text, missing folder.

Updated tests: `tests/render-contract/buildCellMesh.test.ts` and `tests/render-contract/preloadWorldAssets.test.ts`
(the constant renames in step 3 only).

Commands (Git Bash on Windows):

```sh
npm run typecheck
npm test
npm run docs:check
npm run build
npm run size:dist
npm run textures:floor:build      # expect 12 "Skipped" lines, no file changes
git status --short public         # expect only the deletions from step 5
```

## Do not

- Do not rewrite Git history or run `git filter-repo`/BFG. Shrinking the 1.32 GiB pack is a separate, owner-approved
  migration.
- Do not commit anything under `assets-src/`, and do not download the texture sources. They are not needed for this
  job.
- Do not re-encode or touch any `runtime/*.ktx2` file.
- Do not delete `cactus/`, `mapMarker/`, `simplesuitcase/`, `streetlight/` or `flashlight/Flashlight.glb`
  (Decision 4).
- Do not delete `_legacy/clock_low_poly`, `low_poly_campfire`, `low_poly_rocks`, `low_poly_emergency_button` or
  `racoon-animation`: the app loads them.
- Do not add a GitHub Actions workflow, and do not add a build to `.githooks/pre-push`.
- Do not raise `DIST_BUDGET_BYTES` or the 5 MiB per-file limit to make a check pass.
- Do not change how `scripts/build-pages.mjs` resolves the base path. That is job 03.
- Do not make the portal wall load any file, and do not add a new image to `public/`.
- Do not edit `wwwserver/`.

## Done when

- [ ] Steps 1-10 are done, or each skipped step is explained under `### Not done`.
- [ ] `npm run typecheck`, `npm test` and `npm run docs:check` pass. `npm run build` succeeds, and `npm run size:dist`
      reports OK at about 53 MB.
- [ ] `git ls-files public | grep -c .` is 146 (173 tracked files minus the 27 deleted in step 5). If your count
      differs, record both numbers under `### Uncertain`.
- [ ] `npm run docs:generate` has been run, because `src/` changed, and `_docs/generated/` is committed.
- [ ] Issue 40 is closed, unless the report has anything under `### Uncertain` or `### Not done` (see the README
      rule). To close it: move `_issues/40_resolve_unverified_public_assets.md` to
      `_issues/_closed/40_resolve_unverified_public_assets.md`, set `Status: closed on <date>.`, and add
      `## Outcome` and `## Closing evidence` sections above the old text, as in
      `_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md`. Evidence: the deleted paths, the
      generated texture, the new test names, and the measured `dist` size. Update its `Jobs:` link to
      `../../.agents/jobs/_done/02_asset_footprint_and_provenance.md`. If the issue stays open, add one line under
      its `Status:` line pointing to this job's report, and still update the `Jobs:` link. If the issue stays
      open, the links that step 9 points at `_issues/_closed/40_...` must point at `_issues/40_...` instead.
- [ ] This file is moved to `.agents/jobs/_done/02_asset_footprint_and_provenance.md`, its relative links are fixed
      (one more `../`), and its `Status:` line is set: `Status: done on <date>.` if `### Uncertain` and
      `### Not done` are empty, otherwise `Status: done, needs review on <date>.`
- [ ] A `## Report` section is appended with these subsections:
  - `### Done`: what changed, with files and commit hashes;
  - `### Deviations`: where the work differs from the steps, and why;
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them;
  - `### Not done`: anything skipped, and why;
  - `### Checks`: the commands run and their results, including failures and the measured `dist` size.
- [ ] The job 02 row in `.agents/jobs/README.md` links to `_done/02_...`, its title is struck through and marked
      `(done)` (or `(done, needs review)`), and the issue link points to `_closed/` if the issue was closed.
- [ ] Everything is committed in one or more commits. Each message ends with the co-author line the repository uses.

## History

Converted from issue 34 on 2026-10-28. Already done before this rewrite: the raw texture sources (about 920 MiB of
4K JPG/EXR/`.blend`/`.zip`) were removed from the tracked tree, and `.gitignore` was set to keep only `runtime/`
under `public/assets/textures/`. `_legacy/photo-wall-texture-pattern.jpg` and `_legacy/Ground037_1K-JPG*` were also
removed. The old baseline was a 964.3 MiB `public/` and a 966.15 MiB `dist/`. The old acceptance criteria ("CI fails
on budget") are replaced by the `build:pages` size check, because the project does not use GitHub CI.
