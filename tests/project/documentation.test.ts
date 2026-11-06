/**
 * `tests/project/documentation.test.ts` — unit tier.
 *
 * `scripts/docs/checks.mjs` is the documentation rule checker `npm run docs:check` runs: every module has a
 * header comment, every exported symbol has JSDoc, layering rules hold, generated references are up to date, and
 * every document link resolves. This test runs the same checks the command does and fails with every problem
 * found, not just the first.
 */
import { describe, expect, it } from "vitest";

// The documentation tooling is plain ESM JavaScript; load it through a variable path so the
// type checker treats it as `any` instead of requiring declaration files for the scripts folder.
const checksPath = "../../scripts/docs/checks.mjs";

interface DocChecks {
  runAllChecks(): { results: Record<string, string[]> };
}

async function loadChecks(): Promise<DocChecks> {
  return (await import(/* @vite-ignore */ checksPath)) as DocChecks;
}

describe("documentation", () => {
  it("keeps module headers, JSDoc, layering, generated references and document links healthy", async () => {
    const { runAllChecks } = await loadChecks();
    const { results } = runAllChecks();

    for (const [name, problems] of Object.entries(results)) {
      // Report the first few problems of every failing check, not just the first failing check.
      expect({ check: name, problems: problems.slice(0, 15) }).toEqual({ check: name, problems: [] });
    }
    // The legacy-writer check builds a TypeScript program of all of src/, a few seconds on a loaded machine.
  }, 60000);
});
