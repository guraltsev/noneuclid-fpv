import { defineConfig } from "vitest/config";

function resolveBase(): string {
  const configuredBase = process.env.VITE_BASE?.trim();

  if (!configuredBase || configuredBase === "/") {
    return "/";
  }

  return `/${configuredBase.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

export default defineConfig({
  base: resolveBase(),
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
