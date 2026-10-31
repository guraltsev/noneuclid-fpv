/**
 * Branch publisher for GitHub Pages: builds the current commit and copies the result into a folder of the `gh_pages`
 * branch (`gh_pages/<branch-folder>/`), records the commit in `gh_pages/published.json`, and keeps a root
 * `index.html` that redirects to the default branch's folder. GitHub Pages serves `gh_pages` ("Deploy from a branch").
 * It skips the build when `published.json` already records the commit, so a local `npm run publish` and the optional
 * workflow (.github/workflows/publish.yml) never do the same work twice. No dependencies, nothing specific to this
 * repository: configuration is `publish.config.json`. Documented in _docs/PUBLISHING.md.
 *
 *   node scripts/publish/publish.mjs [--branch <name>] [--add] [--remove] [--force] [--check] [--prune] [--prune-only] [--no-push]
 *                                    [--remote <name>] [--config <file>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  branchMatches,
  emptyManifest,
  folderForBranch,
  parseManifest,
  pruneManifest,
  renderIndex,
  renderVersions,
  totalBytes,
  withEntry,
} from "./lib.mjs";

/** Defaults; every key can be overridden in `publish.config.json`. */
export const DEFAULT_CONFIG = {
  // Branch that holds the published site.
  pagesBranch: "gh_pages",
  // Branches that are published (globs); others are skipped unless --force.
  branches: ["main"],
  // Branch the site root redirects to.
  defaultBranch: "main",
  // Build command as an argument list. The build must be relocatable (relative asset paths), because each branch is served from its own sub-path.
  build: ["npm", "run", "build"],
  // Folder the build writes, relative to the repository root.
  dist: "dist",
  // "single": gh_pages is one force-pushed commit (small repository). "keep": every publish is a new commit.
  history: "single",
  // Remote name; defaults to "origin", else the first remote.
  remote: undefined,
  // Warn when the published folders add up to more than this many MiB (GitHub Pages sites are limited to 1 GiB).
  warnTotalMiB: 800,
};

function run(command, args, { cwd, env, allowFail = false, shell = false } = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", shell });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}

/**
 * Publishes the checked-out commit (or only prunes). Resolves to `{ status, ... }` where status is one of
 * `published`, `current` (already recorded), `skipped` (branch not listed), `pruned`, `check` (with `build: boolean`).
 */
export async function publish(options = {}) {
  const log = options.log ?? ((message) => console.log(`publish: ${message}`));
  const cwd = options.cwd ?? process.cwd();
  const git = (args, extra = {}) => run("git", args, { cwd, ...extra });
  const root = git(["rev-parse", "--show-toplevel"]).out;
  const configFile = path.resolve(root, options.configFile ?? "publish.config.json");
  const fileConfig = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  const config = { ...DEFAULT_CONFIG, ...fileConfig, ...(options.config ?? {}) };

  const remotes = git(["remote"]).out.split(/\s+/).filter(Boolean);
  const remote = options.remote ?? config.remote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
  if (!remote) throw new Error("The repository has no git remote.");
  const pagesRef = `refs/heads/${config.pagesBranch}`;
  const trackingRef = `refs/remotes/${remote}/${config.pagesBranch}`;

  const fetchPages = () => {
    const fetched = git(["fetch", "--quiet", remote, `+${pagesRef}:${trackingRef}`], { allowFail: true });
    if (fetched.ok) return git(["rev-parse", trackingRef]).out;
    git(["update-ref", "-d", trackingRef], { allowFail: true });
    return undefined;
  };
  const readManifestAt = (tip) =>
    tip
      ? parseManifest(git(["show", `${tip}:published.json`], { allowFail: true }).out, config.defaultBranch)
      : emptyManifest(config.defaultBranch);
  const liveBranches = () =>
    git(["ls-remote", "--heads", remote]).out
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, ""))
      .filter(Boolean);

  const pruneOnly = options.pruneOnly === true;
  const remove = options.remove === true;
  const noBuild = pruneOnly || remove;
  const outcome = remove ? "removed" : "pruned";
  let branch;
  let folder;
  let sha;
  if (remove) {
    branch = options.branch ?? git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
    if (branch === "HEAD") throw new Error("Detached HEAD: pass --branch <name>.");
    folder = folderForBranch(branch);
    if (config.branches.includes(branch)) {
      config.branches = config.branches.filter((name) => name !== branch);
      fs.writeFileSync(configFile, `${JSON.stringify({ ...fileConfig, branches: config.branches }, null, 2)}\n`);
      log(`removed "${branch}" from "branches" in ${path.relative(root, configFile)}; commit that file.`);
    } else if (branchMatches(branch, config.branches)) {
      log(`note: "${branch}" still matches a pattern in "branches"; the workflow would publish it again on its next push.`);
    }
  } else if (!pruneOnly) {
    branch = options.branch ?? git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
    if (branch === "HEAD") throw new Error("Detached HEAD: pass --branch <name>.");
    sha = git(["rev-parse", "HEAD"]).out;
    folder = folderForBranch(branch);
    if (options.add && !branchMatches(branch, config.branches)) {
      config.branches = [...config.branches, branch];
      fs.writeFileSync(configFile, `${JSON.stringify({ ...fileConfig, branches: config.branches }, null, 2)}\n`);
      log(`added "${branch}" to "branches" in ${path.relative(root, configFile)}; commit that file so the workflow knows it too.`);
    }
    if (!options.force && !branchMatches(branch, config.branches)) {
      log(`branch "${branch}" is not in "branches" of the config; skipping (use --force to publish it).`);
      return { status: "skipped", branch };
    }
    const current = readManifestAt(fetchPages()).entries[folder];
    if (!options.force && current?.sha === sha) {
      log(`${folder}/ already holds ${sha.slice(0, 7)}; nothing to do.`);
      return options.check ? { status: "check", build: false } : { status: "current", folder, sha };
    }
    if (options.check) return { status: "check", build: true };
    // The config file may differ (--add); the build does not depend on it.
    const configPath = path.relative(root, configFile).split(path.sep).join("/");
    const dirty = git(["diff", "--name-only", "HEAD"])
      .out.split("\n")
      .filter((name) => name !== "" && name !== configPath);
    if (dirty.length > 0) {
      throw new Error("The working tree has uncommitted changes; commit them first so the published folder matches the commit.");
    }
  }

  let bytes = 0;
  const distDir = path.resolve(root, config.dist);
  if (!noBuild) {
    log(`building ${branch} (${sha.slice(0, 7)})`);
    const [command, ...args] = config.build;
    fs.rmSync(distDir, { recursive: true, force: true });
    // npm is a .cmd shim on Windows and needs a shell; other commands run directly.
    const built = spawnSync(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32" && command === "npm",
    });
    if (built.error) throw built.error;
    if (built.status !== 0) throw new Error(`The build command failed (exit ${built.status}).`);
    if (!fs.existsSync(distDir)) throw new Error(`The build did not create "${config.dist}".`);
    // A build with root-absolute asset paths (src="/assets/...") would 404 under a sub-path; fail instead.
    const builtIndex = path.join(distDir, "index.html");
    if (fs.existsSync(builtIndex) && /\b(?:src|href)="\/[^/"]/.test(fs.readFileSync(builtIndex, "utf8"))) {
      throw new Error('The built index.html uses root-absolute paths; build with relative paths (Vite: base "./").');
    }
    bytes = directorySize(distDir);
  }

  const hasIdentity = git(["config", "user.name"], { allowFail: true }).out !== "";
  const identity = hasIdentity
    ? {}
    : {
        GIT_AUTHOR_NAME: "publish script",
        GIT_AUTHOR_EMAIL: "publish@localhost",
        GIT_COMMITTER_NAME: "publish script",
        GIT_COMMITTER_EMAIL: "publish@localhost",
      };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const tip = fetchPages();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-"));
    git(["worktree", "add", "--quiet", "--detach", dir, tip ?? "HEAD"]);
    try {
      const inDir = (args, extra = {}) => run("git", args, { cwd: dir, ...extra });
      if (!tip) inDir(["rm", "-rq", "--ignore-unmatch", "."]);
      const manifestFile = path.join(dir, "published.json");
      let manifest = fs.existsSync(manifestFile)
        ? parseManifest(fs.readFileSync(manifestFile, "utf8"), config.defaultBranch)
        : emptyManifest(config.defaultBranch);
      manifest.default = config.defaultBranch;
      let message;
      if (remove) {
        if (!manifest.entries[folder]) log(`${folder}/ is not published.`);
        fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
        const { [folder]: _gone, ...rest } = manifest.entries;
        manifest = { ...manifest, entries: rest };
        message = `Remove ${folder}`;
      } else if (!pruneOnly) {
        fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
        fs.cpSync(distDir, path.join(dir, folder), { recursive: true });
        manifest = withEntry(manifest, folder, { branch, sha, publishedAt: new Date().toISOString(), bytes });
        message = `Publish ${folder} @ ${sha.slice(0, 7)}`;
      }
      if (pruneOnly || (options.prune && !remove)) {
        const { manifest: pruned, removed } = pruneManifest(manifest, [...liveBranches(), ...(branch ? [branch] : [])]);
        manifest = pruned;
        for (const name of removed) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        if (removed.length > 0) {
          log(`pruned ${removed.join(", ")}`);
          message ??= `Prune ${removed.join(", ")}`;
        }
      }
      message ??= "Prune";
      fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, "index.html"), renderIndex(manifest));
      fs.mkdirSync(path.join(dir, "versions"), { recursive: true });
      fs.writeFileSync(path.join(dir, "versions", "index.html"), renderVersions(manifest));
      fs.writeFileSync(path.join(dir, ".nojekyll"), "\n");
      inDir(["add", "-A"]);
      const tree = inDir(["write-tree"]).out;
      if (tip && tree === git(["rev-parse", `${tip}^{tree}`]).out) {
        log("the published branch is already up to date.");
        return noBuild ? { status: outcome } : { status: "current", folder, sha };
      }
      const parent = tip && config.history === "keep" ? ["-p", tip] : [];
      const commit = inDir(["commit-tree", tree, ...parent, "-m", message], { env: identity }).out;
      if (options.push === false) {
        git(["update-ref", pagesRef, commit]);
        log(`committed ${commit.slice(0, 7)} to local ${config.pagesBranch} (not pushed).`);
        return { status: "published", folder, sha, commit };
      }
      const lease = config.history === "single" ? [`--force-with-lease=${pagesRef}:${tip ?? ""}`] : [];
      const pushed = git(["push", "--quiet", remote, `${commit}:${pagesRef}`, ...lease], { allowFail: true });
      if (pushed.ok) {
        const total = totalBytes(manifest) / 1024 / 1024;
        log(`${remove ? `removed ${folder}/` : pruneOnly ? "pruned" : `published ${folder}/`} (${total.toFixed(0)} MiB in all).`);
        if (total > config.warnTotalMiB) log(`warning: the site is larger than ${config.warnTotalMiB} MiB; prune old branches.`);
        return noBuild ? { status: outcome } : { status: "published", folder, sha, commit };
      }
      log(`push rejected (attempt ${attempt}); someone else published meanwhile, retrying.`);
    } finally {
      git(["worktree", "remove", "--force", dir], { allowFail: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  throw new Error("Could not push the published branch after 5 attempts.");
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") options.force = true;
    else if (arg === "--add") options.add = true;
    else if (arg === "--remove") options.remove = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--prune") options.prune = true;
    else if (arg === "--prune-only") options.pruneOnly = true;
    else if (arg === "--no-push") options.push = false;
    else if (arg === "--branch") options.branch = argv[++i];
    else if (arg === "--remote") options.remote = argv[++i];
    else if (arg === "--config") options.configFile = argv[++i];
    else throw new Error(`Unknown argument "${arg}".`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await publish(options);
    if (options.check) {
      const line = `build=${result.build === true}`;
      console.log(line);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    }
  } catch (error) {
    console.error(`publish: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
