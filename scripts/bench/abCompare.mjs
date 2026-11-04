/**
 * Settles a timing alarm of the module step bench by comparing a base commit with HEAD on this machine, alternating runs.
 *
 *   npm run bench:ab -- <commit>
 *
 * Needs a clean working tree (exit 2 otherwise). Adds a detached worktree of <commit> in the system temp directory, links
 * node_modules into it, then runs `npm run bench -- moduleStep` three rounds, alternating base and HEAD, with a 20 second
 * pause between runs. Prints the flow and flow+dependents us/step of every run and the median of each; exits 1 when the
 * HEAD median of either scene is more than 10% above the base median, else 0. The temporary worktree is always removed.
 * A developer tool like run.mjs; the counters (not this tool) are the exact gate.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rounds = 3;
const pauseSeconds = 20;
const allowedRatio = 1.1;
const commit = process.argv[2];

if (!commit) {
  console.error("usage: npm run bench:ab -- <commit>");
  process.exit(2);
}

const status = git(repoRoot, ["status", "--porcelain"]);
if (status.status !== 0 || status.stdout.trim() !== "") {
  console.error("bench:ab needs a clean working tree; commit or stash first.");
  process.exit(2);
}
if (git(repoRoot, ["rev-parse", "--verify", `${commit}^{commit}`]).status !== 0) {
  console.error(`not a commit: ${commit}`);
  process.exit(2);
}

const baseDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bench-ab-")), "base");
let exitCode = 2;
try {
  const added = git(repoRoot, ["worktree", "add", "--detach", baseDir, commit]);
  if (added.status !== 0) {
    console.error(added.stderr);
    process.exit(2);
  }
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(baseDir, "node_modules"), "junction");

  const samples = { base: [], head: [] };
  let runs = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (const [label, dir] of [["base", baseDir], ["head", repoRoot]]) {
      if (runs > 0) pause(pauseSeconds);
      runs += 1;
      const sample = runBench(dir);
      samples[label].push(sample);
      console.info(`round ${round + 1} ${label}: flow ${sample.flow} us/step, flow+dependents ${sample.dependents} us/step`);
    }
  }

  const base = { flow: median(samples.base.map((s) => s.flow)), dependents: median(samples.base.map((s) => s.dependents)) };
  const head = { flow: median(samples.head.map((s) => s.flow)), dependents: median(samples.head.map((s) => s.dependents)) };
  console.info(`\nmedian base ${commit}: flow ${base.flow.toFixed(2)}, flow+dependents ${base.dependents.toFixed(2)} us/step`);
  console.info(`median head:           flow ${head.flow.toFixed(2)}, flow+dependents ${head.dependents.toFixed(2)} us/step`);
  const slower = head.flow > base.flow * allowedRatio || head.dependents > base.dependents * allowedRatio;
  console.info(slower ? "bench:ab: HEAD is more than 10% slower than base" : "bench:ab: ok");
  exitCode = slower ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 2;
} finally {
  git(repoRoot, ["worktree", "remove", "--force", baseDir]);
  fs.rmSync(path.dirname(baseDir), { recursive: true, force: true });
  git(repoRoot, ["worktree", "prune"]);
}
process.exit(exitCode);

function git(cwd, gitArgs) {
  return spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
}

function pause(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function runBench(cwd) {
  const result = spawnSync("npm", ["run", "bench", "--", "moduleStep"], { cwd, encoding: "utf8", shell: true });
  const flow = /^flow\s+([\d.]+) us\/step/m.exec(result.stdout ?? "");
  const dependents = /^flow\+dependents\s+([\d.]+) us\/step/m.exec(result.stdout ?? "");
  if (result.status !== 0 || !flow || !dependents) {
    throw new Error(`bench failed in ${cwd} (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return { flow: Number(flow[1]), dependents: Number(dependents[1]) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
