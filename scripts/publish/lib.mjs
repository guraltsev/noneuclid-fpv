/**
 * Pure helpers of the branch publisher (scripts/publish/publish.mjs): folder names, branch patterns, the site base
 * path, the manifest `published.json` and the root `index.html`. No file system and no git, so they are unit-tested
 * directly (tests/scripts/publish.test.ts). Nothing here is specific to this repository.
 */

/** Turns a branch name into a folder name: `design/012-engine-api` becomes `design-012-engine-api`. */
export function folderForBranch(branch) {
  const folder = branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
  if (folder === "") throw new Error(`The branch name "${branch}" gives an empty folder name.`);
  if (RESERVED_FOLDERS.includes(folder)) throw new Error(`The folder name "${folder}" is reserved for the site; rename the branch.`);
  return folder;
}

/** True when `branch` matches one of the glob `patterns` (`*` stays inside one path segment, `**` crosses `/`). */
export function branchMatches(branch, patterns) {
  return patterns.some((pattern) => {
    const source = pattern
      .split("**")
      .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
      .join(".*");
    return new RegExp(`^${source}$`).test(branch);
  });
}

function escapeRegExp(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The path the whole site is served under, from a remote URL: `git@github.com:me/site.git` gives `/site/`; a user
 * site (`me.github.io`) gives `/`. Throws when the URL has no repository name.
 */
export function siteBaseFromRemote(url) {
  const match = /[/:]([^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) throw new Error(`Cannot read a repository name from the remote URL "${url}"; set "siteBase" in the config.`);
  return /\.github\.io$/i.test(match[1]) ? "/" : `/${match[1]}/`;
}

/** The base path of one published folder, for example `/site/` + `main` gives `/site/main/`. */
export function folderBase(siteBase, folder) {
  return `${siteBase.replace(/\/*$/, "/")}${folder}/`;
}

/** An empty manifest. */
export function emptyManifest(defaultBranch) {
  return { default: defaultBranch, entries: {} };
}

/** Parses `published.json` text; unreadable or missing text gives an empty manifest. */
export function parseManifest(text, defaultBranch) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
      return { default: parsed.default ?? defaultBranch, entries: parsed.entries };
    }
  } catch {
    // fall through
  }
  return emptyManifest(defaultBranch);
}

/** Returns a copy of the manifest with `entry` recorded for `folder`. */
export function withEntry(manifest, folder, entry) {
  return { ...manifest, entries: { ...manifest.entries, [folder]: entry } };
}

/** Returns a copy without the folders whose branch is not in `liveBranches`, and the folders removed. */
export function pruneManifest(manifest, liveBranches) {
  const live = new Set(liveBranches);
  const entries = {};
  const removed = [];
  for (const [folder, entry] of Object.entries(manifest.entries)) {
    if (live.has(entry.branch)) entries[folder] = entry;
    else removed.push(folder);
  }
  return { manifest: { ...manifest, entries }, removed };
}

/** Total size in bytes recorded in the manifest. */
export function totalBytes(manifest) {
  return Object.values(manifest.entries).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Folder names that belong to the site itself and cannot be used for a branch. */
export const RESERVED_FOLDERS = ["versions"];

/**
 * The root `index.html`: redirects to the default branch's folder when it is published, otherwise to `versions/`.
 */
export function renderIndex(manifest) {
  const defaultFolder = Object.entries(manifest.entries).find(([, entry]) => entry.branch === manifest.default)?.[0];
  const target = defaultFolder ? `./${escapeHtml(defaultFolder)}/` : "./versions/";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0; url=${target}"><link rel="canonical" href="${target}"><title>Redirecting</title></head>
<body><p><a href="${target}">Continue</a> or see <a href="./versions/">all published versions</a>.</p></body></html>
`;
}

/** The page `versions/index.html`: every published branch with its commit and time, linking to its folder. */
export function renderVersions(manifest) {
  const rows = Object.entries(manifest.entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([folder, entry]) =>
        `<li><a href="../${escapeHtml(folder)}/">${escapeHtml(entry.branch)}</a>${entry.branch === manifest.default ? " (default)" : ""} <small>${escapeHtml(entry.sha.slice(0, 7))}, ${escapeHtml(entry.publishedAt)}</small></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Published versions</title></head>
<body><h1>Published versions</h1>
<ul>
${rows === "" ? "<li>Nothing is published yet.</li>" : rows}
</ul></body></html>
`;
}
