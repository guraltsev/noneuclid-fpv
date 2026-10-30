/**
 * Source-scanning library shared by the documentation generator and checker.
 *
 * It reads every TypeScript module under `src/` with the TypeScript compiler API and extracts, per module:
 * the header comment, the resolved relative imports, and every exported declaration with its JSDoc.
 * Nothing here is hand-maintained, so documents built from it cannot drift from the code.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const srcRoot = path.join(repoRoot, "src");

/**
 * Architectural layers, lowest first, with the layers each may import.
 *
 * The first key segment of a module path under `src/` (e.g. `cell-complex`) names its layer. Edges outside
 * this table are reported as layering violations; known, accepted exceptions are listed in
 * {@link acceptedLayerExceptions} so that a *new* violation fails the check while history stays visible.
 */
export const layers = {
  math: { description: "Vectors, rigid transforms, planes, polygons, tolerances. Pure; imports nothing.", may: [] },
  "cell-complex": {
    description: "Prism-cell specs, compilation, portal transforms, portal-path tables, static visibility culling.",
    may: ["math"],
  },
  movement: { description: "Player body, collision, movement and portal crossing in compiled cell complexes.", may: ["math", "cell-complex"] },
  examples: { description: "Authored world scripts (data).", may: [] },
  "world-assets": { description: "Floor-texture and asset descriptors.", may: ["cell-complex", "glue"] },
  "world-objects": {
    description: "Placeable runtime objects: registry, geodesic emitters, measurement tools, flags, creatures.",
    may: ["math", "cell-complex", "movement", "world-assets", "glue"],
  },
  authoring: {
    description: "World builder DSL, world-script compiler, validation and world catalog.",
    may: ["math", "cell-complex", "examples", "world-assets", "world-objects"],
  },
  runtime: {
    description: "Runtime menu state, command dispatch, geometry session/worker and deformation families.",
    may: ["math", "cell-complex", "movement", "world-objects", "authoring", "ui", "glue"],
  },
  ui: {
    description: "Renderer-neutral palette, help, tooltip and input-intent definitions.",
    may: ["math", "cell-complex", "runtime", "world-objects", "authoring", "glue"],
  },
  glue: { description: "Launch options, debug settings, asset URLs, app configuration.", may: ["authoring", "runtime", "ui"] },
  render: { description: "Three.js / DOM / WebXR rendering and input adapters (the application shell).", may: ["*"] },
  root: { description: "Entry point and application state.", may: ["*"] },
};

export function toPosix(p) {
  return p.split(path.sep).join("/");
}

export function listSourceFiles(dir = srcRoot) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

export function layerOf(relPath) {
  const parts = relPath.split("/");
  if (parts.length === 1) return "root";
  return parts[0];
}

function jsDocText(node, sourceFile) {
  const docs = ts.getJSDocCommentsAndTags ? node.jsDoc : undefined;
  if (!docs || docs.length === 0) return undefined;
  const last = docs[docs.length - 1];
  const comment = typeof last.comment === "string" ? last.comment : ts.getTextOfJSDocComment(last.comment);
  const text = (comment ?? "").trim();
  return text.length > 0 ? text : undefined;
}

/** The leading JSDoc block of the file (before any import), as plain text. */
function headerComment(sourceFile) {
  const text = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, 0) ?? [];
  for (const range of ranges) {
    const raw = text.slice(range.pos, range.end);
    if (!raw.startsWith("/**")) continue;
    const body = raw
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n")
      .trim();
    return body.length > 0 ? body : undefined;
  }
  return undefined;
}

function hasExportModifier(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function signatureOf(node, sourceFile) {
  if (ts.isFunctionDeclaration(node)) {
    const params = node.parameters.map((p) => p.getText(sourceFile)).join(", ");
    const ret = node.type ? `: ${node.type.getText(sourceFile)}` : "";
    return `function ${node.name?.text ?? "default"}(${params})${ret}`.replace(/\s+/g, " ");
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map((d) => `const ${d.name.getText(sourceFile)}${d.type ? `: ${d.type.getText(sourceFile)}` : ""}`)
      .join("; ")
      .replace(/\s+/g, " ");
  }
  if (ts.isInterfaceDeclaration(node)) return `interface ${node.name.text}`;
  if (ts.isTypeAliasDeclaration(node)) return `type ${node.name.text}`;
  if (ts.isClassDeclaration(node)) return `class ${node.name?.text ?? "default"}`;
  if (ts.isEnumDeclaration(node)) return `enum ${node.name.text}`;
  return "";
}

/** Names declared by a top-level statement (used for exported symbols). */
function declaredNames(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name ? [node.name.text] : [];
  }
  return [];
}

function kindOf(node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isVariableStatement(node)) return "const";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isEnumDeclaration(node)) return "enum";
  return "other";
}

function resolveImport(fromRel, specifier, known) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier)).replace(/\.js$/, "");
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Scans all modules.
 * @returns {Map<string, ModuleInfo>} keyed by path relative to `src/`, with forward slashes.
 */
export function scanProject() {
  const files = listSourceFiles();
  const known = new Set(files.map((f) => toPosix(path.relative(srcRoot, f))));
  const modules = new Map();

  for (const file of files) {
    const rel = toPosix(path.relative(srcRoot, file));
    const text = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const imports = new Set();
    const exports = [];
    const declared = new Set();

    for (const statement of sourceFile.statements) {
      for (const name of declaredNames(statement)) declared.add(name);

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const resolved = resolveImport(rel, statement.moduleSpecifier.text, known);
        if (resolved) imports.add(resolved);
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const resolved = resolveImport(rel, statement.moduleSpecifier.text, known);
        if (resolved) imports.add(resolved);
      }

      if (hasExportModifier(statement)) {
        const names = declaredNames(statement);
        const doc = jsDocText(statement, sourceFile);
        for (const name of names) {
          exports.push({ name, kind: kindOf(statement), doc, signature: signatureOf(statement, sourceFile) });
        }
      }
    }

    // `new URL("./x.ts", import.meta.url)` worker entries count as dependencies.
    for (const m of text.matchAll(/new URL\(["'](\.[^"']+)["'],\s*import\.meta\.url/g)) {
      const resolved = resolveImport(rel, m[1], known);
      if (resolved) imports.add(resolved);
    }

    modules.set(rel, {
      path: rel,
      layer: layerOf(rel),
      lines: text.split("\n").length,
      header: headerComment(sourceFile),
      imports: [...imports].sort(),
      exports,
      declared,
    });
  }

  return modules;
}

/** Modules reachable from the application entry points (`src/main.ts`). */
export function reachableFrom(modules, entries = ["main.ts"]) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current) || !modules.has(current)) continue;
    seen.add(current);
    for (const dep of modules.get(current).imports) stack.push(dep);
  }
  return seen;
}

/** Aggregates module imports into directory-level (layer) edge counts. */
export function layerEdges(modules) {
  const edges = new Map();
  for (const mod of modules.values()) {
    for (const dep of mod.imports) {
      const to = modules.get(dep).layer;
      if (to === mod.layer) continue;
      const key = `${mod.layer} -> ${to}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges;
}

export function layerViolations(modules) {
  const violations = [];
  for (const mod of modules.values()) {
    for (const dep of mod.imports) {
      const to = modules.get(dep).layer;
      if (to === mod.layer) continue;
      const rule = layers[mod.layer];
      if (!rule) continue;
      if (rule.may.includes("*") || rule.may.includes(to)) continue;
      violations.push({ from: mod.path, to: dep, edge: `${mod.layer} -> ${to}` });
    }
  }
  return violations;
}

/**
 * Module-level import rules, for constraints that the layer table cannot express (it works per layer).
 *
 * Two shapes, with paths relative to `src/` using forward slashes:
 * - `{ module, allowedImporters, reason }`: any module that imports `module` and is not listed is a violation.
 * - `{ module, mayImportOnly, reason }`: any import of `module` whose path does not start with one of the prefixes
 *   (or equal a listed file) is a violation.
 */
export const moduleImportRules = [
  {
    module: "world-objects/geodesic/legacyConnection.ts",
    allowedImporters: ["world-objects/geodesicCannon.ts", "world-objects/geodesic/cannon.ts"],
    reason: "retired geodesic connection model; job 26 deletes it - do not add importers",
  },
  {
    module: "world-objects/geodesic/portalWord.ts",
    mayImportOnly: ["math/", "cell-complex/", "world-objects/geodesic/objects.ts"],
    reason: "the portal-word algebra is pure and may only use math, cell-complex and the geodesic object types",
  },
  {
    module: "world-objects/geodesic/development.ts",
    mayImportOnly: ["math/", "cell-complex/"],
    reason: "portal development is pure and may only use math and cell-complex",
  },
  {
    module: "world-objects/geodesic/trace.ts",
    mayImportOnly: ["math/", "cell-complex/", "movement/", "world-objects/geodesic/objects.ts", "world-objects/runtimeObjectRegistry.ts"],
    reason: "tracing may only use math, cell-complex, movement, the geodesic object types and the registry type",
  },
];

/** Violations of {@link moduleImportRules}: `{ from, to, reason }` for every import that breaks a rule. */
export function moduleImportRuleViolations(modules) {
  const violations = [];
  for (const rule of moduleImportRules) {
    if (rule.allowedImporters) {
      for (const mod of modules.values()) {
        if (!mod.imports.includes(rule.module)) continue;
        if (rule.allowedImporters.includes(mod.path)) continue;
        violations.push({ from: mod.path, to: rule.module, reason: rule.reason });
      }
    }
    if (rule.mayImportOnly) {
      const mod = modules.get(rule.module);
      if (!mod) continue;
      for (const dep of mod.imports) {
        if (rule.mayImportOnly.some((allowed) => dep === allowed || (allowed.endsWith("/") && dep.startsWith(allowed)))) continue;
        violations.push({ from: mod.path, to: dep, reason: rule.reason });
      }
    }
  }
  return violations;
}

/** Path of the frozen layering-debt baseline: module-level edges that violate {@link layers} today. */
export const layeringBaselinePath = path.join(repoRoot, "scripts", "docs", "layering-baseline.json");

export function loadLayeringBaseline() {
  if (!fs.existsSync(layeringBaselinePath)) return [];
  return JSON.parse(fs.readFileSync(layeringBaselinePath, "utf8")).edges ?? [];
}

/** Violations that are not in the frozen baseline (these fail the check). */
export function newLayerViolations(modules) {
  const baseline = new Set(loadLayeringBaseline());
  return layerViolations(modules).filter((v) => !baseline.has(`${v.from} -> ${v.to}`));
}
