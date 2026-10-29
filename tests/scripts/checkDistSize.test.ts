import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = "../../scripts/check-dist-size.mjs";
interface DistSizeScript {
  measureDirectory(dir: string): { totalBytes: number; files: Array<{ path: string; bytes: number }> };
  checkDistSize(dir: string, budget?: number): { ok: boolean; totalBytes: number; budgetBytes: number; largest: unknown[] };
  formatDistSizeReport(result: unknown): string;
}
async function loadScript(): Promise<DistSizeScript> {
  return (await import(/* @vite-ignore */ scriptPath)) as DistSizeScript;
}

describe("check-dist-size", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dist-size-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "a.bin"), Buffer.alloc(3000));
    fs.writeFileSync(path.join(dir, "sub", "b.bin"), Buffer.alloc(1000));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("measures files largest first with forward-slash paths", async () => {
    const { measureDirectory } = await loadScript();
    const measured = measureDirectory(dir);
    expect(measured.totalBytes).toBe(4000);
    expect(measured.files).toEqual([
      { path: "a.bin", bytes: 3000 },
      { path: "sub/b.bin", bytes: 1000 },
    ]);
  });

  it("passes at the budget, fails above it, and reports OVER BUDGET", async () => {
    const { checkDistSize, formatDistSizeReport } = await loadScript();
    expect(checkDistSize(dir, 4000).ok).toBe(true);
    const over = checkDistSize(dir, 3999);
    expect(over.ok).toBe(false);
    expect(formatDistSizeReport(over)).toContain("OVER BUDGET");
    expect(formatDistSizeReport(checkDistSize(dir, 4000))).toContain("- OK");
  });

  it("throws for a missing folder", async () => {
    const { checkDistSize } = await loadScript();
    expect(() => checkDistSize(path.join(dir, "missing"))).toThrow(/does not exist/);
  });
});
