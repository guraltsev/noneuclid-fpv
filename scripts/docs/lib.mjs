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
 * Architectural layers in a strict order, lowest first: the key order of this table *is* the layer order.
 *
 * The first key segment of a module path under `src/` (e.g. `cell-complex`) names its layer. A layer may import only layers
 * listed *before* it (`may` names the ones it actually uses; `"*"` means every layer before it), so the layer graph is a DAG
 * by construction; `tests/docs/layering.test.ts` asserts it. Edges outside this table are reported as layering violations;
 * known, accepted exceptions are listed in `layering-baseline.json` so that a *new* violation fails the check while history
 * stays visible.
 */
export const layers = {
  math: { description: "Vectors, rigid transforms, planes, polygons, tolerances. Pure; imports nothing.", may: [] },
  examples: { description: "Authored world scripts (data).", may: [] },
  "cell-complex": {
    description: "Prism-cell specs, compilation, portal transforms, portal-path tables, static visibility culling, deformation families.",
    may: ["math"],
  },
  diagnostics: {
    description: "Debug levels and the runtime diagnostics recorder that every layer above may report to.",
    may: ["math", "cell-complex"],
  },
  visibility: {
    description: "Per-frame portal visibility: funnel clipping of portal-path tables against a camera. Pure; no renderer.",
    may: ["math", "cell-complex"],
  },
  movement: { description: "Player body, collision, movement and portal crossing in compiled cell complexes.", may: ["math", "cell-complex"] },
  "world-assets": { description: "Floor-texture and asset descriptors.", may: ["cell-complex"] },
  "world-objects": {
    description: "Placeable runtime objects: registry, geodesic emitters, measurement tools, flags, creature behaviors.",
    may: ["math", "cell-complex", "diagnostics", "movement", "world-assets"],
  },
  authoring: {
    description: "World builder DSL, world-script compiler, validation and world catalog.",
    may: ["math", "cell-complex", "examples", "world-assets", "world-objects"],
  },
  glue: {
    description: "Launch options, debug settings, tool ids, asset URLs, app configuration.",
    may: ["math", "cell-complex", "diagnostics", "authoring"],
  },
  interaction: {
    description: "Renderer-free interaction logic: input frames, aim picking, VR locomotion, XR session state, carried-object portal transitions.",
    may: ["math", "cell-complex", "movement", "world-objects", "glue"],
  },
  runtime: {
    description: "Application state, runtime menu state, command dispatch, geometry session/worker, server channel and public API.",
    may: ["math", "cell-complex", "diagnostics", "movement", "world-objects", "authoring", "glue"],
  },
  ui: {
    description: "Renderer-neutral palette, help, tooltip and input-intent definitions.",
    may: ["math", "cell-complex", "world-objects", "authoring", "glue", "runtime"],
  },
  render: { description: "Three.js / DOM / WebXR rendering and input adapters (the application shell).", may: ["*"] },
  root: { description: "Entry point.", may: ["*"] },
};

/** The layer names, lowest first. */
export const layerOrder = Object.keys(layers);

/** Whether a module of layer `from` may import a module of layer `to` (`"*"` stands for every layer before `from`). */
export function layerMayImport(from, to) {
  const rule = layers[from];
  if (!rule) return true;
  if (rule.may.includes(to)) return true;
  return rule.may.includes("*") && layerOrder.indexOf(to) < layerOrder.indexOf(from);
}

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
    const packages = new Set();
    const exports = [];
    const declared = new Set();

    for (const statement of sourceFile.statements) {
      for (const name of declaredNames(statement)) declared.add(name);

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const resolved = resolveImport(rel, statement.moduleSpecifier.text, known);
        if (resolved) imports.add(resolved);
        else if (!statement.moduleSpecifier.text.startsWith(".")) packages.add(statement.moduleSpecifier.text);
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
      packages: [...packages].sort(),
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
      if (layerMayImport(mod.layer, to)) continue;
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
    module: "world-objects/geodesic/sleeve.ts",
    mayImportOnly: ["math/", "cell-complex/", "world-objects/geodesic/objects.ts", "world-objects/geodesic/development.ts"],
    reason: "the sleeve and taut-string geometry is pure and may only use math, cell-complex, the geodesic object types and portal development",
  },
  {
    module: "world-objects/geodesic/trace.ts",
    mayImportOnly: ["math/", "cell-complex/", "movement/", "world-objects/geodesic/objects.ts", "world-objects/geodesic/perfCounters.ts", "world-objects/runtimeObjectRegistry.ts"],
    reason: "tracing may only use math, cell-complex, movement, the geodesic object types, the performance counters and the registry type",
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

/**
 * Rules on npm packages: a package (or any subpath of it) may be imported only from the listed layers.
 * `packages` entries ending in `/*` are scope prefixes (`@pmndrs/*` matches `@pmndrs/xr`); the others match the package and its subpaths.
 */
export const packageImportRules = [
  {
    packages: ["three", "@pmndrs/*"],
    allowedLayers: ["render", "root"],
    reason: "Three.js and its helper packages are renderer details; only the render layer (and the entry point) may import them",
  },
];

function packageMatches(specifier, pattern) {
  if (pattern.endsWith("/*")) return specifier.startsWith(pattern.slice(0, -1));
  return specifier === pattern || specifier.startsWith(`${pattern}/`);
}

/** Violations of {@link packageImportRules}: `{ from, to, reason }` for every import of a restricted package from a layer that may not. */
export function packageImportViolations(modules) {
  const violations = [];
  for (const rule of packageImportRules) {
    for (const mod of modules.values()) {
      if (rule.allowedLayers.includes(mod.layer)) continue;
      for (const specifier of mod.packages) {
        if (rule.packages.some((pattern) => packageMatches(specifier, pattern))) {
          violations.push({ from: mod.path, to: specifier, reason: rule.reason });
        }
      }
    }
  }
  return violations;
}

/**
 * Import cycles among modules: the strongly connected components of the import graph with more than one module
 * (type-only imports count, since they are real dependencies of the design), each sorted, the list sorted by first member.
 */
export function importCycles(modules) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  let counter = 0;

  // Iterative Tarjan: the import graph is deep enough that recursion is not worth risking.
  for (const root of modules.keys()) {
    if (index.has(root)) continue;
    const work = [{ node: root, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.next === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const deps = modules.get(node).imports;
      if (frame.next < deps.length) {
        const dep = deps[frame.next];
        frame.next += 1;
        if (!index.has(dep)) work.push({ node: dep, next: 0 });
        else if (onStack.has(dep)) low.set(node, Math.min(low.get(node), index.get(dep)));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        if (component.length > 1) cycles.push(component.sort());
      }
    }
  }
  return cycles.sort((a, b) => (a[0] < b[0] ? -1 : 1));
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
