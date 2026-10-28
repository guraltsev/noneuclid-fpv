# 03 - Tech stack and deployment

## Recommended stack

Use:

- TypeScript,
- Vite,
- Three.js,
- WebXR through Three.js,
- Vitest for unit and contract tests,
- Playwright later for browser smoke tests,
- GitHub Pages branch deployment for static hosting.

Do not use React, Next.js, A-Frame, Unity, Godot, or a backend in the first implementation.

The proof of concept used A-Frame successfully, but the rebuild should prefer direct Three.js so the runtime and mathematical contracts stay visible to the developer.

## Why this stack

Vite gives a minimal browser app scaffold with a static build directory.

Three.js exposes a WebXR manager through `WebGLRenderer`, so the project can use ordinary Three.js scenes and then add XR entry when ready.

Vitest is close to the Vite toolchain and is suitable for fast behavior tests of geometry, specs, movement, and tools.

Playwright is reserved for browser smoke tests, not mathematical correctness.

## Package scripts

The first `package.json` should expose these scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc --noEmit && vite build",
    "build:pages": "VITE_BASE=/${npm_package_name}/ npm run build",
    "preview": "vite preview",
    "deploy:pages": "bash scripts/deploy-pages.sh"
  }
}
```

Revise `build:pages` if the repository name differs from the package name. The important contract is that GitHub Pages under `/<repo>/` uses a matching Vite `base`.

## Vite config

Use a configurable base path.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  test: {
    environment: "node",
  },
});
```

Do not add routing infrastructure. Keep the app as a single static page. If a later UI needs multiple screens, use internal state or hash fragments, not a router.

## GitHub Pages deployment from branch

The requested deployment path is:

1. Build locally.
2. Commit the compiled `dist/` output to a branch.
3. Configure GitHub Pages to serve that branch.

Use a `gh-pages` branch whose root contains the built static files.

Create `scripts/deploy-pages.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_name="$(basename -s .git "$(git config --get remote.origin.url)")"
export VITE_BASE="/${repo_name}/"

npm run build

deploy_dir="$(mktemp -d)"
cp -R dist/. "${deploy_dir}/"
touch "${deploy_dir}/.nojekyll"

git -C "${deploy_dir}" init
git -C "${deploy_dir}" checkout -b gh-pages
git -C "${deploy_dir}" add .
git -C "${deploy_dir}" commit -m "Deploy GitHub Pages"
git -C "${deploy_dir}" remote add origin "$(git config --get remote.origin.url)"
git -C "${deploy_dir}" push --force origin gh-pages

rm -rf "${deploy_dir}"
```

The human must then configure the repository's Pages settings to deploy from the `gh-pages` branch, root folder.

Do not add GitHub Actions unless the user asks for it later.

## Local classroom serving

Keep local development simple:

```bash
npm run dev -- --host 0.0.0.0
```

For VR headset testing over a local network, expect secure-origin issues. GitHub Pages provides HTTPS for remote hosting. For local classroom LAN hosting, add an HTTPS local server only when testing confirms it is needed.

Do not spend milestone 0 building a local HTTPS solution unless the first headset test requires it.

## Static asset rules

Put simple public assets in:

```text
public/assets/
```

Use low-poly `.glb` or `.gltf` assets only when they are small, licensed, and necessary for orientation or comfort. Do not let asset loading logic become part of the mathematical runtime.

## References checked during design

Vite's deployment docs say that GitHub Pages under `https://<USERNAME>.github.io/<REPO>/` needs `base: '/<REPO>/'`.

GitHub Pages can publish from a selected branch and folder.

MDN documents WebXR as available only in secure contexts in some or all supporting browsers, and MDN's secure-context page treats localhost as potentially trustworthy for local development.

Three.js documents `WebXRManager` as the abstraction of the WebXR Device API used by `WebGLRenderer`.

## Closing note

Closed as a one-off stack and deployment scaffold issue.

The requested stack is now installed and represented in project files:
TypeScript, Vite, Three.js, Vitest, configurable Vite base support, and a
branch-based GitHub Pages deployment script. Playwright and WebXR-specific
controls remain deferred, as requested by the handoff.

## Evidence for closing

- `package.json` defines `dev`, `typecheck`, `test`, `test:watch`, `build`,
  `build:pages`, `preview`, and `deploy:pages`.
- `vite.config.ts` uses `process.env.VITE_BASE ?? "/"` and configures Vitest
  with the Node environment.
- `scripts/deploy-pages.sh` builds locally and force-pushes built `dist/`
  contents to a `gh-pages` branch root with `.nojekyll`.
- `public/assets/README.md` documents the static asset boundary.
- `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` passed after
  the scaffold was added.
