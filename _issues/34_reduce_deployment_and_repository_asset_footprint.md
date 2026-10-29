# 34 - Reduce deployment and repository asset footprint

Status: open; re-verified 2026-10-28.

Priority: P0 deployment reliability.

## Status update 2026-10-28

Done:

- Raw texture sources are no longer in the build input. Under
  `public/assets/textures/` only `README.md` and the twelve
  `*/runtime/*_color.ktx2` files are tracked, and `.gitignore` ignores
  `public/assets/textures/*/*` except `runtime/`. No `.blend`, `.zip`, `.exr`,
  `.psd`, `.fbx` or `.obj` file is tracked under `public` (`git ls-files public`).
- Tracked `public` content is 78,716,478 B (about 75 MiB; textures 35.0 MB,
  `_legacy` 36.3 MB), against the 964.3 MiB baseline. The CI Pages build checks
  out a clean tree, so its artifact is bounded by that plus the JS bundle
  (about 1.9 MB, see issue 80). A fresh build was not run for this
  re-verification; the 967 MB `dist/` on disk (built 2026-10-28 15:51) still
  contains the raw `.blend`/JPG sources because they were present locally at
  build time, so it does not represent a clean-checkout build.

Still open:

- Unreferenced `_legacy` files are still deployed: `car.gltf`, `scene.bin`,
  `skybox-1.png` to `skybox-6.jpg`, `house-low-poly/`, `imp/`,
  `low_poly_cat_walk/`, `low_poly_rabbit/`, `low_poly_tree_wind/` (about
  4.4 MB; no reference in `src/` or `public/*.config.js`). The largest file,
  the 22 MB portal-wall JPG, is runtime-requested and tracked by issue 40.
- No decision on where source textures live. They are simply absent from the
  repository now; `scripts/texture-build/floor-texture-config.mjs` still reads
  `sourcePath` values under `public/assets/textures/<name>/...`, and
  `public/assets/textures/README.md` still says to put downloaded folders under
  `public/assets/textures/` and that the sources "remain temporarily public".
  A maintainer who restores sources there gets them copied into a local
  `dist/` again (ignored by Git, not by Vite).
- No artifact size report or budget: `.github/workflows/deploy-pages.yml` only
  installs, builds and deploys.
- No recorded check that every runtime-referenced asset loads in
  representative worlds after the move.
- `_docs/ASSET_PROVENANCE.md` ("Floor textures") still describes the source
  folders as temporarily public.
- The Git object pack is still 1.32 GiB (`git count-objects -vH`); history
  reduction remains out of scope.

## Problem

The `public` directory measured 964.3 MiB and the existing `dist` directory
measured 966.15 MiB. Approximately 920.9 MiB of tracked public content is not in
the small runtime-oriented set. Raw 4K JPG/PNG/EXR maps, Blend authoring files,
ZIP archives, and legacy assets are placed under `public`, so Vite copies them
into every site build even when application code never requests them.

The Git object pack is also 1.32 GiB, making clones, CI checkout, caching, and
history maintenance unnecessarily expensive.

Issue 18 reduced runtime GPU texture use but intentionally left source assets
inside `public`; this issue corrects the packaging boundary without undoing its
KTX2 runtime work.

## Required work

- Inventory actual runtime URL references from world definitions and source.
- ~~Move authoring/source texture material outside `public`.~~ Done: removed
  from the tracked tree and ignored; the rebuild paths still need a home (see
  status update).
- Remove unused `_legacy` assets from the deployed graph.
- Keep only generated runtime KTX2, required models, licenses, icons, and
  transcoder files in the public build input. (Textures done; unused `_legacy`
  files remain.)
- Decide whether source assets belong in Git LFS, a separate source-asset
  archive, or an external reproducible download/build process.
- Add a build artifact size report and a reviewed maximum-size budget to CI.
- Preserve all third-party license/provenance records while moving assets.

History rewriting is not required for the first fix. If repository-history
reduction is proposed later, it must be handled as a separately approved,
coordinated migration.

## Acceptance criteria

- A Pages build no longer contains raw authoring texture maps or authoring files.
- Every runtime-referenced asset still loads in representative worlds.
- The resulting artifact is measured and materially smaller than the 966.15
  MiB baseline.
- CI fails with a readable message if the agreed artifact budget is exceeded.
- Texture rebuild documentation uses source paths outside the deployed public
  graph.
