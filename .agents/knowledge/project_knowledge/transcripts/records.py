"""The runtime-neutral records that every transcript reader yields (design section 8.5).

A reader turns a runtime's own log lines into these, so the usage statistics and, later, the digest do not depend on
which runtime wrote the transcript. Records are frozen and hold no more text than the later steps need.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

TEXT_LIMIT = 2000  # characters kept of a prompt, a reply or a tool result; the full text stays in the transcript


@dataclass(frozen=True)
class Prompt:
    """Something the user typed."""

    ts: dt.datetime | None
    text: str


@dataclass(frozen=True)
class AssistantText:
    """Visible text of one assistant message."""

    ts: dt.datetime | None
    text: str
    model: str | None


@dataclass(frozen=True)
class ToolCall:
    """The assistant asked for a tool: its name and arguments, matched to its result by ``call_id``."""

    ts: dt.datetime | None
    call_id: str
    name: str
    arguments: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    """What a tool returned; ``is_error`` is the runtime's own failure flag."""

    ts: dt.datetime | None
    call_id: str
    is_error: bool
    text: str


@dataclass(frozen=True)
class Usage:
    """Token counts of one model response. One response can span several log lines, all with the same ``message_id``."""

    ts: dt.datetime | None
    message_id: str | None
    model: str | None
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


TranscriptRecord = Prompt | AssistantText | ToolCall | ToolResult | Usage


@dataclass(frozen=True)
class Coverage:
    """How much of a transcript range a reader understood (design 8.4), so a changed format is visible.

    ``lines`` counts the lines it parsed (request-log lines it discarded are not part of it); ``understood`` those with a
    known record type; ``unknown_types`` counts the others by type; ``unparsable`` the lines that were not JSON objects.
    """

    lines: int = 0
    understood: int = 0
    discarded: int = 0
    unparsable: int = 0
    unknown_types: Mapping[str, int] = field(default_factory=dict)

    @property
    def share(self) -> float:
        """The share of parsed lines that were understood (1.0 for an empty range)."""
        return self.understood / self.lines if self.lines else 1.0

    def __add__(self, other: Coverage) -> Coverage:
        unknown = dict(self.unknown_types)
        for name, count in other.unknown_types.items():
            unknown[name] = unknown.get(name, 0) + count
        return Coverage(
            self.lines + other.lines,
            self.understood + other.understood,
            self.discarded + other.discarded,
            self.unparsable + other.unparsable,
            unknown,
        )
