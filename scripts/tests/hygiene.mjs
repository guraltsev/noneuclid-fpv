/**
 * Test-suite hygiene checks (H1-H10 of `_docs/tests_hygiene.md` §6) and the suite's indicators
 * (`_docs/tests.md` §2.3).
 *
 * Checks parse test files as text, with regular expressions, like `scripts/docs/checks.mjs`. They are run by
 * `npm run test:report` and by the `unit` test `tests/project/testHygiene.test.ts` (which calls
 * {@link runHygieneChecks} only; {@link collectIndicators} shells out to Vitest and is for the CLI alone).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const baselinePath = path.join(repoRoot, "tests", "hygiene-baseline.txt");

const RULES = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

// Directories git ignores wholesale (`.gitignore`); walking the filesystem instead of shelling out to
// `git ls-files` keeps `gitTrackedFiles()` usable from the `unit` tier, which may touch only the process itself
// (`_docs/tests.md` §5). None of H1-H10 needs the finer-grained ignores (textures, key files), only these.
const IGNORED_DIR_NAMES = new Set([".git", "node_modules", "dist", ".vite", "coverage", "assets-src"]);

function listAllFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      out.push(...listAllFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function gitTrackedFiles() {
  return listAllFiles(repoRoot).map((abs) => toPosix(path.relative(repoRoot, abs)));
}

const TIER_SUFFIXES = [
  [".report.test.ts", "report"],
  [".release.test.ts", "release"],
  [".process.test.ts", "process"],
  [".test.ts", "unit"],
];

/** The tier a test module's path declares by its suffix (`_docs/tests.md` §8.2), or `undefined` outside `tests/`. */
export function tierOf(relPath) {
  if (!relPath.startsWith("tests/")) return undefined;
  for (const [suffix, tier] of TIER_SUFFIXES) {
    if (relPath.endsWith(suffix)) return tier;
  }
  return undefined;
}

const TEMP_REF_RE = /^tests\/_temp\/([^/]+)\//;

function tempRefOf(relPath) {
  return relPath.match(TEMP_REF_RE)?.[1];
}

/** Every tracked test module (a recognised tier suffix under `tests/`), with its text read once. */
function loadTestModules(allTracked) {
  return allTracked
    .filter((rel) => rel.startsWith("tests/"))
    .map((rel) => ({ rel, tier: tierOf(rel) }))
    .filter((m) => m.tier)
    .map((m) => ({
      ...m,
      abs: path.join(repoRoot, m.rel),
      text: fs.readFileSync(path.join(repoRoot, m.rel), "utf8"),
      tempRef: tempRefOf(m.rel),
    }));
}

function resolveRelativeImport(fromAbsFile, spec) {
  if (!spec.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromAbsFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.mjs")];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// H1: every test file's tier is declared by its suffix (_docs/tests.md §8.2); a test file outside tests/, or one
// under tests/ with the wrong suffix (*.spec.ts, *.test.js), has none.
// ---------------------------------------------------------------------------------------------------------------

const TEST_LIKE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/;

function checkH1(allTracked) {
  const violations = [];
  for (const rel of allTracked) {
    if (rel.startsWith("tests/")) continue;
    if (TEST_LIKE_RE.test(rel)) {
      violations.push({ file: rel, test: "-", message: "a test-like file lives outside tests/; move it under tests/<area>/ (tests.md §3)." });
    }
  }
  for (const rel of allTracked) {
    if (!rel.startsWith("tests/")) continue;
    if (/\.spec\.ts$/.test(rel) || /\.test\.js$/.test(rel)) {
      violations.push({ file: rel, test: "-", message: "wrong suffix for a tier; use .test.ts, .process.test.ts, .release.test.ts or .report.test.ts (tests.md §8.2)." });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H2: a unit-tier file touches no process/network boundary (_docs/tests.md §5).
// ---------------------------------------------------------------------------------------------------------------

const H2_BARE_SPECIFIERS = new Set(["node:child_process", "child_process", "node:net", "node:http", "node:https", "ws"]);
const H2_IMPORT_RE = /\bimport\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;

function checkH2(modules) {
  const violations = [];
  for (const mod of modules) {
    if (mod.tier !== "unit") continue;
    const hits = new Set();
    for (const m of mod.text.matchAll(H2_IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (H2_BARE_SPECIFIERS.has(spec)) {
        hits.add(`imports \`${spec}\``);
        continue;
      }
      if (spec.startsWith(".")) {
        const resolved = resolveRelativeImport(mod.abs, spec);
        const rel = resolved ? toPosix(path.relative(repoRoot, resolved)) : spec;
        if (rel.includes("scripts/server/") || rel.endsWith("scripts/smoke/staticServer.mjs")) {
          hits.add(`imports \`${rel}\``);
        }
      }
    }
    if (/\bfetch\(/.test(mod.text)) hits.add("calls `fetch(`");
    if (/\bnew\s+WebSocket\(/.test(mod.text)) hits.add("calls `new WebSocket(`");
    for (const hit of hits) {
      violations.push({ file: mod.rel, test: "-", message: `unit tier: ${hit}, a process or network boundary (tests.md §5).` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H3: a test module's imports that resolve into tests/ land only in tests/support/, tests/fixtures/ or
// tests/world-objects/geodesic/fixtures.ts; a _temp/<ref>/ file may also import its own ref's folder.
// ---------------------------------------------------------------------------------------------------------------

const H3_IMPORT_RE = /\bimport\s+(?:[^'"]+?\s+from\s+)?["'](\.[^"']+)["']/g;

function isAllowedTestImportTarget(rel) {
  return rel.startsWith("tests/support/") || rel.startsWith("tests/fixtures/") || rel === "tests/world-objects/geodesic/fixtures.ts";
}

function checkH3(modules) {
  const violations = [];
  for (const mod of modules) {
    for (const m of mod.text.matchAll(H3_IMPORT_RE)) {
      const resolved = resolveRelativeImport(mod.abs, m[1]);
      if (!resolved) continue;
      const rel = toPosix(path.relative(repoRoot, resolved));
      if (!rel.startsWith("tests/")) continue;
      if (isAllowedTestImportTarget(rel)) continue;
      if (mod.tempRef && rel.startsWith(`tests/_temp/${mod.tempRef}/`)) continue;
      violations.push({
        file: mod.rel,
        test: "-",
        message: `imports ${rel}, which is not tests/support/, tests/fixtures/ or tests/world-objects/geodesic/fixtures.ts (tests.md §3).`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H4: no mock of the product's own code, and no import of a name the product marks test/debug-only
// (_docs/tests.md §4.5, §6.3).
// ---------------------------------------------------------------------------------------------------------------

const H4_NAME_SUFFIX_RE = /\b[A-Za-z_$][\w$]*(?:ForDebug|ForTests)\b/g;
const H4_MOCK_RE = /\bvi\.(?:mock|doMock)\(\s*["']([^"']+)["']/g;
const H4_IMPORT_RE = /\bimport\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'](\.[^"']+)["']/g;

function jsDocMentionsTestOrDebug(srcText, name) {
  const declRe = new RegExp(
    `/\\*\\*((?:[^*]|\\*(?!/))*)\\*/\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+${name}\\b`,
  );
  const m = srcText.match(declRe);
  return m ? /for tests|for debugging/i.test(m[1]) : false;
}

function checkH4(modules) {
  const violations = [];
  const srcTextCache = new Map();
  const readSrcText = (abs) => {
    if (!srcTextCache.has(abs)) srcTextCache.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined);
    return srcTextCache.get(abs);
  };

  for (const mod of modules) {
    const suffixHits = new Set([...mod.text.matchAll(H4_NAME_SUFFIX_RE)].map((m) => m[0]));
    for (const hit of suffixHits) {
      violations.push({ file: mod.rel, test: "-", message: `uses \`${hit}\`, a name marked test/debug-only; add a real public query (tests.md §6.3).` });
    }

    for (const m of mod.text.matchAll(H4_MOCK_RE)) {
      if (!m[1].startsWith(".")) continue;
      const resolved = resolveRelativeImport(mod.abs, m[1]);
      if (!resolved) continue;
      const rel = toPosix(path.relative(repoRoot, resolved));
      if (rel.startsWith("src/")) {
        violations.push({ file: mod.rel, test: "-", message: `mocks \`${rel}\`, a module of the product's own code (tests.md §4.5).` });
      }
    }

    for (const m of mod.text.matchAll(H4_IMPORT_RE)) {
      const resolved = resolveRelativeImport(mod.abs, m[2]);
      if (!resolved) continue;
      const rel = toPosix(path.relative(repoRoot, resolved));
      if (!rel.startsWith("src/")) continue;
      const braceMatch = m[1].match(/^\{([^}]*)\}$/);
      if (!braceMatch) continue;
      const srcText = readSrcText(resolved);
      if (!srcText) continue;
      for (const part of braceMatch[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (jsDocMentionsTestOrDebug(srcText, name)) {
          violations.push({
            file: mod.rel,
            test: "-",
            message: `imports \`${name}\` from ${rel}, whose JSDoc says it exists for tests/debugging (tests.md §6.3).`,
          });
        }
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H5/H6 share the extraction of it(/test(/describe( literal names, including a `.each(...)`/`.skipIf(...)` chain.
// ---------------------------------------------------------------------------------------------------------------

function skipBalancedParens(text, openIndex) {
  let depth = 0;
  let inString;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === inString) inString = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inString = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

function readQuotedString(text, startIndex) {
  const quote = text[startIndex];
  let out = "";
  let i = startIndex + 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      out += c + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === quote) return { name: out, endIndex: i + 1 };
    out += c;
  }
  return { name: out, endIndex: i };
}

/** Every literal name of an `it(`, `test(` or `describe(` call (through any `.skip`/`.each(...)` chain). */
function extractTestNames(text) {
  const names = [];
  const callRe = /\b(?:it|test|describe)\b/g;
  let m;
  while ((m = callRe.exec(text))) {
    let i = m.index + m[0].length;
    let safety = 0;
    let found;
    while (safety++ < 10) {
      while (/\s/.test(text[i] ?? "")) i++;
      if (text[i] === ".") {
        i++;
        while (/[A-Za-z0-9_$]/.test(text[i] ?? "")) i++;
        while (/\s/.test(text[i] ?? "")) i++;
        if (text[i] === "(") {
          i = skipBalancedParens(text, i);
          continue;
        }
        break;
      }
      if (text[i] === "(") {
        let j = i + 1;
        while (/\s/.test(text[j] ?? "")) j++;
        const quote = text[j];
        if (quote === '"' || quote === "'" || quote === "`") found = readQuotedString(text, j);
      }
      break;
    }
    if (found) names.push(found.name);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------------------------
// H5: no issue/job/stage/batch/plan-id/numbered-prefix reference in a permanent test's name or comment
// (_docs/tests.md §4.1, §4.2).
// ---------------------------------------------------------------------------------------------------------------

const H5_WORD_RE = /\b(?:issue|job|stage|batch)\s*#?\d+/i;
const H5_PLAN_ID_RE = /^[A-Z]\d{1,2}[a-z]?[:.]\s/;
const H5_NUMBERED_RE = /^\d+[a-z]?[.)]\s/;

function historyReason(s) {
  if (H5_WORD_RE.test(s)) return "an issue/job/stage/batch reference";
  if (H5_PLAN_ID_RE.test(s)) return "a plan-id prefix";
  if (H5_NUMBERED_RE.test(s)) return "a numbered prefix";
  return undefined;
}

const COMMENT_RE = /\/\*\*?[\s\S]*?\*\/|\/\/[^\n]*/g;

function extractComments(text) {
  return [...text.matchAll(COMMENT_RE)].map((m) => m[0]);
}

function checkH5(modules) {
  const violations = [];
  for (const mod of modules) {
    if (mod.tempRef) continue;
    const reportedNames = new Set();
    for (const name of extractTestNames(mod.text)) {
      const reason = historyReason(name);
      if (reason && !reportedNames.has(name)) {
        reportedNames.add(name);
        violations.push({ file: mod.rel, test: name, message: `the name carries history (${reason}); name the behaviour instead (tests.md §4.1).` });
      }
    }
    const reportedComments = new Set();
    for (const comment of extractComments(mod.text)) {
      const cleaned = comment
        .replace(/^\/\*\*?|\*\/$/g, "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\*?\s?\/?\/?/, "").trim())
        .filter(Boolean);
      let reason = H5_WORD_RE.test(comment) ? "an issue/job/stage/batch reference" : undefined;
      for (const line of cleaned) {
        if (!reason && H5_PLAN_ID_RE.test(line)) reason = "a plan-id prefix";
        if (!reason && H5_NUMBERED_RE.test(line)) reason = "a numbered prefix";
      }
      const key = comment.slice(0, 80);
      if (reason && !reportedComments.has(key)) {
        reportedComments.add(key);
        violations.push({ file: mod.rel, test: "-", message: `a comment carries history (${reason}); move it to the commit message (tests.md §4.2).` });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H6: every test module has a leading module doc comment of at least 30 characters, before its imports; every
// test name is at most 90 characters (_docs/tests.md §4.1, §4.2).
// ---------------------------------------------------------------------------------------------------------------

function leadingModuleComment(text) {
  const m = text.replace(/^﻿/, "").match(/^\s*\/\*\*((?:[^*]|\*(?!\/))*)\*\//);
  if (!m) return undefined;
  return m[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkH6(modules) {
  const violations = [];
  for (const mod of modules) {
    if (mod.tempRef) continue;
    const header = leadingModuleComment(mod.text);
    if (!header || header.length < 30) {
      violations.push({ file: mod.rel, test: "-", message: "missing a leading module doc comment of at least 30 characters, before its imports (tests.md §4.2)." });
    }
    for (const name of extractTestNames(mod.text)) {
      if (name.length > 90) {
        violations.push({ file: mod.rel, test: name, message: `the name is ${name.length} characters, over the 90-character limit (tests.md §4.1).` });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H7: every tests/_conditional/<name>/ has a README with until, expires (unexpired) and purpose
// (tests_hygiene.md §2.1).
// ---------------------------------------------------------------------------------------------------------------

function listRefDirs(allTracked, prefix) {
  const names = new Set();
  const re = new RegExp(`^${prefix}/([^/]+)/`);
  for (const rel of allTracked) {
    const m = rel.match(re);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

function checkH7(allTracked) {
  const violations = [];
  for (const name of listRefDirs(allTracked, "tests/_conditional")) {
    const readmeRel = `tests/_conditional/${name}/README.md`;
    const abs = path.join(repoRoot, readmeRel);
    if (!fs.existsSync(abs)) {
      violations.push({ file: readmeRel, test: "-", message: "missing README.md with until:, expires: and purpose: (tests_hygiene.md §2.1)." });
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    if (!/^until:\s*\S.*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing until: (tests_hygiene.md §2.1)." });
    if (!/^purpose:\s*\S.*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing purpose: (tests_hygiene.md §2.1)." });
    const expiresMatch = text.match(/^expires:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
    if (!expiresMatch) {
      violations.push({ file: readmeRel, test: "-", message: "README.md is missing a valid expires: YYYY-MM-DD (tests_hygiene.md §2.1)." });
    } else if (Number.isNaN(Date.parse(expiresMatch[1])) ) {
      violations.push({ file: readmeRel, test: "-", message: `README.md's expires: ${expiresMatch[1]} is not a valid date (tests_hygiene.md §2.1).` });
    } else if (Date.parse(expiresMatch[1]) < Date.now()) {
      violations.push({ file: readmeRel, test: "-", message: `README.md's expires: ${expiresMatch[1]} has passed; confirm the condition and move the date, or retire the tests (tests_hygiene.md §2.1).` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H8: every tests/_temp/<ref>/ has a README with ref, kind, purpose and fate, and its ref is open
// (tests_hygiene.md §3.2, §3.3).
// ---------------------------------------------------------------------------------------------------------------

function jobOrIssueIsOpen(ref) {
  const jobMatch = ref.match(/^job(\d+)$/i);
  if (jobMatch) {
    const dir = path.join(repoRoot, ".agents", "jobs");
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && new RegExp(`^${jobMatch[1]}_.*\\.md$`).test(e.name));
  }
  const issueMatch = ref.match(/^issue(\d+)$/i);
  if (issueMatch) {
    const dir = path.join(repoRoot, "_issues");
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && new RegExp(`^${issueMatch[1]}_.*\\.md$`).test(e.name));
  }
  return false;
}

function checkH8(allTracked) {
  const violations = [];
  for (const name of listRefDirs(allTracked, "tests/_temp")) {
    const readmeRel = `tests/_temp/${name}/README.md`;
    const abs = path.join(repoRoot, readmeRel);
    if (!fs.existsSync(abs)) {
      violations.push({ file: readmeRel, test: "-", message: "missing README.md with ref:, kind:, purpose: and fate: (tests_hygiene.md §3.2)." });
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    if (!/^ref:\s*\S.*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing ref: (tests_hygiene.md §3.2)." });
    if (!/^kind:\s*(guard|report)\s*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing kind: guard or kind: report (tests_hygiene.md §3.2)." });
    if (!/^purpose:\s*\S.*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing purpose: (tests_hygiene.md §3.2)." });
    if (!/^fate:\s*\S.*$/m.test(text)) violations.push({ file: readmeRel, test: "-", message: "README.md is missing fate: (tests_hygiene.md §3.2)." });
    if (!jobOrIssueIsOpen(name)) {
      violations.push({ file: readmeRel, test: "-", message: `ref ${name} is closed; finish the exit review and delete tests/_temp/${name}/ (tests_hygiene.md §3.3).` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// H9: no skipped/filtered test and no process.env outside tests/_temp/ (_docs/tests.md §3, §4.7).
// ---------------------------------------------------------------------------------------------------------------

function checkH9(modules) {
  const violations = [];
  for (const mod of modules) {
    if (mod.tempRef) continue;
    if (/\.(?:skip|skipIf|todo|only)\s*\(/.test(mod.text)) {
      violations.push({ file: mod.rel, test: "-", message: "uses .skip(/.skipIf(/.todo(/.only( outside tests/_temp/ (tests.md §3, §4.7)." });
    }
    if (/\bprocess\.env\b/.test(mod.text)) {
      violations.push({ file: mod.rel, test: "-", message: "reads process.env outside tests/_temp/ (tests.md §3, §4.7)." });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline (H10) and the runner.
// ---------------------------------------------------------------------------------------------------------------

function violationKey(rule, file, test) {
  return `${rule}\t${file}\t${test || "-"}`;
}

export function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return [];
  return fs
    .readFileSync(baselinePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function collectRawViolations(allTracked, modules) {
  return {
    H1: checkH1(allTracked),
    H2: checkH2(modules),
    H3: checkH3(modules),
    H4: checkH4(modules),
    H5: checkH5(modules),
    H6: checkH6(modules),
    H7: checkH7(allTracked),
    H8: checkH8(allTracked),
    H9: checkH9(modules),
  };
}

function loadContext() {
  const allTracked = gitTrackedFiles();
  const modules = loadTestModules(allTracked);
  return { allTracked, modules };
}

/** Every current violation's baseline key, rule by rule, independent of `tests/hygiene-baseline.txt`. */
export function allViolationKeys() {
  const { allTracked, modules } = loadContext();
  const raw = collectRawViolations(allTracked, modules);
  const keys = new Set();
  for (const rule of RULES) {
    for (const v of raw[rule]) keys.add(violationKey(rule, v.file, v.test));
  }
  return [...keys].sort();
}

/**
 * Runs H1-H10. A violation listed in `tests/hygiene-baseline.txt` is suppressed (it is known debt); a new one
 * fails under its rule; a baseline line matching no current violation fails under H10 (the ratchet).
 */
export function runHygieneChecks() {
  const { allTracked, modules } = loadContext();
  const raw = collectRawViolations(allTracked, modules);
  const baseline = new Set(loadBaseline());
  const used = new Set();

  const results = {};
  for (const rule of RULES) {
    results[rule] = [];
    for (const v of raw[rule]) {
      const key = violationKey(rule, v.file, v.test);
      if (baseline.has(key)) {
        used.add(key);
        continue;
      }
      const testPart = v.test && v.test !== "-" ? ` ["${v.test}"]` : "";
      results[rule].push(`${v.file}${testPart}: ${v.message}`);
    }
  }

  results.H10 = [...baseline]
    .filter((key) => !used.has(key))
    .sort()
    .map((key) => {
      const [rule, file, test] = key.split("\t");
      const testPart = test && test !== "-" ? ` ["${test}"]` : "";
      return `${file}${testPart}: remove this line from the baseline (${rule}); no current violation matches it.`;
    });

  return { results };
}

// ---------------------------------------------------------------------------------------------------------------
// Indicators (_docs/tests.md §2.3).
// ---------------------------------------------------------------------------------------------------------------

function sumLines(allTracked, prefix) {
  let lines = 0;
  for (const rel of allTracked) {
    if (!rel.startsWith(prefix)) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    lines += fs.readFileSync(abs, "utf8").split(/\r?\n/).length;
  }
  return lines;
}

function countItTest(text) {
  return [...text.matchAll(/\b(?:it|test)\s*\(/g)].length;
}

function manualSmokeEntryCount() {
  const abs = path.join(repoRoot, "tests", "manual_smoke.md");
  if (!fs.existsSync(abs)) return 0;
  return [...fs.readFileSync(abs, "utf8").matchAll(/^##\s+M\d/gm)].length;
}

function unitTierSerialTiming() {
  const outFile = path.join(os.tmpdir(), `noneuclid-unit-report-${process.pid}.json`);
  try {
    execSync(`npx vitest run --project unit --no-file-parallelism --reporter=json --outputFile="${outFile}"`, {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Vitest exits non-zero on a failing run; the JSON file is still written and still useful for timing.
  }
  if (!fs.existsSync(outFile)) return { totalMs: 0, slowest: [] };
  const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
  fs.rmSync(outFile, { force: true });
  const files = (report.testResults ?? []).map((r) => ({
    file: toPosix(path.relative(repoRoot, r.name)),
    ms: r.endTime - r.startTime,
  }));
  const totalMs = files.reduce((sum, f) => sum + f.ms, 0);
  const slowest = [...files].sort((a, b) => b.ms - a.ms).slice(0, 10);
  return { totalMs, slowest };
}

/** The indicators of `_docs/tests.md` §2.3, printed by `npm run test:report`. Shells out to Vitest once. */
export function collectIndicators() {
  const { allTracked, modules } = loadContext();
  const baseline = loadBaseline();
  const baselineByRule = {};
  for (const rule of RULES) baselineByRule[rule] = 0;
  for (const key of baseline) {
    const rule = key.split("\t")[0];
    baselineByRule[rule] = (baselineByRule[rule] ?? 0) + 1;
  }

  const byTier = { unit: { files: 0, tests: 0 }, process: { files: 0, tests: 0 }, release: { files: 0, tests: 0 }, report: { files: 0, tests: 0 } };
  for (const mod of modules) {
    byTier[mod.tier].files += 1;
    byTier[mod.tier].tests += countItTest(mod.text);
  }

  const { totalMs, slowest } = unitTierSerialTiming();

  return {
    testLines: sumLines(allTracked, "tests/"),
    srcLines: sumLines(allTracked, "src/"),
    byTier,
    baselineTotal: baseline.length,
    baselineByRule,
    tempFolders: listRefDirs(allTracked, "tests/_temp").length,
    conditionalFolders: listRefDirs(allTracked, "tests/_conditional").length,
    manualSmokeEntries: manualSmokeEntryCount(),
    unitSerialMs: totalMs,
    unitSlowestFiles: slowest,
  };
}
