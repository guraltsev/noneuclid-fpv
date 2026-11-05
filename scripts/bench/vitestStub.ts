/**
 * Stands in for `vitest` when a benchmark imports a test fixture (the fixtures call `expect` while building scenes).
 * Every assertion is a no-op; the benchmark measures time, the tests check the scenes. See `vite.config.ts`.
 */
const anything: unknown = new Proxy(() => anything, { get: () => anything });

export function expect(_value?: unknown): unknown {
  return anything;
}
