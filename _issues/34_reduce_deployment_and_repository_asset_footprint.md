# 34 - Reduce deployment and repository asset footprint

Status: open as of 2026-08-03T14:24:10-05:00.

Priority: P0 deployment reliability.

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
- Move authoring/source texture material outside `public`.
- Remove unused `_legacy` assets from the deployed graph.
- Keep only generated runtime KTX2, required models, licenses, icons, and
  transcoder files in the public build input.
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
