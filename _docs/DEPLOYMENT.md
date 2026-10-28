# Deployment guide

This guide is for maintainers publishing a classroom instance. It is separate
from the main README so students and educators can focus on the mathematics.

## GitHub Pages

The checked-in [Pages workflow](../.github/workflows/deploy-pages.yml) installs
dependencies, runs tests, builds `dist/`, adds `.nojekyll`, and deploys the
artifact. In the repository settings, set Pages to use **GitHub Actions**.

The source project is named `noneuclid-fpv`. A Pages repository can have a
different name, such as `camp-2026-VR`; that deployment name determines the
Pages path, not the project identity. Supply the target base path explicitly
when verifying a project-page build:

```sh
VITE_BASE=/camp-2026-VR/ npm run build:pages
npm run preview
```

Then visit the preview under `/camp-2026-VR/` and check at least one locked
scenario URL such as `?config=001`. The active
[base-path deployment issue](issues/37_align_pages_and_deployment_configuration.md)
tracks removal of the remaining legacy fallback from the helper scripts; do not
rely on a package name to choose a Pages repository.

## HTTPS and WebXR

WebXR requires a secure context. GitHub Pages provides HTTPS. For local headset
testing, use a trusted HTTPS server and certificate appropriate for the device;
plain HTTP on a LAN is not enough. `localhost` is normally treated as secure by
browsers for desktop development, but it is not a substitute for a headset
connecting from another device.

Check a release on the actual deployment URL before class: the page loads under
the intended base path, the selected config loads, static models and floor
textures appear, and the browser offers VR only when the device supports it.

## Release gate for assets

Before publishing, review [asset provenance](ASSET_PROVENANCE.md). Do not add an
unrecorded file to `public/`; Vite copies that directory into a release. The
asset footprint and source/runtime split are tracked by
[issue 34](issues/34_reduce_deployment_and_repository_asset_footprint.md), and
unverified historical files are tracked by
[issue 40](issues/40_resolve_unverified_public_assets.md).
