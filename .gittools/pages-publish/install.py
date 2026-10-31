"""Set up the pages-publish tool in a git repository, asking what to include.

The folder ``.gittools/pages-publish`` is the whole tool: copy it into a
repository and call ``python .gittools/pages-publish/install.py`` there to choose,
one question at a time, whether to add a starter config, the optional GitHub
Actions workflow, the opt-in pre-push hook and launcher scripts in ``_scripts/``.
Called with a repository path from outside it, ``install.py <repository>`` first
copies this folder into ``<repository>/.gittools/pages-publish``.

Every question has a flag (``--workflow``/``--no-workflow`` and so on) and
``--yes`` accepts the defaults, so the installer also runs without a terminal.
Existing files are never overwritten unless ``--force`` is given, and nothing is
committed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# This tool's own folder: where the workflow template lives and what a copy duplicates.
HERE = Path(__file__).resolve().parent

# Where the tool sits inside a repository.
TOOL_DIR = ".gittools/pages-publish"

# Names that are never copied along with the folder (caches and per-repository settings).
NOT_COPIED = ("__pycache__", "config.toml")

# Fixed text of the folder README: it describes the folder, never the installed tools.
GITTOOLS_README = """\
# .gittools

Self-contained git tools for this repository, one subfolder each (`.gittools/<tool>/`) with its own README.
Tools do not depend on each other; deleting a subfolder removes that tool.
"""

# Windows launcher: runs the tool by absolute path so the caller's directory is kept; prefers ``py``, falls back to ``python``.
LAUNCHER_CMD = """\
@echo off
setlocal
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py "%~dp0..\\.gittools\\pages-publish\\pages_publish.py" %*
) else (
  python "%~dp0..\\.gittools\\pages-publish\\pages_publish.py" %*
)
exit /b %ERRORLEVEL%
"""

# POSIX launcher with the same behavior.
LAUNCHER_SH = """\
#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    exec "$candidate" "$here/../.gittools/pages-publish/pages_publish.py" "$@"
  fi
done
echo "pages-publish: no Python found." >&2
exit 1
"""


def main(argv: list[str] | None = None) -> int:
    """Set up the tool in a repository and return the exit status.

    Parameters
    ----------
    argv : list of str, optional
        Arguments after the program name; defaults to ``sys.argv[1:]``.

    Returns
    -------
    int
        ``0`` on success, ``1`` if no git repository can be determined.
    """
    args = _parse_arguments(argv)
    interactive = sys.stdin.isatty() and not args.yes

    # Without a path, the repository is the one that contains this folder.
    target = _find_repository(args.repository)
    if target is None:
        print("no git repository found: pass the repository path, or run this from a copy inside one.", file=sys.stderr)
        return 1

    # Make sure the tool is in the repository; a folder already in place is used as it is.
    installed = target / TOOL_DIR
    if installed.resolve() != HERE:
        _copy_folder(target, force=args.force)
    tool = installed / "pages_publish.py"
    _write_gittools_readme(target)

    # Ask (or read the flags for) each optional piece, in the order they matter.
    want_init = _decide(args.init, "Write a starter config.toml (build command guessed from the project)?", True, interactive)
    want_workflow = _decide(args.workflow, "Add the GitHub Actions workflow (publishes on every push)?", True, interactive)
    want_hook = _decide(args.hook, "Add the opt-in pre-push hook to .githooks/pre-push?", True, interactive)
    want_launchers = _decide(args.launchers, "Add launcher scripts (_scripts/pages-publish.cmd and .sh)?", True, interactive)

    # Apply the choices; the hook and the config are written by the tool itself.
    if want_init and not (installed / "config.toml").exists():
        _run_tool(tool, target, "init")
    if want_workflow:
        _copy_file(
            installed / "workflow" / "pages-publish.yml",
            target / ".github" / "workflows" / "pages-publish.yml",
            ".github/workflows/pages-publish.yml",
            force=args.force,
        )
    if want_hook:
        _run_tool(tool, target, "install-hook")
    if want_launchers:
        _write_launchers(target, force=args.force)

    print(
        "\nNext:\n"
        f"  1. edit {TOOL_DIR}/config.toml (build command, dist folder, branches) and commit\n"
        f"  2. python {TOOL_DIR}/pages_publish.py publish --add     (builds and creates gh_pages)\n"
        f"  3. python {TOOL_DIR}/pages_publish.py enable-pages      (Settings -> Pages -> gh_pages)\n"
        f"See {TOOL_DIR}/README.md."
    )
    return 0


def _find_repository(given: Path | None) -> Path | None:
    """Return the repository root: the given path, else the one containing this folder."""
    start = (given or HERE).resolve()
    completed = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=start, capture_output=True, text=True)
    if completed.returncode != 0:
        return None
    return Path(completed.stdout.strip()).resolve()


def _copy_folder(target: Path, *, force: bool) -> None:
    """Copy this whole folder into the repository, skipping caches and the local config."""
    for source in sorted(HERE.rglob("*")):
        relative = source.relative_to(HERE)
        if not source.is_file() or any(part in NOT_COPIED for part in relative.parts):
            continue
        _copy_file(source, target / TOOL_DIR / relative, f"{TOOL_DIR}/{relative.as_posix()}", force=force)


def _write_gittools_readme(target: Path) -> None:
    """Create the static ``.gittools/README.md`` once; it is never rewritten, so tools stay independent."""
    readme = target / ".gittools" / "README.md"
    if not readme.exists():
        readme.parent.mkdir(parents=True, exist_ok=True)
        readme.write_text(GITTOOLS_README, encoding="utf-8", newline="\n")
        print("copied  .gittools/README.md")


def _write_launchers(target: Path, *, force: bool) -> None:
    """Write short launcher scripts into ``_scripts/`` so the tool runs from any directory of the repository."""
    scripts = target / "_scripts"
    for name, text, newline in (("pages-publish.cmd", LAUNCHER_CMD, "\r\n"), ("pages-publish.sh", LAUNCHER_SH, "\n")):
        destination = scripts / name
        if destination.exists() and not force:
            print(f"kept    _scripts/{name} (exists; use --force to overwrite)")
            continue
        scripts.mkdir(exist_ok=True)
        destination.write_text(text, encoding="utf-8", newline=newline)
        destination.chmod(destination.stat().st_mode | 0o111)
        print(f"copied  _scripts/{name}")


def _copy_file(source: Path, destination: Path, label: str, *, force: bool) -> None:
    """Copy one file unless it exists and ``force`` is false; ``label`` is how it is reported."""
    if destination.exists() and not force:
        print(f"kept    {label} (exists; use --force to overwrite)")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    print(f"copied  {label}")


def _run_tool(tool: Path, target: Path, command: str) -> None:
    """Run one command of the installed tool inside the repository."""
    subprocess.run([sys.executable, str(tool), command], cwd=target, check=False)


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
    """Parse the command line, with a paired on/off flag for each optional piece."""
    parser = argparse.ArgumentParser(description="Set up pages-publish in a git repository.")
    parser.add_argument("repository", nargs="?", type=Path, help="target repository (default: the one containing this folder)")
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    parser.add_argument("--yes", action="store_true", help="do not ask; use the flags, else the defaults")
    options = (
        ("init", "write a starter config.toml"),
        ("workflow", "add the GitHub Actions workflow"),
        ("hook", "add the pre-push hook"),
        ("launchers", "add launcher scripts to _scripts/"),
    )
    for name, what in options:
        parser.add_argument(f"--{name}", dest=name, action="store_true", default=None, help=what)
        parser.add_argument(f"--no-{name}", dest=name, action="store_false", help=f"do not {what}")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
