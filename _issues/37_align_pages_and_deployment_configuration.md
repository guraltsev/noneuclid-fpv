# 37 - Make Pages deployment repository-name agnostic

Status: open as of 2026-08-03T14:24:10-05:00.

Priority: P2 developer/release tooling.

Scope clarified on 2026-08-03T14:28:10-05:00: `noneuclid-fpv` is the
multi-year project identity. Names such as `camp-2026-VR` identify particular
yearly or ad-hoc deployment repositories and must remain variable.

## Problem

The reusable project and a deployed instance do not necessarily have the same
name. `scripts/build-pages.mjs` currently falls back to the package name, so a
local `npm run build:pages` assumes `/noneuclid-fpv/` even when the target is a
yearly repository such as `/camp-2026-VR/` or another ad-hoc deployment.
Changing the package name for every deployment would incorrectly couple the
multi-year source project to one instance.

`scripts/deploy-pages.sh` also assumes a Git remote named `origin` and derives
the Pages base from that remote. The audited checkout uses a remote named
`github`, and another deployment may use any configured remote or URL.
Production Actions override the base correctly, but local verification and the
exposed deploy script are not reusable across deployment repositories.

## Required work

- Keep a stable multi-year package/project name independent of deployment
  repository names.
- Establish one base-path precedence contract, for example: explicit CLI or
  `VITE_BASE`, GitHub Pages workflow metadata, selected deployment remote, then
  a clearly documented local-root fallback.
- Do not use the package name as an implicit Pages repository name.
- Make build and deployment scripts accept a remote name, remote URL, or
  explicit repository/base name instead of assuming `origin`.
- Derive the repository basename robustly for HTTPS and SSH remote formats when
  inference is requested, including repositories that have been renamed.
- Print the resolved target remote and base path before building or pushing,
  and fail before mutation when they cannot be resolved unambiguously.
- Ensure local preview documentation exercises the Pages subpath.
- Add base-path behavior to the browser smoke test in issue 36.

## Acceptance criteria

- The same unchanged source checkout can deploy correctly to two differently
  named test repositories by changing only explicit deployment context.
- Local and production Pages builds emit the same URL base for a selected
  deployment repository.
- The package/project name remains stable across yearly deployments.
- The deployment command works with any selected configured remote, or fails
  early with a clear non-mutating configuration message.
- README documentation distinguishes the multi-year project from example
  yearly/ad-hoc deployment URLs.
