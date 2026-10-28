# Deployment guide

This guide is for maintainers publishing a classroom instance. It is separate
from the main README so students and educators can focus on the mathematics.

## GitHub Pages

Upstream is [guraltsev/noneuclid-fpv](https://github.com/guraltsev/noneuclid-fpv).
A deployment is simply a copy of it (a fork, or a new repository you push the
code to) with GitHub Pages switched on. The checked-in
[Pages workflow](../.github/workflows/deploy-pages.yml) installs dependencies,
runs the tests, builds `dist/`, adds `.nojekyll`, and publishes the result.

### One-time setup

1. **Get your own repository.** Either fork upstream on GitHub (Fork button), or
   create an empty repository and push the code to it:

   ```sh
   git remote rename origin upstream        # keep a pointer to the original
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```

2. **Enable Pages with GitHub Actions.** In the repository on GitHub open
   *Settings → Pages*, and under *Build and deployment → Source* choose
   **GitHub Actions**. Do not choose "Deploy from a branch".
3. **Allow the workflow to run.** In a fork, open the *Actions* tab and click
   "I understand my workflows, go ahead and enable them". Workflow permissions
   need no change: the workflow requests `pages: write` and `id-token: write`
   itself.
4. **Publish.** Push to the default branch (or run *Actions → Deploy GitHub
   Pages → Run workflow*). The `build` job tests and builds; the `deploy` job
   publishes. The first run may ask you to approve the `github-pages`
   environment under *Settings → Environments*.
5. **Open the site** at `https://<you>.github.io/<repo>/`; the address is also
   shown on the workflow run. Activities are `?config=001` to `?config=005`, and
   `?config=full` opens the unrestricted debug mode (see the README).

The base path (`/<repo>/`) is detected automatically by the workflow, so the
repository can be named anything, such as `camp-2026-VR`. That name decides the
URL only; the project identity stays `noneuclid-fpv`. For a user or organization
site (`<you>.github.io` repository) the base path is `/`.

### Updating a deployment

- Every push to the default branch redeploys. A failing test blocks the deploy.
- To pull in upstream changes:

  ```sh
  git fetch upstream
  git merge upstream/main      # or: git rebase upstream/main
  git push origin main
  ```

- Per-class variants live in `public/*.config.js` (menus, tools, starting world,
  debug defaults). Edit or copy one, and link to it with `?config=<name>`.
- After changing the README's activity links, point them at your own site.

### Checking a build locally

Supply the target base path explicitly when verifying a project-page build:

```sh
VITE_BASE=/<repo>/ npm run build:pages
npm run preview
```

Then visit the preview under `/<repo>/` and check at least one locked scenario
URL such as `?config=001`. The active
[base-path deployment issue](../_issues/37_align_pages_and_deployment_configuration.md)
tracks removal of the remaining legacy fallback from the helper scripts; do not
rely on a package name to choose a Pages repository.

### Troubleshooting

- **404 or a blank page:** the base path does not match the repository name.
  Rebuild with the correct `VITE_BASE`, or let the workflow set it.
- **Workflow does not start:** Actions are disabled on the fork, or the push was
  not to the default branch.
- **Deploy job fails with a permissions or environment error:** Pages source is
  not set to *GitHub Actions* (step 2).
- **Floor textures missing:** only the compressed `runtime/*.ktx2` textures are
  tracked. Source maps are intentionally not in the repository; see
  [issue 34](../_issues/34_reduce_deployment_and_repository_asset_footprint.md).
- **Alternative script:** `npm run deploy:pages` force-pushes a build to a
  `gh-pages` branch. Use it only with Pages set to "Deploy from a branch", and
  never together with the Actions workflow.

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
