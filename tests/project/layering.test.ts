/**
 * `tests/project/layering.test.ts` — unit tier.
 *
 * The layer table in `scripts/docs/lib.mjs` is a strict order (a DAG): a layer may import only layers before it, so no two layers
 * can permit each other. These tests assert that property of the table itself, check the two rules the layer table cannot express
 * (npm packages by layer, and import cycles) against small fake module graphs, and check the real project against them. The
 * full `npm run docs:check` run is in `documentation.test.ts`.
 */
import { describe, expect, it } from "vitest";

// The documentation tooling is plain ESM JavaScript; load it through a variable path (see documentation.test.ts).
const libPath = "../../scripts/docs/lib.mjs";

interface FakeModule {
  readonly path: string;
  readonly layer: string;
  readonly imports: readonly string[];
  readonly packages: readonly string[];
}

interface DocLib {
  readonly layers: Record<string, { readonly may: readonly string[] }>;
  readonly layerOrder: readonly string[];
  layerMayImport(from: string, to: string): boolean;
  importCycles(modules: Map<string, FakeModule>): string[][];
  packageImportViolations(modules: Map<string, FakeModule>): { from: string; to: string }[];
  loadLayeringBaseline(): string[];
  scanProject(): Map<string, FakeModule>;
}

async function loadLib(): Promise<DocLib> {
  return (await import(/* @vite-ignore */ libPath)) as DocLib;
}

function fake(path: string, imports: readonly string[] = [], packages: readonly string[] = []): FakeModule {
  return { path, layer: path.includes("/") ? path.split("/")[0] : "root", imports, packages };
}

function modulesOf(...mods: FakeModule[]): Map<string, FakeModule> {
  return new Map(mods.map((mod) => [mod.path, mod]));
}

describe("layer table", () => {
  it("lets each layer name only layers that come before it, so the layer graph is a DAG", async () => {
    const { layers, layerOrder } = await loadLib();

    for (const [name, rule] of Object.entries(layers)) {
      const position = layerOrder.indexOf(name);
      for (const allowed of rule.may) {
        if (allowed === "*") continue;
        expect(layerOrder.indexOf(allowed), `${name} may import ${allowed}`).toBeGreaterThanOrEqual(0);
        expect(layerOrder.indexOf(allowed), `${name} may import ${allowed}`).toBeLessThan(position);
      }
    }
  });

  it("never permits two layers to import each other", async () => {
    const { layerOrder, layerMayImport } = await loadLib();

    for (const a of layerOrder) {
      for (const b of layerOrder) {
        if (a !== b) expect(layerMayImport(a, b) && layerMayImport(b, a), `${a} <-> ${b}`).toBe(false);
      }
    }
  });

  it("lets only the render layer and the entry point use the wildcard", async () => {
    const { layers } = await loadLib();

    expect(Object.entries(layers).filter(([, rule]) => rule.may.includes("*")).map(([name]) => name)).toEqual(["render", "root"]);
  });
});

describe("import cycles", () => {
  it("reports a cycle even when it is closed by a type-only import, and none for a DAG", async () => {
    const { importCycles } = await loadLib();
    const cyclic = modulesOf(fake("a/x.ts", ["a/y.ts"]), fake("a/y.ts", ["a/z.ts"]), fake("a/z.ts", ["a/x.ts"]), fake("a/w.ts", ["a/x.ts"]));
    const acyclic = modulesOf(fake("a/x.ts", ["a/y.ts"]), fake("a/y.ts", ["a/z.ts"]), fake("a/z.ts"), fake("a/w.ts", ["a/x.ts", "a/z.ts"]));

    expect(importCycles(cyclic)).toEqual([["a/x.ts", "a/y.ts", "a/z.ts"]]);
    expect(importCycles(acyclic)).toEqual([]);
  });

  it("reports a module that imports itself through a two-module loop once", async () => {
    const { importCycles } = await loadLib();

    expect(importCycles(modulesOf(fake("a/p.ts", ["a/q.ts"]), fake("a/q.ts", ["a/p.ts"])))).toEqual([["a/p.ts", "a/q.ts"]]);
  });
});

describe("npm package rules", () => {
  it("allows three and @pmndrs packages only in render and root", async () => {
    const { packageImportViolations } = await loadLib();
    const violations = packageImportViolations(
      modulesOf(
        fake("render/three/scene.ts", [], ["three", "three/examples/jsm/loaders/GLTFLoader.js"]),
        fake("main.ts", [], ["three"]),
        fake("world-objects/creature.ts", [], ["three"]),
        fake("interaction/aim.ts", [], ["three/examples/jsm/utils/SkeletonUtils.js"]),
        fake("runtime/xr.ts", [], ["@pmndrs/xr"]),
        fake("math/vec.ts", [], ["threejs-helper"]),
      ),
    );

    expect(violations.map((v) => `${v.from} -> ${v.to}`).sort()).toEqual([
      "interaction/aim.ts -> three/examples/jsm/utils/SkeletonUtils.js",
      "runtime/xr.ts -> @pmndrs/xr",
      "world-objects/creature.ts -> three",
    ]);
  });
});

describe("the project", () => {
  it("has no import cycles and no restricted npm import outside render", async () => {
    const { importCycles, packageImportViolations, scanProject } = await loadLib();
    const modules = scanProject();

    expect(importCycles(modules)).toEqual([]);
    expect(packageImportViolations(modules)).toEqual([]);
  });

  it("keeps no frozen layering exception that reaches into render", async () => {
    const { loadLayeringBaseline } = await loadLib();

    expect(loadLayeringBaseline().filter((edge) => /^(world-objects|runtime|glue)\/.* -> render\//.test(edge))).toEqual([]);
  });
});
