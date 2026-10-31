# Running an ad hoc TypeScript script against `src/`

- There is no `tsx` or `ts-node`. `npx vite-node <script.ts>` works: `vite-node` ships with vitest.
- A script outside the repository (for example in a scratch directory) can import modules by absolute path, as
  dynamic imports: `await import("C:/Users/.../noneuclid-fpv/src/cell-complex/portalPaths.ts")`.
- For something worth keeping, prefer a benchmark script under `scripts/bench/`, run with `npm run bench -- <name>`,
  as `staticCull.bench.ts` (job 42) and `funnelStaticCull.bench.ts` (job 43) do.
- `vi` (from `"vitest"`) and `vi.mock` do not work under plain `vite-node`: `import { vi } from "vitest"` throws
  "Vitest failed to access its internal state" the moment anything touches it, because there is no running Vitest
  worker behind it. A benchmark that needs to replace a module's exports (job 43 tried this for a
  constructor-counting benchmark) cannot use `vi.mock` outside the test runner.
- `three`'s package build is genuine ESM with frozen, non-configurable export bindings (confirmed by probing
  `vite-node`: `Object.defineProperty(THREE, "Vector3", ...)` throws "Cannot redefine property"). You cannot
  monkey-patch a `three` class from outside to count or wrap its constructor calls in a plain script; that trick
  only works inside Vitest, which routes every import through its own mocker. A benchmark that wants to measure
  allocation has to use `process.memoryUsage().heapUsed` deltas (or `node --expose-gc`) instead.
