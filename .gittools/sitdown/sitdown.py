"""Keep each machine's ``.git`` aligned with a working tree that Syncthing carries between machines.

Syncthing carries the working tree and ignores ``.git``, so each machine's ``.git`` is a local view of files it did not
write. This tool makes the two agree. Hooks write a *record* (``.git-current``) at the top of every checkout; the record
names the branch and the commit the files belong to. ``git sitdown`` follows the records on arrival (HEAD and the index
move, no working-tree file is written, worktrees that came by Syncthing are attached), and ``git sitdown done`` pushes
every checkout's branch and writes the records on leaving. The design is in ``_issues/01_sitdown_*.md``.

Layers, top to bottom in this file: messages and constants; ``git`` access; the record and the seen record; discovery of
checkouts; arrival; leaving; installation; command line. Only the Python standard library (3.11 or newer) and ``git``
(2.31 or newer) are used.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import tomllib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

# --------------------------------------------------------------------------------------------------------------------
# Names and constants
# --------------------------------------------------------------------------------------------------------------------

RECORD_FILE = ".git-current"
RECORD_TMP = ".git-current.tmp"
RECORD_FORMAT = 1

# The seen record: per checkout, inside the git directory (``git rev-parse --git-path``), never synced.
SEEN_PATH = "sitdown-seen"

# Environment variables that make git act on another checkout than the one named by the working directory.
GIT_ENV_TO_DROP = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY")

# --------------------------------------------------------------------------------------------------------------------
# Message texts. Every ERROR line of the tool, and the README's failure table, use these words.
# --------------------------------------------------------------------------------------------------------------------

# Conflict copies Syncthing makes of the record when both machines changed it while out of touch.
CONFLICT_PATTERNS = (".sync-conflict-*.git-current", ".git-current.sync-conflict-*")

# The repository's settings: at the top of the root checkout, carried by Syncthing, ignored by git (an exclude line).
# Never inside ``.gittools/sitdown``: that folder holds only the tool's sources, and is often a link to a shared copy.
CONFIG_FILE = ".sitdown.toml"
LEGACY_CONFIG_FILE = ".gittools/sitdown/config.toml"
# Where the checkouts are looked for when no settings file says otherwise.
DEFAULT_CHECKOUTS = (".worktrees/*",)

LEGACY_RECORD_FILE = ".git-current-branch"
EXCLUDE_LINES = (".git-current*", ".sync-conflict-*.git-current", f"/{CONFIG_FILE}")
HOOK_NAMES = ("post-checkout", "post-commit", "post-merge", "post-rewrite")
HOOK_MARKER = "# sitdown hook"
OLD_HOOK_MARKERS = ("# current-branch hook", "# current-branch post-checkout hook", "# branch-sync post-checkout hook")
INSTALL_DIR = "sitdown"  # under the git directory: the installed copy, and the folders of an attach
ALIAS = "sitdown"

# The fixed text of the settings file: the same bytes on every machine, so that Syncthing makes no conflict copy.
CONFIG_TEXT = (
    "# Folders that hold worktrees, relative to the root checkout. Registered worktrees are always included.\n"
    'checkouts = [".worktrees/*"]\n'
)

NOTE_NO_STFOLDER = (
    "no Syncthing folder (.stfolder) found at or above this repository. If Syncthing carries it, the folder's\n"
    "         .stignore needs the line\n             .git\n         and must not ignore .git-current."
)
NOTE_NO_STIGNORE = (
    "no .stignore in the Syncthing folder {folder}. If Syncthing carries this repository, the folder's\n"
    "         .stignore needs the line\n             .git\n         and must not ignore .git-current."
)
NOTE_LEGACY_RECORD = "{old} is the old record file; nothing reads it. Delete it: rm {old}"
NOTE_HOOKS_IN_TREE = (
    "the hooks are in the working tree ({folder}): Syncthing carries them, and git does if the folder is tracked. "
    "They name no machine path, so that is fine; commit them if the folder is tracked."
)
NOTE_UNUSED_HOOKS = (
    "our hooks are also in {folder}, which this machine does not use (git runs the hooks in {used}); "
    "the other machine uses them (core.hooksPath)."
)
NOTE_SAME_NAME = (
    "a record names this machine ({name}) with a commit that is unknown here: another machine has the same "
    "name. Give this one its own: git config sitdown.machine NEWNAME"
)
NOTE_LEGACY_CONFIG_COPIED = (
    "{old} is the old place of the settings; it was copied to {new}, which is read from now on. "
    "Delete {old} (the folder .gittools/sitdown holds only the tool's sources)."
)
NOTE_LEGACY_CONFIG_IGNORED = "{old} is the old place of the settings and is not read; {new} is. Delete {old}."
NEXT_FIRST_RECORDS = "Next: git sitdown done   (writes the first records and pushes; then install on the other machine)"

ERR_NOT_A_REPOSITORY = "not inside a git repository."
ERR_BARE = "bare repositories with worktrees are not supported."
ERR_CONFIG = "{path} is not valid: {why}"
ERR_LEGACY_CONFIG = "{old} is no longer read; run install, which copies it to {new}"
BACKUP_PREFIX = "refs/sitdown/backup"
ERR_NO_REMOTE = "no remote named {remote}; pass --remote NAME."
ERR_CONFLICT_COPIES = (
    "Syncthing conflict copies of the record: {names}; both machines wrote it while out of touch. "
    "Keep the right one as .git-current and delete the others"
)
ERR_TRACKED_RECORD = '.git-current is tracked by git; run "git rm --cached .git-current"'
ERR_NO_RECORD = 'no .git-current here; run "git sitdown done" on the machine that has this folder'
ERR_LINK_FOREIGN = (
    ".git is a link file from the other machine ({gitdir} does not exist here); add the line .git (unanchored) to "
    '.stignore on both machines, delete this .git file, then run "git sitdown" again'
)
ERR_LINK_OTHER = ".git links to {gitdir}, which belongs to {other}; resolve this by hand"
ERR_OPERATION = '{operation} in progress; finish or abort it, then run "git sitdown" again'
ERR_INDEX_LOCK = "git is busy: {path} exists; wait for it, or delete it if no git command is running"
ERR_SAME_MACHINE_NAME = (
    "{branch} at {short} is unknown here but the record names this machine ({machine}); "
    "give each machine its own name: git config sitdown.machine NAME"
)
ERR_NOT_ON_REMOTE = '{branch} at {short} from {machine} is not on {remote}; run "git sitdown done" on {machine}'
ERR_CANNOT_FETCH = "cannot fetch {branch} from {remote}: {why}"
ERR_BRANCH_HELD = (
    'branch {branch} is checked out in {other}; run "git -C {other} switch --detach", then git sitdown again'
)
NOTE_NO_RECORD_REGISTERED = "no .git-current; this machine's git is the only record of this worktree"
NOTE_NO_COMMIT = "the branch has no commit yet; nothing to follow"
NOTE_REPOSITORY = "has its own .git: a separate repository, skipped"
NOTE_HEAD_MOVED = 'HEAD moved without a hook since the record was written; run "git sitdown done" before you leave'
NOTE_COULD_NOT_REACH = "could not reach {remote}; followed from local objects"
NOTE_FILES_DIFFER = "{count} {files} from {short}: uncommitted edits from {machine}, or Syncthing is not finished"
NOTE_REMOTE_AHEAD = "{remote}/{branch} is {count} {commits} ahead of the files; pull when ready"
NOTE_DIVERGED = "{remote}/{branch} has diverged from the files"
NOTE_COPY_DIFFERS = ".gittools/sitdown/sitdown.py differs from the installed copy; run install"
MSG_REMOVED = "the other machine removed this worktree; its branch is kept"
ERR_DONE_NOT_ATTACHED = 'this folder is not a worktree of this repository yet; run "git sitdown" first'
ERR_DONE_GUARD = '.git-current is from {machine} and has not been followed here; run "git sitdown" first'
ERR_DONE_DETACHED = 'detached HEAD at {short} is not on {remote}; create a branch, then run "git sitdown done" again'
ERR_DONE_UPSTREAM = 'upstream of {branch} is {upstream}; "done" pushes only to {remote}/{branch}'
ERR_DONE_DIVERGED = 'diverged from {remote}/{branch}; pull or rebase, then run "git sitdown done" again'
ERR_DONE_PUSH = "push failed: {why}"
NOTE_DONE_BEHIND = "{remote}/{branch} is {count} {commits} ahead; pull when ready"
ERR_RECORD_UNREADABLE = "cannot read .git-current: {why}"
ERR_RECORD_FORMAT = ".git-current has format {found}, this tool reads format {expected}: update the sitdown tool"
WARN_NOT_RECORDING = (
    'not recording: .git-current is from {machine} and this checkout has not followed it; run "git sitdown"'
)


class SitdownError(RuntimeError):
    """A condition that stops the tool, or one checkout, with a message instead of a traceback."""


# --------------------------------------------------------------------------------------------------------------------
# Git access
# --------------------------------------------------------------------------------------------------------------------


def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run ``git`` in ``cwd`` with a clean environment and return the completed process.

    ``cwd`` alone says which checkout is meant: a ``!`` alias started inside a worktree exports ``GIT_DIR``, and a hook
    exports ``GIT_INDEX_FILE``, so the variables of `GIT_ENV_TO_DROP` are removed. Optional index refreshes are off, so
    read-only commands write nothing.

    Parameters
    ----------
    cwd : Path
        Directory to run in.
    *args : str
        Arguments after ``git``.
    check : bool, default True
        Raise `SitdownError` with git's message on a nonzero exit.

    Returns
    -------
    subprocess.CompletedProcess of str
        Captured output, decoded as UTF-8.
    """
    env = {name: value for name, value in os.environ.items() if name not in GIT_ENV_TO_DROP}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    done = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env
    )
    if check and done.returncode != 0:
        raise SitdownError(f"git {' '.join(args)} failed: {(done.stderr or done.stdout).strip()}")
    return done


def git_path(checkout: Path, name: str) -> Path:
    """Return the absolute path git uses for ``name`` in ``checkout`` (per worktree for names git does not share)."""
    return Path(git(checkout, "rev-parse", "--path-format=absolute", "--git-path", name).stdout.strip())


def toplevel(start: Path) -> Path:
    """Return the top of the checkout (root or worktree) that contains ``start``."""
    done = git(start, "rev-parse", "--show-toplevel", check=False)
    if done.returncode != 0:
        raise SitdownError(ERR_NOT_A_REPOSITORY)
    return Path(done.stdout.strip()).resolve()


def machine_name(repo: Path) -> str:
    """Return this machine's name: ``sitdown.machine`` from the git config, else the host name."""
    configured = git(repo, "config", "--get", "sitdown.machine", check=False).stdout.strip()
    return configured or platform.node()


def now_utc() -> str:
    """Return the current UTC time as ``2026-11-11T20:41:07Z``."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def toml_string(value: str) -> str:
    """Return ``value`` as a TOML basic string.

    ``ensure_ascii=False`` keeps characters outside the basic plane whole (JSON would write surrogate pairs, which TOML
    refuses); DEL is escaped because TOML does not allow it raw.
    """
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


# --------------------------------------------------------------------------------------------------------------------
# The record and the seen record
# --------------------------------------------------------------------------------------------------------------------

HEAD_PATTERN = re.compile(r"^([0-9a-f]{40}|[0-9a-f]{64})?$")


@dataclass(frozen=True)
class Record:
    """What the files of one checkout belong to: the branch and the commit, and who wrote it."""

    machine: str
    written: str
    event: str
    branch: str  # "" when HEAD is detached
    head: str  # "" when the branch has no commit

    def same_as(self, other: Record | None) -> bool:
        """Return whether ``other`` names the same machine, branch and commit."""
        return (
            other is not None
            and self.machine == other.machine
            and self.branch == other.branch
            and self.head == other.head
        )


def format_record(record: Record) -> str:
    """Return the text of a record file: a comment line, then ``key = value`` lines, LF endings."""
    return (
        f"# {RECORD_FILE}: written by the sitdown tool. Syncthing carries it; git ignores it. Do not edit.\n"
        f"format = {RECORD_FORMAT}\n"
        f"machine = {toml_string(record.machine)}\n"
        f"written = {toml_string(record.written)}\n"
        f"event = {toml_string(record.event)}\n"
        f"branch = {toml_string(record.branch)}\n"
        f"head = {toml_string(record.head)}\n"
    )


def parse_record(text: str, repo: Path) -> Record:
    """Parse and validate the text of a record file.

    Raises
    ------
    SitdownError
        If the text is not TOML, has another ``format``, lacks a key, or holds an invalid branch or commit id.
        Unknown keys are ignored.
    """
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise SitdownError(ERR_RECORD_UNREADABLE.format(why=error)) from error
    found = data.get("format")
    if isinstance(found, bool) or not isinstance(found, int):
        raise SitdownError(ERR_RECORD_UNREADABLE.format(why="format is missing or not an integer"))
    if found != RECORD_FORMAT:
        raise SitdownError(ERR_RECORD_FORMAT.format(found=found, expected=RECORD_FORMAT))
    values: dict[str, str] = {}
    for key in ("machine", "written", "event", "branch", "head"):
        value = data.get(key)
        if not isinstance(value, str):
            raise SitdownError(ERR_RECORD_UNREADABLE.format(why=f"{key} is missing or not a string"))
        values[key] = value
    branch = values["branch"]
    if branch and ("@{" in branch or git(repo, "check-ref-format", "--branch", branch, check=False).returncode != 0):
        raise SitdownError(ERR_RECORD_UNREADABLE.format(why=f"{branch!r} is not a branch name"))
    if not HEAD_PATTERN.match(values["head"]):
        raise SitdownError(ERR_RECORD_UNREADABLE.format(why=f"{values['head']!r} is not a commit id"))
    return Record(values["machine"], values["written"], values["event"], branch, values["head"])


def read_record(folder: Path, repo: Path) -> Record | None:
    """Return the record in ``folder``, or ``None`` if there is none. Raises `SitdownError` if it is invalid."""
    path = folder / RECORD_FILE
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise SitdownError(ERR_RECORD_UNREADABLE.format(why=error)) from error
    return parse_record(text, repo)


def write_record(folder: Path, record: Record) -> None:
    """Write the record atomically: a temporary file, then a rename.

    On Windows the rename fails for a moment while Syncthing holds the file open, so it is tried 5 times, 100 ms apart.
    """
    temporary = folder / RECORD_TMP
    temporary.write_text(format_record(record), encoding="utf-8", newline="\n")
    for attempt in range(5):
        try:
            temporary.replace(folder / RECORD_FILE)
        except PermissionError:
            if attempt == 4:
                temporary.unlink(missing_ok=True)
                raise
            time.sleep(0.1)
        else:
            return


def read_seen(checkout: Path) -> Record | None:
    """Return the seen record of ``checkout``; a missing or unreadable one counts as missing."""
    path = git_path(checkout, SEEN_PATH)
    try:
        return parse_record(path.read_text(encoding="utf-8"), checkout) if path.is_file() else None
    except (SitdownError, OSError, UnicodeDecodeError):
        return None


def write_seen(checkout: Path, record: Record) -> None:
    """Store ``record`` as the last record this machine wrote or followed in ``checkout``."""
    path = git_path(checkout, SEEN_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(format_record(record), encoding="utf-8", newline="\n")


def current_record(checkout: Path, event: str) -> Record:
    """Return the record that describes what git says about ``checkout`` now."""
    branch = git(checkout, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
    head = git(checkout, "rev-parse", "--verify", "--quiet", "HEAD", check=False)
    return Record(
        machine_name(checkout),
        now_utc(),
        event,
        branch.stdout.strip() if branch.returncode == 0 else "",
        head.stdout.strip() if head.returncode == 0 else "",
    )


def operation_in_progress(checkout: Path) -> str:
    """Return ``rebase``, ``merge``, ``cherry-pick`` or ``revert`` if one is unfinished in ``checkout``, else ``""``."""
    markers = (
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    )
    for name, operation in markers:
        if git_path(checkout, name).exists():
            return operation
    return ""


def may_overwrite(existing: Record | None, seen: Record | None, machine: str) -> bool:
    """Return whether this machine may replace ``existing`` (the guard).

    It may if there is no record, if the record is the one this checkout already knows (the seen record), or if the
    record was written by this machine. Otherwise the record came from another machine and was never followed here.
    """
    return existing is None or existing.same_as(seen) or existing.machine == machine


def update_record(checkout: Path, event: str) -> Record | None:
    """Write the record of ``checkout`` through the guard, and the seen record.

    Nothing is written when the record already names the same branch and commit (this keeps Syncthing quiet); the seen
    record is still refreshed, because then this machine's git and the files agree with the record.

    Returns
    -------
    Record or None
        ``None`` normally; the record from another machine that blocked the write, if the guard refused.
    """
    new = current_record(checkout, event)
    try:
        existing = read_record(checkout, checkout)
    except SitdownError:
        existing = None
    if existing is not None and existing.branch == new.branch and existing.head == new.head:
        write_seen(checkout, existing)
        return None
    if not may_overwrite(existing, read_seen(checkout), new.machine):
        return existing
    write_record(checkout, new)
    write_seen(checkout, new)
    return None


def command_record(start: Path, event: str) -> int:
    """Write the record of the checkout that contains ``start`` (what the hooks call); print nothing on success.

    During a rebase HEAD is detached while git picks commits; nothing is written then, and ``post-rewrite`` records
    the end. A record from another machine that was not followed is kept, with a warning on stderr.

    Returns
    -------
    int
        ``0``, also when the guard refused; ``1`` if the record could not be written.
    """
    try:
        top = toplevel(start)
        if git(top, "symbolic-ref", "--quiet", "HEAD", check=False).returncode != 0 and operation_in_progress(top) == (
            "rebase"
        ):
            return 0
        blocking = update_record(top, event)
    except (SitdownError, OSError) as error:
        print(f"sitdown: {error}", file=sys.stderr)
        return 1
    if blocking is not None:
        print(f"sitdown: {WARN_NOT_RECORDING.format(machine=blocking.machine)}", file=sys.stderr)
    return 0


# --------------------------------------------------------------------------------------------------------------------
# Discovery of checkouts
# --------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Checkout:
    """A folder with the files of one branch.

    ``kind`` is ``root`` (the main worktree), ``registered`` (a worktree of this machine's ``.git``), ``unregistered``
    (a folder without ``.git``, which Syncthing brought), ``repository`` (it has a ``.git`` folder: a separate
    repository) or ``link`` (a ``.git`` file that this machine's ``.git`` does not list).
    """

    path: Path  # resolved
    kind: str
    label: str  # relative to the root, POSIX form; "." for the root


def worktree_list(repo: Path) -> list[dict[str, str]]:
    """Return the blocks of ``git worktree list --porcelain``: ``worktree``, ``HEAD``, ``branch``, ``bare``, ..."""
    done = git(repo, "worktree", "list", "--porcelain", check=False)
    if done.returncode != 0:
        raise SitdownError(ERR_NOT_A_REPOSITORY)
    blocks: list[dict[str, str]] = []
    for chunk in done.stdout.replace("\r\n", "\n").split("\n\n"):
        block: dict[str, str] = {}
        for line in chunk.splitlines():
            key, _, value = line.partition(" ")
            block[key] = value
        if block:
            blocks.append(block)
    return blocks


def root_checkout(start: Path) -> Path:
    """Return the root checkout (the main worktree) of the repository containing ``start``."""
    first = worktree_list(start)[0]
    if "bare" in first:
        raise SitdownError(ERR_BARE)
    return Path(first["worktree"]).resolve()


def read_config(root: Path) -> list[str]:
    """Return the ``checkouts`` globs of the settings file; the default if the file is missing.

    Raises
    ------
    SitdownError
        If the file exists and is not TOML, or ``checkouts`` is not a list of strings; or if only the settings file of
        an older version exists (silently using the default instead would drop checkouts).
    """
    path = root / CONFIG_FILE
    if not path.is_file():
        if (root / LEGACY_CONFIG_FILE).is_file():
            raise SitdownError(ERR_LEGACY_CONFIG.format(old=LEGACY_CONFIG_FILE, new=CONFIG_FILE))
        return list(DEFAULT_CHECKOUTS)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, OSError, UnicodeDecodeError) as error:
        raise SitdownError(ERR_CONFIG.format(path=path, why=error)) from error
    globs = data.get("checkouts", list(DEFAULT_CHECKOUTS))
    if not isinstance(globs, list) or not all(isinstance(item, str) and item for item in globs):
        raise SitdownError(ERR_CONFIG.format(path=path, why="checkouts must be a list of folder patterns"))
    return globs


def find_checkouts(root: Path, globs: Sequence[str]) -> list[Checkout]:
    """Return the root first, then every other checkout sorted by label, each classified.

    The others are the registered worktrees whose folder exists, and the folders that match a glob (relative to
    ``root``) and are folders inside ``root``. Paths are compared after ``resolve()``, so case and slashes agree.
    """
    registered = {
        Path(block["worktree"]).resolve() for block in worktree_list(root)[1:] if Path(block["worktree"]).is_dir()
    }
    found: dict[Path, Path] = {}
    for pattern in globs:
        try:
            matches = list(root.glob(pattern))
        except (NotImplementedError, ValueError) as error:
            raise SitdownError(
                ERR_CONFIG.format(path=root / CONFIG_FILE, why=f"pattern {pattern!r}: {error}")
            ) from error
        for match in matches:
            resolved = match.resolve()
            if match.is_dir() and resolved != root and match.name != ".git" and resolved.is_relative_to(root):
                found[resolved] = resolved
    for path in registered:
        found[path] = path
    checkouts = []
    for path in found:
        label = path.relative_to(root).as_posix() if path.is_relative_to(root) else path.as_posix()
        if path in registered:
            kind = "registered"
        elif (path / ".git").is_dir():
            kind = "repository"
        elif (path / ".git").is_file():
            kind = "link"
        else:
            kind = "unregistered"
        checkouts.append(Checkout(path, kind, label))
    return [Checkout(root, "root", "."), *sorted(checkouts, key=lambda checkout: checkout.label)]


def conflict_copies(folder: Path) -> list[str]:
    """Return the names in ``folder`` that are Syncthing conflict copies of the record."""
    names = sorted(entry.name for entry in folder.iterdir()) if folder.is_dir() else []
    return [name for name in names if any(fnmatch.fnmatch(name, pattern) for pattern in CONFLICT_PATTERNS)]


def is_tracked_record(root: Path, checkout: Checkout) -> bool:
    """Return whether git tracks the record of ``checkout`` (it must not: the tool keeps it out of git)."""
    if checkout.kind in ("root", "registered"):
        return bool(git(checkout.path, "ls-files", "--", RECORD_FILE).stdout.strip())
    return bool(git(root, "ls-files", "--", f"{checkout.label}/{RECORD_FILE}").stdout.strip())


# --------------------------------------------------------------------------------------------------------------------
# Arrival: git sitdown
# --------------------------------------------------------------------------------------------------------------------


def line(word: str, label: str, message: str) -> str:
    """Return one output line about a checkout: the word padded to 8 characters, the label, two spaces, the message."""
    return f"{word:<8} {label}  {message}"


def plural(count: int, singular: str, many: str) -> str:
    """Return ``singular`` for one, ``many`` otherwise."""
    return singular if count == 1 else many


@dataclass
class Plan:
    """What to do for one checkout, decided without writing anything; plain data.

    ``lines`` are printed first (ok, notes, errors); ``follow`` says whether HEAD and the index move; ``notes_after``
    are printed after the action lines.
    """

    checkout: Checkout
    record: Record | None = None
    lines: list[str] = field(default_factory=list)
    notes_after: list[str] = field(default_factory=list)
    error: bool = False
    follow: bool = False
    remove: bool = False
    repair: bool = False
    attach: bool = False
    would_fetch: bool = False
    backup: tuple[str, str] | None = None  # (backup ref, old tip)
    branch: str = ""  # the target; "" means detached
    head: str = ""
    old_branch_value: str = ""  # the branch tip seen while planning; "" means it did not exist
    set_upstream: bool = False
    push: bool = False
    switching_from: str = ""  # the branch HEAD is on now, if it is another one


@dataclass
class Outcome:
    """What happened for one checkout: the lines to print and ``ok``, ``followed``, ``removed`` or ``error``."""

    plan: Plan
    lines: list[str]
    state: str


def work_dir(root: Path, checkout: Checkout) -> Path:
    """Return where git commands about ``checkout`` run: a folder git does not know yet is asked about through the root."""
    return checkout.path if checkout.kind in ("root", "registered") else root


def require_remote(root: Path, remote: str) -> None:
    """Stop the run if ``remote`` is not a configured remote."""
    if git(root, "remote", "get-url", remote, check=False).returncode != 0:
        raise SitdownError(ERR_NO_REMOTE.format(remote=remote))


def commit_exists(repo: Path, commit: str) -> bool:
    """Return whether ``commit`` is a commit in the repository of ``repo``."""
    return git(repo, "cat-file", "-e", f"{commit}^{{commit}}", check=False).returncode == 0


def ref_value(repo: Path, ref: str) -> str:
    """Return the commit id that ``ref`` points to, or ``""`` if it does not exist."""
    return git(repo, "rev-parse", "--verify", "--quiet", ref, check=False).stdout.strip()


def is_ancestor(repo: Path, older: str, newer: str) -> bool:
    """Return whether ``older`` is an ancestor of (or equal to) ``newer``; raise `SitdownError` on a git error."""
    done = git(repo, "merge-base", "--is-ancestor", older, newer, check=False)
    if done.returncode not in (0, 1):
        raise SitdownError(f"git merge-base failed: {done.stderr.strip()}")
    return done.returncode == 0


def count_commits(repo: Path, older: str, newer: str) -> int:
    """Return the number of commits reachable from ``newer`` and not from ``older``."""
    return int(git(repo, "rev-list", "--count", f"{older}..{newer}").stdout.strip())


def our_post_commit_hook(checkout: Path) -> bool:
    """Return whether our hook is in the folder git runs hooks from for ``checkout``."""
    hook = git_path(checkout, "hooks") / "post-commit"
    return hook.is_file() and is_our_hook(hook.read_text(encoding="utf-8", errors="replace"))


def copy_note(root: Path) -> list[str]:
    """Return the note that the tool in the working tree differs from the installed copy, or nothing."""
    source = root / ".gittools" / "sitdown" / "sitdown.py"
    if source.is_file() and installed_copy(root).is_file() and source.read_bytes() != installed_copy(root).read_bytes():
        return [say("note", NOTE_COPY_DIFFERS)]
    return []


def fetch_for(root: Path, remote: str, records: Sequence[Record], *, always: bool = False) -> dict[str, str]:
    """Fetch what the records need; never raises.

    One fetch per recorded branch whose commit is missing here or whose remote-tracking ref does not exist (every
    branch with ``always``), and one plain fetch if a detached record's commit is missing.

    Returns
    -------
    dict of str to str
        Per branch (``""`` for the plain fetch): ``ok``, ``missing`` (the remote has no such branch) or git's message.
    """
    results: dict[str, str] = {}

    def outcome(done: subprocess.CompletedProcess[str]) -> str:
        if done.returncode == 0:
            return "ok"
        if "couldn't find remote ref" in done.stderr:
            return "missing"
        return (done.stderr or done.stdout).strip()

    plain = False
    for record in records:
        if not record.head:
            continue
        present = commit_exists(root, record.head)
        if not record.branch:
            plain = plain or not present
        elif record.branch not in results:
            tracked = bool(ref_value(root, f"refs/remotes/{remote}/{record.branch}"))
            if always or not present or not tracked:
                refspec = f"+refs/heads/{record.branch}:refs/remotes/{remote}/{record.branch}"
                results[record.branch] = outcome(git(root, "fetch", remote, refspec, check=False))
    if plain:
        results[""] = outcome(git(root, "fetch", remote, check=False))
    return results


def is_leftover_link(checkout: Checkout) -> bool:
    """Return whether a registered worktree's folder holds only ``.git`` while its HEAD has files.

    That is what remains after the other machine removed the worktree: Syncthing keeps a folder that holds an ignored
    file, so the link stays and the rest is deleted.
    """
    if [entry.name for entry in checkout.path.iterdir()] != [".git"]:
        return False
    return bool(git(checkout.path, "ls-tree", "-r", "--name-only", "HEAD", check=False).stdout.strip())


def check_checkout_state(root: Path, checkout: Checkout) -> str:
    """Return an error message if the record of ``checkout`` may not be used, else ``""``.

    The checks shared by arrival and leaving: conflict copies, a tracked record, an unfinished operation, a lock.
    """
    names = conflict_copies(checkout.path)
    if names:
        return ERR_CONFLICT_COPIES.format(names=", ".join(names))
    if is_tracked_record(root, checkout):
        return ERR_TRACKED_RECORD
    if checkout.kind in ("root", "registered"):
        operation = operation_in_progress(checkout.path)
        if operation:
            return ERR_OPERATION.format(operation=operation)
        lock = git_path(checkout.path, "index.lock")
        if lock.exists():
            return ERR_INDEX_LOCK.format(path=lock.as_posix())
    return ""


def check_link(checkout: Checkout) -> tuple[bool, str]:
    """Judge the ``.git`` link file of a folder that git does not list: return (repair, error).

    A link to a git directory that does not exist here came from the other machine. A link to ours, whose ``gitdir``
    points to this folder or to a folder that is gone, is half repaired and needs ``git worktree repair``.
    """
    text = (checkout.path / ".git").read_text(encoding="utf-8", errors="replace").strip()
    target = Path(text.removeprefix("gitdir:").strip())
    if not target.is_absolute():
        target = checkout.path / target
    if not target.exists():
        return False, ERR_LINK_FOREIGN.format(gitdir=target.as_posix())
    back = target / "gitdir"
    pointed = Path(back.read_text(encoding="utf-8", errors="replace").strip()).parent if back.is_file() else None
    if pointed is None or not pointed.exists() or pointed.resolve() == checkout.path:
        return True, ""
    return False, ERR_LINK_OTHER.format(gitdir=target.as_posix(), other=pointed.as_posix())


def plan_arrive(root: Path, checkout: Checkout, remote: str, fetched: dict[str, str] | None) -> Plan:
    """Decide what ``git sitdown`` does for one checkout; run every check and write nothing.

    Parameters
    ----------
    root : Path
        The root checkout.
    checkout : Checkout
        The checkout to plan.
    remote : str
        Name of the remote.
    fetched : dict of str to str, optional
        The result of `fetch_for`; ``None`` in ``status``, where a missing commit becomes "would fetch".
    """
    plan = Plan(checkout)
    label = checkout.label

    def stop(message: str) -> Plan:
        plan.lines.append(line("ERROR", label, message))
        plan.error = True
        return plan

    if checkout.kind == "repository":
        plan.lines.append(line("note", label, NOTE_REPOSITORY))
        return plan
    here = work_dir(root, checkout)
    if checkout.kind == "registered" and is_leftover_link(checkout):
        plan.remove = True
        return plan
    problem = check_checkout_state(root, checkout)
    if problem:
        return stop(problem)
    try:
        record = read_record(checkout.path, here)
    except SitdownError as error:
        return stop(str(error))
    if record is None:
        if checkout.kind == "registered":
            plan.lines.append(line("note", label, NOTE_NO_RECORD_REGISTERED))
            return plan
        return stop(ERR_NO_RECORD)
    plan.record = record
    plan.branch, plan.head = record.branch, record.head
    where = f"{record.branch or 'detached HEAD'} at {record.head[:12]}"

    seen = read_seen(checkout.path) if checkout.kind in ("root", "registered") else None
    if record.same_as(seen):
        plan.lines.append(line("ok", label, f"{where}, as recorded by {record.machine}"))
        now = current_record(checkout.path, "")
        if (now.branch, now.head) != (record.branch, record.head):
            plan.lines.append(line("note", label, NOTE_HEAD_MOVED))
        return plan

    if checkout.kind == "link":
        repair, problem = check_link(checkout)
        if problem:
            return stop(problem)
        plan.repair = repair
    if not record.head:
        plan.lines.append(line("note", label, NOTE_NO_COMMIT))
        return plan

    if not commit_exists(here, record.head):
        if record.machine == machine_name(root):
            return stop(
                ERR_SAME_MACHINE_NAME.format(branch=record.branch, short=record.head[:12], machine=record.machine)
            )
        if fetched is None:
            plan.follow = plan.would_fetch = True
            return plan
        result = fetched.get(record.branch, "ok")
        if result in ("ok", "missing"):
            return stop(
                ERR_NOT_ON_REMOTE.format(
                    branch=record.branch or "detached HEAD",
                    short=record.head[:12],
                    machine=record.machine,
                    remote=remote,
                )
            )
        return stop(ERR_CANNOT_FETCH.format(branch=record.branch or "HEAD", remote=remote, why=result))
    if fetched is not None and fetched.get(record.branch, "ok") not in ("ok", "missing"):
        plan.lines.append(line("note", label, NOTE_COULD_NOT_REACH.format(remote=remote)))

    plan.follow = True
    plan.attach = checkout.kind == "unregistered"
    if checkout.kind in ("root", "registered"):
        current = git(checkout.path, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
        now_on = current.stdout.strip() if current.returncode == 0 else "(detached)"
        if now_on != (record.branch or "(detached)"):
            plan.switching_from = now_on
    if record.branch:
        try:
            plan_branch(root, plan, remote)
        except SitdownError as error:
            return stop(str(error))
    return plan


def plan_branch(root: Path, plan: Plan, remote: str) -> None:
    """Plan the branch-related steps: backup of an old tip, upstream, and notes about the remote tip."""
    label, branch, head = plan.checkout.label, plan.branch, plan.head
    old = ref_value(root, f"refs/heads/{branch}")
    plan.old_branch_value = old
    if old and old != head and not is_ancestor(root, old, head):
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        ref, number = f"{BACKUP_PREFIX}/{stamp}/{branch}", 1
        while ref_value(root, ref):
            number += 1
            ref = f"{BACKUP_PREFIX}/{stamp}-{number}/{branch}"
        plan.backup = (ref, old)
    tip = ref_value(root, f"refs/remotes/{remote}/{branch}")
    if not tip:
        return
    configured = [
        git(root, "config", "--get", f"branch.{branch}.{key}", check=False).stdout.strip()
        for key in ("remote", "merge")
    ]
    plan.set_upstream = not all(configured)
    if tip != head:
        if is_ancestor(root, head, tip):
            count = count_commits(root, head, tip)
            message = NOTE_REMOTE_AHEAD.format(
                remote=remote, branch=branch, count=count, commits=plural(count, "commit", "commits")
            )
            plan.notes_after.append(line("note", label, message))
        elif not is_ancestor(root, tip, head):
            plan.notes_after.append(line("note", label, NOTE_DIVERGED.format(remote=remote, branch=branch)))


def attach_folder(root: Path, folder: Path, head: str) -> None:
    """Turn ``folder`` (files only) into a worktree of this repository, by moving a ``.git`` link into it.

    ``git worktree add`` refuses a folder that is not empty, so the link is made in a temporary folder inside ``.git``
    and moved. The repair that follows points git's record of the worktree at ``folder``.
    """
    base = common_dir(root) / INSTALL_DIR / "attach"
    base.mkdir(parents=True, exist_ok=True)
    parent = Path(tempfile.mkdtemp(dir=base))
    temporary = parent / folder.name
    git(root, "worktree", "add", "--no-checkout", "--detach", str(temporary), head)
    (temporary / ".git").replace(folder / ".git")
    git(root, "worktree", "repair", str(folder))
    if not any(temporary.iterdir()) and [entry.name for entry in parent.iterdir()] == [folder.name]:
        shutil.rmtree(parent)


def apply_plan(root: Path, plan: Plan, remote: str, out: list[str]) -> None:
    """Carry out the writes of one plan, in the order that lets a repeated run finish an interrupted one.

    Lines for ``out`` are appended as steps finish. Raises `SitdownError` if a git command fails.
    """
    label, path = plan.checkout.label, plan.checkout.path
    if plan.remove:
        git(root, "worktree", "remove", "--force", str(path))
        out.append(line("removed", label, MSG_REMOVED))
        return
    record = plan.record
    if record is None:
        raise SitdownError("a plan that follows a record must hold it")
    short = plan.head[:12]
    if plan.repair:
        git(root, "worktree", "repair", str(path))
    if plan.attach:
        attach_folder(root, path, plan.head)
        out.append(line("attached", label, f"worktree attached to this repository at {short}"))
    if plan.backup is not None:
        ref, old = plan.backup
        git(root, "update-ref", ref, old)
        out.append(line("backup", label, f"old tip {old[:12]} of {plan.branch} kept at {ref}"))
    if plan.branch:
        zeros = "0" * len(plan.head)
        git(
            root, "update-ref", "-m", "sitdown: sitdown", f"refs/heads/{plan.branch}", plan.head,
            plan.old_branch_value or zeros,
        )  # fmt: skip
        git(path, "symbolic-ref", "-m", "sitdown: sitdown", "HEAD", f"refs/heads/{plan.branch}")
    else:
        git(path, "update-ref", "--no-deref", "HEAD", plan.head)
    git(path, "reset", "--mixed", "--quiet", plan.head)
    if plan.set_upstream:
        git(root, "config", f"branch.{plan.branch}.remote", remote)
        git(root, "config", f"branch.{plan.branch}.merge", f"refs/heads/{plan.branch}")
    write_seen(path, record)
    where = f"{plan.branch or 'detached HEAD'} at {short}"
    if plan.switching_from:
        out.append(line("switched", label, f"{plan.switching_from} -> {where}"))
    else:
        out.append(line("reset", label, where))
    differing = len(git(path, "status", "--porcelain").stdout.splitlines())
    if differing:
        files = plural(differing, "file differs", "files differ")
        out.append(
            line(
                "note",
                label,
                NOTE_FILES_DIFFER.format(count=differing, files=files, short=short, machine=record.machine),
            )
        )


def branch_holders(root: Path) -> dict[str, Path]:
    """Return which checkout has each branch checked out, by branch name."""
    holders: dict[str, Path] = {}
    for block in worktree_list(root):
        if block.get("branch", "").startswith("refs/heads/"):
            holders[block["branch"].removeprefix("refs/heads/")] = Path(block["worktree"]).resolve()
    return holders


def apply_in_passes(root: Path, plans: Sequence[Plan], remote: str) -> list[Outcome]:
    """Apply the plans so that a branch is never checked out in two places.

    Removals of worktrees the other machine removed come first, so their branches are free. A plan is ready when no
    other checkout holds its branch; passes repeat while one applies something. A plan left over gets an error that
    names the checkout holding its branch. Every checkout is independent: an error in one does not stop the others.
    """
    holders = branch_holders(root)
    outcomes = [Outcome(plan, list(plan.lines), "error" if plan.error else "ok") for plan in plans]

    def run(outcome: Outcome, state: str) -> None:
        plan = outcome.plan
        try:
            apply_plan(root, plan, remote, outcome.lines)
        except SitdownError as error:
            outcome.lines.append(line("ERROR", plan.checkout.label, str(error)))
            outcome.state = "error"
        else:
            outcome.lines.extend(plan.notes_after)
            outcome.state = state
        for name in [name for name, path in holders.items() if path == plan.checkout.path]:
            del holders[name]
        if plan.branch and not plan.remove:
            holders[plan.branch] = plan.checkout.path

    for outcome in outcomes:
        if outcome.plan.remove:
            run(outcome, "removed")
    todo = [outcome for outcome in outcomes if outcome.plan.follow]
    progress = True
    while todo and progress:
        progress = False
        for outcome in list(todo):
            holder = holders.get(outcome.plan.branch) if outcome.plan.branch else None
            if holder is not None and holder != outcome.plan.checkout.path:
                continue
            todo.remove(outcome)
            run(outcome, "followed")
            progress = True
    for outcome in todo:
        holder = holders[outcome.plan.branch]
        message = ERR_BRANCH_HELD.format(branch=outcome.plan.branch, other=holder.as_posix())
        outcome.lines.append(line("ERROR", outcome.plan.checkout.label, message))
        outcome.state = "error"
    return outcomes


def plan_all(root: Path, checkouts: Sequence[Checkout], remote: str, fetched: dict[str, str] | None) -> list[Plan]:
    """Plan every checkout; a problem in one becomes an error line for that checkout only."""
    plans = []
    for checkout in checkouts:
        try:
            plans.append(plan_arrive(root, checkout, remote, fetched))
        except SitdownError as error:
            plans.append(Plan(checkout, lines=[line("ERROR", checkout.label, str(error))], error=True))
    return plans


def records_to_fetch(root: Path, checkouts: Sequence[Checkout]) -> list[Record]:
    """Return the records that may need a fetch: valid, with a commit, and not already followed here."""
    records = []
    for checkout in checkouts:
        if checkout.kind == "repository":
            continue
        try:
            record = read_record(checkout.path, work_dir(root, checkout))
        except SitdownError:
            continue
        seen = read_seen(checkout.path) if checkout.kind in ("root", "registered") else None
        if record is not None and not record.same_as(seen):
            records.append(record)
    return records


def command_sitdown(start: Path, remote: str) -> int:
    """Follow every checkout's record: ``git sitdown``. Returns ``1`` if any checkout printed an error."""
    root = root_checkout(start)
    require_remote(root, remote)
    globs = read_config(root)
    git(root, "worktree", "prune")
    checkouts = find_checkouts(root, globs)
    fetched = fetch_for(root, remote, records_to_fetch(root, checkouts))
    outcomes = apply_in_passes(root, plan_all(root, checkouts, remote, fetched), remote)
    print("\n".join(copy_note(root)), end="\n" if copy_note(root) else "")
    for outcome in outcomes:
        print("\n".join(outcome.lines))
    states = [outcome.state for outcome in outcomes]
    synced, followed, errors = (
        states.count("ok"),
        states.count("followed") + states.count("removed"),
        states.count("error"),
    )
    print(f"sitdown: {len(outcomes)} checkouts: {synced} in sync, {followed} followed, {errors} errors")
    return 1 if errors else 0


def describe_plan(plan: Plan, remote: str) -> list[str]:
    """Return the lines ``git sitdown status`` prints for one plan: what would be done, then the facts."""
    checkout, label = plan.checkout, plan.checkout.label
    lines = list(plan.lines)
    if plan.remove:
        lines.append(line("would", label, f"remove this worktree ({MSG_REMOVED})"))
    elif plan.follow:
        target = f"{plan.branch or 'detached HEAD'} at {plan.head[:12]}"
        steps = [
            *(["fetch it from " + remote] if plan.would_fetch else []),
            *(["attach this folder"] if plan.attach else []),
            *(["repair the link"] if plan.repair else []),
            *(
                [f"keep the old tip {plan.backup[1][:12]} of {plan.branch} under {plan.backup[0]}"]
                if plan.backup
                else []
            ),
            f"follow {target}",
        ]
        lines.append(line("would", label, ", ".join(steps)))
    lines.extend(plan.notes_after)
    if plan.record is not None:
        seen = read_seen(checkout.path) if checkout.kind in ("root", "registered") else None
        record = plan.record
        lines.append(
            f"  record   {record.machine}  {record.branch or '(detached)'}  {record.head[:12] or '(none)'}  "
            f"{record.event}  {record.written}   (seen: {'yes' if record.same_as(seen) else 'no'})"
        )
    if checkout.kind in ("root", "registered"):
        now = current_record(checkout.path, "")
        hooks = "yes" if our_post_commit_hook(checkout.path) else "no"
        lines.append(f"  local    {now.branch or '(detached)'}  {now.head[:12] or '(none)'}   hooks: {hooks}")
    return lines


def command_sitdown_status(start: Path, remote: str) -> int:
    """Show what ``git sitdown`` would do for every checkout, without fetching, pruning or writing anything."""
    root = root_checkout(start)
    require_remote(root, remote)
    checkouts = find_checkouts(root, read_config(root))
    plans = plan_all(root, checkouts, remote, None)
    lines = copy_note(root)
    for plan in plans:
        lines.extend(describe_plan(plan, remote))
    lines.extend(stignore_notes(root))
    print("\n".join(lines))
    return 1 if any(plan.error for plan in plans) else 0


# --------------------------------------------------------------------------------------------------------------------
# Leaving: git sitdown done
# --------------------------------------------------------------------------------------------------------------------


def plan_done(root: Path, checkout: Checkout, remote: str, fetched: dict[str, str]) -> Plan:
    """Decide what ``git sitdown done`` does for one checkout; run every check and write nothing.

    A plan that holds a record writes it (event ``done``) even when its branch cannot be pushed: the record then tells
    the other machine the truth, and ``git sitdown`` there says the commit is not on the remote. A plan without a
    record (a refused guard, a folder that is not attached) writes nothing.

    Parameters
    ----------
    fetched : dict of str to str
        The result of `fetch_for`; empty with ``--dry-run``, which makes no network access.
    """
    plan = Plan(checkout)
    label = checkout.label

    def stop(message: str) -> Plan:
        plan.lines.append(line("ERROR", label, message))
        plan.error = True
        return plan

    if checkout.kind == "repository":
        plan.lines.append(line("note", label, NOTE_REPOSITORY))
        return plan
    if checkout.kind in ("unregistered", "link"):
        return stop(ERR_DONE_NOT_ATTACHED)
    problem = check_checkout_state(root, checkout)
    if problem:
        return stop(problem)
    path = checkout.path
    try:
        existing = read_record(path, path)
    except SitdownError:
        existing = None
    current = current_record(path, "done")
    unchanged = existing is not None and (existing.branch, existing.head) == (current.branch, current.head)
    if not unchanged and not may_overwrite(existing, read_seen(path), current.machine):
        return stop(ERR_DONE_GUARD.format(machine=existing.machine if existing else ""))
    plan.record, plan.branch, plan.head = current, current.branch, current.head
    short = current.head[:12]
    if not current.head:
        plan.lines.append(line("note", label, NOTE_NO_COMMIT))
        return plan
    if not current.branch:
        on_remote = git(path, "for-each-ref", "--contains", current.head, f"refs/remotes/{remote}/").stdout.strip()
        if on_remote:
            plan.lines.append(line("ok", label, f"detached HEAD at {short} is on {remote}"))
            return plan
        return stop(ERR_DONE_DETACHED.format(short=short, remote=remote))

    branch = current.branch
    configured = {
        key: git(path, "config", "--get", f"branch.{branch}.{key}", check=False).stdout.strip()
        for key in ("remote", "merge")
    }
    if (configured["merge"] and configured["merge"] != f"refs/heads/{branch}") or (
        configured["remote"] and configured["remote"] != remote
    ):
        upstream = f"{configured['remote'] or remote}/{configured['merge'].removeprefix('refs/heads/') or branch}"
        return stop(ERR_DONE_UPSTREAM.format(branch=branch, upstream=upstream, remote=remote))
    tip = "" if fetched.get(branch) == "missing" else ref_value(path, f"refs/remotes/{remote}/{branch}")
    if not tip:
        plan.push = plan.set_upstream = True
    elif tip == current.head:
        plan.lines.append(line("ok", label, f"{branch} at {short} is on {remote}"))
    elif is_ancestor(path, current.head, tip):
        count = count_commits(path, current.head, tip)
        plan.lines.append(line("ok", label, f"{branch} at {short} is on {remote}"))
        message = NOTE_DONE_BEHIND.format(
            remote=remote, branch=branch, count=count, commits=plural(count, "commit", "commits")
        )
        plan.notes_after.append(line("note", label, message))
    elif is_ancestor(path, tip, current.head):
        plan.push = True
    else:
        return stop(ERR_DONE_DIVERGED.format(remote=remote, branch=branch))
    return plan


def apply_done(plan: Plan, remote: str, out: list[str]) -> str:
    """Push the branch if planned, then write the record (event ``done``) and the seen record.

    Returns
    -------
    str
        ``pushed``, ``ok`` (already on the remote) or ``error``. Never force-pushes.
    """
    label, path = plan.checkout.label, plan.checkout.path
    state = "ok"
    if plan.push:
        spec = f"refs/heads/{plan.branch}:refs/heads/{plan.branch}"
        done = git(path, "push", *(["--set-upstream"] if plan.set_upstream else []), remote, spec, check=False)
        if done.returncode != 0:
            why = (done.stderr or done.stdout).strip().splitlines()
            out.append(line("ERROR", label, ERR_DONE_PUSH.format(why=" ".join(item.strip() for item in why[-3:]))))
            state = "error"
        else:
            out.append(line("pushed", label, f"{plan.branch} at {plan.head[:12]} to {remote}"))
            state = "pushed"
    else:
        out.extend(plan.lines)
    if plan.error:
        state = "error"
    blocking = update_record(path, "done")
    if blocking is not None:
        out.append(line("ERROR", label, ERR_DONE_GUARD.format(machine=blocking.machine)))
        state = "error"
    out.extend(plan.notes_after)
    differing = len(git(path, "status", "--porcelain").stdout.splitlines())
    if differing:
        out.append(
            line(
                "note", label, f"{differing} {plural(differing, 'file', 'files')} not committed; Syncthing carries them"
            )
        )
    return state


def command_done(start: Path, remote: str, dry_run: bool) -> int:
    """Leave this machine: push every checkout's branch and write the records. Returns ``1`` on any error.

    With ``dry_run``, nothing is fetched, pruned, pushed or written; the plans are printed from the remote-tracking
    refs as they are.
    """
    root = root_checkout(start)
    require_remote(root, remote)
    globs = read_config(root)
    if not dry_run:
        git(root, "worktree", "prune")
    checkouts = find_checkouts(root, globs)
    fetched: dict[str, str] = {}
    if not dry_run:
        current = [current_record(item.path, "") for item in checkouts if item.kind in ("root", "registered")]
        fetched = fetch_for(root, remote, current, always=True)
    plans = []
    for checkout in checkouts:
        try:
            plans.append(plan_done(root, checkout, remote, fetched))
        except SitdownError as error:
            plans.append(Plan(checkout, lines=[line("ERROR", checkout.label, str(error))], error=True))
    lines = copy_note(root)
    states = []
    for plan in plans:
        if dry_run:
            lines.extend(plan.lines)
            if plan.push:
                lines.append(line("would", plan.checkout.label, f"push {plan.branch} at {plan.head[:12]} to {remote}"))
            lines.extend(plan.notes_after)
            states.append("error" if plan.error else "pushed" if plan.push else "ok")
        elif plan.record is None:
            lines.extend(plan.lines)
            states.append("error" if plan.error else "ok")
        else:
            outcome: list[str] = []
            try:
                states.append(apply_done(plan, remote, outcome))
            except (SitdownError, OSError) as error:
                outcome.append(line("ERROR", plan.checkout.label, str(error)))
                states.append("error")
            lines.extend(outcome)
    errors = states.count("error")
    verb = "would be pushed" if dry_run else "pushed"
    lines.append(
        f"done: {len(plans)} checkouts: {states.count('pushed')} {verb}, {states.count('ok')} already on {remote}, {errors} errors"
    )
    print("\n".join(lines))
    return 1 if errors else 0


# --------------------------------------------------------------------------------------------------------------------
# Installation
# --------------------------------------------------------------------------------------------------------------------


def say(word: str, message: str) -> str:
    """Return one output line: a word padded to 8 characters, then the message."""
    return f"{word:<8} {message}"


def common_dir(root: Path) -> Path:
    """Return the git directory shared by all worktrees."""
    return Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())


def installed_copy(root: Path) -> Path:
    """Return where the installed copy of this tool lives: inside ``.git``, so Syncthing never rewrites it."""
    return common_dir(root) / INSTALL_DIR / "sitdown.py"


def hook_line(name: str) -> str:
    """Return the line that records on ``name``: the third line of our hook, and what a foreign hook needs.

    It reads the Python and the tool from the local git config, so it names no machine path and is the same on every
    machine. It does nothing when the keys are missing, and never changes the exit status of the hook it sits in.
    """
    return (
        "python=$(git config --get sitdown.python) && tool=$(git config --get sitdown.tool) && "
        f'"$python" "$tool" record --event {name} >/dev/null || true'
    )


def hook_text(name: str) -> str:
    """Return the complete text of our hook ``name``."""
    return f"#!/bin/sh\n{HOOK_MARKER}\n{hook_line(name)}\nexit 0\n"


def is_our_hook(text: str) -> bool:
    """Return whether a hook file was written by this tool, under its current or an old marker."""
    return any(marker in text for marker in (HOOK_MARKER, *OLD_HOOK_MARKERS))


def is_shared_folder(root: Path, folder: Path) -> bool:
    """Return whether ``folder`` is inside the working tree (so Syncthing carries it) and not inside ``.git``."""
    folder = folder.resolve()
    return folder.is_relative_to(root) and not folder.is_relative_to(common_dir(root).resolve())


def install_copy(root: Path) -> bool:
    """Copy this file into ``.git`` if the installed copy is missing or differs; return whether it changed."""
    source = Path(__file__).resolve()
    target = installed_copy(root)
    if target.exists() and (target.resolve() == source or target.read_bytes() == source.read_bytes()):
        print(say("ok", f"installed copy {target.as_posix()} (unchanged)"))
        return False
    verb = "updated" if target.exists() else "copied"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    print(say(verb, f"installed copy {target.as_posix()}"))
    return True


def install_hooks(root: Path) -> tuple[bool, list[str]]:
    """Install the four hooks where git runs them; return (changed, names of foreign hooks that were kept).

    A hook that is not ours is never touched: the line to add to it is printed instead. A hook of ours that differs
    (an older text, or an old marker) is replaced; one that is byte-identical is not rewritten.
    """
    hooks = git_path(root, "hooks")
    changed = False
    foreign: list[str] = []
    for name in HOOK_NAMES:
        path = hooks / name
        text = hook_text(name)
        existing = path.read_bytes().decode("utf-8", errors="replace") if path.is_file() else None
        if existing == text:
            print(say("ok", f"hook {name} (unchanged)"))
            continue
        if existing is not None and not is_our_hook(existing):
            foreign.append(name)
            print(say("kept", f"hook {name}: {path.as_posix()} is not ours; add this line to it:"))
            print(f"         {hook_line(name)}")
            continue
        hooks.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        print(say("updated" if existing is not None else "added", f"hook {name}: {path.as_posix()}"))
        changed = True
    return changed, foreign


def install_excludes(root: Path) -> bool:
    """Add the record patterns to the shared ``info/exclude`` once each; return whether it changed."""
    exclude = git_path(root, "info/exclude")
    existing_text = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    missing = [line for line in EXCLUDE_LINES if line not in existing_text.splitlines()]
    if not missing:
        print(say("ok", f"exclude lines in {exclude.as_posix()} (unchanged)"))
        return False
    exclude.parent.mkdir(parents=True, exist_ok=True)
    separator = "" if not existing_text or existing_text.endswith("\n") else "\n"
    with exclude.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(separator + "".join(f"{line}\n" for line in missing))
    print(say("added", f"{' and '.join(missing)} to {exclude.as_posix()}"))
    return True


def install_config_file(root: Path) -> tuple[bool, list[str]]:
    """Create the settings file if it is missing (it is shared, so never rewritten); return (changed, notes).

    A settings file of an older version (inside ``.gittools/sitdown``) is copied, never moved: that folder may be a
    link to a copy of the tool that other repositories share, so deleting from it is left to the user.
    """
    path, legacy = root / CONFIG_FILE, root / LEGACY_CONFIG_FILE
    names = {"old": LEGACY_CONFIG_FILE, "new": CONFIG_FILE}
    if path.exists():
        print(say("ok", f"{CONFIG_FILE} (kept)"))
        notes = [say("note", NOTE_LEGACY_CONFIG_IGNORED.format(**names))] if legacy.is_file() else []
        return False, notes
    if legacy.is_file():
        path.write_bytes(legacy.read_bytes())
        print(say("added", f"{CONFIG_FILE} (copied from {LEGACY_CONFIG_FILE})"))
        return True, [say("note", NOTE_LEGACY_CONFIG_COPIED.format(**names))]
    path.write_text(CONFIG_TEXT, encoding="utf-8", newline="\n")
    print(say("added", CONFIG_FILE))
    return True, []


def install_git_config(root: Path) -> bool:
    """Set the local config keys the hooks and the alias use; return whether anything changed."""
    wanted = {
        "sitdown.python": Path(sys.executable).as_posix(),
        "sitdown.tool": installed_copy(root).as_posix(),
    }
    changed = False
    for key, value in wanted.items():
        if git(root, "config", "--local", "--get", key, check=False).stdout.strip() == value:
            print(say("ok", f"git config {key} (unchanged)"))
        else:
            git(root, "config", "--local", key, value)
            print(say("set", f"git config {key} = {value}"))
            changed = True
    machine = git(root, "config", "--get", "sitdown.machine", check=False).stdout.strip()
    if machine:
        print(say("ok", f"machine name {machine!r}; each machine needs its own name"))
    else:
        git(root, "config", "--local", "sitdown.machine", platform.node())
        print(say("set", f"machine name {platform.node()!r}; each machine needs its own name (sitdown.machine)"))
        changed = True
    return changed


def install_alias(root: Path, *, force: bool) -> bool:
    """Write or repair ``git sitdown``; an alias that is not ours is kept unless ``force``. Returns whether it changed."""
    command = f'!"{Path(sys.executable).as_posix()}" "{installed_copy(root).as_posix()}" {ALIAS}'
    key = f"alias.{ALIAS}"
    existing = git(root, "config", "--local", "--get", key, check=False)
    current = existing.stdout.strip()
    if existing.returncode == 0:
        if current == command:
            print(say("ok", f"git alias {ALIAS} (unchanged)"))
            return False
        if "sitdown.py" not in current and not force:
            print(say("kept", f"git alias {ALIAS} is not ours ({current}); use --force to replace it"))
            return False
    git(root, "config", "--local", key, command)
    print(say("updated" if existing.returncode == 0 else "added", f"git alias: git {ALIAS}"))
    return True


# --- Syncthing's ignore rules, read the way Syncthing reads them --------------------------------------------------


@dataclass(frozen=True)
class IgnoreRule:
    """One pattern of a ``.stignore`` file, after ``#include`` has been expanded."""

    pattern: re.Pattern[str]
    negated: bool
    text: str  # the line as written
    source: Path  # the file it came from
    line: int  # its line number there


def glob_to_regex(pattern: str, ignore_case: bool) -> re.Pattern[str]:
    """Translate a Syncthing pattern (without prefixes) into a regular expression for a whole relative path.

    A leading ``/`` anchors the pattern at the folder root; any other pattern matches at any depth. ``**`` matches
    anything, ``/`` included; ``*`` and ``?`` stay within one path part; ``[...]`` is a character class and ``{a,b}``
    an alternation. (``fnmatch.translate`` is not used: its ``*`` crosses ``/``.)
    """
    anchored = pattern.startswith("/")
    if anchored:
        pattern = pattern[1:]
    parts: list[str] = []
    depth = 0
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if pattern.startswith("**/", index):
            parts.append("(?:.*/)?")
            index += 3
            continue
        if pattern.startswith("**", index):
            parts.append(".*")
            index += 2
            continue
        index += 1
        if char == "*":
            parts.append("[^/]*")
        elif char == "?":
            parts.append("[^/]")
        elif char == "[" and (end := pattern.find("]", index + 1)) != -1:
            body = pattern[index:end].replace("\\", "\\\\")
            parts.append("[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
            index = end + 1
        elif char == "{":
            depth += 1
            parts.append("(?:")
        elif char == "}" and depth:
            depth -= 1
            parts.append(")")
        elif char == "," and depth:
            parts.append("|")
        elif char == "\\" and index < len(pattern):
            parts.append(re.escape(pattern[index]))
            index += 1
        else:
            parts.append(re.escape(char))
    parts.append(")" * depth)
    prefix = "" if anchored else "(?:.*/)?"
    return re.compile(f"^{prefix}{''.join(parts)}$", re.IGNORECASE if ignore_case else 0)


def ignore_rules(stignore: Path) -> tuple[list[IgnoreRule], list[str]]:
    """Read ``stignore`` with its ``#include`` files expanded in place; return the rules and the notes.

    Empty lines and ``//`` comments are skipped. An include is relative to the folder of the file that holds it, and a
    file already read is skipped, so loops end. A missing include or an unknown ``#`` directive gives a note and the
    reading goes on. The prefixes ``!``, ``(?i)`` and ``(?d)`` are read in any order. Nothing is written.
    """
    rules: list[IgnoreRule] = []
    notes: list[str] = []
    seen: set[Path] = set()

    def read(path: Path) -> None:
        seen.add(path.resolve())
        try:
            lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        except OSError as error:
            notes.append(f"Syncthing ignore rules: cannot read {path.as_posix()}: {error}")
            return
        for number, raw in enumerate(lines, start=1):
            text = raw.strip()
            if not text or text.startswith("//"):
                continue
            where = f"{path.as_posix()} line {number}"
            if text.startswith("#include"):
                target = path.parent / text[len("#include") :].strip()
                if target.resolve() in seen:
                    continue
                if not target.is_file():
                    notes.append(f"Syncthing ignore rules: {where}: the included file {target.name} is not found")
                    continue
                read(target)
                continue
            if text.startswith("#"):
                notes.append(f"Syncthing ignore rules: {text!r} ({where}) is skipped; this check may be inexact")
                continue
            negated = ignore_case = False
            body = text
            while True:
                if body.startswith("!"):
                    negated, body = True, body[1:]
                elif body.startswith("(?i)"):
                    ignore_case, body = True, body[4:]
                elif body.startswith("(?d)"):
                    body = body[4:]
                else:
                    break
            if body:
                rules.append(IgnoreRule(glob_to_regex(body, ignore_case), negated, text, path, number))

    read(stignore)
    return rules, notes


def first_match(rules: Sequence[IgnoreRule], path: str) -> IgnoreRule | None:
    """Return the first rule that matches ``path``: Syncthing lets the first match decide."""
    return next((rule for rule in rules if rule.pattern.match(path)), None)


def is_ignored(rules: Sequence[IgnoreRule], path: str) -> IgnoreRule | None:
    """Return the rule that makes Syncthing ignore ``path`` (or a folder above it), or ``None`` if it is not ignored."""
    parts = path.split("/")
    for count in range(1, len(parts) + 1):
        rule = first_match(rules, "/".join(parts[:count]))
        if rule is not None and not rule.negated:
            return rule
    return None


def stignore_notes(root: Path) -> list[str]:
    """Return the notes about Syncthing's ignore rules for this repository; empty when they are right.

    Syncthing must ignore ``.git`` at every depth (a link file of a worktree must not travel) and must carry
    ``.git-current``. The Syncthing folder is the nearest folder, from the root upwards, that holds ``.stfolder``; its
    ``.stignore`` is read, never changed.
    """
    sync = next((folder for folder in (root, *root.parents) if (folder / ".stfolder").exists()), None)
    if sync is None:
        return [say("note", NOTE_NO_STFOLDER)]
    stignore = sync / ".stignore"
    if not stignore.is_file():
        return [say("note", NOTE_NO_STIGNORE.format(folder=sync.as_posix()))]
    rules, notes = ignore_rules(stignore)
    place = "" if sync == root else root.relative_to(sync).as_posix() + "/"
    try:
        globs = read_config(root)
    except SitdownError:
        globs = list(DEFAULT_CHECKOUTS)
    problems: list[str] = []
    for folder in ["", *(pattern.replace("*", "x").replace("?", "x") + "/" for pattern in globs)]:
        git_link, record = f"{place}{folder}.git", f"{place}{folder}{RECORD_FILE}"
        if is_ignored(rules, git_link) is None:
            decided = first_match(rules, git_link)
            why = (
                f'by "{decided.text}" ({decided.source.as_posix()} line {decided.line})'
                if decided
                else "no line matches"
            )
            problems.append(
                f"Syncthing ignore rules: {git_link} is not ignored ({why}); add the line .git to {stignore.as_posix()}"
            )
        hiding = is_ignored(rules, record)
        if hiding is not None:
            problems.append(
                f'Syncthing ignore rules: {record} is ignored by "{hiding.text}" ({hiding.source.as_posix()} line '
                f"{hiding.line}); Syncthing must carry it"
            )
    settings = f"{place}{CONFIG_FILE}"
    hiding = is_ignored(rules, settings)
    if hiding is not None:
        problems.append(
            f'Syncthing ignore rules: {settings} is ignored by "{hiding.text}" ({hiding.source.as_posix()} line '
            f"{hiding.line}); Syncthing must carry it, so that both machines use the same settings"
        )
    return [say("note", message) for message in [*notes, *problems]]


# --- What install finds, and what it says -------------------------------------------------------------------------


def records_found(root: Path) -> list[str]:
    """Read the records of every checkout (reading only) and return the lines that tell what to do next.

    Records from another machine that this machine has not followed give ``Next: git sitdown``; a record that names
    this machine but a commit unknown here gives a note about the machine name; no record at all gives
    ``Next: git sitdown done``.
    """
    try:
        checkouts = find_checkouts(root, read_config(root))
    except SitdownError as error:
        return [say("note", f"cannot look for records: {error}")]
    machine = machine_name(root)
    waiting: list[str] = []
    senders: list[str] = []
    clash = False
    recorded = 0
    for checkout in checkouts:
        if checkout.kind == "repository":
            continue
        try:
            record = read_record(checkout.path, root)
        except SitdownError:
            continue
        if record is None:
            continue
        recorded += 1
        if record.machine == machine:
            missing = record.head and git(root, "cat-file", "-e", f"{record.head}^{{commit}}", check=False).returncode
            clash = clash or bool(missing)
            continue
        seen = read_seen(checkout.path) if checkout.kind in ("root", "registered") else None
        if not record.same_as(seen):
            waiting.append(checkout.label)
            if record.machine not in senders:
                senders.append(record.machine)
    lines = []
    if clash:
        lines.append(say("note", NOTE_SAME_NAME.format(name=machine)))
    if waiting:
        count = f"{len(waiting)} checkout" + ("" if len(waiting) == 1 else "s")
        lines.append(f"Next: git sitdown   (records from {', '.join(senders)} are waiting: {count})")
    elif not recorded:
        lines.append(NEXT_FIRST_RECORDS)
    return lines


def command_install(start: Path, force: bool, alias: bool) -> int:
    """Install the tool for this machine in the repository containing ``start``; safe to repeat.

    Everything written inside the working tree is fixed text and is left alone when already right, so installing on the
    second machine writes nothing that Syncthing would carry. No record is written.

    Returns
    -------
    int
        ``1`` if a foreign hook was kept (its line to add was printed), else ``0``.
    """
    root = root_checkout(start)
    notes: list[str] = []
    if (root / LEGACY_RECORD_FILE).exists():
        notes.append(say("note", NOTE_LEGACY_RECORD.format(old=LEGACY_RECORD_FILE)))
    changed = install_copy(root)
    hooks_changed, foreign = install_hooks(root)
    changed |= hooks_changed
    changed |= install_excludes(root)
    config_changed, config_notes = install_config_file(root)
    changed |= config_changed
    notes += config_notes
    changed |= install_git_config(root)
    if alias:
        changed |= install_alias(root, force=force)
    hooks = git_path(root, "hooks")
    if is_shared_folder(root, hooks):
        notes.append(say("note", NOTE_HOOKS_IN_TREE.format(folder=hooks.as_posix())))
    else:
        for folder in sorted(entry for entry in root.iterdir() if entry.is_dir() and entry.name != ".git"):
            hook = folder / "post-commit"
            if hook.is_file() and is_our_hook(hook.read_text(encoding="utf-8", errors="replace")):
                notes.append(say("note", NOTE_UNUSED_HOOKS.format(folder=folder.as_posix(), used=hooks.as_posix())))
                break
    notes += stignore_notes(root)
    if notes:
        print("\n".join(notes))
    print("\nInstalled." if changed else "\nNothing changed: already installed and up to date.")
    lines = records_found(root)
    if lines:
        print("\n".join(lines))
    return 1 if foreign else 0


def command_uninstall(start: Path, shared: bool) -> int:
    """Remove this machine's hooks, alias, installed copy and config keys; keep the records and shared files.

    Hooks inside the working tree are synced to the other machine, so they are removed only with ``shared``.
    """
    root = root_checkout(start)
    hooks = git_path(root, "hooks")
    for name in HOOK_NAMES:
        path = hooks / name
        if not path.is_file():
            continue
        if not is_our_hook(path.read_text(encoding="utf-8", errors="replace")):
            print(say("kept", f"hook {name}: {path.as_posix()} is not ours"))
        elif is_shared_folder(root, hooks) and not shared:
            print(say("kept", f"hook {name}: {path.as_posix()} is carried to the other machine; --shared removes it"))
        else:
            path.unlink()
            print(say("removed", f"hook {name}: {path.as_posix()}"))
    key = f"alias.{ALIAS}"
    value = git(root, "config", "--local", "--get", key, check=False).stdout.strip()
    if "sitdown.py" in value:
        git(root, "config", "--local", "--unset", key)
        print(say("removed", f"git alias {ALIAS}"))
    copy = installed_copy(root)
    if copy.exists():
        copy.unlink()
        for folder in (copy.parent / "attach", copy.parent):
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
        print(say("removed", f"installed copy {copy.as_posix()}"))
    for name in ("sitdown.python", "sitdown.tool"):
        if git(root, "config", "--local", "--get", name, check=False).returncode == 0:
            git(root, "config", "--local", "--unset", name)
            print(say("removed", f"git config {name}"))
    print(
        "Left in place: the records, the seen records, sitdown.machine, the exclude lines, "
        f"{CONFIG_FILE} and the backup refs."
    )
    return 0


# --------------------------------------------------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    """Return the command-line parser."""
    parser = argparse.ArgumentParser(prog="sitdown.py", description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--repo", type=Path, default=Path.cwd(), help="a path inside the repository (default: current directory)"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    record = sub.add_parser("record", help="write the record of this checkout (the hooks call this)")
    record.add_argument("--event", required=True, help="what triggered it, for example post-commit")
    install = sub.add_parser("install", help="install the hooks, the alias and the config keys on this machine")
    install.add_argument("--force", action="store_true", help="replace a git alias that is not ours")
    install.add_argument("--no-alias", dest="alias", action="store_false", help="do not install the git alias")
    uninstall = sub.add_parser("uninstall", help="remove this machine's hooks, alias and installed copy")
    uninstall.add_argument("--shared", action="store_true", help="also remove hooks that sit in the working tree")
    sitdown = sub.add_parser("sitdown", help="arrive: follow the records; or leave (done); or look (status)")
    sitdown.add_argument("action", nargs="?", choices=("done", "status"), help="default: arrive")
    sitdown.add_argument("--remote", default="origin", help="the remote the history travels through (default: origin)")
    sitdown.add_argument("--dry-run", action="store_true", help="with done: show what would be pushed, change nothing")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command line and return the exit status."""
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")  # type: ignore[union-attr]  # a branch name may not fit the console
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "sitdown" and args.dry_run and args.action != "done":
        parser.error("--dry-run is only valid with done")
    try:
        if args.command == "sitdown":
            if args.action == "status":
                return command_sitdown_status(args.repo, args.remote)
            if args.action == "done":
                return command_done(args.repo, args.remote, args.dry_run)
            return command_sitdown(args.repo, args.remote)
        if args.command == "install":
            return command_install(args.repo, args.force, args.alias)
        if args.command == "uninstall":
            return command_uninstall(args.repo, args.shared)
        return command_record(args.repo, args.event)
    except SitdownError as error:
        print(f"sitdown: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
