import { defineWorkspace } from "vitest/config";

/**
 * The four test tiers of `_docs/tests.md` §5, each a Vitest project extending the shared `vite.config.ts`.
 * `npm run test:unit`, `npm test`, `npm run test:release` and `npm run test:report` select projects by name
 * (`--project <name>`); the project names below must match those commands (`_docs/tests.md` §8.2).
 */
export default defineWorkspace([
  {
    extends: "./vite.config.ts",
    test: {
      name: "unit",
      include: ["tests/**/*.test.ts"],
      exclude: ["**/node_modules/**", "**/*.process.test.ts", "**/*.release.test.ts", "**/*.report.test.ts"],
      setupFiles: ["tests/support/unitSetup.ts"],
    },
  },
  {
    extends: "./vite.config.ts",
    test: {
      name: "process",
      include: ["tests/**/*.process.test.ts"],
    },
  },
  {
    // `passWithNoTests` is a root-only run option in Vitest 1.6 (omitted from `ProjectConfig`), so it cannot be
    // set here; `npm run test:release` passes `--passWithNoTests` on the command line instead (a Deviation of
    // job 41, recorded in its Report).
    extends: "./vite.config.ts",
    test: {
      name: "release",
      include: ["tests/**/*.release.test.ts"],
    },
  },
  {
    extends: "./vite.config.ts",
    test: {
      name: "report",
      // Report modules run only when named by path (_docs/tests_hygiene.md §8 "Report runs"); they are excluded
      // from every other project's include pattern, and this project is never selected by a bare `vitest run`.
      include: ["tests/_temp/**/*.report.test.ts"],
    },
  },
]);
