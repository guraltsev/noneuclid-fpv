import { describe, expect, it } from "vitest";
import { callApi, listApi, toPlainData } from "../../src/runtime/apiCall";

describe("callApi", () => {
  const api = {
    app: {
      add: (a: number, b: number) => a + b,
      later: async () => ({ done: true }),
      value: 3,
      self() {
        return this === api.app;
      },
    },
    top: () => "top",
  };

  it("calls a nested function with arguments", async () => {
    expect(await callApi(api, ["app", "add"], [1, 2])).toBe(3);
    expect(await callApi(api, ["top"], [])).toBe("top");
  });

  it("calls the function on its namespace object", async () => {
    expect(await callApi(api, ["app", "self"], [])).toBe(true);
  });

  it("awaits async functions", async () => {
    expect(await callApi(api, ["app", "later"], [])).toEqual({ done: true });
  });

  it("rejects an unknown path", async () => {
    await expect(callApi(api, ["app", "nope"], [])).rejects.toThrow("no such API function: app.nope");
    await expect(callApi(api, ["nope", "add"], [])).rejects.toThrow("no such API function: nope.add");
  });

  it("rejects a non-function at the end", async () => {
    await expect(callApi(api, ["app", "value"], [])).rejects.toThrow("no such API function: app.value");
    await expect(callApi(api, ["app"], [])).rejects.toThrow("no such API function: app");
  });

  it("rejects forbidden segments", async () => {
    for (const segment of ["__proto__", "prototype", "constructor"]) {
      await expect(callApi(api, ["app", segment], [])).rejects.toThrow("no such API function");
      await expect(callApi(api, [segment], [])).rejects.toThrow("no such API function");
    }
    await expect(callApi(api, ["app", "add", "call"], [])).rejects.toThrow("no such API function");
  });
});

describe("listApi", () => {
  it("returns sorted nested names", () => {
    const api = { b: { z: () => 1, a: () => 2, n: 5 }, a: { f: () => 3 } };
    const list = listApi(api);
    expect(Object.keys(list)).toEqual(["a", "b"]);
    expect(list).toEqual({ a: ["f"], b: ["a", "z"] });
  });
});

describe("toPlainData", () => {
  it("turns a Map with string keys into an object", () => {
    expect(toPlainData(new Map<string, unknown>([["a", 1], ["b", new Set([1, 2])]]))).toEqual({ a: 1, b: [1, 2] });
  });

  it("turns another Map into an array of pairs", () => {
    expect(toPlainData(new Map([[1, "x"]]))).toEqual([[1, "x"]]);
  });

  it("turns typed arrays and sets into arrays", () => {
    expect(toPlainData(new Float32Array([1, 2]))).toEqual([1, 2]);
    expect(toPlainData(new Set(["a"]))).toEqual(["a"]);
  });

  it("turns an Error into name and message", () => {
    expect(toPlainData(new TypeError("bad"))).toEqual({ name: "TypeError", message: "bad" });
  });

  it("drops functions and keeps plain data", () => {
    expect(toPlainData({ a: 1, f: () => 1, s: "x", n: null, l: [1, { b: true }] })).toEqual({
      a: 1,
      s: "x",
      n: null,
      l: [1, { b: true }],
    });
  });

  it("throws on a cycle but allows shared references", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toPlainData(cyclic)).toThrow("result is not plain data (cycle)");
    const shared = { x: 1 };
    expect(toPlainData({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });
});
