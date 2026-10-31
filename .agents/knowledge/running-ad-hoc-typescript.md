# Running an ad hoc TypeScript script against `src/`

- There is no `tsx` or `ts-node`. `npx vite-node <script.ts>` works: `vite-node` ships with vitest.
- A script outside the repository (for example in a scratch directory) can import modules by absolute path, as
  dynamic imports: `await import("C:/Users/.../noneuclid-fpv/src/cell-complex/portalPaths.ts")`.
- For something worth keeping, prefer a test file skipped unless an environment variable is set, as
  `tests/cell-complex/staticCullBenchmark.test.ts` and `tests/render-contract/funnelStaticCullBenchmark.test.ts` do.
