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
  it("keeps module headers, exported JSDoc, layering, generated references and document links healthy", async () => {
    const { runAllChecks } = await loadChecks();
    const { results } = runAllChecks();

    for (const [name, problems] of Object.entries(results)) {
      // Report the first few problems of every failing check, not just the first failing check.
      expect({ check: name, problems: problems.slice(0, 15) }).toEqual({ check: name, problems: [] });
    }
  });
});
