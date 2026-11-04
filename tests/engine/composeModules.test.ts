/**
 * `tests/engine/composeModules.test.ts` — unit tier.
 *
 * Composing an experience (design 013 section 9.2): every composition error is reported, all of them at once, and valid modules are created in topological order of their `requires`, ties broken by list order.
 */
import { describe, expect, it } from "vitest";
import { ModuleCompositionError } from "../../src/engine/composeModules";
import { defineModuleToken, type AnyModuleDefinition, type ModuleTick } from "../../src/engine/moduleTypes";
import type { RuntimeToolId } from "../../src/glue/toolIds";
import { createTestEngine } from "../support/engine";

const tokenA = defineModuleToken<{ readonly a: number }>("modA");
const tokenB = defineModuleToken<{ readonly b: number }>("modB");

/** A valid module with no behaviour; `over` replaces fields. */
function fake(id: string, over: Partial<AnyModuleDefinition> & { readonly ticks?: readonly ModuleTick[]; readonly commands?: object } = {}): AnyModuleDefinition {
  const { ticks = [], commands = {}, ...definition } = over;
  return {
    id,
    requires: [],
    objectKinds: [],
    create: () => ({ api: {}, queries: {}, commands, ticks }),
    ...definition,
  };
}

function problemsOf(modules: readonly AnyModuleDefinition[]): readonly string[] {
  try {
    createTestEngine({ modules });
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleCompositionError);
    return (error as ModuleCompositionError).problems;
  }
  throw new Error("composition did not fail");
}

const thing = (id: string, name = "thing") => ({ kind: `${id}/${name}`, label: "real" as const, persistence: "saved" as const });

describe("composeModules", () => {
  it("accepts an empty module list", () => {
    expect(() => createTestEngine({ modules: [] })).not.toThrow();
  });

  it("rejects two modules with the same id", () => {
    expect(problemsOf([fake("same"), fake("same")])).toEqual(["two modules have the id same"]);
  });

  it("rejects two modules providing the same token", () => {
    const problems = problemsOf([fake("one", { provides: tokenA }), fake("two", { provides: tokenA })]);
    expect(problems).toEqual(["modules one and two both provide modA"]);
  });

  it("rejects a required token that no module provides, naming both", () => {
    const problems = problemsOf([fake("flow", { requires: [tokenA] })]);
    expect(problems).toEqual(["module flow requires modA; no module in the experience provides it"]);
  });

  it("rejects a dependency cycle and names it as a path", () => {
    const problems = problemsOf([
      fake("modA", { provides: tokenA, requires: [tokenB] }),
      fake("modB", { provides: tokenB, requires: [tokenA] }),
    ]);
    expect(problems).toEqual(["modules form a dependency cycle: modA -> modB -> modA"]);
  });

  it("rejects an object kind declared twice and one that is a core kind", () => {
    const twice = problemsOf([fake("one", { objectKinds: [thing("one")] }), fake("two", { objectKinds: [{ ...thing("two"), kind: "one/thing" }] })]);
    expect(twice).toContain("the object kind one/thing is declared twice, by one and by two");
    const core = problemsOf([fake("one", { objectKinds: [{ ...thing("one"), kind: "geo-mouse" }] })]);
    expect(core).toContain("module one declares the object kind geo-mouse, which is a core kind");
  });

  it("rejects two handlers for one command kind and two modules defining one tool id", () => {
    const run = () => ({ ok: true as const });
    const commands = { "one/go": { run } };
    const twoHandlers = problemsOf([fake("one", { commands }), fake("two", { commands })]);
    expect(twoHandlers).toContain("the command one/go has handlers in both one and two");
    const toolId = "one/tool" as RuntimeToolId;
    const twoTools = problemsOf([fake("one", { toolIds: [toolId] }), fake("two", { toolIds: [toolId] })]);
    expect(twoTools).toContain("the tool id one/tool is defined by both one and two");
  });

  it("rejects a tick that writes a kind its module does not declare", () => {
    const tick: ModuleTick = { id: "one/spawn", phase: "simulate", writes: ["one/thing"], run: () => undefined };
    expect(problemsOf([fake("one", { ticks: [tick] })])).toEqual(["module one: the tick one/spawn writes one/thing, which the module does not declare"]);
  });

  it("rejects a derive tick that subscribes to a kind it cannot see", () => {
    const tick: ModuleTick = { id: "two/watch", phase: "derive", writes: [], subscribes: ["one/thing"], run: () => undefined };
    const problems = problemsOf([fake("one", { objectKinds: [thing("one")] }), fake("two", { ticks: [tick] })]);
    expect(problems).toEqual(["module two: the derive tick two/watch subscribes to one/thing, which no module it requires declares"]);
  });

  it("lets a derive tick subscribe to a core kind and to a kind of a module it requires, transitively", () => {
    const tokenOne = defineModuleToken<unknown>("one");
    const tokenTwo = defineModuleToken<unknown>("two");
    const watch: ModuleTick = { id: "three/watch", phase: "derive", writes: [], subscribes: ["geo-mouse", "one/thing"], run: () => undefined };
    expect(() =>
      createTestEngine({
        modules: [
          fake("one", { provides: tokenOne, objectKinds: [thing("one")] }),
          fake("two", { provides: tokenTwo, requires: [tokenOne] }),
          fake("three", { requires: [tokenTwo], ticks: [watch] }),
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a derive tick that subscribes to a kind a later derive tick writes", () => {
    const first: ModuleTick = { id: "one/first", phase: "derive", writes: [], subscribes: ["one/thing"], run: () => undefined };
    const second: ModuleTick = { id: "one/second", phase: "derive", writes: ["one/thing"], run: () => undefined };
    const problems = problemsOf([fake("one", { objectKinds: [thing("one")], ticks: [first, second] })]);
    expect(problems).toEqual(["module one: the derive tick one/first subscribes to one/thing, which the later derive tick one/second writes"]);
  });

  it("rejects ctx.require of a token that is not in requires", () => {
    const greedy = fake("flow", {
      create: (ctx) => {
        ctx.require(tokenA);
        return { api: {}, queries: {}, commands: {}, ticks: [] };
      },
    });
    const problems = problemsOf([fake("modA", { provides: tokenA }), greedy]);
    expect(problems).toEqual(["module flow calls require(modA), which is not in its requires"]);
  });

  it("rejects contributed names that break the naming rule or the module's prefix", () => {
    const run = () => ({ ok: true as const });
    const problems = problemsOf([
      fake("one", {
        objectKinds: [{ ...thing("one"), kind: "one-thing" }],
        toolIds: ["two/tool" as RuntimeToolId],
        commands: { "one/Bad": { run } },
      }),
    ]);
    expect(problems).toEqual([
      'module one: the object kind "one-thing" is not of the form one/<noun>',
      'module one: the tool id "two/tool" is not of the form one/<noun>',
      'module one: the command "one/Bad" is not of the form one/<noun>',
    ]);
  });

  it("rejects a requiresTool that names a tool no module defines, and accepts a core tool and a module tool", () => {
    const run = () => ({ ok: true as const });
    const unknown = problemsOf([fake("one", { commands: { "one/go": { run, requiresTool: "one/nothing" } } })]);
    expect(unknown).toEqual(["module one: the command one/go requires the tool one/nothing, which no module in the experience defines"]);
    expect(() =>
      createTestEngine({
        modules: [fake("one", { toolIds: ["one/tool" as RuntimeToolId], commands: { "one/go": { run, requiresTool: "one/tool" }, "one/aim": { run, requiresTool: "aim" } } })],
      }),
    ).not.toThrow();
  });

  it("reports every problem at once", () => {
    const problems = problemsOf([fake("same"), fake("same"), fake("flow", { requires: [tokenA] })]);
    expect(problems).toEqual(["two modules have the id same", "module flow requires modA; no module in the experience provides it"]);
  });

  it("creates modules in topological order of requires, ties broken by list order", () => {
    const created: string[] = [];
    const logging = (id: string, over: Partial<AnyModuleDefinition> = {}): AnyModuleDefinition => ({
      ...fake(id, over),
      create: () => {
        created.push(id);
        return { api: {}, queries: {}, commands: {}, ticks: [] };
      },
    });
    createTestEngine({
      modules: [
        logging("late", { requires: [tokenB] }),
        logging("free"),
        logging("modB", { provides: tokenB, requires: [tokenA] }),
        logging("modA", { provides: tokenA }),
      ],
    });
    expect(created).toEqual(["free", "modA", "modB", "late"]);
  });
});
