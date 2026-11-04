"""The Claude Code transcript reader (design sections 8.3 and 8.4).

A Claude Code transcript is a JSON Lines file, one record per line, in ``~/.claude/projects/<project>/<session>.jsonl``.
``read_chunks`` reads it from a byte offset in bounded chunks and yields runtime-neutral records. Request-log records
(types starting with ``api-request``) and file-history records are discarded before they are parsed, since they can make
up most of a large file. Unknown record types are tolerated and counted. A chunk always ends at a line end, so a line
that is still being written is left for the next read, and reading in chunks of any size gives the same records as
reading the whole file.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from project_knowledge.transcripts.chunks import Chunk, read_chunks_with
from project_knowledge.transcripts.records import (
    TEXT_LIMIT,
    AssistantText,
    Coverage,
    Prompt,
    ToolCall,
    ToolResult,
    TranscriptRecord,
    Usage,
)

# Types that the reader interprets or knowingly ignores; anything else is counted in ``Coverage.unknown_types``.
KNOWN_TYPES = frozenset(
    {
        "user",
        "assistant",
        "system",
        "attachment",
        "summary",
        "progress",
        "queue-operation",
        "last-prompt",
        "ai-title",
        "custom-title",
        "agent-name",
        "permission-mode",
        "mode",
        "pr-link",
    }
)
# The record type is the first key of every log line seen so far, so the discard test looks only at the start of the line.
_DISCARDED = re.compile(rb'^\s*\{\s*"type"\s*:\s*"(?:api-request|file-history)')
_DISCARDED_TYPES = ("api-request", "file-history")
_HEAD_BYTES = 64

__all__ = ["KNOWN_TYPES", "Chunk", "parse_lines", "parse_record", "read_chunks"]


def read_chunks(path: Path, offset: int, chunk_bytes: int) -> Iterator[Chunk]:
    """Yield the transcript from byte ``offset`` on, in chunks of about ``chunk_bytes`` that end at a line end.

    See ``chunks.read_chunks_with``: the caller moves its cursor to ``Chunk.end`` after it has processed a chunk, and a
    last line without a line end is left for the next read.
    """
    return read_chunks_with(parse_lines, path, offset, chunk_bytes)


def parse_lines(data: bytes) -> tuple[list[TranscriptRecord], Coverage, str | None]:
    """Parse the complete lines of ``data``; return the records, the parse coverage and the last record id."""
    records: list[TranscriptRecord] = []
    lines = understood = discarded = unparsable = 0
    unknown: dict[str, int] = {}
    last_uuid: str | None = None
    for raw in data.split(b"\n"):
        if not raw.strip():
            continue
        # Request-log and file-history lines are dropped before any parsing.
        if _DISCARDED.match(raw[:_HEAD_BYTES]):
            discarded += 1
            continue
        lines += 1
        try:
            record = json.loads(raw)
        except ValueError:  # includes UnicodeDecodeError
            unparsable += 1
            continue
        kind = record.get("type") if isinstance(record, dict) else None
        if not isinstance(kind, str):
            unparsable += 1
            continue
        if kind.startswith(_DISCARDED_TYPES):  # the type was not the first key
            lines -= 1
            discarded += 1
            continue
        if kind in KNOWN_TYPES:
            understood += 1
        else:
            unknown[kind] = unknown.get(kind, 0) + 1
        if isinstance(record.get("uuid"), str):
            last_uuid = record["uuid"]
        records.extend(parse_record(record))
    return records, Coverage(lines, understood, discarded, unparsable, unknown), last_uuid


def parse_record(record: Mapping[str, Any]) -> list[TranscriptRecord]:
    """Turn one log line into runtime-neutral records (none for a type that carries no conversation)."""
    kind = record.get("type")
    message = record.get("message")
    if kind not in ("user", "assistant") or not isinstance(message, dict):
        return []
    ts = _timestamp(record.get("timestamp"))
    content = message.get("content")
    found: list[TranscriptRecord] = []

    if kind == "user":
        if record.get("isMeta") is True:  # text the runtime inserted, not something the user typed
            return []
        if isinstance(content, str):
            return [Prompt(ts, content[:TEXT_LIMIT])] if content.strip() else []
        for block in content if isinstance(content, list) else ():
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and str(block.get("text", "")).strip():
                found.append(Prompt(ts, str(block["text"])[:TEXT_LIMIT]))
            elif block.get("type") == "tool_result":
                found.append(
                    ToolResult(
                        ts,
                        str(block.get("tool_use_id", "")),
                        block.get("is_error") is True,
                        _result_text(block.get("content")),
                    )
                )
        return found

    model = message.get("model") if isinstance(message.get("model"), str) else None
    for block in content if isinstance(content, list) else ():
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and str(block.get("text", "")).strip():
            found.append(AssistantText(ts, str(block["text"])[:TEXT_LIMIT], model))
        elif block.get("type") == "tool_use":
            arguments = block.get("input")
            found.append(
                ToolCall(
                    ts,
                    str(block.get("id", "")),
                    str(block.get("name", "")),
                    arguments if isinstance(arguments, dict) else {},
                )
            )
    usage = message.get("usage")
    if isinstance(usage, dict):
        found.append(
            Usage(
                ts,
                message["id"] if isinstance(message.get("id"), str) else None,
                model,
                _count(usage.get("input_tokens")),
                _count(usage.get("output_tokens")),
                _count(usage.get("cache_read_input_tokens")),
                _count(usage.get("cache_creation_input_tokens")),
            )
        )
    return found


def _timestamp(value: object) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        moment = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _result_text(content: object) -> str:
    """Return a tool result's text: the string itself, or the text blocks of a list joined."""
    if isinstance(content, str):
        return content[:TEXT_LIMIT]
    if isinstance(content, list):
        parts = [str(block.get("text", "")) for block in content if isinstance(block, dict)]
        return "\n".join(parts)[:TEXT_LIMIT]
    return ""
