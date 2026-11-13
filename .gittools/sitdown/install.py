"""Set up the sitdown tool in a git repository.

The folder ``.gittools/sitdown`` is the whole tool: copy it into a repository and call
``python .gittools/sitdown/install.py`` there. Called with a repository path from outside it,
``install.py <repository>`` first copies this folder into ``<repository>/.gittools/sitdown``. Without a path, a copy
at ``<repository>/.gittools/sitdown`` installs into that repository, and any other copy (the source folder in
``gittools/``) installs into the repository of the current folder, never into the one that holds the source. The first
line printed names the target.

The installer then runs ``sitdown.py install`` there: the tool is copied into ``.git``, the four hooks that
keep ``.git-current`` (the record that Syncthing carries) up to date are installed where git runs hooks, and ``git
sitdown`` becomes an alias (``--alias``/``--no-alias``, default on). Existing files are never overwritten unless
``--force`` is given, a foreign hook or alias is never touched, and nothing is committed. ``--yes`` is accepted and
changes nothing: the installer asks no questions.

Running it again is safe, and repairs what is there: missing files are put back, files that are already right are
left alone (``ok`` lines), files that differ (edited by you, or from an older copy) are kept unless ``--force`` is
given, and the last line says whether anything changed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# This tool's own folder: what a copy duplicates. Links are followed, so this is where the files really are.
HERE = Path(__file__).resolve().parent
# The folder as it was called, links not followed: ``<repository>/.gittools/sitdown`` may be a link (a junction on
# Windows) to a shared copy, and is still that repository's copy.
CALLED_AS = Path(os.path.abspath(__file__)).parent  # noqa: PTH100 - Path.absolute keeps "..", resolve follows links

# Where the tool sits inside a repository.
TOOL_DIR = ".gittools/sitdown"

# The tool's own line when its part of the installation changed nothing.
TOOL_NOTHING_CHANGED = "Nothing changed: already installed and up to date."

# Names that are never copied along with the folder: caches, and the settings file of older versions. The folder holds
# only the tool's sources; a repository's settings live in its root (.sitdown.toml), never here.
NOT_COPIED = ("__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "config.toml")

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
        ``0`` on success, ``1`` if no git repository can be determined or the tool's own install failed (for
        example, a foreign hook was kept).
    """
    args = _parse_arguments(argv)

    target = _find_repository(args.repository)
    if target is None:
        print("no git repository found: pass the repository path, or run this from a copy inside one.", file=sys.stderr)
        return 1
    print(f"target  {target.as_posix()}")

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

    command = [sys.executable, str(installed / "sitdown.py"), "install"]
    if args.force:
        command.append("--force")
    if not args.alias:
        command.append("--no-alias")
    done = subprocess.run(command, cwd=target, capture_output=True, text=True, encoding="utf-8", errors="replace")
    # The tool ends with its own summary; it knows nothing of the files copied above, so it is corrected here.
    output = done.stdout.replace(TOOL_NOTHING_CHANGED, "Installed.") if changed else done.stdout
    sys.stdout.write(output)
    sys.stderr.write(done.stderr)
    print(
        "\nTo use it: run git sitdown done on the machine you are leaving; on the other machine, run "
        f"python {TOOL_DIR}/install.py, then git sitdown.\n"
        f"To remove it from this machine: python {TOOL_DIR}/sitdown.py uninstall.\n"
        f"See {TOOL_DIR}/README.md."
    )
    return 1 if done.returncode != 0 else 0


def _find_repository(given: Path | None) -> Path | None:
    """Return the root of the repository to install into, or ``None`` if there is none.

    The given path; else, for a copy called as ``<repository>/.gittools/sitdown/install.py`` (even through a link to a
    shared copy), that repository; else the repository of the current folder.

    The source folder is never its own target by default: run from another repository without a path, it would
    install there and leave the current repository without the alias.
    """
    if given is not None:
        start = given.resolve()
    elif CALLED_AS.parent.name == ".gittools" and CALLED_AS.name == Path(TOOL_DIR).name:
        start = CALLED_AS.parent.parent
    else:
        start = Path.cwd()
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


def _parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    """Parse the command line."""
    parser = argparse.ArgumentParser(description="Set up the sitdown tool in a git repository.")
    parser.add_argument(
        "repository",
        nargs="?",
        type=Path,
        help="target repository (default: the one holding this copy if it is .gittools/sitdown, else the current one)",
    )
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    parser.add_argument("--yes", action="store_true", help="accepted for compatibility; nothing is asked")
    parser.add_argument(
        "--alias", dest="alias", action="store_true", default=True, help="install git sitdown (default)"
    )
    parser.add_argument("--no-alias", dest="alias", action="store_false", help="do not install the git alias")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
