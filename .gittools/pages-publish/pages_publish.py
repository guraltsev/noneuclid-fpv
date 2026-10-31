"""Publish built folders of a repository's branches to a GitHub Pages branch.

Call ``python .gittools/pages-publish/pages_publish.py publish`` to build the checked-out
commit with the command configured in ``config.toml`` and copy the result
into ``<pages branch>/<branch folder>/``. The Pages branch (``gh_pages`` by
default) also receives ``published.json`` (which commit each folder was built
from), a ``versions/`` page listing every published folder, and a root
``index.html`` that redirects to the default branch.

A commit that ``published.json`` already records is skipped without building,
so a local publish and the optional workflow never repeat each other's work.
The working tree is never touched: the Pages branch is assembled in a temporary
git worktree and pushed with a lease, by default as a single commit so built
files do not accumulate in history.

The command-line interface delegates to ``main(...)``. Only the Python standard
library and ``git`` are required (Python 3.11 or newer); ``gh`` is used only by
``enable-pages``.
"""

from __future__ import annotations

import argparse
import contextlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Sequence

# Folder names that belong to the site itself and cannot name a branch.
RESERVED_FOLDERS = frozenset({"versions"})

# Config file next to this script unless ``--config`` is given.
DEFAULT_CONFIG_PATH = Path(__file__).resolve().with_name("config.toml")

# Keys accepted in each config table; anything else is reported as a typo.
_PUBLISH_KEYS = {
    "pages_branch",
    "branches",
    "default_branch",
    "history",
    "remote",
    "site_base",
    "warn_total_mib",
    "require_relative",
}
_BUILD_KEYS = {"command", "commands", "dist", "cwd", "env"}

# Marker lines delimiting the block that ``install-hook`` owns in a hook file.
_HOOK_BEGIN = "# pages-publish:begin"
_HOOK_END = "# pages-publish:end"


# ----------------------------------------------------------------------------
# Command-line entrypoint and the commands it dispatches to
# ----------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command-line interface and return its exit status.

    Parameters
    ----------
    argv : sequence of str, optional
        Arguments after the program name. Defaults to ``sys.argv[1:]``. When no
        command is named, ``publish`` is used.

    Returns
    -------
    int
        ``0`` on success and ``1`` when the command failed with an error
        message printed to standard error.
    """
    args = _parse_arguments(list(sys.argv[1:] if argv is None else argv))

    try:
        # Every command works on the repository that contains the current
        # directory, whatever subdirectory the command was started from.
        root = Path(_git(["rev-parse", "--show-toplevel"], cwd=Path.cwd())).resolve()
        config_path = (root / args.config).resolve() if args.config else DEFAULT_CONFIG_PATH

        if args.command == "init":
            return _command_init(root, config_path, force=args.force)
        if args.command == "install-hook":
            return _command_install_hook(root)

        config = load_config(config_path)

        if args.command == "publish":
            result = publish(
                root,
                config,
                branch=args.branch,
                force=args.force,
                add=args.add,
                push=not args.no_push,
                prune_dead=args.prune,
                config_path=config_path,
            )
            return 0 if result.status != "failed" else 1
        if args.command == "check":
            result = publish(root, config, branch=args.branch, check_only=True)
            _announce_check(result.build)
            return 0
        if args.command == "remove":
            remove(root, config, branch=args.branch, config_path=config_path)
            return 0
        if args.command == "prune":
            prune(root, config)
            return 0
        if args.command == "status":
            return _command_status(root, config)
        if args.command == "enable-pages":
            return _command_enable_pages(root, config, dry_run=args.dry_run)
    except PublishError as error:
        print(f"pages-publish: {error}", file=sys.stderr)
        return 1

    return 0


class PublishError(Exception):
    """Report a problem the user can fix, such as bad config or a failed build."""


@dataclass(frozen=True)
class Config:
    """Settings read from ``config.toml``.

    Attributes
    ----------
    pages_branch : str
        Branch that holds the published site.
    branches : list of str
        Glob patterns of the branches that are published (``*`` stays inside
        one path segment, ``**`` crosses ``/``).
    default_branch : str
        Branch the site root redirects to.
    history : str
        ``"single"`` keeps the Pages branch as one force-pushed commit;
        ``"keep"`` adds a commit per publish.
    remote : str or None
        Remote to push to; ``None`` selects ``origin`` or the first remote.
    site_base : str or None
        URL path the repository is served under (for example ``"/site/"``);
        ``None`` derives it from the remote URL.
    warn_total_mib : int
        Warn when published folders add up to more than this many MiB.
    require_relative : bool
        Refuse a build whose ``index.html`` uses root-absolute asset paths.
    commands : list of (str or list of str)
        Build steps, each a shell string or an argument list.
    dist : str
        Folder the build writes, relative to ``cwd``; ``"."`` is rejected.
    cwd : str
        Directory the build runs in, relative to the repository root.
    env : dict of str to str
        Extra environment variables for the build.
    """

    pages_branch: str = "gh_pages"
    branches: list[str] = field(default_factory=lambda: ["main"])
    default_branch: str = "main"
    history: str = "single"
    remote: str | None = None
    site_base: str | None = None
    warn_total_mib: int = 800
    require_relative: bool = True
    commands: list[str | list[str]] = field(default_factory=list)
    dist: str = "dist"
    cwd: str = "."
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Result:
    """Outcome of a publish, check, or prune.

    Attributes
    ----------
    status : str
        ``"published"``, ``"current"`` (commit already recorded), ``"skipped"``
        (branch not listed), ``"check"``, ``"pruned"`` or ``"failed"``.
    folder : str or None
        Folder on the Pages branch that was written or inspected.
    sha : str or None
        Commit that was published or inspected.
    build : bool
        For ``check``: whether a build and publish are needed.
    """

    status: str
    folder: str | None = None
    sha: str | None = None
    build: bool = False


def load_config(path: Path) -> Config:
    """Read and validate a ``config.toml`` file.

    Parameters
    ----------
    path : pathlib.Path
        Location of the TOML file.

    Returns
    -------
    Config
        The settings, with defaults for omitted keys.

    Raises
    ------
    PublishError
        If the file is missing, is not valid TOML, has an unknown key, or has
        a malformed value.
    """
    # A missing file gets a pointer to ``init`` rather than a traceback.
    if not path.exists():
        raise PublishError(f"{path.name} not found; run `python .gittools/pages-publish/pages_publish.py init` to create it.")

    try:
        # utf-8-sig tolerates the byte-order mark that some Windows editors add.
        raw = tomllib.loads(path.read_text(encoding="utf-8-sig"))
    except tomllib.TOMLDecodeError as error:
        raise PublishError(f"{path.name} is not valid TOML: {error}") from error

    publish_table = raw.get("publish", {})
    build_table = raw.get("build", {})

    # Unknown keys are almost always typos that would otherwise be ignored.
    unknown = [f"publish.{key}" for key in publish_table if key not in _PUBLISH_KEYS]
    unknown += [f"build.{key}" for key in build_table if key not in _BUILD_KEYS]
    unknown += [key for key in raw if key not in {"publish", "build"}]
    if unknown:
        raise PublishError(f"unknown key(s) in {path.name}: {', '.join(unknown)}")

    # ``command`` is shorthand for a single step; ``commands`` lists several.
    commands = list(build_table.get("commands", []))
    if "command" in build_table:
        commands.insert(0, build_table["command"])
    # An empty command means "publish dist as it is", so it is not a step.
    commands = [step for step in commands if step != ""]
    for step in commands:
        valid_string = isinstance(step, str)
        valid_list = isinstance(step, list) and bool(step) and all(isinstance(part, str) for part in step)
        if not (valid_string or valid_list):
            raise PublishError("build.command must be a shell string or a list of argument strings")

    defaults = Config()
    config = Config(
        pages_branch=publish_table.get("pages_branch", defaults.pages_branch),
        branches=list(publish_table.get("branches", defaults.branches)),
        default_branch=publish_table.get("default_branch", defaults.default_branch),
        history=publish_table.get("history", defaults.history),
        remote=publish_table.get("remote"),
        site_base=publish_table.get("site_base"),
        warn_total_mib=int(publish_table.get("warn_total_mib", defaults.warn_total_mib)),
        require_relative=bool(publish_table.get("require_relative", defaults.require_relative)),
        commands=commands,
        dist=build_table.get("dist", defaults.dist),
        cwd=build_table.get("cwd", defaults.cwd),
        env={key: str(value) for key, value in build_table.get("env", {}).items()},
    )

    if config.history not in {"single", "keep"}:
        raise PublishError('publish.history must be "single" or "keep"')
    return config


def publish(
    root: Path,
    config: Config,
    branch: str | None = None,
    *,
    force: bool = False,
    add: bool = False,
    check_only: bool = False,
    push: bool = True,
    prune_dead: bool = False,
    config_path: Path | None = None,
    log=None,
) -> Result:
    """Build the checked-out commit and publish it to the Pages branch.

    The commit is skipped without building when ``published.json`` on the Pages
    branch already records it, when ``branch`` is not listed in the config
    (unless ``force``), or, in ``check_only`` mode, always after reporting.

    Parameters
    ----------
    root : pathlib.Path
        Repository root.
    config : Config
        Settings from :func:`load_config`.
    branch : str, optional
        Branch name to publish under; defaults to the checked-out branch.
        Needed when HEAD is detached, as in CI.
    force : bool, optional
        Publish an unlisted branch, or rebuild a commit that is already
        recorded.
    add : bool, optional
        Append ``branch`` to ``publish.branches`` in the config file first.
    check_only : bool, optional
        Only report, through ``Result.build``, whether a build is needed.
    push : bool, optional
        When false, commit to the local Pages branch and do not push.
    prune_dead : bool, optional
        Also remove folders of branches that no longer exist on the remote.
    config_path : pathlib.Path, optional
        Config file edited by ``add``; defaults to the root's standard name.
    log : callable, optional
        Receives progress messages; defaults to printing.

    Returns
    -------
    Result
        What happened to the commit.

    Raises
    ------
    PublishError
        If the build fails, the build is not relocatable, the tree is dirty,
        or the push keeps being rejected.
    """
    log = log or _log
    config_path = config_path or DEFAULT_CONFIG_PATH
    remote = _resolve_remote(root, config)

    # Establish which branch and commit are being published.
    branch = branch or _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root)
    if branch == "HEAD":
        raise PublishError("detached HEAD: pass --branch <name>.")
    sha = _git(["rev-parse", "HEAD"], cwd=root)
    folder = folder_for_branch(branch)

    # ``--add`` edits the config so later runs (and the workflow) know the
    # branch; it applies to this run too.
    if add and not branch_matches(branch, config.branches):
        add_branch_to_config(config_path, branch)
        config = replace(config, branches=[*config.branches, branch])
        log(f"added '{branch}' to publish.branches in {config_path.name}; commit that file.")

    # Unlisted branches stop here unless forced; nothing is built for them.
    if not force and not branch_matches(branch, config.branches):
        log(f"branch '{branch}' is not listed in publish.branches; skipping (use --force to publish it).")
        return Result("skipped", folder, sha)

    # A recorded commit needs no work; ``check`` reports exactly this.
    manifest = _read_manifest(root, config, _fetch_pages(root, config, remote))
    recorded = manifest["entries"].get(folder, {}).get("sha")
    if not force and recorded == sha:
        log(f"{folder}/ already holds {sha[:7]}; nothing to do.")
        return Result("check" if check_only else "current", folder, sha, build=False)
    if check_only:
        return Result("check", folder, sha, build=True)

    # The folder must match the commit, so tracked changes block publishing.
    # The config file is exempt because ``--add`` edits it and the build does not read it.
    changed = _git(["diff", "--name-only", "HEAD"], cwd=root).splitlines()
    try:
        config_relative = config_path.resolve().relative_to(root).as_posix()
    except ValueError:
        config_relative = None
    if any(name != config_relative for name in changed if name):
        raise PublishError("the working tree has uncommitted changes; commit them first so the published folder matches the commit.")

    with _publish_lock(root):
        # Build once, then freeze a private copy of the output so nothing that
        # touches ``dist`` afterwards (another build, a hook) can change what
        # is published.
        log(f"building {branch} ({sha[:7]})")
        built = _run_build(root, config, remote, folder, branch, sha)
        snapshot = Path(tempfile.mkdtemp(prefix="pages-publish-snapshot-"))
        try:
            shutil.copytree(built, snapshot / "content")
            if config.require_relative:
                _require_relative_paths(snapshot / "content")
            size_bytes = _directory_size(snapshot / "content")

            return _push_folder(
                root,
                config,
                remote,
                branch=branch,
                folder=folder,
                sha=sha,
                content=snapshot / "content",
                size_bytes=size_bytes,
                push=push,
                prune_dead=prune_dead,
                log=log,
            )
        finally:
            shutil.rmtree(snapshot, ignore_errors=True)


def remove(root: Path, config: Config, branch: str | None = None, *, config_path: Path | None = None, log=None) -> Result:
    """Delete a branch's folder from the Pages branch.

    Works from any checked-out branch because only the Pages branch is
    touched. If ``branch`` is listed in ``publish.branches`` by exact name, the
    entry is removed from the config file as well.

    Parameters
    ----------
    root : pathlib.Path
        Repository root.
    config : Config
        Settings from :func:`load_config`.
    branch : str, optional
        Branch whose folder is removed; defaults to the checked-out branch.
    config_path : pathlib.Path, optional
        Config file to edit; defaults to the root's standard name.
    log : callable, optional
        Receives progress messages; defaults to printing.

    Returns
    -------
    Result
        ``status == "pruned"`` after the folder is gone.
    """
    log = log or _log
    config_path = config_path or DEFAULT_CONFIG_PATH
    remote = _resolve_remote(root, config)
    branch = branch or _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root)
    folder = folder_for_branch(branch)

    # Keep the config in step with the site, and warn if a pattern would
    # bring the branch straight back on the next push.
    if branch in config.branches:
        remove_branch_from_config(config_path, branch)
        log(f"removed '{branch}' from publish.branches in {config_path.name}; commit that file.")
    elif branch_matches(branch, config.branches):
        log(f"note: '{branch}' still matches a pattern in publish.branches and would be published again.")

    def edit(manifest: dict, worktree: Path) -> str | None:
        """Delete the folder and its manifest entry; name the commit message."""
        if folder not in manifest["entries"]:
            log(f"{folder}/ is not published.")
        shutil.rmtree(worktree / folder, ignore_errors=True)
        manifest["entries"].pop(folder, None)
        return f"Remove {folder}"

    with _publish_lock(root):
        _commit_to_pages_branch(root, config, remote, edit, push=True, log=log)
    return Result("pruned", folder)


def prune(root: Path, config: Config, *, log=None) -> Result:
    """Remove folders whose branches no longer exist on the remote.

    Parameters
    ----------
    root : pathlib.Path
        Repository root.
    config : Config
        Settings from :func:`load_config`.
    log : callable, optional
        Receives progress messages; defaults to printing.

    Returns
    -------
    Result
        ``status == "pruned"`` once the Pages branch is up to date.
    """
    log = log or _log
    remote = _resolve_remote(root, config)

    def edit(manifest: dict, worktree: Path) -> str | None:
        """Drop every folder of a dead branch; name the commit message."""
        return _prune_manifest(root, remote, manifest, worktree, log)

    with _publish_lock(root):
        _commit_to_pages_branch(root, config, remote, edit, push=True, log=log)
    return Result("pruned")


def folder_for_branch(branch: str) -> str:
    """Turn a branch name into a folder name, for example ``a/b`` into ``a-b``.

    Parameters
    ----------
    branch : str
        Git branch name.

    Returns
    -------
    str
        Folder name safe for URLs and file systems.

    Raises
    ------
    PublishError
        If the result is empty or reserved for the site (``versions``).
    """
    folder = re.sub(r"[^A-Za-z0-9._-]+", "-", branch)
    folder = re.sub(r"^[-.]+|-+$", "", folder)
    if not folder:
        raise PublishError(f"the branch name '{branch}' gives an empty folder name.")
    if folder in RESERVED_FOLDERS:
        raise PublishError(f"the folder name '{folder}' is reserved for the site; rename the branch.")
    return folder


def branch_matches(branch: str, patterns: Sequence[str]) -> bool:
    """Tell whether a branch name matches any glob pattern.

    Parameters
    ----------
    branch : str
        Git branch name.
    patterns : sequence of str
        Globs where ``*`` stays inside one ``/``-separated segment and ``**``
        crosses ``/``.

    Returns
    -------
    bool
        ``True`` if at least one pattern matches the whole name.
    """
    for pattern in patterns:
        # Translate the glob piece by piece so that regex metacharacters in
        # branch names stay literal.
        pieces = [".*".join(re.escape(part).replace(r"\*", "[^/]*") for part in pattern.split("**"))]
        if re.fullmatch("".join(pieces), branch):
            return True
    return False


def site_base_from_remote(url: str) -> str:
    """Derive the URL path a repository's Pages site lives under.

    Parameters
    ----------
    url : str
        Remote URL such as ``git@github.com:me/site.git``.

    Returns
    -------
    str
        ``"/site/"`` for that URL, or ``"/"`` for a user site named
        ``<name>.github.io``.

    Raises
    ------
    PublishError
        If no repository name can be read from the URL.
    """
    match = re.search(r"[/:\\]([^/:\\]+?)(?:\.git)?[/\\]?$", url.strip())
    if not match:
        raise PublishError(f"cannot read a repository name from the remote URL '{url}'; set publish.site_base.")
    name = match.group(1)
    return "/" if re.search(r"\.github\.io$", name, re.IGNORECASE) else f"/{name}/"


def add_branch_to_config(path: Path, branch: str) -> None:
    """Append a branch name to ``publish.branches`` in a config file.

    Parameters
    ----------
    path : pathlib.Path
        Config file to edit in place; comments inside the array are not kept.
    branch : str
        Branch name to append (no change if already listed verbatim).
    """
    _rewrite_branches(path, lambda names: names if branch in names else [*names, branch])


def remove_branch_from_config(path: Path, branch: str) -> None:
    """Delete an exact branch name from ``publish.branches`` in a config file.

    Parameters
    ----------
    path : pathlib.Path
        Config file to edit in place; comments inside the array are not kept.
    branch : str
        Branch name to remove (patterns that merely match it are untouched).
    """
    _rewrite_branches(path, lambda names: [name for name in names if name != branch])


# ----------------------------------------------------------------------------
# Subcommands that are not publishing proper
# ----------------------------------------------------------------------------


def _command_status(root: Path, config: Config) -> int:
    """Print every published folder and whether the checked-out commit is current."""
    remote = _resolve_remote(root, config)
    manifest = _read_manifest(root, config, _fetch_pages(root, config, remote))
    if not manifest["entries"]:
        print(f"nothing is published on {config.pages_branch} yet.")
        return 0

    # One line per folder, newest information first is not needed: sorted names
    # make the output stable for diffs and scripts.
    for folder, entry in sorted(manifest["entries"].items()):
        mark = " (default)" if entry["branch"] == manifest["default"] else ""
        print(f"{folder}/  {entry['branch']}{mark}  {entry['sha'][:7]}  {entry['publishedAt']}")

    # Report whether the current commit would be skipped.
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root)
    sha = _git(["rev-parse", "HEAD"], cwd=root)
    with contextlib.suppress(PublishError):
        folder = folder_for_branch(branch)
        recorded = manifest["entries"].get(folder, {}).get("sha")
        print(f"checked out: {branch} {sha[:7]} -> {'published' if recorded == sha else 'not published'}")
    return 0


def _command_init(root: Path, config_path: Path, *, force: bool) -> int:
    """Write a starter config, guessing the build from the project's files."""
    if config_path.exists() and not force:
        raise PublishError(f"{config_path.name} already exists (use --force to overwrite).")

    # Pick a build command from the files that identify common site tools.
    if (root / "package.json").exists():
        command, dist = "npm ci && npm run build", "dist"
    elif (root / "mkdocs.yml").exists():
        command, dist = "mkdocs build", "site"
    elif (root / "docs" / "conf.py").exists():
        command, dist = "sphinx-build -b html docs docs/_build/html", "docs/_build/html"
    elif (root / "docs" / "index.html").exists():
        command, dist = "", "docs"
    else:
        command, dist = "echo EDIT-ME-build-command", "dist"

    # symbolic-ref also works before the first commit; a detached HEAD falls back to main.
    branch = _git(["symbolic-ref", "--short", "HEAD"], cwd=root, check=False) or "main"
    config_path.write_text(
        _STARTER_CONFIG.format(branch=branch, command=command, dist=dist),
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {config_path.name}; edit it, then run `python .gittools/pages-publish/pages_publish.py publish --add`.")
    return 0


def _command_enable_pages(root: Path, config: Config, *, dry_run: bool) -> int:
    """Point the repository's Pages setting at the Pages branch, through ``gh``."""
    remote = _resolve_remote(root, config)
    url = _git(["remote", "get-url", remote], cwd=root)
    match = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    steps = (
        f"Settings -> Pages -> Build and deployment -> Source: Deploy from a branch -> "
        f"branch '{config.pages_branch}', folder '/ (root)'."
    )
    if not match:
        print(f"remote '{remote}' is not a github.com repository; do it by hand: {steps}")
        return 1
    owner, repo = match.groups()

    # Without the GitHub CLI there is nothing to automate; show the manual steps.
    if shutil.which("gh") is None:
        print(f"the GitHub CLI (gh) is not installed. Do it by hand: {steps}")
        return 0

    # POST creates the Pages site, PUT updates an existing one; ask which applies.
    exists = subprocess.run(["gh", "api", f"repos/{owner}/{repo}/pages"], capture_output=True, text=True).returncode == 0
    command = [
        "gh", "api", "-X", "PUT" if exists else "POST", f"repos/{owner}/{repo}/pages",
        "-f", "build_type=legacy", "-f", f"source[branch]={config.pages_branch}", "-f", "source[path]=/",
    ]
    if dry_run:
        print(" ".join(command))
        return 0
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        print(f"gh failed ({completed.stderr.strip()}). Do it by hand: {steps}", file=sys.stderr)
        return 1
    print(f"Pages for {owner}/{repo} now serves '{config.pages_branch}'. It appears at https://{owner}.github.io/{repo}/ in a minute or two.")
    return 0


def _command_install_hook(root: Path) -> int:
    """Add an opt-in publish step to the tracked pre-push hook."""
    hooks = root / ".githooks"
    hook = hooks / "pre-push"
    hooks.mkdir(exist_ok=True)

    # Keep any existing hook; only the marked block is ours to replace.
    text = hook.read_text(encoding="utf-8") if hook.exists() else "#!/bin/sh\n"
    block = f"{_HOOK_BEGIN}\n{_HOOK_BLOCK}{_HOOK_END}\n"
    pattern = re.compile(re.escape(_HOOK_BEGIN) + r".*?" + re.escape(_HOOK_END) + r"\n?", re.DOTALL)
    text = pattern.sub(block, text) if pattern.search(text) else text.rstrip("\n") + "\n\n" + block
    hook.write_text(text, encoding="utf-8", newline="\n")
    with contextlib.suppress(OSError):
        hook.chmod(hook.stat().st_mode | 0o111)

    # Git only runs tracked hooks when hooksPath points at them.
    current = subprocess.run(["git", "config", "core.hooksPath"], cwd=root, capture_output=True, text=True).stdout.strip()
    if current != ".githooks":
        _git(["config", "core.hooksPath", ".githooks"], cwd=root)
    print("hook installed. Turn publishing on with: git config publish.onPush true")
    return 0


# ----------------------------------------------------------------------------
# Building, assembling and pushing the Pages branch
# ----------------------------------------------------------------------------


def _push_folder(
    root: Path,
    config: Config,
    remote: str,
    *,
    branch: str,
    folder: str,
    sha: str,
    content: Path,
    size_bytes: int,
    push: bool,
    prune_dead: bool,
    log,
) -> Result:
    """Write one built folder into the Pages branch and push it."""

    def edit(manifest: dict, worktree: Path) -> str | None:
        """Replace the folder, record the commit, and optionally prune."""
        shutil.rmtree(worktree / folder, ignore_errors=True)
        shutil.copytree(content, worktree / folder)
        manifest["entries"][folder] = {
            "branch": branch,
            "sha": sha,
            "publishedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "bytes": size_bytes,
        }
        if prune_dead:
            _prune_manifest(root, remote, manifest, worktree, log, keep=branch)
        return f"Publish {folder} @ {sha[:7]}"

    _commit_to_pages_branch(root, config, remote, edit, push=push, log=log)
    return Result("published", folder, sha)


def _commit_to_pages_branch(root: Path, config: Config, remote: str, edit, *, push: bool, log) -> None:
    """Apply ``edit`` to the newest Pages branch tip in a worktree and push the result.

    A rejected push (someone published meanwhile) is retried from the new tip,
    up to five times.
    """
    identity = _commit_identity(root)
    pages_ref = f"refs/heads/{config.pages_branch}"

    for attempt in range(1, 6):
        tip = _fetch_pages(root, config, remote)
        worktree = Path(tempfile.mkdtemp(prefix="pages-publish-"))
        _git(["worktree", "add", "--quiet", "--detach", str(worktree), tip or "HEAD"], cwd=root)
        try:
            # With no Pages branch yet, start from an empty tree instead of HEAD's files.
            if tip is None:
                _git(["rm", "-rq", "--ignore-unmatch", "."], cwd=worktree)

            # Let the caller change folders and the manifest, then regenerate
            # the pages that are derived from the manifest.
            manifest = _read_manifest(worktree, config, "HEAD" if tip else None, local=True)
            manifest["default"] = config.default_branch
            message = edit(manifest, worktree)
            _write_site_files(worktree, manifest)

            # Skip the commit when the tree did not change at all.
            _git(["add", "-A"], cwd=worktree)
            tree = _git(["write-tree"], cwd=worktree)
            if tip and tree == _git(["rev-parse", f"{tip}^{{tree}}"], cwd=root):
                log("the Pages branch is already up to date.")
                return

            # Single-commit mode drops the parent; keep mode builds on the tip.
            parent = ["-p", tip] if tip and config.history == "keep" else []
            commit = _git(["commit-tree", tree, *parent, "-m", message or "Update"], cwd=worktree, env=identity)
            if not push:
                _git(["update-ref", pages_ref, commit], cwd=root)
                log(f"committed {commit[:7]} to local {config.pages_branch} (not pushed).")
                return

            # The lease makes the force-push fail if anyone moved the branch
            # since it was fetched; the loop then retries from the new tip.
            lease = [f"--force-with-lease={pages_ref}:{tip or ''}"] if config.history == "single" else []
            pushed = _git(["push", "--quiet", remote, f"{commit}:{pages_ref}", *lease], cwd=root, check=False)
            if pushed is not None:
                total_mib = sum(entry.get("bytes", 0) for entry in manifest["entries"].values()) / 1024 / 1024
                log(f"pushed to {config.pages_branch} ({total_mib:.0f} MiB in all).")
                if total_mib > config.warn_total_mib:
                    log(f"warning: the site is larger than {config.warn_total_mib} MiB; prune old branches.")
                return
            log(f"push rejected (attempt {attempt}); someone published meanwhile, retrying.")
        finally:
            _git(["worktree", "remove", "--force", str(worktree)], cwd=root, check=False)
            shutil.rmtree(worktree, ignore_errors=True)

    raise PublishError(f"could not push {config.pages_branch} after 5 attempts.")


def _run_build(root: Path, config: Config, remote: str, folder: str, branch: str, sha: str) -> Path:
    """Run the configured build steps and return the output folder."""
    workdir = (root / config.cwd).resolve()
    output = (workdir / config.dist).resolve()
    if output in {root, workdir}:
        raise PublishError("build.dist must be a subfolder, not the repository root.")

    # The folder's URL path is offered to builds that need it; failing to
    # derive it only matters if a command actually uses it.
    try:
        base = (config.site_base or site_base_from_remote(_git(["remote", "get-url", remote], cwd=root))).rstrip("/") + f"/{folder}/"
    except PublishError:
        base = None
    values = {"base": base, "folder": folder, "branch": branch, "sha": sha}
    env = {**os.environ, **config.env, "PAGES_FOLDER": folder, "PAGES_BRANCH": branch, "PAGES_SHA": sha}
    if base is not None:
        env["PAGES_BASE"] = base

    # Start from a clean output folder so stale files cannot be published.
    if config.commands:
        shutil.rmtree(output, ignore_errors=True)
    for step in config.commands:
        if isinstance(step, str):
            command = _fill_placeholders(step, values)
            completed = subprocess.run(command, shell=True, cwd=workdir, env=env)
        else:
            command = [_fill_placeholders(part, values) for part in step]
            completed = subprocess.run(command, cwd=workdir, env=env)
        if completed.returncode != 0:
            raise PublishError(f"the build command failed (exit {completed.returncode}): {command}")

    if not output.is_dir():
        raise PublishError(f"the build did not create '{config.dist}'.")
    return output


def _fill_placeholders(text: str, values: dict[str, str | None]) -> str:
    """Replace ``{base}``, ``{folder}``, ``{branch}`` and ``{sha}`` in a command string."""
    for name, value in values.items():
        token = "{" + name + "}"
        if token in text:
            if value is None:
                raise PublishError(f"the command uses {token} but it cannot be derived; set publish.site_base.")
            text = text.replace(token, value)
    return text


def _require_relative_paths(content: Path) -> None:
    """Refuse a build whose ``index.html`` links assets by root-absolute paths."""
    index = content / "index.html"
    if index.exists() and re.search(r'\b(?:src|href)="/[^/"]', index.read_text(encoding="utf-8", errors="replace")):
        raise PublishError(
            "the built index.html uses root-absolute paths (src=\"/...\"), which 404 under a sub-path. "
            "Build with relative paths, use {base}, or set publish.require_relative = false."
        )


def _prune_manifest(root: Path, remote: str, manifest: dict, worktree: Path, log, keep: str | None = None) -> str | None:
    """Remove folders of branches that are gone from the remote; return a commit message."""
    listing = _git(["ls-remote", "--heads", remote], cwd=root)
    live = {line.split("\t")[1].removeprefix("refs/heads/") for line in listing.splitlines() if "\t" in line}
    if keep:
        live.add(keep)

    # Collect first, then delete, so the manifest is not mutated while iterated.
    dead = [folder for folder, entry in manifest["entries"].items() if entry["branch"] not in live]
    for folder in dead:
        shutil.rmtree(worktree / folder, ignore_errors=True)
        del manifest["entries"][folder]
    if dead:
        log(f"pruned {', '.join(dead)}")
        return f"Prune {', '.join(dead)}"
    return None


def _write_site_files(worktree: Path, manifest: dict) -> None:
    """Write ``published.json``, the root redirect, ``versions/`` and ``.nojekyll``."""
    (worktree / "published.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    (worktree / "index.html").write_text(_render_index(manifest), encoding="utf-8", newline="\n")
    (worktree / "versions").mkdir(exist_ok=True)
    (worktree / "versions" / "index.html").write_text(_render_versions(manifest), encoding="utf-8", newline="\n")
    (worktree / ".nojekyll").write_text("\n", encoding="utf-8", newline="\n")


def _render_index(manifest: dict) -> str:
    """Render the root page: a redirect to the default branch, else to ``versions/``."""
    default_folder = next((name for name, entry in manifest["entries"].items() if entry["branch"] == manifest["default"]), None)
    target = f"./{html.escape(default_folder)}/" if default_folder else "./versions/"
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<meta http-equiv="refresh" content="0; url={target}"><link rel="canonical" href="{target}">'
        "<title>Redirecting</title></head>\n"
        f'<body><p><a href="{target}">Continue</a> or see <a href="./versions/">all published versions</a>.</p></body></html>\n'
    )


def _render_versions(manifest: dict) -> str:
    """Render the list of published folders with commit and time."""
    rows = []
    for folder, entry in sorted(manifest["entries"].items()):
        mark = " (default)" if entry["branch"] == manifest["default"] else ""
        rows.append(
            f'<li><a href="../{html.escape(folder)}/">{html.escape(entry["branch"])}</a>{mark} '
            f'<small>{html.escape(entry["sha"][:7])}, {html.escape(entry["publishedAt"])}</small></li>'
        )
    body = "\n".join(rows) or "<li>Nothing is published yet.</li>"
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Published versions</title></head>\n'
        f"<body><h1>Published versions</h1>\n<ul>\n{body}\n</ul></body></html>\n"
    )


# ----------------------------------------------------------------------------
# Git and file-system helpers
# ----------------------------------------------------------------------------


def _git(args: Sequence[str], cwd: Path, env: dict[str, str] | None = None, check: bool = True) -> str | None:
    """Run git and return its trimmed output; with ``check=False`` return ``None`` on failure."""
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        if check:
            raise PublishError(f"git {' '.join(args)} failed:\n{completed.stderr.strip() or completed.stdout.strip()}")
        return None
    return completed.stdout.strip()


def _resolve_remote(root: Path, config: Config) -> str:
    """Pick the remote to push to: the configured one, else ``origin``, else the first."""
    remotes = (_git(["remote"], cwd=root) or "").split()
    remote = config.remote or ("origin" if "origin" in remotes else (remotes[0] if remotes else None))
    if not remote:
        raise PublishError("the repository has no git remote.")
    return remote


def _fetch_pages(root: Path, config: Config, remote: str) -> str | None:
    """Fetch the Pages branch and return its tip, or ``None`` if it does not exist yet."""
    ref = f"refs/remotes/{remote}/{config.pages_branch}"
    fetched = _git(["fetch", "--quiet", remote, f"+refs/heads/{config.pages_branch}:{ref}"], cwd=root, check=False)
    if fetched is None:
        _git(["update-ref", "-d", ref], cwd=root, check=False)
        return None
    return _git(["rev-parse", ref], cwd=root)


def _read_manifest(where: Path, config: Config, tip: str | None, *, local: bool = False) -> dict:
    """Read ``published.json`` from the Pages tip (or a worktree), empty if absent or unreadable."""
    empty = {"default": config.default_branch, "entries": {}}
    if tip is None:
        return empty
    if local:
        file = where / "published.json"
        text = file.read_text(encoding="utf-8") if file.exists() else ""
    else:
        text = _git(["show", f"{tip}:published.json"], cwd=where, check=False) or ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return empty
    if not isinstance(parsed, dict) or not isinstance(parsed.get("entries"), dict):
        return empty
    return {"default": parsed.get("default", config.default_branch), "entries": parsed["entries"]}


def _commit_identity(root: Path) -> dict[str, str]:
    """Return author/committer variables when git has no configured identity (CI)."""
    if _git(["config", "user.name"], cwd=root, check=False):
        return {}
    return {
        "GIT_AUTHOR_NAME": "pages-publish",
        "GIT_AUTHOR_EMAIL": "pages-publish@localhost",
        "GIT_COMMITTER_NAME": "pages-publish",
        "GIT_COMMITTER_EMAIL": "pages-publish@localhost",
    }


@contextlib.contextmanager
def _publish_lock(root: Path, timeout_seconds: float = 1800.0) -> Iterator[None]:
    """Serialise publishes started from the same clone with a lock file in the git directory."""
    git_dir = Path(_git(["rev-parse", "--git-common-dir"], cwd=root))
    lock = (root / git_dir if not git_dir.is_absolute() else git_dir) / "pages-publish.lock"
    deadline = time.monotonic() + timeout_seconds

    # Take the lock by exclusive creation; a lock older than the timeout is
    # treated as left behind by a crashed run.
    while True:
        try:
            handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(handle)
            break
        except FileExistsError:
            if time.time() - lock.stat().st_mtime > timeout_seconds:
                lock.unlink(missing_ok=True)
            elif time.monotonic() > deadline:
                raise PublishError(f"another publish holds {lock}; remove it if that run is gone.")
            else:
                time.sleep(1.0)
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def _directory_size(folder: Path) -> int:
    """Total size in bytes of all files below a folder."""
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())


def _rewrite_branches(path: Path, change) -> None:
    """Rewrite the ``branches = [...]`` array of a config file with ``change(names)``."""
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r"^branches\s*=\s*\[(.*?)\]", re.MULTILINE | re.DOTALL)
    match = pattern.search(text)

    # Without an existing array, create one under [publish] (or at the top).
    if match is None:
        names = change([])
        line = "branches = " + json.dumps(names) + "\n"
        header = re.search(r"^\[publish\]\s*\n", text, re.MULTILINE)
        text = text[: header.end()] + line + text[header.end():] if header else f"[publish]\n{line}\n{text}"
    else:
        names = change(re.findall(r'"([^"]*)"', match.group(1)))
        text = text[: match.start()] + "branches = " + json.dumps(names) + text[match.end():]
    path.write_text(text, encoding="utf-8", newline="\n")


def _announce_check(build: bool) -> None:
    """Print ``build=true|false`` and, in GitHub Actions, append it to ``$GITHUB_OUTPUT``."""
    line = f"build={str(build).lower()}"
    print(line)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def _log(message: str) -> None:
    """Print a progress message to standard error, keeping standard output for results."""
    print(f"pages-publish: {message}", file=sys.stderr, flush=True)


def _parse_arguments(argv: list[str]) -> argparse.Namespace:
    """Parse the command line; ``publish`` is the default command."""
    parser = argparse.ArgumentParser(
        prog="pages_publish.py",
        description="Publish branches of this repository to GitHub Pages (one folder per branch).",
    )
    parser.epilog = "Option for every command: --config FILE (relative to the repository root; default: config.toml next to this script)."
    commands = parser.add_subparsers(dest="command", metavar="command")

    publish_parser = commands.add_parser("publish", help="build and publish the checked-out commit (default)")
    publish_parser.add_argument("--branch", help="publish under this branch name (needed on a detached HEAD)")
    publish_parser.add_argument("--add", action="store_true", help="list the branch in publish.branches first")
    publish_parser.add_argument("--force", action="store_true", help="publish an unlisted branch or rebuild a current one")
    publish_parser.add_argument("--no-push", action="store_true", help="commit to the local Pages branch only")
    publish_parser.add_argument("--prune", action="store_true", help="also remove folders of deleted branches")

    check_parser = commands.add_parser("check", help="print build=true|false: is a publish needed?")
    check_parser.add_argument("--branch")

    remove_parser = commands.add_parser("remove", help="delete a branch's folder from the Pages branch")
    remove_parser.add_argument("--branch")

    commands.add_parser("prune", help="remove folders of branches that no longer exist")
    commands.add_parser("status", help="list published folders")
    init_parser = commands.add_parser("init", help="write a starter config.toml")
    init_parser.add_argument("--force", action="store_true")
    enable_parser = commands.add_parser("enable-pages", help="point the repository's Pages setting at the Pages branch (uses gh)")
    enable_parser.add_argument("--dry-run", action="store_true")
    commands.add_parser("install-hook", help="add an opt-in publish step to .githooks/pre-push")

    # ``--config`` may appear anywhere; pull it out before the command is read.
    config = None
    if "--config" in argv:
        position = argv.index("--config")
        if position + 1 >= len(argv):
            parser.error("--config needs a value")
        config = argv[position + 1]
        del argv[position : position + 2]

    # No command word means ``publish``, so ``pages_publish.py --force`` works.
    known = set(commands.choices)
    if not any(word in known for word in argv) and not {"-h", "--help"} & set(argv):
        argv = ["publish", *argv]
    args = parser.parse_args(argv)
    args.config = config

    # Options that only some commands define still exist on the namespace.
    for name, default in (("branch", None), ("add", False), ("force", False), ("no_push", False), ("prune", False), ("dry_run", False)):
        if not hasattr(args, name):
            setattr(args, name, default)
    return args

# Starter config written by ``init``; ``{command}`` and ``{dist}`` are guessed from the project.
_STARTER_CONFIG = '''\
# Settings for .gittools/pages-publish/pages_publish.py. See README.md in this folder.

[publish]
# Branches that are published (globs: * stays inside one / segment, ** crosses it).
branches = ["{branch}"]
# The site root redirects to this branch's folder.
default_branch = "{branch}"
# "single": the Pages branch is one force-pushed commit (small repository).
# "keep": every publish is a new commit on top.
history = "single"
# Refuse a build whose index.html links assets with root-absolute paths ("/assets/..."),
# because each branch is served from its own sub-path. Set to false if the build uses {{base}}.
require_relative = true
# pages_branch = "gh_pages"
# remote = "origin"
# site_base = "/my-repo/"        # URL path of the site; derived from the remote URL when omitted
# warn_total_mib = 800           # GitHub Pages sites are limited to 1 GiB

[build]
# A shell string (pipes and && work), or a list of arguments, or use `commands = [...]` for several steps.
# Placeholders: {{base}} (URL path of this folder), {{folder}}, {{branch}}, {{sha}};
# the same values are in the environment as PAGES_BASE, PAGES_FOLDER, PAGES_BRANCH, PAGES_SHA.
# An empty command publishes `dist` as it is (a static folder).
command = "{command}"
# Folder the build writes (relative to cwd). Must be a subfolder of the repository.
dist = "{dist}"
# cwd = "."
# env = {{ NODE_ENV = "production" }}
'''

# Body of the block ``install-hook`` adds to .githooks/pre-push.
_HOOK_BLOCK = """\
# Opt-in: publish the checked-out branch after the other checks. Enable with
#   git config publish.onPush true
# A failed publish only warns; it never blocks the push.
if [ "$(git config --bool publish.onPush 2>/dev/null)" = "true" ]; then
  py=""
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then py="$candidate"; break; fi
  done
  "$py" .gittools/pages-publish/pages_publish.py publish >&2 || echo "pre-push: warning: publishing failed (the push continues)." >&2
fi
"""


if __name__ == "__main__":
    sys.exit(main())
