# 80 - Tighten type strictness, add linting, and configure the bundle

Status: open as of 2026-10-08.

Priority: P2 (tooling / performance); bundle items P3.

## Summary

`strict` is on but the index-safety flags are off, there is no linter, and `vite.config.ts` has no build configuration:
everything ships in one 1.44 MB JS chunk, all ten example worlds are compiled at module load, and a dependency worker is
emitted unbundled. The world-script surface uses `new Function` with a `with` scope, which is fine for bundled scripts but
must stay closed to user input and blocks a strict CSP.

## Evidence

- `tsconfig.json`: `strict: true`; no `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noPropertyAccessFromIndexSignature`. Turning on `noUncheckedIndexedAccess` gives 330 errors: `src/render` 84,
  `src/cell-complex` 60, `src/world-objects` 46, `src/math` 13, `src/authoring` 12, `src/runtime` 2, tests 113.
  Top files: `geodesicCannon.ts` 46, `staticPortalPathCull.ts` 39, `visiblePortalPaths.ts` 21, `polygons.ts` 13,
  `prismBase.ts` 12, `validateAuthoringSpec.ts` 12. These are exactly the polygon/side-index loops where an off-by-one
  yields `undefined` silently.
- `package.json`: no ESLint/Prettier; nothing catches floating promises, `any` (`vrPaletteLibraryAdapter.ts` uses
  `Component<any>` at :1427-1620), or `!` non-null assertions in tests.
- `vite.config.ts:13-18` sets only `base` and `test`; no `build.rollupOptions`, `worker.format`, or chunk limits.
- Last `dist/assets`: `index-*.js` 1,442,486 B (single chunk: three + uikit + app), `inter-*.js` 423,250 B (uikit font
  as JS), `worldGeometryWorker-*.js` 28,682 B, `worker-*.js` 41,907 B. The latter starts with
  `import { expose, transfer } from "comlink"` and `// src/wasm/msdfgen_wasm.js`: a dependency worker copied without
  bundling; the bare `comlink` specifier cannot resolve in a browser (verify whether it is ever instantiated).
- `src/authoring/exampleWorlds.ts:21-57` compiles all ten `src/examples/*.world.js` scripts eagerly on import (header
  :3 says a broken example breaks every importer); only one world is used per run.
- `src/authoring/compileWorldScript.ts:85` runs scripts via `new Function("scope", "with (scope) {...}")`; the header
  (:3) correctly calls it "not a security sandbox". Scripts come only from `?raw` imports today
  (`exampleWorlds.ts:7-16`); `?world=` is resolved by id through `worldCatalog.ts:85` (`normalizeWorldId`), so no
  user-supplied source reaches `new Function`. `glue/appConfig.ts:115` dynamically imports `<name>.config.js` from the
  public base; the name is restricted to `[a-zA-Z0-9_-]` (:154), so it is same-origin only.

## Proposed change

Strictness (staged by directory to keep PRs small):
1. Add `tsconfig.strict.json` extending the base with `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `exactOptionalPropertyTypes`, and `include: ["src/math", "src/movement", "src/runtime"]`; run it in `npm run
   typecheck`. Widen `include` one directory per PR (`cell-complex`, `authoring`, `world-objects`, `render`, `tests`),
   then fold into `tsconfig.json`.
2. Add a `math/indexing.ts` helper (`at(array, i)` throwing on out-of-range, `cyclicNext/Prev`) for polygon loops instead
   of scattering `!`.

Lint: add `typescript-eslint` (type-aware) with `no-floating-promises`, `no-explicit-any`, `no-non-null-assertion` (warn in
tests), `consistent-type-imports`, `import/no-cycle`; run in CI (issue 36).

Bundle (`vite.config.ts`):
1. `build.rollupOptions.output.manualChunks`: `three`, `uikit` (`@pmndrs/*`), `app`.
2. Load the VR palette (`vrPaletteLibraryAdapter` + uikit + Inter font) via dynamic `import()` on first palette open or
   XR entry, so desktop first paint does not pay 423 KB of font + uikit.
3. Make `exampleWorlds.ts` lazy: a map `id -> () => import("../examples/x.world.js?raw")`, compile only the requested
   world; keep a test that compiles all of them.
4. Set `worker: { format: "es" }` explicitly; fix or exclude the msdfgen worker (e.g. `optimizeDeps`/alias, or confirm
   unused and drop it).
5. Add `rollup-plugin-visualizer` (or `vite-bundle-visualizer`) script `npm run build:analyze` and a size budget check
   in CI (e.g. main chunk < 700 KB minified).

World scripts: keep `new Function` but document in `docs/ARCHITECTURE.md` that world scripts must never be loaded from
URL or user upload; if that is ever wanted, run them in a Worker with no DOM and return only JSON spec data. Add a CSP
note: deployment needs `script-src 'unsafe-eval'` while scripts are evaluated at runtime; alternatively precompile
examples to JSON specs at build time (a small Vite plugin) and remove runtime eval entirely.

## Acceptance criteria

- `noUncheckedIndexedAccess` and `noImplicitOverride` enabled for all of `src` and `tests`, zero errors.
- `npm run lint` exists and passes in CI.
- Main JS chunk under the agreed budget; three, uikit and app are separate chunks; uikit/Inter load only when a palette
  is shown.
- Only the selected example world is compiled at startup.
- No emitted asset contains a bare npm import specifier.
