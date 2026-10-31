/**
 * Documentation checks. Each returns a list of human-readable problems (empty means healthy).
 *
 * They are run by `npm run docs:check` and by `tests/docs/documentation.test.ts`, so documentation drift
 * fails the same way a failing unit test does.
 */
import fs from "node:fs";
import path from "node:path";
import { moduleImportRuleViolations, newLayerViolations, repoRoot, scanProject, toPosix } from "./lib.mjs";
import { renderApiReference, renderArchitectureReference } from "./render.mjs";

export const generatedFiles = {
  "_docs/generated/ARCHITECTURE_REFERENCE.md": renderArchitectureReference,
  "_docs/generated/API_REFERENCE.md": renderApiReference,
};

/** Hand-written documents whose backticked `src/...` references must stay valid. */
export const referenceCheckedDocs = [
  "README.md",
  "_docs/ARCHITECTURE.md",
  "_docs/MATHEMATICAL_MODEL.md",
  "_docs/Development_guide.md",
  "_docs/DEVELOPMENT.md",
  "_docs/DEPLOYMENT.md",
  "_docs/Readme.md",
  "_docs/coding_style.md",
  "_docs/documentation_style.md",
  "_docs/tests.md",
];

export function checkModuleHeaders(modules) {
  const problems = [];
  for (const mod of modules.values()) {
    if (!mod.header || mod.header.replace(/\s+/g, " ").length < 30) {
      problems.push(`src/${mod.path}: missing module header comment (a leading /** ... */ block of at least one full sentence).`);
    }
  }
  return problems;
}

export function checkExportDocs(modules) {
  const problems = [];
  for (const mod of modules.values()) {
    for (const exp of mod.exports) {
      if (!exp.doc) problems.push(`src/${mod.path}: exported ${exp.kind} \`${exp.name}\` has no JSDoc.`);
    }
  }
  return problems;
}

export function checkLayering(modules) {
  return newLayerViolations(modules).map(
    (v) => `src/${v.from} imports src/${v.to} (${v.edge}); this violates the layering rules in scripts/docs/lib.mjs.`,
  );
}

export function checkModuleImportRules(modules) {
  return moduleImportRuleViolations(modules).map((v) => `src/${v.from} imports src/${v.to}; ${v.reason}`);
}

export function checkGeneratedFresh(modules) {
  const problems = [];
  for (const [rel, render] of Object.entries(generatedFiles)) {
    const file = path.join(repoRoot, rel);
    const expected = render(modules);
    const actual = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : undefined;
    if (actual !== expected) problems.push(`${rel} is stale; run \`npm run docs:generate\`.`);
  }
  return problems;
}

const refPattern = /`(src\/[A-Za-z0-9_./-]+?)(?:#([A-Za-z0-9_$]+))?`/g;

export function checkDocReferences(modules) {
  const problems = [];
  for (const rel of referenceCheckedDocs) {
    const file = path.join(repoRoot, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(refPattern)) {
      const [, target, symbol] = m;
      const abs = path.join(repoRoot, target);
      if (!fs.existsSync(abs)) {
        problems.push(`${rel}: references \`${target}\`, which does not exist.`);
        continue;
      }
      if (symbol) {
        const mod = modules.get(toPosix(path.relative(path.join(repoRoot, "src"), abs)));
        if (!mod) {
          problems.push(`${rel}: \`${target}#${symbol}\` points into a non-module file.`);
        } else if (!mod.declared.has(symbol)) {
          problems.push(`${rel}: \`${target}#${symbol}\` — no top-level declaration named \`${symbol}\` in that module.`);
        }
      }
    }
  }
  return problems;
}

export function runAllChecks() {
  const modules = scanProject();
  return {
    modules,
    results: {
      "module headers": checkModuleHeaders(modules),
      "exported JSDoc": checkExportDocs(modules),
      "layering": checkLayering(modules),
      "module import rules": checkModuleImportRules(modules),
      "generated documents": checkGeneratedFresh(modules),
      "document references": checkDocReferences(modules),
    },
  };
}
