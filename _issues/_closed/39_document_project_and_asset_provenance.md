# 39 - Document project and third-party asset provenance

Status: completed 2026-08-03.

Priority: P2 legal clarity and onboarding.

## Scope

This issue made the project understandable to students and educators, set the
license for project-authored work, and created a traceable record for the
third-party assets that can be identified. It does not authorize a guessed
license for an asset with missing history.

## Not done here

- The legacy files still marked **Blocked** in the canonical
  [asset provenance manifest](../../ASSET_PROVENANCE.md) need their original
  source and terms verified, replacement with documented assets, or removal
  from the public build input. This is the open, release-gated work in
  [issue 40](../40_resolve_unverified_public_assets.md).
- [Issue 34](../../.agents/jobs/02_asset_footprint_and_provenance.md) still
  needs to separate source-only material from deployed public assets. Until
  then, the manifest documents some files Vite copies even though the app does
  not request them.
- Running the full typecheck, test suite, and production build still requires a
  Node-enabled environment; this documentation issue does not replace that
  verification.

## Completed work

- [x] Rewrote the main README for students age 12+ and their educators. Its
  final section links to the separate [development guide](../../DEVELOPMENT.md)
  and [deployment guide](../../DEPLOYMENT.md), keeping implementation and
  deployment material out of the learner-facing document.
- [x] Added the root [MIT License](../../../LICENSE) for project-authored code
  and documentation, without changing third-party asset terms.
- [x] Added the canonical
  [asset provenance manifest](../../ASSET_PROVENANCE.md), including public
  paths, sources, creators, licenses, required credits, and source/runtime
  status. It records the source relationship for derived KTX2 textures.
- [x] Reconciled local notices for documented assets, including the traffic
  cone, bicycle, supplied UI icons, UXWing alphabet icons, and the UXWing carry
  icon with its white UI derivative.
- [x] Explicitly blocked unverified historical assets rather than relicensing
  them by assumption, and created the release-gated follow-up in
  [issue 40](../40_resolve_unverified_public_assets.md).
