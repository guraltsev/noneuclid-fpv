# 23 - Make lighting stable across portal traversal

Status: closed on 2026-05-28.

## Outcome

Issue 23 is complete.

The renderer lighting rig is now centralized in a small module, uses a portal-stable stylized setup, keeps shadows disabled, and has renderer-contract coverage.

## Implemented changes

- [src/render/three/sceneLighting.ts](../../../src/render/three/sceneLighting.ts) centralizes the stylized lighting policy and lifecycle.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) uses the lighting helper instead of hard-coding the rig inline.
- [tests/render-contract/sceneLighting.test.ts](../../../tests/render-contract/sceneLighting.test.ts) covers the lighting contract.

## Verification

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`
