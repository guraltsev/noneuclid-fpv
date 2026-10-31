import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base: the built site works from any path (a Pages folder, the local server, a domain root). Public
  // files are addressed through src/glue/assetUrls.ts, which resolves them against the page.
  base: "./",
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/math/**", "src/cell-complex/**", "src/movement/**"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 92 },
    },
  },
});
