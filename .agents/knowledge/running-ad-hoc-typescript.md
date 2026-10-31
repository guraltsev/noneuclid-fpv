# Running an ad hoc TypeScript script against `src/`

- There is no `tsx` or `ts-node`. `npx vite-node <script.ts>` works: `vite-node` ships with vitest.
- A script outside the repository (for example in a scratch directory) can import modules by absolute path, as
  dynamic imports: `await import("C:/Users/.../noneuclid-fpv/src/cell-complex/portalPaths.ts")`.
- For something worth keeping, prefer a benchmark script under `scripts/bench/`, run with `npm run bench -- <name>`,
  as `staticCull.bench.ts` (job 42) and `funnelStaticCull.bench.ts` (job 43) do.
