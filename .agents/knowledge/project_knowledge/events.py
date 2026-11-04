"""Events: the record types and the per-session append-only JSONL log of design section 10.

This module imports only ``notes`` (for timestamp formatting) and never runs Git or starts processes. It writes and reads
files under an ``events/`` folder it is given; committing them is ``store``'s job. Key invariants: a line is never
rewritten (corrections are new events), an event about a delivered note carries the note's version, and an event with an
idempotency key in ``data`` is written at most once per session file.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from project_knowledge.notes import NOTE_ID_PATTERN, TIMESTAMP_PATTERN, format_timestamp

EVENT_TYPES = (
    "surfaced",
    "read",
    "read_failed",
    "written",
    "revised",
    "status_changed",
    "graded",
    "self_assessed",
    "session_usage",
    "curated",
    "selector_call",  # written by older versions; a brief selection is now a ``model_call``
    "model_call",
    "operational_error",
)
# These events describe a note that was shown or changed, so they pin the exact text with its blob hash (design 5.4).
VERSIONED_TYPES = ("surfaced", "read", "written", "revised", "graded")

RUNTIME_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
SESSION_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class EventError(ValueError):
    """An event, a session or runtime name, or an event line is invalid; the message says which."""


@dataclass(frozen=True)
class EventContext:
    """Who is acting: the runtime, the session, the project and optionally the model. Every event carries these."""

    runtime: str
    session_id: str
    project_id: str
    model: str | None = None


@dataclass(frozen=True)
class Event:
    """One event line (design section 10.1). ``data`` holds the type-specific fields and never note content."""

    event_id: str
    type: str
    ts: str
    runtime: str
    model: str | None
    session_id: str
    project_id: str
    note_id: str | None = None
    note_version: str | None = None
    data: Mapping[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------------------------------------------------
# Making and serialising events


def new_event(
    type: str,  # noqa: A002 - the field of the design's event line is called ``type``
    context: EventContext,
    *,
    now: dt.datetime,
    note_id: str | None = None,
    note_version: str | None = None,
    data: Mapping[str, Any] | None = None,
    rng: random.Random | None = None,
) -> Event:
    """Build an event of a known type for the acting context, stamped with ``now`` (timezone-aware).

    Raises
    ------
    EventError
        For an unknown type, an invalid runtime or session name, a malformed note ID, or a note event that lacks the
        note version it must carry.
    """
    if type not in EVENT_TYPES:
        raise EventError(f"unknown event type {type!r}; known: {', '.join(EVENT_TYPES)}")
    check_names(context.runtime, context.session_id)
    if note_id is not None and not NOTE_ID_PATTERN.fullmatch(note_id):
        raise EventError(f"invalid note id {note_id!r}")
    if type in VERSIONED_TYPES and (note_id is None or not note_version):
        raise EventError(f"a {type} event needs the note id and the note version (blob hash)")
    return Event(
        event_id=new_event_id(now, rng),
        type=type,
        ts=format_timestamp(now),
        runtime=context.runtime,
        model=context.model,
        session_id=context.session_id,
        project_id=context.project_id,
        note_id=note_id,
        note_version=note_version,
        data=dict(data or {}),
    )


def check_names(runtime: str, session_id: str) -> None:
    """Raise ``EventError`` unless the runtime and session names are safe to use in a file name."""
    if not RUNTIME_PATTERN.fullmatch(runtime):
        raise EventError(f"invalid runtime {runtime!r}: use lowercase letters, digits and '-'")
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise EventError(f"invalid session id {session_id!r}: use letters, digits, '.', '_' and '-'")


def new_event_id(now: dt.datetime, rng: random.Random | None = None) -> str:
    """Return a ULID: 26 Crockford base32 characters, 48 bits of milliseconds then 80 random bits, so IDs sort by time."""
    rng = rng or random.SystemRandom()
    milliseconds = int(now.timestamp() * 1000)
    value = (milliseconds << 80) | rng.getrandbits(80)
    return "".join(_CROCKFORD[(value >> shift) & 31] for shift in range(125, -1, -5))


def event_to_line(event: Event) -> str:
    """Serialise an event as one line of JSON (ASCII only, no trailing newline), keys in the order of design 10.1."""
    record = {
        "event_id": event.event_id,
        "type": event.type,
        "ts": event.ts,
        "runtime": event.runtime,
        "model": event.model,
        "session_id": event.session_id,
        "project_id": event.project_id,
        "note_id": event.note_id,
        "note_version": event.note_version,
        "data": dict(event.data),
    }
    return json.dumps(record)


def parse_event_line(line: str) -> Event:
    """Parse one event line, raising ``EventError`` if it is not valid JSON or lacks a required field."""
    try:
        record = json.loads(line)
    except json.JSONDecodeError as error:
        raise EventError(f"not valid JSON: {error}") from error
    if not isinstance(record, dict):
        raise EventError("an event line must be a JSON object")
    required = ("event_id", "type", "ts", "runtime", "session_id", "project_id")
    missing = [name for name in required if not isinstance(record.get(name), str)]
    if missing:
        raise EventError(f"missing field(s): {', '.join(missing)}")
    try:
        if not TIMESTAMP_PATTERN.fullmatch(record["ts"]):
            raise ValueError
        dt.datetime.strptime(record["ts"], "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise EventError(f"ts must be a UTC time like 2026-11-01T14:02:11Z; got {record['ts']!r}") from None
    data = record.get("data", {})
    if not isinstance(data, dict):
        raise EventError("data must be an object")
    return Event(
        event_id=record["event_id"],
        type=record["type"],
        ts=record["ts"],
        runtime=record["runtime"],
        model=record.get("model"),
        session_id=record["session_id"],
        project_id=record["project_id"],
        note_id=record.get("note_id"),
        note_version=record.get("note_version"),
        data=data,
    )


# ---------------------------------------------------------------------------------------------------------------------
# The log files


def session_log_path(events_root: Path, runtime: str, session_id: str, now: dt.datetime) -> Path:
    """Return ``events/YYYY/MM/<runtime>-<session-id>.jsonl``, reusing the file of an earlier month for a known session."""
    check_names(runtime, session_id)
    name = f"{runtime}-{session_id}.jsonl"
    earlier = sorted(events_root.glob(f"*/*/{name}")) if events_root.is_dir() else []
    if earlier:
        return earlier[0]
    moment = now.astimezone(dt.UTC)
    return events_root / f"{moment:%Y}" / f"{moment:%m}" / name


def _session_files(events_root: Path, runtime: str, session_id: str) -> list[Path]:
    """Return the files of one session under ``events/YYYY/MM/``, oldest month first."""
    name = f"{runtime}-{session_id}.jsonl"
    return sorted(events_root.glob(f"*/*/{name}")) if events_root.is_dir() else []


def append_events(events_root: Path, events: Iterable[Event], *, now: dt.datetime) -> list[Event]:
    """Append events to their session files and return the ones written; the caller holds the knowledge lock.

    An event whose ``data`` has an ``idempotency_key`` is skipped when any file of its session (the session's file of
    every month) already holds an event of the same type and key, so duplicate hook deliveries and retries that cross a
    month boundary leave one line. Files and folders are created as needed.
    """
    written: list[Event] = []
    for event in events:
        path = session_log_path(events_root, event.runtime, event.session_id, now)
        key = event.data.get("idempotency_key")
        if key is not None and any(
            _has_key(existing, event.type, key)
            for known in _session_files(events_root, event.runtime, event.session_id)
            for existing in _read_file(known)[0]
        ):
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(event_to_line(event) + "\n")
        written.append(event)
    return written


def load_events(events_root: Path) -> tuple[list[Event], list[str]]:
    """Read every event file under ``events_root``; return the events sorted by time (file order within a second) and a list of problem lines.

    A line that cannot be parsed is skipped and reported as ``<file>:<line number>: <reason>``, so one damaged line does
    not hide the rest.
    """
    events: list[Event] = []
    problems: list[str] = []
    for path in sorted(events_root.rglob("*.jsonl")) if events_root.is_dir() else []:
        found, bad = _read_file(path)
        events += found
        problems += [f"{path.name}:{reason}" for reason in bad]
    # A stable sort on time alone keeps the file order for events in the same second.
    return sorted(events, key=lambda event: event.ts), problems


def find_write_by_key(events_root: Path, key: str) -> Event | None:
    """Return the first ``written`` or ``revised`` event whose ``data.idempotency_key`` is ``key``, or ``None``."""
    # Only lines that contain the key are parsed, so a keyed write does not parse every event of the branch.
    needle = json.dumps(key)[1:-1].encode("ascii")
    found: list[Event] = []
    for path in sorted(events_root.rglob("*.jsonl")) if events_root.is_dir() else []:
        found += [
            event
            for event in _read_file(path, containing=needle)[0]
            if event.type in ("written", "revised") and event.data.get("idempotency_key") == key
        ]
    return min(found, key=lambda event: event.ts, default=None)


def _read_file(path: Path, *, containing: bytes | None = None) -> tuple[list[Event], list[str]]:
    """Parse the lines of one event file (only those containing ``containing``, if given) and list damaged lines."""
    events: list[Event] = []
    problems: list[str] = []
    # Lines are decoded one at a time, so a line that is not UTF-8 is one damaged line and not a lost file.
    for number, raw in enumerate(path.read_bytes().split(b"\n"), start=1):
        if not raw.strip() or (containing is not None and containing not in raw):
            continue
        try:
            events.append(parse_event_line(raw.decode("utf-8")))
        except UnicodeDecodeError:
            problems.append(f"{number}: not valid UTF-8")
        except EventError as error:
            problems.append(f"{number}: {error}")
    return events, problems


def _has_key(event: Event, type: str, key: object) -> bool:  # noqa: A002
    return event.type == type and event.data.get("idempotency_key") == key
