"""Usage statistics of a transcript range: what a session cost, computed without a model (design section 8.6).

``summarise`` folds the runtime-neutral records of a range into token counts, turns, tool calls, failures, duration and
models. ``knowledge_activity`` counts, from the event log, which notes the knowledge system surfaced, delivered and saved
in the same stretch of time, and how many characters that put into the session. Both are plain functions of their input;
``UsageStats.as_event_data`` gives the ``data`` of a ``session_usage`` event. The module imports ``transcripts`` and
``events`` and never touches files or Git.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from project_knowledge.events import Event
from project_knowledge.notes import format_timestamp
from project_knowledge.transcripts.records import (
    Coverage,
    Prompt,
    ToolCall,
    ToolResult,
    TranscriptRecord,
    Usage,
)

SYNTHETIC_MODEL = "<synthetic>"  # Claude Code's name for messages it wrote itself; not a model that ran


@dataclass(frozen=True)
class UsageStats:
    """Tokens, turns, tool calls, failures, duration and models of one transcript range, with its parse coverage.

    ``turns`` counts the prompts the user typed; ``messages`` the distinct model responses (a response written over several
    log lines counts once, with the largest token counts seen for it).
    """

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    turns: int
    messages: int
    tool_calls: int
    failed_tool_calls: int
    first_ts: dt.datetime | None
    last_ts: dt.datetime | None
    models: tuple[str, ...]
    coverage: Coverage

    @property
    def has_activity(self) -> bool:
        """Whether the range holds any conversation at all (prompts, responses or tool use)."""
        return bool(self.turns or self.messages or self.tool_calls or self.failed_tool_calls)

    @property
    def duration_seconds(self) -> int:
        """The time from the first to the last timestamp of the range, in whole seconds (0 if it has fewer than two)."""
        if self.first_ts is None or self.last_ts is None:
            return 0
        return max(0, int((self.last_ts - self.first_ts).total_seconds()))

    def as_event_data(self, activity: KnowledgeActivity) -> dict[str, Any]:
        """Return the ``data`` of the ``session_usage`` event for this range and the knowledge activity in it."""
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "turns": self.turns,
            "messages": self.messages,
            "tool_calls": self.tool_calls,
            "failed_tool_calls": self.failed_tool_calls,
            "duration_seconds": self.duration_seconds,
            "models": list(self.models),
            "notes_surfaced": activity.notes_surfaced,
            "notes_read": activity.notes_read,
            "notes_written": activity.notes_written,
            "brief_chars": activity.brief_chars,
            "read_chars": activity.read_chars,
            "parse_coverage": round(self.coverage.share, 3),
            "discarded_lines": self.coverage.discarded,
            "unknown_record_types": dict(self.coverage.unknown_types),
            "window_end": activity.until,
        }


@dataclass(frozen=True)
class KnowledgeActivity:
    """What the knowledge system did in a stretch of a session: distinct notes surfaced, read and saved, and its size.

    ``brief_chars`` and ``read_chars`` are the characters that briefs and full reads put into the session (the
    knowledge system's own overhead, design 8.6). ``until`` is the end of the stretch, the lower bound of the next one.
    """

    notes_surfaced: int
    notes_read: int
    notes_written: int
    brief_chars: int
    read_chars: int
    until: str


def summarise(
    records: Iterable[TranscriptRecord], coverage: Coverage, *, continued_from: str | None = None
) -> UsageStats:
    """Fold the records of a range into its usage statistics.

    A model response that was logged over several lines is counted once: for each message id the largest value of each
    token count is used (the counts only grow while a response streams). Responses without an id count separately.

    ``continued_from`` is the id of the last response of the previous range. A response that a range boundary cut in
    two is counted in the range where it starts, so lines of that response at the start of this range are left out
    (the tokens that only appeared on those later lines are not counted; the loss is small, a double count is not).
    """
    best: dict[str | int, Usage] = {}
    turns = tool_calls = failed = 0
    stamps: list[dt.datetime] = []
    models: dict[str, None] = {}
    for position, record in enumerate(records):
        if record.ts is not None:
            stamps.append(record.ts)
        if isinstance(record, Prompt):
            turns += 1
        elif isinstance(record, ToolCall):
            tool_calls += 1
        elif isinstance(record, ToolResult):
            failed += 1 if record.is_error else 0
        elif isinstance(record, Usage):
            if continued_from is not None and record.message_id == continued_from:
                continue
            key: str | int = record.message_id if record.message_id is not None else -1 - position
            previous = best.get(key)
            best[key] = record if previous is None else _largest(previous, record)
            if record.model and record.model != SYNTHETIC_MODEL:
                models[record.model] = None
    responses = list(best.values())
    return UsageStats(
        input_tokens=sum(item.input_tokens for item in responses),
        output_tokens=sum(item.output_tokens for item in responses),
        cache_read_tokens=sum(item.cache_read_tokens for item in responses),
        cache_write_tokens=sum(item.cache_write_tokens for item in responses),
        turns=turns,
        messages=len(responses),
        tool_calls=tool_calls,
        failed_tool_calls=failed,
        first_ts=min(stamps, default=None),
        last_ts=max(stamps, default=None),
        models=tuple(models),
        coverage=coverage,
    )


def knowledge_activity(events: Sequence[Event], *, after: str | None, until: dt.datetime) -> KnowledgeActivity:
    """Count the knowledge events of one session with a time after ``after`` (exclusive) up to ``until`` (inclusive).

    ``after`` is the ``until`` of the session's previous range, so consecutive ranges neither miss nor repeat an event.
    Notes are counted once however often they appear. Candidate notes the session job saved are not counted as written.
    """
    end = format_timestamp(until)
    surfaced: set[str] = set()
    read: set[str] = set()
    written: set[str] = set()
    brief_chars = read_chars = 0
    for event in events:
        if (after is not None and event.ts <= after) or event.ts > end:
            continue
        if event.type == "surfaced" and event.note_id:
            surfaced.add(event.note_id)
            brief_chars += _whole_number(event.data.get("brief_chars"))
        elif event.type == "read" and event.note_id:
            read.add(event.note_id)
            read_chars += _whole_number(event.data.get("chars"))
        elif event.type in ("written", "revised") and event.note_id and not _by_the_grader(event):
            written.add(event.note_id)
    return KnowledgeActivity(len(surfaced), len(read), len(written), brief_chars, read_chars, end)


def _by_the_grader(event: Event) -> bool:
    """Whether a ``written`` event is a candidate note that the session job saved (its key starts with ``extract:``).

    The agent did not write that note, so it is not part of the session's own ``notes_written``.
    """
    return str(event.data.get("idempotency_key", "")).startswith("extract:")


def _largest(first: Usage, second: Usage) -> Usage:
    return Usage(
        second.ts or first.ts,
        second.message_id,
        second.model or first.model,
        max(first.input_tokens, second.input_tokens),
        max(first.output_tokens, second.output_tokens),
        max(first.cache_read_tokens, second.cache_read_tokens),
        max(first.cache_write_tokens, second.cache_write_tokens),
    )


def _whole_number(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0
