"""Set up the current-branch tool in a git repository, asking what to include.

The folder ``.gittools/current-branch`` is the whole tool: copy it into a repository and call
``python .gittools/current-branch/install.py`` there. Called with a repository path from outside it,
``install.py <repository>`` first copies this folder into ``<repository>/.gittools/current-branch``.

The installer offers to install the ``post-checkout`` hook (``current_branch.py install``), which records the
checked-out branch in ``.git-current-branch`` (repository root, added to ``.git/info/exclude``), a file that
Syncthing carries. The question has a flag (``--hook``/``--no-hook``) and ``--yes``
accepts the default, so the installer also runs without a terminal. Existing files are never overwritten unless
``--force`` is given, a foreign hook is never touched, and nothing is committed.

Running it again is safe, and repairs what is there: missing files are put back, files that are already right are
left alone (``ok`` lines), files that differ (edited by you, or from an older copy) are kept unless ``--force`` is
given, and the last line says whether anything changed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# This tool's own folder: what a copy duplicates.
HERE = Path(__file__).resolve().parent

# Where the tool sits inside a repository.
TOOL_DIR = ".gittools/current-branch"

# Names that are never copied along with the folder (caches).
NOT_COPIED = ("__pycache__",)

# Fixed text of the folder README: it describes the folder, never the installed tools.
GITTOOLS_README = """\
# .gittools

Self-contained git tools for this repository, one subfolder each (`.gittools/<tool>/`) with its own README.
Tools do not depend on each other; deleting a subfolder removes that tool.
"""


def main(argv: list[str] | None = None) -> int:
    """Set up or repair the tool in a repository and return the exit status.

    Parameters
    ----------
    argv : list of str, optional
        Arguments after the program name; defaults to ``sys.argv[1:]``.

    Returns
    -------
    int
        ``0`` on success, ``1`` if no git repository can be determined or the hook could not be installed.
    """
    args = _parse_arguments(argv)
    interactive = sys.stdin.isatty() and not args.yes

    target = _find_repository(args.repository)
    if target is None:
        print("no git repository found: pass the repository path, or run this from a copy inside one.", file=sys.stderr)
        return 1

    changed = False
    installed = target / TOOL_DIR
    if installed.resolve() != HERE:
        changed |= _copy_folder(target, force=args.force)
    else:
        print(f"ok      {TOOL_DIR} (this is the installed copy)")
    changed |= _write_gittools_readme(target)

    # The tool was called branch-sync before. Its hook is recognised and replaced; the old folder is left to you.
    legacy = target / ".gittools" / "branch-sync"
    if legacy.exists():
        print("note    .gittools/branch-sync is the old name of this tool; its hook is replaced by this one.")
        print("        When you no longer need it, remove it: rm -r .gittools/branch-sync")
        print("        (PowerShell: Remove-Item -Recurse .gittools/branch-sync)")

    status = 0
    if _decide(args.hook, "Install the post-checkout hook that records the branch?", True, interactive):
        # The tool prints one line per step; a line that does not start with "ok" means something was changed.
        done = subprocess.run(
            [sys.executable, str(installed / "current_branch.py"), "install"],
            cwd=target,
            capture_output=True,
            text=True,
        )
        sys.stdout.write(done.stdout)
        sys.stderr.write(done.stderr)
        if done.returncode != 0:
            status = 1
        else:
            changed |= any(line and not line.startswith("ok") for line in done.stdout.splitlines())

    if status == 0:
        _summary(changed=changed)
    print(
        "\nNext:\n"
        f"  on the other machine: python {TOOL_DIR}/current_branch.py reset   (after the branch is pushed and synced)\n"
        f"To remove it again: python {TOOL_DIR}/current_branch.py uninstall, then delete .git-current-branch.\n"
        f"See {TOOL_DIR}/README.md."
    )
    return status


def _summary(*, changed: bool) -> None:
    """Say whether this run changed anything; a repeated run on a good installation changes nothing."""
    print("\nInstalled." if changed else "\nNothing changed: already installed and up to date.")


def _find_repository(given: Path | None) -> Path | None:
    """Return the repository root: the given path, else the one containing this folder."""
    start = (given or HERE).resolve()
    completed = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=start, capture_output=True, text=True)
    if completed.returncode != 0:
        return None
    return Path(completed.stdout.strip()).resolve()


def _copy_folder(target: Path, *, force: bool) -> bool:
    """Copy this whole folder into the repository, skipping the ``NOT_COPIED`` names; return whether it changed."""
    changed = False
    for source in sorted(HERE.rglob("*")):
        relative = source.relative_to(HERE)
        if not source.is_file() or any(part in NOT_COPIED for part in relative.parts):
            continue
        changed |= _copy_file(source, target / TOOL_DIR / relative, f"{TOOL_DIR}/{relative.as_posix()}", force=force)
    return changed


def _write_gittools_readme(target: Path) -> bool:
    """Create the static ``.gittools/README.md`` once; it is never rewritten, so tools stay independent."""
    readme = target / ".gittools" / "README.md"
    if readme.exists():
        return False
    readme.parent.mkdir(parents=True, exist_ok=True)
    readme.write_text(GITTOOLS_README, encoding="utf-8", newline="\n")
    print("copied  .gittools/README.md")
    return True


def _copy_file(source: Path, destination: Path, label: str, *, force: bool) -> bool:
    """Copy one file and report what happened; return whether anything changed.

    A missing file is copied, an identical one is left alone, and one that differs is kept unless ``force`` is given.
    """
    if destination.exists():
        if destination.read_bytes() == source.read_bytes():
            print(f"ok      {label} (unchanged)")
            return False
        if not force:
            print(f"kept    {label} (differs from the source copy; use --force to update it)")
            return False
        verb = "updated"
    else:
        verb = "copied "
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    print(f"{verb} {label}")
    return True


def _decide(flag: bool | None, question: str, default: bool, interactive: bool) -> bool:
    """Return the flag if given, else ask when interactive, else the default."""
    if flag is not None:
        return flag
    return _ask_yes_no(question, default) if interactive else default


def _ask_yes_no(question: str, default: bool) -> bool:
    """Ask a yes/no question on the terminal; an empty answer means the default."""
    hint = "Y/n" if default else "y/N"
    while True:
        answer = input(f"{question} [{hint}] ").strip().lower()
        if not answer:
            return default
        if answer in {"y", "yes"}:
            return True
        if answer in {"n", "no"}:
            return False


def _parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    """Parse the command line, with a paired on/off flag for the optional hook."""
    parser = argparse.ArgumentParser(description="Set up the current-branch tool in a git repository.")
    parser.add_argument(
        "repository", nargs="?", type=Path, help="target repository (default: the one containing this folder)"
    )
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    parser.add_argument("--yes", action="store_true", help="do not ask; use the flags, else the defaults")
    parser.add_argument("--hook", dest="hook", action="store_true", default=None, help="install the post-checkout hook")
    parser.add_argument("--no-hook", dest="hook", action="store_false", help="do not install the hook")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
