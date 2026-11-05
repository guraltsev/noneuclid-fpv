/**
 * `tests/project/moduleImportRules.test.ts` — unit tier.
 *
 * `scripts/docs/lib.mjs#moduleImportRuleViolations` enforces the project's layering rules (also run by
 * `npm run docs:check`, see `documentation.test.ts`): a pure module (the portal-word helpers, portal
 * development) may not import
 * a module that pulls in the registry, rendering, or other impure layers. These tests check the rule against
 * the pure modules it protects, and the rules of design 013 section 12.2: the prefix rule shape (`onlyVia`,
 * prefix entries, `exceptFromPrefixes`), the rules generated for each module directory, the public face of the
 * engine, the geometry tools exception, the legacy world writers (found by the type checker on a small source tree; a
 * list that stays exact and may only shrink) and the layer order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The documentation tooling is plain ESM JavaScript; load it through a variable path (see documentation.test.ts).
const libPath = "../../scripts/docs/lib.mjs";

interface FakeModule {
  readonly path: string;
  readonly imports: readonly string[];
}

interface PrefixRule {
  readonly fromPrefix: string;
  readonly toPrefix: string;
  readonly onlyVia: readonly string[];
  readonly exceptFromPrefixes?: readonly string[];
  readonly reason: string;
}

type Violation = { from: string; to: string; reason: string };

interface ClientWrites {
  readonly path: string;
  readonly namesWriter: boolean;
  readonly writes: readonly { readonly line: number; readonly text: string }[];
  readonly mutatorUses: readonly { readonly line: number; readonly name: string }[];
}

interface DocLib {
  moduleImportRuleViolations(modules: Map<string, FakeModule>): Violation[];
  prefixImportRuleViolations(modules: Map<string, FakeModule>, rules: readonly PrefixRule[]): Violation[];
  legacyWorldWriters: readonly string[];
  scanClientWrites(root: string): Map<string, ClientWrites>;
  legacyWorldWriterViolations(clients: Map<string, ClientWrites>, listed: readonly string[]): { path: string; reason: string }[];
  layerMayImport(from: string, to: string): boolean;
  layerOrder: readonly string[];
}

// The legacy world writers as measured by the type checker. The list in lib.mjs may only shrink: every entry must be here.
const committedLegacyWorldWriters = [
  "render/three/createThreeApp.ts",
  "render/three/creatures/geodesicMarmotView.ts",
  "render/three/creatures/simpleGeoCreatureView.ts",
  "render/three/geodesicCannonTools.ts",
  "render/three/geometryCommit.ts",
  "render/three/runtimeObjectActions.ts",
  "render/three/toolObjectRuntimes.ts",
  "runtime/worldGeometryComputedObjects.ts",
];

// A small source tree for scanClientWrites: the registry's shape, two mutators (one through the other), a read, and clients of each sort.
const clientWriteSources: Readonly<Record<string, string>> = {
  "world-objects/runtimeObjectRegistry.ts": `
    export interface RuntimeObjectRegistry {
      add(object: string): void;
      update(object: string): void;
      remove(id: string): void;
      claimOwnership(id: string): () => void;
      releaseOwnership(id: string): void;
      moveToCell(id: string, cellId: string): void;
      get(id: string): string | undefined;
    }
    export type RuntimeObjectReader = Pick<RuntimeObjectRegistry, "get">;
    export type LegacyWorldWriter = RuntimeObjectRegistry;
  `,
  "world-objects/flags.ts": `
    import type { RuntimeObjectReader, RuntimeObjectRegistry } from "./runtimeObjectRegistry";
    export const flagKind = "flag";
    export function removeFlag(registry: RuntimeObjectRegistry, id: string): void { registry.remove(id); }
    export function readFlag(registry: RuntimeObjectReader, id: string): string | undefined { return registry.get(id); }
    export function createFlagOwner(store: RuntimeObjectRegistry, id: string): () => void {
      return () => { store.claimOwnership(id); };
    }
  `,
  "world-objects/bulk.ts": `
    import type { RuntimeObjectRegistry } from "./runtimeObjectRegistry";
    import { removeFlag } from "./flags";
    export { removeFlag as dropFlag } from "./flags";
    export function clearFlags(registry: RuntimeObjectRegistry, ids: readonly string[]): void {
      for (const id of ids) removeFlag(registry, id);
    }
  `,
  "render/readsOnly.ts": `
    import type { RuntimeObjectReader } from "../world-objects/runtimeObjectRegistry";
    import { flagKind, readFlag } from "../world-objects/flags";
    export function labels(registry: RuntimeObjectReader, ids: Set<string>): void {
      ids.add(flagKind);
      readFlag(registry, flagKind);
    }
  `,
  "render/renamedWriter.ts": `
    import type { RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";
    export function move(world: RuntimeObjectRegistry): void {
      const alias = world;
      alias.update("a");
      alias.moveToCell("a", "cell");
    }
  `,
  "ui/usesMutators.ts": `
    import { clearFlags, dropFlag } from "../world-objects/bulk";
    import { createFlagOwner, removeFlag } from "../world-objects/flags";
    export const pick = (registry: Parameters<typeof clearFlags>[0]): void => {
      clearFlags(registry, []);
      dropFlag(registry, "a");
      createFlagOwner(registry, "b");
      ["c"].forEach((id) => [removeFlag].forEach((remove) => remove(registry, id)));
    };
  `,
  "runtime/namesWriter.ts": `
    import type { LegacyWorldWriter } from "../world-objects/runtimeObjectRegistry";
    export interface Options { readonly registry: LegacyWorldWriter; }
  `,
  "runtime/writes.ts": `
    import type { Options } from "./namesWriter";
    export function drop(options: Options): void { options.registry.remove("a"); }
  `,
  "engine/notAClient.ts": `
    import type { RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";
    export function write(registry: RuntimeObjectRegistry): void { registry.add("a"); }
  `,
};

function clientWrites(path: string, facts: Partial<ClientWrites> = {}): [string, ClientWrites] {
  return [path, { path, namesWriter: false, writes: [], mutatorUses: [], ...facts }];
}

async function loadLib(): Promise<DocLib> {
  return (await import(/* @vite-ignore */ libPath)) as DocLib;
}

function modulesOf(...mods: FakeModule[]): Map<string, FakeModule> {
  return new Map(mods.map((mod) => [mod.path, mod]));
}

function edges(violations: readonly Violation[]): string[] {
  return violations.map((v) => `${v.from} -> ${v.to}`);
}

describe("module import rules", () => {
  it("restricts what the pure portal-word module may import", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const violations = moduleImportRuleViolations(
      modulesOf({
        path: "world-objects/geodesic/portalWord.ts",
        imports: ["math/vec3.ts", "world-objects/geodesic/objects.ts", "world-objects/runtimeObjectRegistry.ts"],
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.to).toBe("world-objects/runtimeObjectRegistry.ts");
  });

  it("applies the prefix rule shape: onlyVia entries, prefix entries and exceptFromPrefixes", async () => {
    const { prefixImportRuleViolations } = await loadLib();
    const rule: PrefixRule = {
      fromPrefix: "a/",
      toPrefix: "b/",
      onlyVia: ["b/api.ts", "b/public/"],
      exceptFromPrefixes: ["a/trusted/"],
      reason: "test rule",
    };
    const modules = modulesOf(
      { path: "a/ok.ts", imports: ["b/api.ts", "b/public/deep/x.ts", "c/other.ts"] },
      { path: "a/bad.ts", imports: ["b/internal.ts", "b/api.ts"] },
      { path: "a/trusted/free.ts", imports: ["b/internal.ts"] },
      { path: "z/outside.ts", imports: ["b/internal.ts"] },
    );

    expect(prefixImportRuleViolations(modules, [rule])).toEqual([{ from: "a/bad.ts", to: "b/internal.ts", reason: "test rule" }]);
  });

  it("lets a module reach another module only through its api.ts, and its own files freely", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const violations = moduleImportRuleViolations(
      modulesOf(
        { path: "modules/carry/module.ts", imports: ["modules/geodesicModel/api.ts"] },
        { path: "modules/curveShortening/module.ts", imports: ["modules/geodesicModel/module.ts", "modules/curveShortening/flow.ts"] },
        { path: "modules/geodesicModel/api.ts", imports: ["modules/geodesicModel/module.ts"] },
        { path: "modules/geodesicModel/module.ts", imports: [] },
        { path: "modules/curveShortening/flow.ts", imports: [] },
        { path: "runtime/experience.ts", imports: ["modules/geodesicModel/module.ts"] },
      ),
    );

    expect(edges(violations)).toEqual(["modules/curveShortening/module.ts -> modules/geodesicModel/module.ts"]);
  });

  it("keeps the geodesic implementation behind geodesicModel except its geometry tools", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const violations = moduleImportRuleViolations(
      modulesOf(
        { path: "modules/geodesicModel/module.ts", imports: ["world-objects/geodesic/vertices.ts"] },
        { path: "modules/curveShortening/flow.ts", imports: ["world-objects/geodesic/portalWord.ts", "world-objects/geodesic/curveShortening.ts"] },
      ),
    );

    expect(edges(violations)).toEqual(["modules/curveShortening/flow.ts -> world-objects/geodesic/curveShortening.ts"]);
  });

  it("lets clients import only the public face of the engine", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const violations = moduleImportRuleViolations(
      modulesOf(
        { path: "render/three/view.ts", imports: ["engine/worldEngine.ts", "engine/moduleTypes.ts", "engine/moduleTicks.ts"] },
        { path: "ui/panel.ts", imports: ["engine/participants.ts"] },
        { path: "runtime/experience.ts", imports: ["engine/composeModules.ts"] },
      ),
    );

    expect(edges(violations)).toEqual(["render/three/view.ts -> engine/moduleTicks.ts", "ui/panel.ts -> engine/participants.ts"]);
  });

  describe("client writes", () => {
    let root: string;
    let clients: Map<string, ClientWrites>;

    beforeAll(async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "client-writes-"));
      for (const [rel, text] of Object.entries(clientWriteSources)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      }
      clients = (await loadLib()).scanClientWrites(root);
    }, 30000);

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("scans render, ui and runtime and nothing else", () => {
      expect([...clients.keys()]).toEqual([
        "render/readsOnly.ts",
        "render/renamedWriter.ts",
        "runtime/namesWriter.ts",
        "runtime/writes.ts",
        "ui/usesMutators.ts",
      ]);
    });

    it("sees nothing in a client that reads, even one importing from a module with mutators", () => {
      expect(clients.get("render/readsOnly.ts")).toMatchObject({ namesWriter: false, writes: [], mutatorUses: [] });
    });

    it("finds a direct write by its type, whatever the variable is called", () => {
      expect(clients.get("render/renamedWriter.ts")?.writes.map((write) => write.text)).toEqual(["alias.update", "alias.moveToCell"]);
      expect(clients.get("runtime/writes.ts")?.writes.map((write) => write.text)).toEqual(["options.registry.remove"]);
    });

    it("finds a mutator through another mutator, a re-export, a closure and a value", () => {
      expect(clients.get("ui/usesMutators.ts")?.mutatorUses.map((use) => use.name)).toEqual([
        "clearFlags",
        "clearFlags",
        "dropFlag",
        "createFlagOwner",
        "removeFlag",
      ]);
    });

    it("finds a file that only names the writer type", () => {
      expect(clients.get("runtime/namesWriter.ts")).toMatchObject({ namesWriter: true, writes: [], mutatorUses: [] });
    });

    it("gives the line of a write", () => {
      expect(clients.get("runtime/writes.ts")?.writes[0]?.line).toBe(3);
    });
  });

  it("fails on a writing client outside the list, whichever way it writes", async () => {
    const { legacyWorldWriterViolations } = await loadLib();
    const violations = legacyWorldWriterViolations(
      new Map([
        clientWrites("render/reader.ts"),
        clientWrites("render/listed.ts", { namesWriter: true }),
        clientWrites("render/names.ts", { namesWriter: true }),
        clientWrites("ui/mutator.ts", { mutatorUses: [{ line: 1, name: "removeFlag" }] }),
        clientWrites("runtime/direct.ts", { writes: [{ line: 1, text: "registry.add" }] }),
      ]),
      ["render/listed.ts"],
    );

    expect(violations.map((violation) => violation.path)).toEqual(["render/names.ts", "ui/mutator.ts", "runtime/direct.ts"]);
  });

  it("fails on a listed file that does not write or no longer exists", async () => {
    const { legacyWorldWriterViolations } = await loadLib();
    const violations = legacyWorldWriterViolations(
      new Map([clientWrites("render/reader.ts"), clientWrites("runtime/writer.ts", { writes: [{ line: 1, text: "registry.add" }] })]),
      ["render/reader.ts", "runtime/writer.ts", "render/gone.ts"],
    );

    expect(violations.map((violation) => violation.path)).toEqual(["render/reader.ts", "render/gone.ts"]);
  });

  it("lets the list of legacy world writers only shrink", async () => {
    const { legacyWorldWriters } = await loadLib();
    expect(legacyWorldWriters.filter((entry) => !committedLegacyWorldWriters.includes(entry))).toEqual([]);
    expect(new Set(legacyWorldWriters).size).toBe(legacyWorldWriters.length);
  });

  it("orders the engine and modules layers between interaction and runtime", async () => {
    const { layerMayImport, layerOrder } = await loadLib();
    expect(layerOrder.indexOf("engine")).toBeGreaterThan(layerOrder.indexOf("interaction"));
    expect(layerOrder.indexOf("modules")).toBeGreaterThan(layerOrder.indexOf("engine"));
    expect(layerOrder.indexOf("runtime")).toBeGreaterThan(layerOrder.indexOf("modules"));
    expect(layerMayImport("modules", "engine")).toBe(true);
    expect(layerMayImport("engine", "modules")).toBe(false);
    expect(layerMayImport("engine", "runtime")).toBe(false);
    for (const layer of ["runtime", "ui", "render"]) {
      expect(layerMayImport(layer, "engine")).toBe(true);
      expect(layerMayImport(layer, "modules")).toBe(true);
    }
  });
});
