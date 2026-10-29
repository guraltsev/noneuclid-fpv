# 40 - Unverified public assets are deployed

Status: closed on 2026-10-29.

Priority: P1 legal release gate.

Jobs: [02](../../.agents/jobs/_done/02_asset_footprint_and_provenance.md).

## Outcome

Fixed by job 02. Every blocked or unreferenced file was removed from `public/`. The portal wall now uses a 64 x 64
checkerboard generated in code (`src/render/three/portalWallTexture.ts`), so no image of unknown origin is loaded or
deployed. The manifest's blocked table is replaced by a "None" note.

## Closing evidence

- Deleted: `_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg`, `_legacy/car.gltf`,
  `_legacy/scene.bin`, `_legacy/skybox-1.png`, `_legacy/skybox-2.jpg` to `skybox-6.jpg`, the unreferenced
  `_legacy/house-low-poly`, `imp`, `low_poly_cat_walk`, `low_poly_rabbit`, `low_poly_tree_wind`, and the duplicate
  `WoodenSign2/Wooden Sign2.png`.
- New tests: `tests/render-contract/portalWallTexture.test.ts`, the "registers the generated portal wall texture
  without downloading it" test in `tests/render-contract/preloadWorldAssets.test.ts`,
  `tests/assets/publicAssetPolicy.test.ts` (5 tests), `tests/scripts/checkDistSize.test.ts` (3 tests).
- `dist/` measured 53.4 MB (budget 64 MiB, enforced by `npm run build:pages` through `scripts/check-dist-size.mjs`).

## Old text

## Status update 2026-10-28

Done since filing:

- Two blocked entries are no longer tracked: `_legacy/photo-wall-texture-pattern.jpg`
  and `_legacy/Ground037_1K-JPG.zip` / `_legacy/Ground037_1K-JPG/**` do not
  appear in `git ls-files public/assets/_legacy`. The manifest row in
  `_docs/ASSET_PROVENANCE.md` ("Blocked, unverified, or incorrect historical
  records") still lists them and should drop them.

Still open (all still tracked and copied into every build):

- `_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg`
  (22 MB) is still runtime-requested on every world:
  `src/render/three/portalWallTexture.ts` (`PORTAL_WALL_TEXTURE_FILE`) is loaded
  unconditionally by `preloadWorldAssets` (`loadRequiredTexture`) and used by
  `buildPortalMesh.ts` via `createPortalWallMaterial`.
- `_legacy/car.gltf`, `_legacy/scene.bin`, `_legacy/skybox-1.png`,
  `_legacy/skybox-2.jpg` to `_legacy/skybox-6.jpg` are unreferenced by `src/`
  and `public/*.config.js` and can simply be removed (overlaps issue 34).

## Not done

The canonical [asset provenance manifest](../_docs/ASSET_PROVENANCE.md) identifies
the remaining historical files for which this repository cannot establish a
source, creator, or license. The legacy portal-wall image is among them. Vite
currently copies these files into builds.

## Fix

Tracked as job [02](../../.agents/jobs/_done/02_asset_footprint_and_provenance.md).

## Acceptance criteria

- No runtime-requested asset is marked blocked in the provenance manifest.
- Every remaining file in the public build input has a traceable license and
  required attribution.
- A clean production build no longer copies unverified historical assets.

## Completed work

- [x] Replaced the undocumented runtime carry PNGs with documented UXWing carry
  SVGs, including a white derivative for dark UI surfaces.
- [x] Recorded their exact source URL, UXWing terms, voluntary credit, and
  derivative status in the manifest and local icon notice.
- [x] Removed the old carry files and their runtime references, so no runtime
  icon remains blocked by this issue.
- [x] `photo-wall-texture-pattern.jpg` and the `Ground037_1K-JPG` archive and
  folder are no longer tracked (verified 2026-10-28).
