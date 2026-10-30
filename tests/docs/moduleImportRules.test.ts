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
  it("rejects importers of the legacy connection module that are not listed", async () => {
    const { moduleImportRuleViolations } = await loadLib();
    const legacy = "world-objects/geodesic/legacyConnection.ts";
    const violations = moduleImportRuleViolations(
      modulesOf(
        { path: "a.ts", imports: [legacy] },
        { path: "world-objects/geodesic/cannon.ts", imports: [legacy] },
        { path: legacy, imports: [] },
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.from).toBe("a.ts");
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
