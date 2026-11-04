import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// vite-node configuration for `npm run bench`: test fixtures import `expect` from vitest, which only works inside a
// running Vitest worker, so benchmarks get a no-op stand-in.
export default defineConfig({
  resolve: { alias: { vitest: path.join(path.dirname(fileURLToPath(import.meta.url)), "vitestStub.ts") } },
});
