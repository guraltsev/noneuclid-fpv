/**
 * Command-line entry for the test-suite hygiene tooling.
 *
 *   node scripts/tests/cli.mjs report     run the hygiene checks (H1-H10) and print the suite's indicators
 *   node scripts/tests/cli.mjs check      run the hygiene checks only (no indicators; faster)
 *   node scripts/tests/cli.mjs baseline   freeze today's violations into tests/hygiene-baseline.txt
 */
import fs from "node:fs";
import { allViolationKeys, baselinePath, collectIndicators, runHygieneChecks } from "./hygiene.mjs";

const [command = "report"] = process.argv.slice(2);

function printChecks() {
  const { results } = runHygieneChecks();
  let failed = false;
  for (const [rule, problems] of Object.entries(results)) {
    if (problems.length === 0) {
      console.log(`ok   ${rule}`);
      continue;
    }
    failed = true;
    console.log(`FAIL ${rule} (${problems.length})`);
    for (const problem of problems.slice(0, 15)) console.log(`     ${problem}`);
    if (problems.length > 15) console.log(`     ... and ${problems.length - 15} more`);
  }
  return failed;
}

function printIndicators() {
  const i = collectIndicators();
  console.log("");
  console.log("Indicators (_docs/tests.md §2.3):");
  console.log(`  test lines / src lines: ${i.testLines} / ${i.srcLines}`);
  for (const tier of ["unit", "process", "release", "report"]) {
    console.log(`  ${tier}: ${i.byTier[tier].files} file(s), ${i.byTier[tier].tests} test(s)`);
  }
  console.log(`  hygiene baseline: ${i.baselineTotal} total (${Object.entries(i.baselineByRule).map(([r, n]) => `${r}:${n}`).join(", ")})`);
  console.log(`  tests/_temp folders: ${i.tempFolders}; tests/_conditional folders: ${i.conditionalFolders}`);
  console.log(`  manual_smoke.md entries: ${i.manualSmokeEntries}`);
  console.log(`  unit tier serial time: ${(i.unitSerialMs / 1000).toFixed(2)}s`);
  console.log("  slowest unit files:");
  for (const f of i.unitSlowestFiles) console.log(`    ${(f.ms / 1000).toFixed(2)}s  ${f.file}`);
}

if (command === "check") {
  process.exit(printChecks() ? 1 : 0);
} else if (command === "report") {
  const failed = printChecks();
  printIndicators();
  process.exit(failed ? 1 : 0);
} else if (command === "baseline") {
  const keys = allViolationKeys();
  fs.writeFileSync(baselinePath, keys.length ? `${keys.join("\n")}\n` : "");
  console.log(`wrote ${keys.length} violation(s) to tests/hygiene-baseline.txt`);
} else {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
