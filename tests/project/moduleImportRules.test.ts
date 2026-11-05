/**
 * `tests/project/moduleImportRules.test.ts` — unit tier.
 *
 * `scripts/docs/lib.mjs#moduleImportRuleViolations` enforces the project's layering rules (also run by
 * `npm run docs:check`, see `documentation.test.ts`): a pure module (the portal-word helpers, portal
 * development) may not import
 * a module that pulls in the registry, rendering, or other impure layers. These tests check the rule against
 * the pure modules it protects, and the rules of design 013 section 12.2: the prefix rule shape (`onlyVia`,
 * prefix entries, `exceptFromPrefixes`), the rules generated for each module directory, the public face of the
 * engine, the geometry tools exception, the legacy world writers (a list that may only shrink) and the layer order.
 */
import { describe, expect, it } from "vitest";

// The documentation tooling is plain ESM JavaScript; load it through a variable path (see documentation.test.ts).
const libPath = "../../scripts/docs/lib.mjs";

interface FakeModule {
  readonly path: string;
  readonly imports: readonly string[];
  readonly writesRegistry?: boolean;
}

interface PrefixRule {
  readonly fromPrefix: string;
  readonly toPrefix: string;
  readonly onlyVia: readonly string[];
  readonly exceptFromPrefixes?: readonly string[];
  readonly reason: string;
}

type Violation = { from: string; to: string; reason: string };

interface DocLib {
  moduleImportRuleViolations(modules: Map<string, FakeModule>): Violation[];
  prefixImportRuleViolations(modules: Map<string, FakeModule>, rules: readonly PrefixRule[]): Violation[];
  legacyWorldWriters: readonly string[];
  layerMayImport(from: string, to: string): boolean;
  layerOrder: readonly string[];
}

// The legacy world writers as committed with design 013. The list in lib.mjs may only shrink: every entry must be here.
const committedLegacyWorldWriters = [
  "render/three/carriedGeodesicCannon.ts",
  "render/three/createThreeApp.ts",
  "render/three/creatures/geodesicMarmotView.ts",
  "render/three/creatures/simpleGeoCreatureView.ts",
  "render/three/geodesicCannonRenderer.ts",
  "render/three/geodesicCannonTools.ts",
  "render/three/geodesicDebugDumps.ts",
  "render/three/geodesicEmitterLabelController.ts",
  "render/three/geodesicEmitterLabels.ts",
  "render/three/geometryCommit.ts",
  "render/three/placedFlagRenderer.ts",
  "render/three/preloadWorldAssets.ts",
  "render/three/runtimeObjectActions.ts",
  "ui/paletteDefinition.ts",
];

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

  it("reports a client importing a world-objects mutator unless it is a legacy writer", async () => {
    const { moduleImportRuleViolations, legacyWorldWriters } = await loadLib();
    const legacy = legacyWorldWriters[0]!;
    const violations = moduleImportRuleViolations(
      modulesOf(
        { path: "world-objects/placedFlags.ts", imports: [], writesRegistry: true },
        { path: "world-objects/measureLengthTool.ts", imports: [] },
        { path: "render/three/newTool.ts", imports: ["world-objects/placedFlags.ts", "world-objects/measureLengthTool.ts"] },
        { path: legacy, imports: ["world-objects/placedFlags.ts"] },
        { path: "runtime/appState.ts", imports: ["world-objects/placedFlags.ts"] },
      ),
    );

    expect(edges(violations)).toEqual(["render/three/newTool.ts -> world-objects/placedFlags.ts"]);
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
