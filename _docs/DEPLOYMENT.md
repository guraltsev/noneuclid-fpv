# Deployment guide

This guide is for maintainers publishing a classroom instance. It is separate
from the main README so students and educators can focus on the mathematics.

## GitHub Pages

The site is published from [guraltsev/noneuclid-fpv](https://github.com/guraltsev/noneuclid-fpv)
at **https://guraltsev.github.io/noneuclid-fpv/**. Publishing is automatic: every
push to `main` runs the [Pages workflow](../.github/workflows/deploy-pages.yml),
which installs dependencies, builds the site and deploys it. The workflow does
**not** run the tests (they are heavy). Instead a local pre-push hook
(`.githooks/pre-push`, enabled by `npm install` or `npm run setup:hooks`) runs `npm run typecheck` and
`npm test` and refuses the push if either fails.
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

That is all. `git push` first runs the pre-push hook (about a minute); the
deploy itself does not test anything. `git push --no-verify` skips the hook,
so use it only when you know the checks are irrelevant. Watch the run in the Actions tab; after a minute or two the site
shows the change (force-refresh the browser, Ctrl+F5, if it looks stale). If the
build fails, the deploy is skipped and the old site stays up.

### Activity addresses

Add `?config=...` to the site address: `001` to `005` are the locked student
activities, and `full` is the unrestricted mode with the world and debug menus.
Per-activity settings live in `public/*.config.js`.

### Check a build locally first (optional)

```sh
npm run build:pages -- --base noneuclid-fpv
VITE_BASE=noneuclid-fpv npm run preview
```

Then open `http://localhost:4173/noneuclid-fpv/?config=001`. Write the base
without a leading slash, because Git Bash rewrites `/noneuclid-fpv/` into a
Windows path, and `build:pages` refuses such a value. The preview also needs
`VITE_BASE`, or it serves the app's files as HTML. `build:pages` never guesses
the base: it takes `--base <name>` or `VITE_BASE`, prints the base it uses, and
fails before building when neither is given (use `--base .` for a site at a
domain root).

### Deploying another instance (yearly or ad-hoc repository)

`noneuclid-fpv` is the project; an instance such as `camp-2026-VR` is just
another GitHub repository with the same source.

- Push the same source to the new repository and do the one-time setup in it.
- The workflow takes the base from GitHub Pages, so no file changes.
- To check locally, use `--base camp-2026-VR` and `VITE_BASE=camp-2026-VR`.
- Do not rename the package.

### Troubleshooting

- **404 or blank page:** Pages source is not set to GitHub Actions, or the first
  workflow run has not finished.
- **Workflow does not start:** the push was not to `main`, or Actions are
  disabled under Settings → Actions.
- **Deploy fails with a permissions or environment error:** repeat setup step 2.
- **Floor textures missing:** only compressed `runtime/*.ktx2` textures are in
  the repository; texture sources are not (see
  [job 02](../.agents/jobs/_done/02_asset_footprint_and_provenance.md) and
  `public/assets/textures/README.md`).
- **Every asset 404s or the page is blank locally:** the build and the preview
  use different bases. Run both with the same `--base`/`VITE_BASE` value.
- **`build:pages` says the base looks like a Windows path:** drop the leading
  slash (Git Bash rewrote it).

## HTTPS and WebXR

WebXR requires a secure context. GitHub Pages provides HTTPS. For local headset
testing, use a trusted HTTPS server and certificate appropriate for the device;
plain HTTP on a LAN is not enough. `localhost` is normally treated as secure by
browsers for desktop development, but it is not a substitute for a headset
connecting from another device.

### Local HTTPS server for a headset

`wwwserver/` holds the Rebex Tiny Web Server, configured to serve `dist/` at the
site root on HTTP port 1183 and HTTPS port 11446, with the certificate
`wwwserver/server-certificate.pfx`.

1. Run `npm run build` (base `/`, because the server serves `dist/` at the root).
2. Find the PC's LAN IPv4 address with `ipconfig`.
3. In Git Bash, run these two OpenSSL commands from `wwwserver/`, with that
   address in place of `192.168.1.50`:

   ```sh
   cd wwwserver
   MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365      -keyout server.key -out server-certificate.cer      -subj "/CN=192.168.1.50" -addext "subjectAltName=IP:192.168.1.50,DNS:localhost"
   openssl pkcs12 -export -out server-certificate.pfx -inkey server.key -in server-certificate.cer      -passout pass:my-super-secure-password -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
   ```

4. Start `wwwserver/RebexTinyWebServer.exe` and press Start.
5. On the headset, open `https://<address>:11446/?config=001` and accept the
   certificate warning.

The certificate files are ignored by Git and must never be committed. The
password in the server config is a local test setting, not a secret.

Check a release on the actual deployment URL before class: the page loads under
the intended base path, the selected config loads, static models and floor
textures appear, and the browser offers VR only when the device supports it.

## Release gate for assets

Before publishing, review [asset provenance](ASSET_PROVENANCE.md). Do not add an
unrecorded file to `public/`; Vite copies that directory into a release.
`npm run build:pages` fails when `dist/` exceeds the 64 MiB budget (`npm run size:dist` prints the report), and
`tests/assets/publicAssetPolicy.test.ts` guards `public/`.
