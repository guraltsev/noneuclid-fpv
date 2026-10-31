# Deployment guide

This guide is for maintainers publishing a classroom instance. It is separate
from the main README so students and educators can focus on the mathematics.

## GitHub Pages

The site is published from [guraltsev/noneuclid-fpv](https://github.com/guraltsev/noneuclid-fpv). The `gh_pages`
branch holds one built folder per published branch; the stable version is at
**https://guraltsev.github.io/noneuclid-fpv/main/** and the root redirects there. Setup, the `npm run publish:branch`
command, the optional push hook and the optional workflow are described in [PUBLISHING.md](PUBLISHING.md).

A local pre-push hook (`.githooks/pre-push`, enabled by `npm install` or `npm run setup:hooks`) runs
`npm run typecheck`, `npm test`, `npm run build` and a headless smoke test of two worlds (skipped with a warning when no
Chromium-based browser is found) and refuses the push if any fails. Publishing itself does not test anything.
`git push --no-verify` skips the hook.

Before publishing you can run the browser smoke check (optional, needs a Chromium-based browser):

```sh
npm run build:pages -- --base noneuclid-fpv
npm run smoke -- --world cube,dodecahedron,torus-moduli
```

After publishing, check the live site with
`npm run smoke -- --url https://guraltsev.github.io/noneuclid-fpv/main/ --world cube`.
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
  disabled under Settings â†’ Actions.
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
connecting from another device. A manual headset checklist is in `_docs/acceptance-checklists.md` ("Headset smoke checklist (manual)").

### Local HTTPS server for a headset

The recommended way is the Node server, `npm run server`. It serves `dist/` at the site root over HTTPS (default port
11446, certificate `wwwserver/server-certificate.pfx`), prints the address of every network interface, and marks the
`index.html` it serves with `<meta name="noneuclid-server">` so the page knows it came from this server. Cross-platform
alternative: the Rebex Tiny Web Server in `wwwserver/` (Windows only, steps 4 and 5 below).

1. Run `npm run build` (base `/`, because the server serves `dist/` at the root).
2. Find the PC's LAN IPv4 address with `ipconfig`.
3. Create the certificate (below).
4. Run `npm run server`. Options: `--port <n>`, `--host <h>`, `--dist <dir>`, `--pfx <file>`, `--http` (plain HTTP, no
   headset), `--dev` (dev mode). The pfx passphrase is read from `NONEUCLID_PFX_PASSPHRASE` (default: the local test
   password below).
5. On the headset, open `https://<printed address>:11446/?config=001` and accept the certificate warning.

The server also hosts the channel for [interactive debugging of any device](interactive-browser-debugging.md). Set
`NONEUCLID_ADMIN_PASSWORD` before `npm run server` to allow admin connections (`npm run cdp -- --server ...`); without
it the server refuses them and says so at start. `--dev` additionally allows evaluating arbitrary expressions on devices.

Certificate: in Git Bash, run these two OpenSSL commands from `wwwserver/`, with the PC's address in place of
`192.168.1.50`:

   ```sh
   cd wwwserver
   MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365      -keyout server.key -out server-certificate.cer      -subj "/CN=192.168.1.50" -addext "subjectAltName=IP:192.168.1.50,DNS:localhost"
   openssl pkcs12 -export -out server-certificate.pfx -inkey server.key -in server-certificate.cer      -passout pass:my-super-secure-password -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
   ```

Rebex alternative: it is configured to serve `dist/` on HTTP port 1183 and HTTPS port 11446 with the same certificate.
Start `wwwserver/RebexTinyWebServer.exe`, press Start, and open `https://<address>:11446/?config=001` on the headset.

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
