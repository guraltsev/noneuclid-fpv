"""The knowledge branch: an orphan Git branch checked out as a worktree, with a lock, note and event files, and commits.

This is the only module that runs Git (``coding_style.md``). It imports ``notes``, ``events`` and ``config``. Key
invariants: every change of the worktree happens under the exclusive file lock; every note version that an event records
is a blob that exists in the branch history (uncommitted outside edits are committed first, design section 5.4); a failed
write raises and is never reported as saved.

Paths are relative to the repository root unless a name says otherwise. Timestamps come in as parameters.
"""

from __future__ import annotations

import datetime as dt
import random
import re
import subprocess
import sys
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import IO, Any

from project_knowledge.config import (
    DEFAULT_BRANCH,
    DEFAULT_CONFIG_TOML,
    DEFAULT_README,
    DEFAULT_WORKTREE,
    ConfigError,
    load_config,
)
from project_knowledge.events import (
    Event,
    EventContext,
    append_events,
    find_write_by_key,
    new_event,
    session_log_path,
)
from project_knowledge.notes import (
    NOTE_ID_PATTERN,
    Duplicate,
    Note,
    NoteError,
    VersionedNote,
    check_status_change,
    clean_reason,
    format_timestamp,
    parse_note,
    prepare_note,
    render_note,
)

MINIMUM_GIT = (2, 42)  # ``git worktree add --orphan`` first shipped in Git 2.42
LOCK_TIMEOUT_SECONDS = 10.0  # the default of ``git.lock_timeout_seconds``
CHANGED_FILES_LIMIT = 30  # files named in a brief query; more would drown the prompt text in path words
OWN_FOLDERS = (".agents/knowledge.d/", ".agents/.state/")
RECENT_COMMITS = 3  # the brief looks at files changed in this many latest commits (design section 7.2)

DuplicateCheck = Callable[[Note, Sequence[VersionedNote]], Sequence[Duplicate]]


class StoreError(RuntimeError):
    """The knowledge branch cannot be used: Git failed, the worktree is missing, or a precondition does not hold."""


class LockTimeoutError(StoreError):
    """Another process holds the knowledge lock and did not release it within the timeout."""


class NoChangeError(NoteError):
    """A curator action would leave the note as it is (``curate_note``); the caller may record that it was tried."""


class NoteNotFoundError(StoreError):
    """No note has the requested ID on the knowledge branch."""


@dataclass(frozen=True)
class KnowledgeBranch:
    """Where the knowledge branch lives for one repository: its worktree, its state folder and its branch name."""

    root: Path
    worktree: Path
    state_dir: Path
    branch: str = DEFAULT_BRANCH

    @property
    def notes_dir(self) -> Path:
        """The folder of note files inside the worktree."""
        return self.worktree / "notes"

    @property
    def events_dir(self) -> Path:
        """The folder of event files inside the worktree."""
        return self.worktree / "events"

    @property
    def config_path(self) -> Path:
        """The ``config.toml`` on the branch."""
        return self.worktree / "config.toml"

    @property
    def lock_path(self) -> Path:
        """The lock file that serialises every write and commit."""
        return self.state_dir / "lock"

    @property
    def embeddings_path(self) -> Path:
        """The derived embedding cache (never committed)."""
        return self.state_dir / "embeddings.npz"

    @property
    def models_dir(self) -> Path:
        """Where the embedding model files are cached (never committed)."""
        return self.state_dir / "models"


@dataclass(frozen=True)
class InitResult:
    """What ``init_branch`` did: ``created`` a new branch, ``attached`` an existing one, or found it ``exists``."""

    status: str
    branch: KnowledgeBranch


@dataclass(frozen=True)
class LoadedNotes:
    """The notes of the branch with their versions, and one line per note file that could not be read."""

    notes: list[VersionedNote]
    problems: list[str]


@dataclass(frozen=True)
class WriteResult:
    """The outcome of a write: ``written``, ``revised``, ``unchanged``, ``existing`` (a retried key) or ``duplicate``.

    ``note`` and ``version`` are set unless the status is ``duplicate``, in which case nothing was saved and
    ``duplicates`` lists the notes the request probably repeats.
    """

    status: str
    note: Note | None
    version: str | None
    duplicates: tuple[Duplicate, ...] = ()
    redacted: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ChangeResult:
    """A note after a status change or a curation: the note, its new version, the version and status before, the commit."""

    note: Note
    version: str
    previous_version: str
    commit: str | None
    previous_status: str


@dataclass(frozen=True)
class RepositoryContext:
    """What the code repository looks like now: the checked-out branch and recently changed files."""

    branch: str
    changed_files: tuple[str, ...]


# ---------------------------------------------------------------------------------------------------------------------
# Locating, initialising and attaching


def locate(root: Path) -> KnowledgeBranch:
    """Return the paths of the knowledge branch for the repository at ``root``, without touching the disk."""
    root = root.resolve()
    return KnowledgeBranch(
        root=root, worktree=root / DEFAULT_WORKTREE, state_dir=root / ".agents" / ".state" / "knowledge"
    )


def open_branch(root: Path) -> KnowledgeBranch:
    """Return the knowledge branch of ``root`` after checking that its worktree exists, else tell the user to init."""
    branch = locate(root)
    if not (branch.worktree / ".git").exists():
        raise StoreError(f"no knowledge worktree at {branch.worktree}; run `knowledge init` first")
    return branch


def init_branch(root: Path) -> InitResult:
    """Create the orphan ``knowledge`` branch and its worktree, or attach to an existing branch (a fresh clone).

    A new branch gets ``config.toml`` and ``README.md`` and one commit. Running it again changes nothing, except that
    it completes a first run that was interrupted before that commit.

    Raises
    ------
    StoreError
        If ``root`` is not the top of a Git repository, Git is older than 2.42 and a new branch is needed, the
        worktree path holds something else, or Git fails.
    """
    branch = locate(root)
    _require_repository_top(branch.root)
    branch.state_dir.mkdir(parents=True, exist_ok=True)

    if (branch.worktree / ".git").exists():
        # A first init that stopped after creating the worktree has no commit yet: finish it.
        if run_git(["rev-parse", "--verify", "-q", "HEAD"], branch.worktree, check=False).returncode != 0:
            _commit_defaults(branch)
            return InitResult("created", branch)
        return InitResult("exists", branch)
    if branch.worktree.exists() and any(branch.worktree.iterdir()):
        raise StoreError(f"{branch.worktree} exists and is not a knowledge worktree; move it away and run init again")

    # Forget worktrees whose folders were deleted, so their branch is free to be checked out again.
    run_git(["worktree", "prune"], branch.root)
    if (
        run_git(["show-ref", "--verify", "--quiet", f"refs/heads/{branch.branch}"], branch.root, check=False).returncode
        == 0
    ):
        run_git(["worktree", "add", str(branch.worktree), branch.branch], branch.root)
        return InitResult("attached", branch)
    remotes = run_git(["for-each-ref", "--format=%(refname)", f"refs/remotes/*/{branch.branch}"], branch.root).stdout
    if remotes.strip():
        run_git(["worktree", "add", "--guess-remote", str(branch.worktree), branch.branch], branch.root)
        return InitResult("attached", branch)

    # No branch anywhere: create it as an orphan with the default files.
    _require_git_version(branch.root)
    run_git(["worktree", "add", "--orphan", "-b", branch.branch, str(branch.worktree)], branch.root)
    _commit_defaults(branch)
    return InitResult("created", branch)


def _commit_defaults(branch: KnowledgeBranch) -> None:
    """Write the default ``config.toml`` and ``README.md`` where missing and make the first commit of the branch."""
    for name, text in (("config.toml", DEFAULT_CONFIG_TOML), ("README.md", DEFAULT_README)):
        if not (branch.worktree / name).exists():
            (branch.worktree / name).write_text(text, encoding="utf-8", newline="\n")
    with branch_lock(branch):
        _commit(branch, "init knowledge branch", ["config.toml", "README.md"])


def project_id(root: Path) -> str:
    """Return the project's identity: the hash of its first commit, or ``path:<root>`` when it has no commits yet."""
    roots = run_git(["rev-list", "--max-parents=0", "HEAD"], root.resolve(), check=False)
    first = sorted(roots.stdout.split())
    return first[0] if roots.returncode == 0 and first else f"path:{root.resolve().as_posix()}"


def repository_context(root: Path) -> RepositoryContext:
    """Return the checked-out branch of the code repository and files changed in the working tree or recent commits.

    Both are empty when ``root`` has no commits or is not a repository, so a brief can always be built.
    """
    root = root.resolve()
    name = run_git(["symbolic-ref", "--short", "-q", "HEAD"], root, check=False).stdout.strip()

    # Working-tree changes first (the most relevant), then the files of the latest commits, without repeats.
    files: dict[str, None] = {}
    status = run_git(["status", "--porcelain", "--untracked-files=all"], root, check=False)
    for line in status.stdout.splitlines():
        if len(line) > 3:
            files[line[3:].split(" -> ")[-1].strip('"')] = None
    # The tool's own folders are not part of the work the notes are about.
    files = {name: None for name in files if not name.startswith(OWN_FOLDERS)}
    log = run_git(["log", "-n", str(RECENT_COMMITS), "--name-only", "--pretty=format:"], root, check=False)
    for line in log.stdout.splitlines():
        if line.strip() and not line.strip().startswith(OWN_FOLDERS):
            files[line.strip()] = None
    return RepositoryContext(branch=name, changed_files=tuple(files)[:CHANGED_FILES_LIMIT])


# ---------------------------------------------------------------------------------------------------------------------
# Reading notes


def load_notes(branch: KnowledgeBranch) -> LoadedNotes:
    """Return every readable note with its version, after committing any outside edits so versions exist in history."""
    with branch_lock(branch):
        _commit_external_edits(branch)
        return _load_committed_notes(branch)


def read_note(branch: KnowledgeBranch, note_id: str) -> VersionedNote:
    """Return one note and its version (the blob hash of its committed file), committing outside edits first.

    Raises
    ------
    NoteNotFoundError
        If no note file has that ID (or the ID is malformed).
    NoteError
        If the note file exists but is invalid.
    """
    with branch_lock(branch):
        return _read_locked(branch, note_id)


def _read_locked(branch: KnowledgeBranch, note_id: str) -> VersionedNote:
    """``read_note`` for a caller that already holds the lock (the lock is not re-entrant)."""
    if not NOTE_ID_PATTERN.fullmatch(note_id):
        raise NoteNotFoundError(f"{note_id!r} is not a note id (they look like K-20261101-7f3a)")
    _commit_external_edits(branch)
    path = branch.notes_dir / f"{note_id}.md"
    if not path.is_file():
        raise NoteNotFoundError(f"no note {note_id} on the knowledge branch")
    version = run_git(["rev-parse", f"HEAD:notes/{note_id}.md"], branch.worktree).stdout.strip()
    return VersionedNote(parse_note(path.read_text(encoding="utf-8")), version)


# ---------------------------------------------------------------------------------------------------------------------
# Writing notes and events


def write_note(
    branch: KnowledgeBranch,
    payload: Mapping[str, object],
    *,
    context: EventContext,
    now: dt.datetime,
    redact_secrets: bool,
    max_summary_tokens: int,
    check_duplicates: DuplicateCheck | None = None,
    allow_duplicate: bool = False,
    idempotency_key: str | None = None,
    rng: random.Random | None = None,
) -> WriteResult:
    """Validate a write request, save it as a note (new, or a revision when it has an ``id``) and commit it.

    The whole operation runs under the lock. With an ``idempotency_key`` that an earlier write used, nothing is written
    and that note is returned with status ``existing``. A new note that ``check_duplicates`` flags is not saved unless
    ``allow_duplicate`` is true; the status is then ``duplicate``. A revision that changes nothing has status
    ``unchanged``. Otherwise the note file and a ``written`` or ``revised`` event are committed together, one commit
    ``write K-…`` (or ``revise K-…``) that also carries any pending event files.

    Raises
    ------
    NoteError
        If the request is invalid or contains a credential that cannot be redacted.
    StoreError
        If Git or the lock fails.
    """
    with branch_lock(branch):
        _commit_external_edits(branch)

        # A retried write returns the note the first attempt saved.
        if idempotency_key is not None:
            earlier = find_write_by_key(branch.events_dir, idempotency_key)
            if earlier is not None and earlier.note_id is not None:
                path = branch.notes_dir / f"{earlier.note_id}.md"
                if path.is_file():
                    version = run_git(["rev-parse", f"HEAD:notes/{earlier.note_id}.md"], branch.worktree).stdout.strip()
                    return WriteResult("existing", parse_note(path.read_text(encoding="utf-8")), version)

        # Validate against the notes that exist, and look for probable duplicates before anything is saved.
        loaded = _load_committed_notes(branch)
        prepared = prepare_note(
            payload,
            existing_notes={versioned.note.id: versioned.note for versioned in loaded.notes},
            taken_ids={file.stem for file in branch.notes_dir.glob("*.md")},  # includes damaged note files
            runtime=context.runtime,
            model=context.model,
            now=now,
            redact_secrets=redact_secrets,
            max_summary_tokens=max_summary_tokens,
            rng=rng,
        )
        note = prepared.note
        if not prepared.revised and check_duplicates is not None and not allow_duplicate:
            duplicates = tuple(check_duplicates(note, loaded.notes))
            if duplicates:
                return WriteResult("duplicate", None, None, duplicates, prepared.redacted, prepared.warnings)

        # A revision that changes no field is not a revision, whatever the time: nothing is saved, and the stored note
        # (with its old ``updated_at``) is returned.
        if prepared.revised and not prepared.changed:
            stored = next(versioned for versioned in loaded.notes if versioned.note.id == note.id)
            return WriteResult("unchanged", stored.note, stored.version, (), prepared.redacted, prepared.warnings)

        # Save the file, then pin its version from the index so the event names the exact committed blob.
        text = render_note(note)
        path = branch.notes_dir / f"{note.id}.md"
        events_file = session_log_path(branch.events_dir, context.runtime, context.session_id, now)
        # If saving fails at any step (a Git error or any other exception), the note file and the event file are put
        # back as they were, so a failed write leaves nothing that a later commit would present as saved.
        before = {file: file.read_bytes() if file.is_file() else None for file in (path, events_file)}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
            run_git(["add", "--", f"notes/{note.id}.md"], branch.worktree)
            version = run_git(["rev-parse", f":notes/{note.id}.md"], branch.worktree).stdout.strip()

            # One commit holds the note, its event and any other pending events.
            data: dict[str, Any] = {}
            if idempotency_key is not None:
                data["idempotency_key"] = idempotency_key
            if prepared.revised:
                data["changed"] = list(prepared.changed)
            if prepared.redacted:
                data["redacted"] = list(prepared.redacted)
            event = new_event(
                "revised" if prepared.revised else "written",
                context,
                now=now,
                note_id=note.id,
                note_version=version,
                data=data,
                rng=rng,
            )
            append_events(branch.events_dir, [event], now=now)
            verb = "revise" if prepared.revised else "write"
            _commit(branch, f"{verb} {note.id}", [f"notes/{note.id}.md", "events"])
            return WriteResult(
                "revised" if prepared.revised else "written", note, version, (), prepared.redacted, prepared.warnings
            )
        except Exception:
            _restore(branch, before)
            raise


def change_status(
    branch: KnowledgeBranch,
    note_id: str,
    status: str,
    *,
    reason: str,
    context: EventContext,
    now: dt.datetime,
    expected_version: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> ChangeResult:
    """Move a note to ``status`` (design 11.1): one commit ``status K-…`` and one ``status_changed`` event with the reason.

    The event holds ``from``, ``to``, ``reason`` (one line, secret-scanned), ``previous_version`` and the ``details`` it
    is given, and pins the new version of the note. With ``expected_version`` the change is refused if the note is no
    longer that version (a curator's decision was made on older text).

    Raises
    ------
    NoteError
        If the transition is not allowed, the reason is empty, or the version is not the expected one.
    NoteNotFoundError
        If there is no such note.
    """
    reason = clean_reason(reason)
    with branch_lock(branch):
        previous = _read_locked(branch, note_id)
        _check_version(previous, expected_version)
        check_status_change(previous.note.status, status)
        note = replace(previous.note, status=status, updated_at=format_timestamp(now))
        data = {"from": previous.note.status, "to": status, "reason": reason, "previous_version": previous.version}
        message = f"status {note_id} {previous.note.status} -> {status}: {reason[:100]}"
        return _save_change(
            branch, previous, note, "status_changed", {**(details or {}), **data}, context, now, message
        )


def curate_note(
    branch: KnowledgeBranch,
    note_id: str,
    changes: Mapping[str, object],
    *,
    action: str,
    reason: str,
    context: EventContext,
    now: dt.datetime,
    redact_secrets: bool,
    max_summary_tokens: int,
    expected_version: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> ChangeResult:
    """Change fields of a note as a curator action (design 11.2): one commit ``curate <action> K-…`` and one ``curated`` event.

    ``changes`` are write-request fields (``summary``, ``tags``, ``related``), validated and secret-scanned like a
    revision. The event holds ``action``, ``reason``, ``changed`` (field names), ``previous_version`` and the ``details``
    it is given; the old text stays in the history of the branch, not in the event.

    Raises
    ------
    NoteError
        If a change is invalid, nothing would change, the reason is empty, or the version is not the expected one.
    NoteNotFoundError
        If there is no such note.
    """
    reason = clean_reason(reason)
    with branch_lock(branch):
        previous = _read_locked(branch, note_id)
        _check_version(previous, expected_version)
        prepared = prepare_note(
            {"id": note_id, **changes},
            existing_notes={note_id: previous.note},
            runtime=context.runtime,
            model=context.model,
            now=now,
            redact_secrets=redact_secrets,
            max_summary_tokens=max_summary_tokens,
        )
        if not prepared.changed:
            raise NoChangeError(f"{action} would not change {note_id}")
        data = {
            "action": action,
            "reason": reason,
            "changed": list(prepared.changed),
            "previous_version": previous.version,
        }
        message = f"curate {action} {note_id}: {reason[:100]}"
        return _save_change(
            branch, previous, prepared.note, "curated", {**(details or {}), **data}, context, now, message
        )


def record_curation_skip(
    branch: KnowledgeBranch,
    note_id: str,
    *,
    action: str,
    reason: str,
    context: EventContext,
    now: dt.datetime,
    expected_version: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> str | None:
    """Record that a curator ``action`` was tried on a note and changed nothing: a ``curated`` event with ``changed: []``.

    The note is not touched. Only the event file is committed (``curate <action> K-…: <reason>``) and the commit hash is
    returned. The event moves the evidence boundary of the note (``curate.analyse``), so the finding that led to the
    action is not raised again until new sessions give new evidence, and it keeps what the attempt cost.

    Raises
    ------
    NoteError
        If the reason is empty or the note is not the expected version.
    NoteNotFoundError
        If there is no such note.
    """
    reason = clean_reason(reason)
    with branch_lock(branch):
        previous = _read_locked(branch, note_id)
        _check_version(previous, expected_version)
        events_file = session_log_path(branch.events_dir, context.runtime, context.session_id, now)
        before = {events_file: events_file.read_bytes() if events_file.is_file() else None}
        data = {
            **(details or {}),
            "action": action,
            "reason": reason,
            "changed": [],
            "previous_version": previous.version,
        }
        try:
            event = new_event("curated", context, now=now, note_id=note_id, note_version=previous.version, data=data)
            append_events(branch.events_dir, [event], now=now)
            return _commit(branch, f"curate {action} {note_id}: {reason[:100]}", ["events"])
        except Exception:
            _restore(branch, before)
            raise


def _check_version(previous: VersionedNote, expected: str | None) -> None:
    if expected is not None and previous.version != expected:
        raise NoteError(f"{previous.note.id} changed since the decision was made (version {previous.version})")


def _save_change(
    branch: KnowledgeBranch,
    previous: VersionedNote,
    note: Note,
    kind: str,
    data: Mapping[str, Any],
    context: EventContext,
    now: dt.datetime,
    message: str,
) -> ChangeResult:
    """Write the changed note, pin its new version in an event, and commit both; the lock must be held."""
    path = branch.notes_dir / f"{note.id}.md"
    events_file = session_log_path(branch.events_dir, context.runtime, context.session_id, now)
    before = {file: file.read_bytes() if file.is_file() else None for file in (path, events_file)}
    try:
        path.write_text(render_note(note), encoding="utf-8", newline="\n")
        run_git(["add", "--", f"notes/{note.id}.md"], branch.worktree)
        version = run_git(["rev-parse", f":notes/{note.id}.md"], branch.worktree).stdout.strip()
        event = new_event(kind, context, now=now, note_id=note.id, note_version=version, data=data)
        append_events(branch.events_dir, [event], now=now)
        commit = _commit(branch, message, [f"notes/{note.id}.md", "events"])
        return ChangeResult(note, version, previous.version, commit, previous.note.status)
    except Exception:
        _restore(branch, before)
        raise


def record_events(branch: KnowledgeBranch, events: Sequence[Event], *, now: dt.datetime) -> list[Event]:
    """Append events to their session files under the lock and return those written (idempotent keys deduplicated).

    The files are committed by the next ``write_note`` or by ``flush_events``.
    """
    with branch_lock(branch):
        return append_events(branch.events_dir, events, now=now)


def flush_events(branch: KnowledgeBranch) -> list[str]:
    """Commit every pending event file, one commit ``events <runtime>-<session>`` each, and return the commit hashes."""
    commits: list[str] = []
    with branch_lock(branch):
        status = run_git(["status", "--porcelain", "--untracked-files=all", "--", "events"], branch.worktree)
        for line in status.stdout.splitlines():
            relative = line[3:].strip('"')
            if not relative.endswith(".jsonl"):
                continue
            commit = _commit(branch, f"events {Path(relative).stem}", [relative])
            if commit is not None:
                commits.append(commit)
    return commits


# ---------------------------------------------------------------------------------------------------------------------
# The lock


def branch_lock(branch: KnowledgeBranch) -> AbstractContextManager[None]:
    """Hold the lock that serialises every write and commit of ``branch``.

    The wait is ``git.lock_timeout_seconds`` of the branch's ``config.toml``; a file that is absent or cannot be read
    gives the default (the command that needs the configuration reports the error itself).
    """
    try:
        timeout = load_config(branch.config_path).git.lock_timeout_seconds
    except ConfigError:
        timeout = LOCK_TIMEOUT_SECONDS
    return file_lock(branch.lock_path, timeout=timeout)


@contextmanager
def file_lock(
    path: Path,
    *,
    timeout: float | None = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> Iterator[None]:
    """Hold an exclusive lock on the file ``path`` for the duration of the ``with`` block.

    The lock is an operating-system byte-range lock (``msvcrt.locking`` on Windows, ``fcntl.flock`` elsewhere), so it
    is released if the process dies. Waiting retries every 50 ms until ``timeout`` seconds (default ``LOCK_TIMEOUT_SECONDS``) have passed on ``clock``.

    Raises
    ------
    LockTimeoutError
        If the lock is still held by someone else after ``timeout`` seconds.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        deadline = clock() + (LOCK_TIMEOUT_SECONDS if timeout is None else timeout)
        while True:
            try:
                _lock(handle)
                break
            except OSError:
                if clock() >= deadline:
                    raise LockTimeoutError(
                        f"another knowledge command holds the lock {path}; wait for it, or delete the file if no "
                        "command is running"
                    ) from None
                sleep(0.05)
        try:
            yield
        finally:
            _unlock(handle)


if sys.platform == "win32":
    import msvcrt

    def _lock(handle: IO[bytes]) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock(handle: IO[bytes]) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def _lock(handle: IO[bytes]) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock(handle: IO[bytes]) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


# ---------------------------------------------------------------------------------------------------------------------
# Git


def run_git(
    args: Sequence[str], cwd: Path, *, check: bool = True, config: Sequence[str] = ()
) -> subprocess.CompletedProcess[str]:
    """Run ``git <args>`` in ``cwd`` with an argument list (never a shell); raise ``StoreError`` on failure if ``check``.

    ``config`` is a list of ``key=value`` settings passed as ``-c`` options before the command.
    """
    command = ["git", *(part for setting in config for part in ("-c", setting)), *args]
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    except FileNotFoundError as error:
        raise StoreError("git is not installed or not on PATH") from error
    if check and result.returncode != 0:
        raise StoreError(f"git {' '.join(args)} failed: {(result.stderr or result.stdout).strip()}")
    return result


def _require_repository_top(root: Path) -> None:
    top = run_git(["rev-parse", "--show-toplevel"], root, check=False)
    if top.returncode != 0 or not Path(top.stdout.strip()).samefile(root):
        raise StoreError(f"{root} is not the top folder of a Git repository; pass the repository with --root")


def _require_git_version(cwd: Path) -> None:
    text = run_git(["--version"], cwd).stdout
    found = re.search(r"(\d+)\.(\d+)", text)
    if found is None or (int(found.group(1)), int(found.group(2))) < MINIMUM_GIT:
        raise StoreError(
            f"creating the knowledge branch needs Git {MINIMUM_GIT[0]}.{MINIMUM_GIT[1]} or later; found: {text.strip()}"
        )


def _commit(branch: KnowledgeBranch, message: str, paths: Sequence[str]) -> str | None:
    """Stage ``paths`` in the worktree and commit them; return the commit hash, or ``None`` if nothing changed.

    Automatic commits never run the user's hooks or signing, and use a fallback identity if Git has none.
    """
    run_git(["add", "--", *paths], branch.worktree)
    if not run_git(["diff", "--cached", "--name-only"], branch.worktree).stdout.strip():
        return None
    hooks = branch.state_dir / "no-hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    settings = [f"core.hooksPath={hooks.as_posix()}", "commit.gpgsign=false"]
    if run_git(["config", "user.email"], branch.worktree, check=False).returncode != 0:
        settings += ["user.name=knowledge", "user.email=knowledge@localhost"]
    run_git(["commit", "-q", "--no-verify", "-m", message], branch.worktree, config=settings)
    return run_git(["rev-parse", "HEAD"], branch.worktree).stdout.strip()


def _restore(branch: KnowledgeBranch, before: Mapping[Path, bytes | None]) -> None:
    """Put files back as they were (``None`` means they did not exist) and unstage them, after a failed write."""
    for file, content in before.items():
        if content is None:
            file.unlink(missing_ok=True)
        else:
            file.write_bytes(content)
    names = [file.relative_to(branch.worktree).as_posix() for file in before]
    run_git(["reset", "-q", "--", *names], branch.worktree, check=False)


def _commit_external_edits(branch: KnowledgeBranch) -> None:
    """Commit uncommitted changes to note files (hand edits) as one ``external edit`` commit; the lock must be held."""
    status = run_git(["status", "--porcelain", "--untracked-files=all", "--", "notes"], branch.worktree)
    ids = sorted({match.group(1) for match in re.finditer(r"notes/(K-[^/\s\"]+?)\.md", status.stdout)})
    if ids:
        _commit(branch, f"external edit {', '.join(ids)}", ["notes"])


def _load_committed_notes(branch: KnowledgeBranch) -> LoadedNotes:
    """Parse every note file and pair it with its blob hash in HEAD; the lock must be held and the notes committed."""
    listing = run_git(["ls-tree", "-r", "-z", "HEAD", "--", "notes/"], branch.worktree).stdout
    loaded: list[VersionedNote] = []
    problems: list[str] = []
    for entry in filter(None, listing.split("\0")):
        meta, _, name = entry.partition("\t")
        version = meta.split()[2]
        path = branch.worktree / name
        try:
            note = parse_note(path.read_text(encoding="utf-8"))
        except (NoteError, OSError, UnicodeDecodeError) as error:
            problems.append(f"{Path(name).name}: {error}")
            continue
        if f"notes/{note.id}.md" != name:
            problems.append(f"{Path(name).name}: the file name does not match the note id {note.id}")
            continue
        loaded.append(VersionedNote(note, version))
    return LoadedNotes(loaded, problems)
