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
  engine: {
    description: "The world engine core (design 013): step order, command queue, participants, module composition and ticks. Imports no module.",
    may: ["math", "cell-complex", "diagnostics", "movement", "world-objects", "glue", "interaction"],
  },
  modules: {
    description: "World modules (design 013): each owns a slice of world behaviour and exposes a typed api.ts to the others.",
    may: ["math", "cell-complex", "diagnostics", "movement", "world-objects", "glue", "interaction", "engine"],
  },
  runtime: {
    description: "Application state, runtime menu state, command dispatch, geometry session/worker, server channel and public API.",
    may: ["math", "cell-complex", "diagnostics", "movement", "world-objects", "authoring", "glue", "engine", "modules"],
  },
  ui: {
    description: "Renderer-neutral palette, help, tooltip and input-intent definitions.",
    may: ["math", "cell-complex", "world-objects", "authoring", "glue", "engine", "modules", "runtime"],
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
 * Three shapes, with paths relative to `src/` using forward slashes:
 * - `{ module, allowedImporters, reason }`: any module that imports `module` and is not listed is a violation.
 * - `{ module, mayImportOnly, reason }`: any import of `module` whose path does not start with one of the prefixes
 *   (or equal a listed file) is a violation.
 * - `{ fromPrefix, toPrefix, onlyVia, alsoViaFrom?, exceptFromPrefixes?, reason }`: an import from a file under `fromPrefix` of a file
 *   under `toPrefix` is a violation unless the target is in `onlyVia` (entries ending in `/` are prefixes), the importer is
 *   under a prefix of `alsoViaFrom` that lists the target, or the importer is under an `exceptFromPrefixes` entry.
 *
 * {@link moduleImportRuleViolations} also applies the rules generated from the directories of `src/modules/` (design 013
 * section 12.2).
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
    module: "world-objects/geodesic/trace.ts",
    mayImportOnly: ["math/", "cell-complex/", "movement/", "world-objects/geodesic/objects.ts", "world-objects/geodesic/perfCounters.ts", "world-objects/runtimeObjectRegistry.ts"],
    reason: "tracing may only use math, cell-complex, movement, the geodesic object types, the performance counters and the registry type",
  },
  {
    fromPrefix: "modules/",
    toPrefix: "world-objects/geodesic/",
    onlyVia: [
      "world-objects/geodesic/portalWord.ts",
      "world-objects/geodesic/development.ts",
      "world-objects/geodesic/trace.ts",
      "world-objects/geodesic/objects.ts",
    ],
    // The emitters are the world part over these two files, which stay in place (design 013 section 16).
    alsoViaFrom: { "modules/geodesicEmitters/": ["world-objects/geodesic/cannon.ts", "world-objects/geodesic/carryEnd.ts"] },
    // The carry module runs the emitter's carry contract (moveEmitterAlongRoute and the rebuild of carryEnd.ts), which stays in world-objects code until job 64 (design 013 sections 7 and 16).
    exceptFromPrefixes: ["modules/geodesicModel/", "modules/carry/"],
    reason: "modules reach the piecewise-geodesic implementation only through the geodesicModel module, except for its stateless geometry tools (design 013 section 13.1); the emitters also use cannon.ts and carryEnd.ts, and the carry module runs the emitter's carry contract",
  },
  {
    fromPrefix: "render/",
    toPrefix: "engine/",
    onlyVia: ["engine/worldEngine.ts", "engine/moduleTypes.ts"],
    reason: "clients use the engine's public face only: worldEngine.ts and moduleTypes.ts",
  },
  {
    fromPrefix: "ui/",
    toPrefix: "engine/",
    onlyVia: ["engine/worldEngine.ts", "engine/moduleTypes.ts"],
    reason: "clients use the engine's public face only: worldEngine.ts and moduleTypes.ts",
  },
];

/**
 * The client files (`render/`, `ui/`, `runtime/`) that still write the world: exactly those that name `LegacyWorldWriter`
 * or call a world-objects mutator, as {@link scanClientWrites} finds them. New behaviour reaches the world through the
 * engine (design 013 section 5.7). {@link legacyWorldWriterViolations} fails on a file outside the list that does either
 * and on a listed file that does neither, so the list stays exact. It may only shrink:
 * `tests/project/moduleImportRules.test.ts` compares it with a committed copy.
 */
export const legacyWorldWriters = [
  "render/three/createThreeApp.ts",
  "render/three/creatures/geodesicMarmotView.ts",
  "render/three/creatures/simpleGeoCreatureView.ts",
  "render/three/geodesicCannonTools.ts",
  "render/three/geometryCommit.ts",
  "render/three/runtimeObjectActions.ts",
  "render/three/toolObjectRuntimes.ts",
  "runtime/worldGeometryComputedObjects.ts",
];

/** The layers of client code, whose files receive `RuntimeObjectReader` unless they are in {@link legacyWorldWriters}. */
const clientPrefixes = ["render/", "ui/", "runtime/"];

/** The module that declares the registry; its own implementation is not a mutator. */
const registryModule = "world-objects/runtimeObjectRegistry.ts";

/** The methods of `RuntimeObjectRegistry` that write. `RuntimeObjectReader` has none of them. */
const registryWriteMethods = new Set(["add", "update", "remove", "claimOwnership", "releaseOwnership", "moveToCell"]);

/** The top-level values a source file declares, as `[declaration name, node holding its code]` pairs. */
function topLevelValues(sourceFile) {
  const values = [];
  for (const statement of sourceFile.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) values.push([statement.name, statement]);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) values.push([declaration.name, declaration]);
      }
    }
  }
  return values;
}

/**
 * What every client file does with the registry, found with the type checker, so a write counts whatever the variable is called and a `Set.add` does not.
 *
 * A **direct write** is a use of a write method declared on the interface `RuntimeObjectRegistry`. A **mutator** is a top-level function, variable or class of a
 * `world-objects/` module (other than the registry's own) whose code holds a direct write or uses another mutator, nested closures included. A **mutator use** is
 * any reference to one, called or passed as a value; a re-export resolves to the original. Not seen: a write through a destructured method
 * (`const { add } = registry`), and a method of an object a mutator returned.
 *
 * @param {string} root the source tree to scan.
 * @returns {Map<string, {path: string, namesWriter: boolean, writes: {line: number, text: string}[], mutatorUses: {line: number, name: string}[]}>} keyed by path relative to `root`, one entry per client file.
 */
export function scanClientWrites(root = srcRoot) {
  const program = ts.createProgram(listSourceFiles(root), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const sourceFiles = listSourceFiles(root).map((file) => [toPosix(path.relative(root, file)), program.getSourceFile(file)]);

  const isDirectWrite = (node) =>
    ts.isPropertyAccessExpression(node) &&
    registryWriteMethods.has(node.name.text) &&
    (checker.getSymbolAtLocation(node.name)?.declarations ?? []).some(
      (declaration) => ts.isInterfaceDeclaration(declaration.parent) && declaration.parent.name.text === "RuntimeObjectRegistry",
    );

  /** The symbol an identifier refers to, through imports and object shorthand. */
  function referencedSymbol(identifier) {
    const shorthand = ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier;
    const symbol = shorthand ? checker.getShorthandAssignmentValueSymbol(identifier.parent) : checker.getSymbolAtLocation(identifier);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }

  /** Calls `visit` on `node` and every node under it. */
  function walk(node, visit) {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  }

  /** Whether an identifier is a use of a mutator; the name in an import or export statement uses nothing. */
  const usesMutator = (identifier) =>
    mutators.has(referencedSymbol(identifier)) && !ts.findAncestor(identifier, (node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node));

  const mutators = new Set();
  const usesByValue = new Map();
  for (const [rel, sourceFile] of sourceFiles) {
    if (!rel.startsWith("world-objects/") || rel === registryModule) continue;
    for (const [name, code] of topLevelValues(sourceFile)) {
      const value = checker.getSymbolAtLocation(name);
      const uses = new Set();
      usesByValue.set(value, uses);
      walk(code, (node) => {
        if (isDirectWrite(node)) mutators.add(value);
        if (ts.isIdentifier(node)) uses.add(referencedSymbol(node));
      });
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [value, uses] of usesByValue) {
      if (mutators.has(value) || ![...uses].some((use) => mutators.has(use))) continue;
      mutators.add(value);
      grew = true;
    }
  }

  const clients = new Map();
  for (const [rel, sourceFile] of sourceFiles) {
    if (!clientPrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    const client = { path: rel, namesWriter: false, writes: [], mutatorUses: [] };
    const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    walk(sourceFile, (node) => {
      if (isDirectWrite(node)) client.writes.push({ line: lineOf(node), text: node.getText() });
      if (!ts.isIdentifier(node)) return;
      if (node.text === "LegacyWorldWriter") client.namesWriter = true;
      if (usesMutator(node)) client.mutatorUses.push({ line: lineOf(node), name: node.text });
    });
    clients.set(rel, client);
  }
  return clients;
}

/**
 * Violations of the legacy-writer rule (design 013 sections 12.2 and 14): `{ path, reason }` for every client file outside `listed` that writes, and for every listed
 * file that does not. "Writes" means names `LegacyWorldWriter`, writes the registry directly, or uses a world-objects mutator.
 *
 * @param {ReturnType<typeof scanClientWrites>} clients
 * @param {readonly string[]} listed
 */
export function legacyWorldWriterViolations(clients, listed = legacyWorldWriters) {
  const violations = [];
  for (const client of clients.values()) {
    if (listed.includes(client.path)) continue;
    if (!client.namesWriter && client.writes.length === 0 && client.mutatorUses.length === 0) continue;
    violations.push({
      path: client.path,
      reason: "client files change the world through the engine and take RuntimeObjectReader; only the files in legacyWorldWriters (scripts/docs/lib.mjs) still name LegacyWorldWriter or call a world-objects mutator",
    });
  }
  for (const entry of listed) {
    const client = clients.get(entry);
    if (client && (client.namesWriter || client.writes.length > 0 || client.mutatorUses.length > 0)) continue;
    violations.push({ path: entry, reason: "listed in legacyWorldWriters (scripts/docs/lib.mjs) but neither names LegacyWorldWriter nor calls a world-objects mutator: take it off the list" });
  }
  return violations;
}

/** The rules generated from the directories of `src/modules/`: another module reaches module `X` only through `modules/X/api.ts`. */
function generatedModuleDirectoryRules(modules) {
  const directories = new Set();
  for (const modulePath of modules.keys()) {
    const match = /^modules\/([^/]+)\//.exec(modulePath);
    if (match) directories.add(match[1]);
  }
  return [...directories].sort().map((name) => ({
    fromPrefix: "modules/",
    toPrefix: `modules/${name}/`,
    onlyVia: [`modules/${name}/api.ts`],
    exceptFromPrefixes: [`modules/${name}/`],
    reason: `module ${name} is reached only through modules/${name}/api.ts`,
  }));
}

function pathMatchesEntry(modulePath, entry) {
  return modulePath === entry || (entry.endsWith("/") && modulePath.startsWith(entry));
}

/** Violations of the `{ fromPrefix, toPrefix, onlyVia, alsoViaFrom?, exceptFromPrefixes?, reason }` rules among `rules` (rules of the other shapes are skipped). */
export function prefixImportRuleViolations(modules, rules) {
  const violations = [];
  for (const rule of rules) {
    if (!rule.fromPrefix) continue;
    for (const mod of modules.values()) {
      if (!mod.path.startsWith(rule.fromPrefix)) continue;
      if (rule.exceptFromPrefixes?.some((prefix) => mod.path.startsWith(prefix))) continue;
      for (const dep of mod.imports) {
        if (!dep.startsWith(rule.toPrefix)) continue;
        if (rule.onlyVia.some((allowed) => pathMatchesEntry(dep, allowed))) continue;
        if (Object.entries(rule.alsoViaFrom ?? {}).some(([prefix, targets]) => mod.path.startsWith(prefix) && targets.includes(dep))) continue;
        violations.push({ from: mod.path, to: dep, reason: rule.reason });
      }
    }
  }
  return violations;
}

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
        if (rule.mayImportOnly.some((allowed) => pathMatchesEntry(dep, allowed))) continue;
        violations.push({ from: mod.path, to: dep, reason: rule.reason });
      }
    }
  }
  violations.push(...prefixImportRuleViolations(modules, [...moduleImportRules, ...generatedModuleDirectoryRules(modules)]));
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

/** The contributed-name pattern of design 013 section 10: `<moduleId>/<noun>`, both camelCase. */
const contributedNamePattern = /^[a-z][A-Za-z0-9]*\/[a-z][A-Za-z0-9]*$/;

/** A string that looks like a namespaced name (one slash between two identifier-like parts), whatever its case. */
const namespacedLooking = /^[A-Za-z][A-Za-z0-9]*\/[A-Za-z0-9_-]+$/;

function propertyNameText(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

/**
 * Violations of the naming rule of design 013 section 10 in the files under `src/modules/`: `{ path, name, reason }`.
 * `files` is a list of `{ path, text }` with `path` relative to `src/`. Checked: every namespaced-looking string literal must
 * match `<moduleId>/<noun>`; and the names a module contributes (the `kind` and `id` of a declaration, the keys of a command
 * handler map, the elements of `toolIds`) must start with the module's own directory name, with `world/` and the modules
 * whose `api.ts` the file imports also allowed (a module may name what it uses).
 */
export function moduleNameViolations(files) {
  const violations = [];
  for (const file of files) {
    const match = /^modules\/([^/]+)\//.exec(file.path);
    if (!match) continue;
    const moduleId = match[1];
    const allowedPrefixes = new Set([moduleId, "world"]);
    for (const imported of file.text.matchAll(/from\s+["']\.\.\/([A-Za-z0-9]+)\/api["']/g)) allowedPrefixes.add(imported[1]);
    const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.ES2022, true);
    const report = (name, reason) => violations.push({ path: file.path, name, reason });
    const checkContributed = (name) => {
      if (!namespacedLooking.test(name) && !name.includes("/")) {
        report(name, `a name a module contributes must be "${moduleId}/<noun>"`);
        return;
      }
      if (!allowedPrefixes.has(name.split("/")[0])) report(name, `a name a module contributes must start with "${moduleId}/"`);
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isStringLiteral(node) && namespacedLooking.test(node.text) && !contributedNamePattern.test(node.text)) {
        report(node.text, "a namespaced name must match <moduleId>/<noun>, both camelCase");
      }
      if (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) {
        const key = propertyNameText(node.name);
        const value = ts.isPropertyAssignment(node) ? node.initializer : node.type && ts.isLiteralTypeNode(node.type) ? node.type.literal : undefined;
        if ((key === "kind" || key === "id") && value && ts.isStringLiteral(value) && value.text.includes("/")) checkContributed(value.text);
        else if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text.includes("/")) checkContributed(node.name.text);
        else if (key === "toolIds" && ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)) {
          for (const element of node.initializer.elements) if (ts.isStringLiteral(element)) checkContributed(element.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

/** Reads the files under `src/modules/` and returns their {@link moduleNameViolations}. */
export function scanModuleNameViolations() {
  const files = listSourceFiles(path.join(srcRoot, "modules")).map((file) => ({
    path: toPosix(path.relative(srcRoot, file)),
    text: fs.readFileSync(file, "utf8"),
  }));
  return moduleNameViolations(files);
}
