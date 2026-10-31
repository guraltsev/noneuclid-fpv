import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Plain ESM scripts; load through variable paths so tsc does not need declarations.
const libPath = "../../scripts/publish/lib.mjs";
const publishPath = "../../scripts/publish/publish.mjs";

interface Entry {
  branch: string;
  sha: string;
  publishedAt: string;
  bytes?: number;
}
interface Manifest {
  default: string;
  entries: Record<string, Entry>;
}
interface Lib {
  folderForBranch(branch: string): string;
  branchMatches(branch: string, patterns: string[]): boolean;
  siteBaseFromRemote(url: string): string;
  folderBase(siteBase: string, folder: string): string;
  parseManifest(text: string, defaultBranch: string): Manifest;
  withEntry(manifest: Manifest, folder: string, entry: Entry): Manifest;
  pruneManifest(manifest: Manifest, live: string[]): { manifest: Manifest; removed: string[] };
  renderIndex(manifest: Manifest): string;
  renderVersions(manifest: Manifest): string;
}
interface PublishResult {
  status: string;
  build?: boolean;
  folder?: string;
}
interface PublishModule {
  publish(options: Record<string, unknown>): Promise<PublishResult>;
}
const loadLib = async () => (await import(/* @vite-ignore */ libPath)) as Lib;
const loadPublish = async () => (await import(/* @vite-ignore */ publishPath)) as PublishModule;

describe("publish helpers", () => {
  it("maps branch names to folders", async () => {
    const { folderForBranch } = await loadLib();
    expect(folderForBranch("main")).toBe("main");
    expect(folderForBranch("design/012-engine-api")).toBe("design-012-engine-api");
    expect(() => folderForBranch("///")).toThrow();
    expect(() => folderForBranch("versions")).toThrow("reserved");
  });

  it("matches branch globs", async () => {
    const { branchMatches } = await loadLib();
    expect(branchMatches("main", ["main"])).toBe(true);
    expect(branchMatches("design/012", ["design/**"])).toBe(true);
    expect(branchMatches("design/a/b", ["design/*"])).toBe(false);
    expect(branchMatches("design/a/b", ["design/**"])).toBe(true);
    expect(branchMatches("other", ["main", "design/**"])).toBe(false);
    expect(branchMatches("mainx", ["main"])).toBe(false);
  });

  it("derives the site base from a remote URL", async () => {
    const { siteBaseFromRemote, folderBase } = await loadLib();
    expect(siteBaseFromRemote("git@github.com:guraltsev/noneuclid-fpv.git")).toBe("/noneuclid-fpv/");
    expect(siteBaseFromRemote("https://github.com/guraltsev/noneuclid-fpv")).toBe("/noneuclid-fpv/");
    expect(siteBaseFromRemote("https://github.com/guraltsev/guraltsev.github.io.git")).toBe("/");
    expect(folderBase("/site/", "main")).toBe("/site/main/");
    expect(folderBase("/", "main")).toBe("/main/");
  });

  it("records, prunes and renders the manifest", async () => {
    const { parseManifest, withEntry, pruneManifest, renderIndex, renderVersions } = await loadLib();
    expect(parseManifest("not json", "main")).toEqual({ default: "main", entries: {} });
    let manifest = parseManifest("", "main");
    manifest = withEntry(manifest, "main", { branch: "main", sha: "a".repeat(40), publishedAt: "t" });
    manifest = withEntry(manifest, "x-y", { branch: "x/y", sha: "b".repeat(40), publishedAt: "t" });
    const html = renderIndex(manifest);
    expect(html).toContain('url=./main/"');
    const versions = renderVersions(manifest);
    expect(versions).toContain('href="../x-y/"');
    expect(versions).toContain('href="../main/"');
    const { manifest: pruned, removed } = pruneManifest(manifest, ["main"]);
    expect(removed).toEqual(["x-y"]);
    expect(Object.keys(pruned.entries)).toEqual(["main"]);
    expect(renderIndex({ default: "main", entries: { "x-y": manifest.entries["x-y"] } })).toContain('url=./versions/"');
    expect(renderVersions({ default: "main", entries: {} })).toContain("Nothing is published yet");
  });
});

describe("publish end to end (temporary repositories)", { timeout: 60_000 }, () => {
  let tmp: string;
  let work: string;
  let remote: string;

  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const show = (file: string) => spawnSync("git", ["show", `gh_pages:${file}`], { cwd: remote, encoding: "utf8" });
  const commitFile = (content: string) => {
    fs.writeFileSync(path.join(work, "src.txt"), content);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", content);
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-test-"));
    remote = path.join(tmp, "site.git");
    work = path.join(tmp, "work");
    fs.mkdirSync(work);
    git(tmp, "init", "-q", "--bare", "-b", "main", remote);
    git(work, "init", "-q", "-b", "main");
    git(work, "config", "user.name", "t");
    git(work, "config", "user.email", "t@example.com");
    git(work, "remote", "add", "origin", remote);
    // The "build" writes dist/index.html containing the base and the source text.
    fs.writeFileSync(
      path.join(work, "build.mjs"),
      'import fs from "node:fs"; fs.mkdirSync("dist",{recursive:true}); fs.writeFileSync("dist/index.html", `base=${process.argv[2]} src=${fs.readFileSync("src.txt","utf8")}`);',
    );
    fs.writeFileSync(
      path.join(work, "publish.config.json"),
      JSON.stringify({ branches: ["main", "feature/**"], build: ["node", "build.mjs", "{base}"], siteBase: "/site/" }),
    );
    fs.writeFileSync(path.join(work, ".gitignore"), "dist\n");
    commitFile("one");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("publishes a branch folder, skips a current commit, and keeps other folders", async () => {
    const { publish } = await loadPublish();
    const quiet = { cwd: work, log: () => undefined };

    expect((await publish(quiet)).status).toBe("published");
    expect(show("main/index.html").stdout).toBe("base=/site/main/ src=one");
    expect(show("index.html").stdout).toContain("url=./main/");
    expect(show("versions/index.html").stdout).toContain('href="../main/"');
    expect(JSON.parse(show("published.json").stdout).entries.main.sha).toBe(git(work, "rev-parse", "HEAD"));

    expect((await publish(quiet)).status).toBe("current");
    expect(await publish({ ...quiet, check: true })).toEqual({ status: "check", build: false });

    git(work, "checkout", "-q", "-b", "feature/x");
    commitFile("two");
    expect(await publish({ ...quiet, check: true })).toEqual({ status: "check", build: true });
    expect((await publish(quiet)).status).toBe("published");
    expect(show("feature-x/index.html").stdout).toBe("base=/site/feature-x/ src=two");
    expect(show("main/index.html").stdout).toBe("base=/site/main/ src=one");
    // History mode "single": the published branch is one commit.
    expect(git(remote, "rev-list", "--count", "gh_pages")).toBe("1");
  });

  it("skips unlisted branches unless forced, and refuses a dirty tree", async () => {
    const { publish } = await loadPublish();
    const quiet = { cwd: work, log: () => undefined };
    git(work, "checkout", "-q", "-b", "scratch");
    expect((await publish(quiet)).status).toBe("skipped");
    fs.writeFileSync(path.join(work, "src.txt"), "dirty");
    await expect(publish({ ...quiet, force: true })).rejects.toThrow("uncommitted");
    git(work, "checkout", "--", "src.txt");
    expect((await publish({ ...quiet, force: true })).status).toBe("published");
  });

  it("--add lists the branch in the config and then publishes it", async () => {
    const { publish } = await loadPublish();
    const quiet = { cwd: work, log: () => undefined };
    git(work, "add", "-A");
    git(work, "commit", "-q", "--allow-empty", "-m", "config");
    git(work, "checkout", "-q", "-b", "scratch");
    expect((await publish(quiet)).status).toBe("skipped");
    expect((await publish({ ...quiet, add: true })).status).toBe("published");
    const config = JSON.parse(fs.readFileSync(path.join(work, "publish.config.json"), "utf8"));
    expect(config.branches).toEqual(["main", "feature/**", "scratch"]);
    expect(config.siteBase).toBe("/site/");
    expect(show("scratch/index.html").status).toBe(0);
    // Adding again changes nothing.
    await publish({ ...quiet, add: true, force: true });
    expect(JSON.parse(fs.readFileSync(path.join(work, "publish.config.json"), "utf8")).branches).toHaveLength(3);
  });

  it("--remove deletes a branch's folder and its entry in the config", async () => {
    const { publish } = await loadPublish();
    const quiet = { cwd: work, log: () => undefined };
    await publish(quiet);
    git(work, "checkout", "-q", "-b", "scratch");
    await publish({ ...quiet, add: true });
    expect(show("scratch/index.html").status).toBe(0);

    // Works from any checked-out branch, by name.
    git(work, "checkout", "-q", "main");
    expect((await publish({ ...quiet, remove: true, branch: "scratch" })).status).toBe("removed");
    expect(show("scratch/index.html").status).not.toBe(0);
    expect(show("main/index.html").status).toBe(0);
    expect(Object.keys(JSON.parse(show("published.json").stdout).entries)).toEqual(["main"]);
    expect(git(work, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("prunes folders of branches that no longer exist", async () => {
    const { publish } = await loadPublish();
    const quiet = { cwd: work, log: () => undefined };
    git(work, "push", "-q", "origin", "main");
    await publish(quiet);
    git(work, "checkout", "-q", "-b", "feature/gone");
    await publish(quiet);
    expect(show("feature-gone/index.html").status).toBe(0);
    // feature/gone was never pushed, so it is not live on the remote.
    expect((await publish({ ...quiet, pruneOnly: true })).status).toBe("pruned");
    expect(show("feature-gone/index.html").status).not.toBe(0);
    expect(show("main/index.html").status).toBe(0);
  });
});
