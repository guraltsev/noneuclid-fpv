/**
 * Command-line entry for the documentation tooling.
 *
 *   node scripts/docs/cli.mjs generate        rewrite _docs/generated/*
 *   node scripts/docs/cli.mjs check           fail on missing docs, stale generated files, layering or reference errors
 *   node scripts/docs/cli.mjs baseline        freeze today's layering violations into layering-baseline.json
 *   node scripts/docs/cli.mjs coverage [dir]  list undocumented modules/exports (optionally under src/<dir>)
 *   node scripts/docs/cli.mjs writers         list every client write of the world, then the counts later jobs compare
 */
import fs from "node:fs";
import path from "node:path";
import { layerViolations, layeringBaselinePath, repoRoot, scanClientWrites, scanProject } from "./lib.mjs";
import { generatedFiles, runAllChecks } from "./checks.mjs";

const [command = "check", argument] = process.argv.slice(2);

if (command === "generate") {
  const modules = scanProject();
  for (const [rel, render] of Object.entries(generatedFiles)) {
    const file = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, render(modules));
    console.log(`wrote ${rel}`);
  }
} else if (command === "baseline") {
  const edges = layerViolations(scanProject()).map((v) => `${v.from} -> ${v.to}`).sort();
  fs.writeFileSync(layeringBaselinePath, JSON.stringify({ comment: "Known layering violations. Remove entries as they are fixed; never add new ones.", edges }, null, 2) + "\n");
  console.log(`froze ${edges.length} layering violation(s)`);
} else if (command === "coverage") {
  const modules = scanProject();
  const prefix = argument ? `${argument.replace(/^src\//, "").replace(/\/$/, "")}/` : "";
  let missingHeaders = 0;
  let missingExports = 0;
  for (const mod of modules.values()) {
    if (!mod.path.startsWith(prefix)) continue;
    if (!mod.header) {
      missingHeaders += 1;
      console.log(`header  src/${mod.path}`);
    }
    for (const exp of mod.exports) {
      if (!exp.doc) {
        missingExports += 1;
        console.log(`export  src/${mod.path}  ${exp.kind} ${exp.name}`);
      }
    }
  }
  console.log(`\n${missingHeaders} module(s) without header, ${missingExports} undocumented export(s).`);
} else if (command === "writers") {
  const writers = [...scanClientWrites().values()].filter((client) => client.namesWriter || client.writes.length > 0 || client.mutatorUses.length > 0);
  let writes = 0;
  let mutatorUses = 0;
  for (const client of writers) {
    writes += client.writes.length;
    mutatorUses += client.mutatorUses.length;
    console.log(`src/${client.path}: ${client.writes.length} direct write(s), ${client.mutatorUses.length} mutator use(s)${client.namesWriter ? ", names LegacyWorldWriter" : ""}`);
    for (const write of client.writes) console.log(`  ${write.line}  write   ${write.text}`);
    for (const use of client.mutatorUses) console.log(`  ${use.line}  mutator ${use.name}`);
  }
  console.log(`\n${writers.length} file(s), ${writes} direct write call(s), ${mutatorUses} mutator use(s).`);
} else if (command === "check") {
  const { results } = runAllChecks();
  let failed = false;
  for (const [name, problems] of Object.entries(results)) {
    if (problems.length === 0) {
      console.log(`ok   ${name}`);
      continue;
    }
    failed = true;
    console.log(`FAIL ${name} (${problems.length})`);
    for (const problem of problems.slice(0, 40)) console.log(`     ${problem}`);
    if (problems.length > 40) console.log(`     ... and ${problems.length - 40} more`);
  }
  process.exit(failed ? 1 : 0);
} else {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
