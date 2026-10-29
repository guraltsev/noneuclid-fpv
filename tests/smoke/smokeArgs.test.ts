import { describe, expect, it } from "vitest";

// Plain ESM script; load through a variable path so tsc does not need declarations.
const modulePath = "../../scripts/smoke/smokeArgs.mjs";

interface SmokeOptions {
  pageUrl?: string;
  siteUrl?: string;
  dist: string;
  configName: string;
  worlds: string[];
  debugLevel?: string;
  timeoutMs: number;
  label: string;
}
interface SmokeArgsModule {
  parseSmokeArgs(argv: string[]): SmokeOptions;
  buildPageUrl(siteUrl: string, o: { configName: string; worldId: string; debugLevel?: string }): string;
}
const load = async () => (await import(/* @vite-ignore */ modulePath)) as SmokeArgsModule;

describe("parseSmokeArgs", () => {
  it("uses defaults", async () => {
    const { parseSmokeArgs } = await load();
    const o = parseSmokeArgs([]);
    expect(o.worlds).toEqual(["cube"]);
    expect(o.configName).toBe("full");
    expect(o.dist).toBe("dist");
    expect(o.timeoutMs).toBe(60000);
    expect(o.label).toBe("smoke");
    expect(o.debugLevel).toBeUndefined();
    expect(o.siteUrl).toBeUndefined();
    expect(o.pageUrl).toBeUndefined();
  });

  it("splits worlds", async () => {
    const { parseSmokeArgs } = await load();
    expect(parseSmokeArgs(["--world", "cube, dodecahedron,torus-moduli"]).worlds).toEqual(["cube", "dodecahedron", "torus-moduli"]);
  });

  it("accepts --flag=value", async () => {
    const { parseSmokeArgs } = await load();
    const o = parseSmokeArgs(["--world=torus", "--debug-level", "verbose"]);
    expect(o.worlds).toEqual(["torus"]);
    expect(o.debugLevel).toBe("verbose");
  });

  it("adds a trailing slash to --url", async () => {
    const { parseSmokeArgs } = await load();
    expect(parseSmokeArgs(["--url", "https://example.org/x"]).siteUrl).toBe("https://example.org/x/");
  });

  it("keeps the legacy page-url form", async () => {
    const { parseSmokeArgs } = await load();
    const o = parseSmokeArgs(["http://h/?config=full&world=cube", "lbl"]);
    expect(o.pageUrl).toBe("http://h/?config=full&world=cube");
    expect(o.label).toBe("lbl");
  });

  it("rejects bad input", async () => {
    const { parseSmokeArgs } = await load();
    expect(() => parseSmokeArgs(["--nope"])).toThrow();
    expect(() => parseSmokeArgs(["--world"])).toThrow();
    expect(() => parseSmokeArgs(["--debug-level", "loud"])).toThrow();
    expect(() => parseSmokeArgs(["--timeout-ms", "0"])).toThrow();
  });
});

describe("buildPageUrl", () => {
  it("builds the query", async () => {
    const { buildPageUrl } = await load();
    expect(buildPageUrl("http://127.0.0.1:5000/noneuclid-fpv/", { configName: "full", worldId: "cube", debugLevel: "verbose" })).toBe(
      "http://127.0.0.1:5000/noneuclid-fpv/?config=full&world=cube&debugLevel=verbose",
    );
  });
});
