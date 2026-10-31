/**
 * The test suite follows its own hygiene policy (`_docs/tests_hygiene.md` §6, checks H1-H10): every test
 * module declares a tier by its suffix, a unit-tier module touches no process or network boundary, test
 * modules import only from the shared support/fixture folders, nothing imports a test/debug-only name from
 * `src/`, no test name or comment carries history, every module has a doc comment and short test names, every
 * `_conditional`/`_temp` folder has a valid README, no test is skipped or gated by an environment variable
 * outside `_temp/`, and `tests/hygiene-baseline.txt` only ever shrinks. This reads repository files read-only
 * (a filesystem walk, not `git ls-files`, so it stays in the process itself), which the unit tier allows.
 */
import { describe, expect, it } from "vitest";

// The hygiene tooling is plain ESM JavaScript; load it through a variable path so the type checker treats it
// as `any` instead of requiring declaration files for the scripts folder (as tests/docs/documentation.test.ts does).
const hygienePath = "../../scripts/tests/hygiene.mjs";

interface HygieneChecks {
  runHygieneChecks(): { results: Record<string, string[]> };
}

async function loadHygiene(): Promise<HygieneChecks> {
  return (await import(/* @vite-ignore */ hygienePath)) as HygieneChecks;
}

describe("test suite hygiene", () => {
  it("keeps every hygiene check (H1-H10) clean, beyond the frozen baseline", async () => {
    const { runHygieneChecks } = await loadHygiene();
    const { results } = runHygieneChecks();

    for (const [rule, problems] of Object.entries(results)) {
      // Report the first few problems of every failing rule, not just the first failing rule.
      expect({ rule, problems: problems.slice(0, 15) }).toEqual({ rule, problems: [] });
    }
  });
});
