/**
 * `tests/project/moduleImportRules.test.ts` — unit tier.
 *
 * `scripts/docs/lib.mjs#moduleImportRuleViolations` enforces the project's layering rules (also run by
 * `npm run docs:check`, see `documentation.test.ts`): a pure module (the sleeve/taut-path geometry, the
 * portal-word helpers) may not import
 * a module that pulls in the registry, rendering, or other impure layers. These tests check the rule against two
 * of the pure modules it protects.
 */
import { describe, expect, it } from "vitest";

// The documentation tooling is plain ESM JavaScript; load it through a variable path (see documentation.test.ts).
const libPath = "../../scripts/docs/lib.mjs";

interface FakeModule {
  readonly path: string;
  readonly imports: readonly string[];
}

interface DocLib {
  moduleImportRuleViolations(modules: Map<string, FakeModule>): { from: string; to: string; reason: string }[];
}

async function loadLib(): Promise<DocLib> {
  return (await import(/* @vite-ignore */ libPath)) as DocLib;
}

function modulesOf(...mods: FakeModule[]): Map<string, FakeModule> {
  return new Map(mods.map((mod) => [mod.path, mod]));
}

describe("module import rules", () => {
  it("restricts what the pure sleeve module may import", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const violations = moduleImportRuleViolations(
      modulesOf({
        path: "world-objects/geodesic/sleeve.ts",
        imports: [
          "math/vec2.ts",
          "cell-complex/compileCellComplex.ts",
          "world-objects/geodesic/objects.ts",
          "world-objects/geodesic/development.ts",
          "world-objects/geodesic/intervals.ts",
        ],
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.to).toBe("world-objects/geodesic/intervals.ts");
  });

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
});
