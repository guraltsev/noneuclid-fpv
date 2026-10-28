# Deployment guide

This guide is for maintainers publishing a classroom instance. It is separate
from the main README so students and educators can focus on the mathematics.

## GitHub Pages

The site is published from [guraltsev/noneuclid-fpv](https://github.com/guraltsev/noneuclid-fpv)
at **https://guraltsev.github.io/noneuclid-fpv/**. Publishing is automatic: every
push to `main` runs the [Pages workflow](../.github/workflows/deploy-pages.yml),
which installs dependencies, builds the site and deploys it. The workflow does
**not** run the tests (they are heavy): run `npm test` locally before pushing.
Nothing needs to be run by hand.

### One-time setup (about two minutes)

1. Open the repository on GitHub, then **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions** (not
   "Deploy from a branch").
3. Open the **Actions** tab. Find the latest "Deploy GitHub Pages" run; if none
   exists, choose it on the left and press **Run workflow**.
4. Wait for both jobs (`build`, then `deploy`) to turn green. If asked, approve
   the `github-pages` environment.
5. Open the site address above. The same address appears on the finished
   `deploy` job and under Settings → Pages.

### Publishing a change

```sh
git add -A
git commit -m "Describe the change"
git push
```

That is all. Run `npm test` yourself before pushing, because the deploy does not
test anything. Watch the run in the Actions tab; after a minute or two the site
shows the change (force-refresh the browser, Ctrl+F5, if it looks stale). If the
build fails, the deploy is skipped and the old site stays up.

### Activity addresses

Add `?config=...` to the site address: `001` to `005` are the locked student
activities, and `full` is the unrestricted mode with the world and debug menus.
Per-activity settings live in `public/*.config.js`.

### Check a build locally first (optional)

```sh
VITE_BASE=/noneuclid-fpv/ npm run build:pages
npm run preview
```

Then open the printed address with `/noneuclid-fpv/` appended and try
`?config=001`. See also the
[base-path deployment issue](../_issues/37_align_pages_and_deployment_configuration.md).

### Troubleshooting

- **404 or blank page:** Pages source is not set to GitHub Actions, or the first
  workflow run has not finished.
- **Workflow does not start:** the push was not to `main`, or Actions are
  disabled under Settings → Actions.
- **Deploy fails with a permissions or environment error:** repeat setup step 2.
- **Floor textures missing:** only compressed `runtime/*.ktx2` textures are in
  the repository; see
  [issue 34](../_issues/34_reduce_deployment_and_repository_asset_footprint.md).
- **Do not use `npm run deploy:pages`** with this setup; it publishes a
  separate `gh-pages` branch and conflicts with the workflow.

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
[issue 34](../_issues/34_reduce_deployment_and_repository_asset_footprint.md), and
unverified historical files are tracked by
[issue 40](../_issues/40_resolve_unverified_public_assets.md).
