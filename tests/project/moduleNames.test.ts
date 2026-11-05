/**
 * `tests/project/moduleNames.test.ts` — unit tier.
 *
 * `scripts/docs/lib.mjs#moduleNameViolations` checks the naming rule of design 013 section 10 in the files under `src/modules/` (also run by `npm run docs:check`):
 * a namespaced string must match `<moduleId>/<noun>` in camelCase, and the names a module contributes must start with its own directory name (`world/` and the
 * modules whose `api.ts` the file imports are allowed). These tests check the rule on small sources.
 */
import { describe, expect, it } from "vitest";

const libPath = "../../scripts/docs/lib.mjs";

interface NameViolation {
  readonly path: string;
  readonly name: string;
  readonly reason: string;
}

interface DocLib {
  moduleNameViolations(files: readonly { path: string; text: string }[]): NameViolation[];
}

async function check(path: string, text: string): Promise<string[]> {
  const lib = (await import(/* @vite-ignore */ libPath)) as DocLib;
  return lib.moduleNameViolations([{ path, text }]).map((violation) => violation.name);
}

describe("module name check", () => {
  it("accepts names with the module's own prefix and the engine's world prefix", async () => {
    const text = `
      export interface A { readonly kind: "geodesicModel/tieAndDetach"; }
      export const objectKinds = [{ kind: "geodesicModel/arc" }];
      export const commands = { "geodesicModel/removeCurve": { run }, };
      export const ticks = [{ id: "geodesicModel/crossings" }];
      export const toolIds = { toolIds: ["geodesicModel/tie"] };
      const ask = { kind: "world/requestTool" };
    `;
    expect(await check("modules/geodesicModel/module.ts", text)).toEqual([]);
  });

  it("rejects a name of another module, a bad noun and a bare tool id", async () => {
    const text = `
      export interface A { readonly kind: "carry/attach"; }
      export const slot = "geodesicModel/Bad";
      export const m = { toolIds: ["tie"] };
    `;
    expect(await check("modules/geodesicModel/module.ts", text)).toEqual(["carry/attach", "geodesicModel/Bad", "tie"]);
  });

  it("allows a module to name what it uses from a module whose api it imports", async () => {
    const text = `
      import { geodesicModelToken } from "../geodesicModel/api";
      const command = { kind: "geodesicModel/removeCurve" };
    `;
    expect(await check("modules/curveShortening/module.ts", text)).toEqual([]);
    expect(await check("modules/curveShortening/other.ts", `const command = { kind: "geodesicModel/removeCurve" };`)).toEqual(["geodesicModel/removeCurve"]);
  });

  it("ignores files outside src/modules and import specifiers", async () => {
    expect(await check("render/three/x.ts", `const a = { kind: "carry/Attach" };`)).toEqual([]);
    expect(await check("modules/carry/module.ts", `import { x } from "../../world-objects/y";`)).toEqual([]);
  });
});
