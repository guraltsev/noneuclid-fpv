/**
 * `tests/modules/objectKinds.contract.test.ts` — unit tier.
 *
 * Design 013 section 11: every declared kind has a `label` and a `persistence`, so that a save format finds what it needs in the declarations. The test reads the default experience's modules, plain data, with no engine.
 */
import { describe, expect, it } from "vitest";
import { createDefaultWorldModules } from "../../src/runtime/experience";

const labels = ["real", "cheap-derived", "expensive-derived"];
const persistences = ["saved", "rebuilt", "transient"];
const declarations = createDefaultWorldModules().flatMap((module) => module.objectKinds.map((declaration) => ({ moduleId: module.id, ...declaration })));

describe("the kinds of the default experience", () => {
  it("are declared at all", () => {
    expect(declarations.length).toBeGreaterThan(0);
  });

  it.each(declarations)("$kind of $moduleId has a label and a persistence", ({ label, persistence }) => {
    expect(labels).toContain(label);
    expect(persistences).toContain(persistence);
  });

  it("are declared once each", () => {
    const kinds = declarations.map((declaration) => declaration.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
