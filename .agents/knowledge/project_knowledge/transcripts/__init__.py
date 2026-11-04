"""Transcript readers: runtime-neutral records from a runtime's session log, read incrementally from a cursor.

The package imports nothing from the rest of the project, never runs Git or starts processes, and prints nothing.
``records`` defines the runtime-neutral record types, ``cursors`` the byte-offset cursor file, ``chunks`` the bounded
chunked read every reader shares, and one module per runtime (``claude_code``, ``codex``) the reader (design sections 8.3
and 8.4). Transcripts are read in place and never copied. ``reader_for`` and ``default_session_id`` choose by runtime name.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

from project_knowledge.transcripts import claude_code, codex
from project_knowledge.transcripts.chunks import Chunk

Reader = Callable[[Path, int, int], Iterator[Chunk]]
READERS: dict[str, Reader] = {"claude-code": claude_code.read_chunks, "codex": codex.read_chunks}


def reader_for(runtime: str) -> Reader:
    """Return the chunk reader of a runtime's transcripts.

    Raises
    ------
    ValueError
        If no reader exists for the runtime; the message lists the ones that do.
    """
    try:
        return READERS[runtime]
    except KeyError:
        raise ValueError(f"no transcript reader for runtime {runtime!r}; supported: {', '.join(READERS)}") from None


def default_session_id(runtime: str, transcript: Path) -> str:
    """Return the session id a transcript file stands for: Claude Code names the file after it, Codex ends the name with it."""
    return codex.session_id_of(transcript) if runtime == "codex" else transcript.stem
