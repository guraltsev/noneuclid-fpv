# 40 - Resolve or remove unverified public assets

Status: open as of 2026-08-03.

Priority: P1 legal release gate.

## Not done

The canonical [asset provenance manifest](../ASSET_PROVENANCE.md) identifies
the remaining historical files for which this repository cannot establish a
source, creator, or license. The legacy portal-wall image is among them. Vite
currently copies these files into builds.

## Required to close this issue

- For each blocked path, locate the original acquisition record and add a
  source URL, creator, license version, and required attribution; **or** replace
  it with a documented asset; **or** remove it from the public build input.
- Replace or verify the legacy portal-wall image before a release that includes
  it.
- Update `docs/ASSET_PROVENANCE.md`, local notices, and any affected world or
  renderer references in the same change.

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
