"""Track the checked-out branch in a file that Syncthing can carry, and reset git metadata to it.

Syncthing distributes the working tree but ``.git`` stays local, so another machine's ``.git`` does
not know which branch the shared files belong to. A ``post-checkout`` hook installed by
``current_branch.py install`` writes the current branch name to ``.git-current-branch`` in the repository root
(kept out of git through ``.git/info/exclude``, synced by Syncthing). ``current_branch.py reset`` then fetches that branch from the remote and
mixed-resets the local ``.git`` to it: HEAD and the index move, the working tree is never touched.

Only the Python standard library (3.11 or newer) and ``git`` are needed.
"""

from __future__ import annotations

import argparse
import stat
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

# Marker line that identifies a hook written by this tool, so foreign hooks are never touched.
HOOK_MARKER = "# current-branch post-checkout hook"

# The marker of the hook that this tool wrote under its old name, branch-sync: it is ours too, and is replaced.
LEGACY_HOOK_MARKER = "# branch-sync post-checkout hook"

# The file in the repository root that records the branch; it is excluded from git, not ignored by a tracked file.
BRANCH_FILE = ".git-current-branch"

# Written to the branch file when HEAD is detached.
DETACHED = "HEAD"

# The hook finds the branch file relative to the repository root, so it survives moving the clone.
HOOK_BODY = f"""\
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
file="$root/{BRANCH_FILE}"
branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || branch={DETACHED}
printf '%s\\n' "$branch" > "$file"
"""
HOOK = f"#!/bin/sh\n{HOOK_MARKER}\n{HOOK_BODY}"

# Where backups of a branch's old tip go before a reset moves it.
BACKUP_PREFIX = "refs/current-branch/backup"


class CurrentBranchError(RuntimeError):
    """A condition that stops the tool with a message instead of a traceback."""


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run ``git`` in ``repo`` and return the completed process.

    Parameters
    ----------
    repo : Path
        Directory to run in.
    *args : str
        Arguments after ``git``.
    check : bool, default True
        Raise `CurrentBranchError` with git's message on a nonzero exit.

    Returns
    -------
    subprocess.CompletedProcess of str
        Captured output.
    """
    done = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if check and done.returncode != 0:
        raise CurrentBranchError(f"git {' '.join(args)} failed: {(done.stderr or done.stdout).strip()}")
    return done


def repo_root(start: Path) -> Path:
    """Return the top-level directory of the repository containing ``start``."""
    done = git(start, "rev-parse", "--show-toplevel", check=False)
    if done.returncode != 0:
        raise CurrentBranchError("not inside a git repository.")
    return Path(done.stdout.strip())


def branch_file(root: Path) -> Path:
    """Return the path of the branch file for the repository at ``root``."""
    return root / BRANCH_FILE


def hook_path(root: Path) -> Path:
    """Return the path of the ``post-checkout`` hook, honouring ``core.hooksPath``."""
    done = git(root, "rev-parse", "--git-path", "hooks/post-checkout")
    path = Path(done.stdout.strip())
    return path if path.is_absolute() else root / path


def current_branch(root: Path) -> str:
    """Return the checked-out branch name, or ``HEAD`` when detached."""
    done = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
    return done.stdout.strip() if done.returncode == 0 and done.stdout.strip() else DETACHED


def is_ours(hook_text: str) -> bool:
    """Return whether a hook file was written by this tool, under its current or its old name."""
    return HOOK_MARKER in hook_text or LEGACY_HOOK_MARKER in hook_text


def exclude_branch_file(root: Path) -> None:
    """Add the branch file to ``.git/info/exclude`` (once), so git never lists or commits it."""
    exclude = Path(git(root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").stdout.strip())
    line = f"/{BRANCH_FILE}"
    lines = exclude.read_text(encoding="utf-8").splitlines() if exclude.exists() else []
    if line not in lines:
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with exclude.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(line + "\n")
        print(f"added   {line} to {exclude}")


def command_install(root: Path) -> int:
    """Install or repair the hook, exclude the branch file from git, and seed the file from the checkout.

    Safe to repeat. A hook of ours that is out of date (or has the old name) is rewritten, a foreign hook is never
    touched, and an existing branch file is kept: it may have come from another machine. Each line printed starts
    with ``ok`` when nothing had to change.
    """
    hook = hook_path(root)
    existing = hook.read_text(encoding="utf-8", errors="replace") if hook.exists() else None
    if existing is not None and not is_ours(existing):
        raise CurrentBranchError(
            f"a different post-checkout hook exists, not overwriting: {hook}\n"
            "To use both, add these lines to it (after its first line), or remove it and run install again:\n"
            f"{HOOK_BODY}"
        )
    if existing == HOOK:
        print(f"ok      hook is up to date: {hook}")
    else:
        hook.parent.mkdir(parents=True, exist_ok=True)
        hook.write_text(HOOK, encoding="utf-8", newline="\n")
        print(f"{'installed' if existing is None else 'updated '} hook {hook}")
    hook.chmod(hook.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    # Seed the file only if it is absent: an existing one came from another machine and is the thing to reset to.
    target = branch_file(root)
    if target.exists():
        print(f"ok      {target.name} exists and is kept")
    else:
        target.write_text(current_branch(root) + "\n", encoding="utf-8", newline="\n")
        print(f"created {target.name} ({current_branch(root)})")
    exclude_branch_file(root)
    return 0


def command_uninstall(root: Path) -> int:
    """Remove the hook if this tool wrote it."""
    hook = hook_path(root)
    if not hook.exists():
        print("no post-checkout hook installed.")
        return 0
    if not is_ours(hook.read_text(encoding="utf-8", errors="replace")):
        raise CurrentBranchError(f"post-checkout hook is not ours, not removing: {hook}")
    hook.unlink()
    print(f"removed {hook}")
    return 0


def read_branch(root: Path) -> str:
    """Return the branch recorded in the branch file."""
    target = branch_file(root)
    if not target.exists():
        raise CurrentBranchError(
            f"{target} is missing; run a checkout or `install` on the machine that has the branch."
        )
    name = target.read_text(encoding="utf-8").strip()
    if not name or name == DETACHED:
        raise CurrentBranchError("the branch file records a detached HEAD; check out a branch first.")
    if git(root, "check-ref-format", "--branch", name, check=False).returncode != 0:
        raise CurrentBranchError(f"the branch file holds an invalid branch name: {name!r}")
    return name


def command_status(root: Path) -> int:
    """Print the recorded branch and the local one."""
    target = branch_file(root)
    recorded = target.read_text(encoding="utf-8").strip() if target.exists() else "(none)"
    print(f"recorded: {recorded}\nlocal:    {current_branch(root)}")
    return 0


def command_reset(root: Path, remote: str, dry_run: bool) -> int:
    """Fetch the recorded branch and mixed-reset HEAD and the index to its remote tip.

    Parameters
    ----------
    root : Path
        Repository root.
    remote : str
        Remote to fetch from.
    dry_run : bool
        Report what would happen without fetching or changing anything.

    Returns
    -------
    int
        Exit status, ``0`` on success.
    """
    name = read_branch(root)
    if dry_run:
        print(f"would fetch {remote}/{name}, point HEAD at {name} and run `git reset --mixed {remote}/{name}`.")
        return 0
    git(root, "fetch", remote, f"+refs/heads/{name}:refs/remotes/{remote}/{name}")
    tip = git(root, "rev-parse", "--verify", f"refs/remotes/{remote}/{name}").stdout.strip()
    old = git(root, "rev-parse", "--verify", "--quiet", f"refs/heads/{name}", check=False).stdout.strip()
    if old and old != tip:
        # Keep unpublished commits reachable; the reset would otherwise orphan them.
        git(root, "update-ref", f"{BACKUP_PREFIX}/{name}", old)
        print(f"previous tip {old[:12]} kept at {BACKUP_PREFIX}/{name}")
    git(root, "symbolic-ref", "HEAD", f"refs/heads/{name}")
    git(root, "reset", "--mixed", "--quiet", tip)
    git(root, "config", f"branch.{name}.remote", remote)
    git(root, "config", f"branch.{name}.merge", f"refs/heads/{name}")
    print(f"{name} reset to {remote}/{name} at {tip[:12]}; working tree untouched.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Return the command-line parser."""
    parser = argparse.ArgumentParser(prog="current_branch.py", description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--repo", type=Path, default=Path.cwd(), help="a path inside the repository (default: current directory)"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("install", help="install the post-checkout hook and seed the branch file")
    sub.add_parser("uninstall", help="remove the hook")
    sub.add_parser("status", help="show the recorded and the local branch")
    reset = sub.add_parser("reset", help="mixed-reset HEAD and the index to the remote tip of the recorded branch")
    reset.add_argument("--remote", default="origin", help="remote to fetch from (default: origin)")
    reset.add_argument("--dry-run", action="store_true", help="show the plan only")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command line and return the exit status."""
    args = build_parser().parse_args(argv)
    try:
        root = repo_root(args.repo)
        if args.command == "install":
            return command_install(root)
        if args.command == "uninstall":
            return command_uninstall(root)
        if args.command == "status":
            return command_status(root)
        return command_reset(root, args.remote, args.dry_run)
    except CurrentBranchError as error:
        print(f"current-branch: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
