"""Transcript cursors: how far each transcript has been read, kept in ``cursors.json`` (design 8.3).

A cursor is the byte offset up to which a transcript was processed, the ``uuid`` of the last record there and the id of the
last model response there (a response written over several lines can be cut by a range boundary; the next range must not
count it again, design 8.6). The file is
derived state (deleting it makes the next job read the transcripts again), is replaced atomically, and a damaged file
counts as empty.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Cursor:
    """Read position in one transcript: the byte offset after the last processed line, its record id and last response id.

    ``pending_end`` is set while a range ``offset``-``pending_end`` has its usage logged but is not yet graded: the next
    job replays exactly that range (design 8.7). ``grading_attempts`` counts the failed grading attempts of that range.
    """

    offset: int
    last_uuid: str | None
    last_message_id: str | None = None
    pending_end: int | None = None
    grading_attempts: int = 0


def cursors_path(state_dir: Path) -> Path:
    """Return the cursor file inside the state folder."""
    return state_dir / "cursors.json"


def load_cursors(state_dir: Path) -> dict[str, Cursor]:
    """Return the cursors by transcript path; an absent or damaged file, or a damaged entry, gives no cursor."""
    try:
        loaded = json.loads(cursors_path(state_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    cursors: dict[str, Cursor] = {}
    for key, entry in loaded.items() if isinstance(loaded, dict) else ():
        if isinstance(entry, dict) and isinstance(entry.get("offset"), int) and entry["offset"] >= 0:
            last = entry.get("last_uuid")
            message = entry.get("last_message_id")
            pending = entry.get("pending_end")
            attempts = entry.get("grading_attempts")
            cursors[str(key)] = Cursor(
                entry["offset"],
                last if isinstance(last, str) else None,
                message if isinstance(message, str) else None,
                pending if isinstance(pending, int) and pending > entry["offset"] else None,
                attempts if isinstance(attempts, int) and attempts >= 0 else 0,
            )
    return cursors


def save_cursor(state_dir: Path, transcript: str, cursor: Cursor) -> None:
    """Store the cursor of one transcript, keeping the others; the file is replaced atomically."""
    cursors = load_cursors(state_dir)
    cursors[transcript] = cursor
    document = {key: _entry(value) for key, value in sorted(cursors.items())}
    path = cursors_path(state_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(document, indent=1), encoding="utf-8", newline="\n")
    temporary.replace(path)


def _entry(cursor: Cursor) -> dict[str, int | str | None]:
    """Return the JSON form of a cursor; the grading fields are written only while a range is pending."""
    entry: dict[str, int | str | None] = {
        "offset": cursor.offset,
        "last_uuid": cursor.last_uuid,
        "last_message_id": cursor.last_message_id,
    }
    if cursor.pending_end is not None:
        entry["pending_end"] = cursor.pending_end
        entry["grading_attempts"] = cursor.grading_attempts
    return entry
