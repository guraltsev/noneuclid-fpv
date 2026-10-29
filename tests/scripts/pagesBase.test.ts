import { describe, expect, it } from "vitest";

interface PagesBaseModule {
  normalizeBase(value: unknown): string | undefined;
  resolvePagesBase(input: { argv: string[]; env: Record<string, string | undefined> }): {
    base: string;
    source: string;
  };
}

const modulePath = "../../scripts/pagesBase.mjs";
async function load(): Promise<PagesBaseModule> {
  return (await import(/* @vite-ignore */ modulePath)) as PagesBaseModule;
}

describe("resolvePagesBase", () => {
  it("reads --base <value>", async () => {
    const { resolvePagesBase } = await load();
    expect(resolvePagesBase({ argv: ["--base", "camp-2026-VR"], env: {} })).toEqual({
      base: "/camp-2026-VR/",
      source: "--base",
    });
  });

  it("reads --base=<value>", async () => {
    const { resolvePagesBase } = await load();
    expect(resolvePagesBase({ argv: ["--base=noneuclid-fpv"], env: {} }).base).toBe("/noneuclid-fpv/");
  });

  it("prefers --base over VITE_BASE", async () => {
    const { resolvePagesBase } = await load();
    expect(resolvePagesBase({ argv: ["--base", "a"], env: { VITE_BASE: "b" } })).toEqual({
      base: "/a/",
      source: "--base",
    });
  });

  it("falls back to VITE_BASE", async () => {
    const { resolvePagesBase } = await load();
    expect(resolvePagesBase({ argv: [], env: { VITE_BASE: "/noneuclid-fpv/" } })).toEqual({
      base: "/noneuclid-fpv/",
      source: "VITE_BASE",
    });
  });

  it.each([".", "/"])("treats %s as the domain root", async (value) => {
    const { resolvePagesBase } = await load();
    expect(resolvePagesBase({ argv: ["--base", value], env: {} }).base).toBe("/");
  });

  it("throws when nothing is given", async () => {
    const { resolvePagesBase } = await load();
    expect(() => resolvePagesBase({ argv: [], env: {} })).toThrow("No Pages base path given");
  });

  it("throws when --base has no value", async () => {
    const { resolvePagesBase } = await load();
    expect(() => resolvePagesBase({ argv: ["--base"], env: {} })).toThrow("needs a value");
  });

  it("rejects a Git Bash rewritten path", async () => {
    const { resolvePagesBase } = await load();
    expect(() =>
      resolvePagesBase({ argv: [], env: { VITE_BASE: "C:/Program Files/Git/noneuclid-fpv/" } }),
    ).toThrow("Git Bash");
  });

  it("rejects invalid characters", async () => {
    const { resolvePagesBase } = await load();
    expect(() => resolvePagesBase({ argv: ["--base", "my repo"], env: {} })).toThrow("not a valid Pages path");
  });
});

describe("normalizeBase", () => {
  it.each(["x", "/x", "x/", "/x/"])("normalizes %s", async (value) => {
    const { normalizeBase } = await load();
    expect(normalizeBase(value)).toBe("/x/");
  });

  it("returns undefined for empty input", async () => {
    const { normalizeBase } = await load();
    expect(normalizeBase("")).toBeUndefined();
    expect(normalizeBase(undefined)).toBeUndefined();
  });
});
