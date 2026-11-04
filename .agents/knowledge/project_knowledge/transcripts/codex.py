"""The Codex CLI transcript reader (design sections 8.3, 8.4 and 13.4).

A Codex session is a JSON Lines "rollout" file, ``<codex home>/sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl``.
Every line is ``{"timestamp", "type", "payload"}``. ``read_chunks`` reads it from a byte offset in bounded chunks and
yields the same runtime-neutral records as the Claude Code reader.

What the reader takes from it:

* ``response_item`` / ``message``: the user's prompt (text the runtime inserted, such as the environment context or the
  ``AGENTS.md`` text, is not a prompt) and the assistant's visible text. Developer messages and encrypted reasoning are
  skipped. The ``event_msg`` copies of the same messages are ignored, so nothing is counted twice.
* ``response_item`` / ``function_call``, ``custom_tool_call``, ``local_shell_call`` and their ``*_output`` records: tool calls
  and results.
* ``event_msg`` / ``token_count``: token usage, one ``Usage`` per model response, from the per-response
  ``last_token_usage`` (the cumulative ``total_token_usage`` is only used to recognise a repeated record).
* ``turn_context``: the model, which is attached to the assistant text and usage that follow.

Unknown record types are tolerated and counted. A chunk always ends at a line end. A rollout is not matched to a project here: the hook that starts
the job already runs in one (design 8.4).
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

# Record types that the reader interprets or knowingly ignores; anything else is counted in ``Coverage.unknown_types``.
KNOWN_TYPES = frozenset(
    {"session_meta", "response_item", "event_msg", "turn_context", "world_state", "compacted", "token_usage_record"}
)
# Kinds of ``response_item`` the reader interprets or knowingly ignores; another kind is counted as ``response_item:<kind>``.
KNOWN_ITEMS = frozenset(
    {
        "message",
        "reasoning",
        "function_call",
        "function_call_output",
        "custom_tool_call",
        "custom_tool_call_output",
        "local_shell_call",
        "compaction",
    }
)
_SESSION_ID = re.compile(r"[0-9A-Za-z][0-9A-Za-z-]*")
_ROLLOUT = re.compile(r"^rollout-.*?-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")
_INSERTED_PREFIXES = ("<", "# AGENTS.md instructions")  # text Codex adds to the conversation on its own


def read_chunks(path: Path, offset: int, chunk_bytes: int) -> Iterator[Chunk]:
    """Yield the rollout from byte ``offset`` on, in chunks of about ``chunk_bytes`` that end at a line end.

    The model of a chunk's responses is the last ``turn_context`` before it, also one before ``offset`` (a read that starts
    in the middle of a turn looks back for it, so reading a grown file in ranges gives the records of reading it whole).
    """
    model: list[str | None] = [_model_before(path, offset)]

    def parse(data: bytes) -> tuple[list[TranscriptRecord], Coverage, str | None]:
        records, coverage, last_id, model[0] = parse_lines(data, model[0])
        return records, coverage, last_id

    return read_chunks_with(parse, path, offset, chunk_bytes)


def _model_before(path: Path, offset: int) -> str | None:
    """Return the model of the last ``turn_context`` line that ends before byte ``offset``, or ``None`` if there is none."""
    model: str | None = None
    if offset <= 0:
        return model
    with path.open("rb") as handle:
        position = 0
        for raw in handle:
            position += len(raw)
            if position > offset:
                break
            if b'"turn_context"' not in raw:
                continue
            try:
                record = json.loads(raw)
            except ValueError:
                continue
            payload = record.get("payload") if isinstance(record, dict) else None
            found = payload.get("model") if isinstance(payload, dict) and record.get("type") == "turn_context" else None
            model = found if isinstance(found, str) else model
    return model


def parse_lines(
    data: bytes, model: str | None = None
) -> tuple[list[TranscriptRecord], Coverage, str | None, str | None]:
    """Parse the complete lines of ``data``; return the records, the parse coverage, the last record id and the model.

    ``model`` is the model in force at the start of ``data``; the returned one is the model in force at its end.
    """
    records: list[TranscriptRecord] = []
    lines = understood = unparsable = 0
    unknown: dict[str, int] = {}
    last_id: str | None = None
    for raw in data.split(b"\n"):
        if not raw.strip():
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
        payload = record.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        if kind not in KNOWN_TYPES:
            unknown[kind] = unknown.get(kind, 0) + 1
        elif kind == "response_item" and payload.get("type") not in KNOWN_ITEMS:
            name = f"response_item:{payload.get('type')}"
            unknown[name] = unknown.get(name, 0) + 1
        else:
            understood += 1
        if isinstance(record.get("ordinal"), int):
            last_id = f"ordinal:{record['ordinal']}"
        if kind == "turn_context" and isinstance(payload.get("model"), str):
            model = payload["model"]
        records.extend(parse_record(record, payload, model))
    return records, Coverage(lines, understood, 0, unparsable, unknown), last_id, model


def parse_record(record: Mapping[str, Any], payload: Mapping[str, Any], model: str | None) -> list[TranscriptRecord]:
    """Turn one rollout line into runtime-neutral records (none for a type that carries no conversation)."""
    kind = record.get("type")
    ts = _timestamp(record.get("timestamp"))
    if kind == "event_msg":
        return _token_count(ts, payload, model) if payload.get("type") == "token_count" else []
    if kind != "response_item":
        return []
    item = payload.get("type")
    if item == "message":
        return _message(ts, payload, model)
    if item in ("function_call", "custom_tool_call", "local_shell_call"):
        return [_tool_call(ts, item, payload)]
    if item in ("function_call_output", "custom_tool_call_output"):
        return [_tool_result(ts, payload)]
    return []


def _message(ts: dt.datetime | None, payload: Mapping[str, Any], model: str | None) -> list[TranscriptRecord]:
    role = payload.get("role")
    content = payload.get("content")
    blocks = [block for block in content if isinstance(block, dict)] if isinstance(content, list) else []
    found: list[TranscriptRecord] = []
    if role == "assistant":
        for block in blocks:
            text = block.get("text")
            if block.get("type") == "output_text" and isinstance(text, str) and text.strip():
                found.append(AssistantText(ts, text[:TEXT_LIMIT], model))
        return found
    if role != "user":
        return found
    passthrough = payload.get("internal_chat_message_metadata_passthrough")
    kinds = passthrough.get("content_item_kinds") if isinstance(passthrough, dict) else None
    labelled = isinstance(kinds, list) and len(kinds) == len(blocks)  # newer files say what each block is
    for position, block in enumerate(blocks):
        text = block.get("text")
        if block.get("type") != "input_text" or not isinstance(text, str) or not text.strip():
            continue
        typed = kinds[position] == "user.text" if labelled and isinstance(kinds, list) else not _inserted(text)
        if typed:
            found.append(Prompt(ts, text[:TEXT_LIMIT]))
    return found


def _inserted(text: str) -> bool:
    return text.lstrip().startswith(_INSERTED_PREFIXES)


def _tool_call(ts: dt.datetime | None, item: object, payload: Mapping[str, Any]) -> TranscriptRecord:
    call_id = str(payload.get("call_id", ""))
    if item == "custom_tool_call":
        raw = payload.get("input")
        return ToolCall(
            ts, call_id, str(payload.get("name", "")), {"input": raw[:TEXT_LIMIT]} if isinstance(raw, str) else {}
        )
    if item == "local_shell_call":
        action = payload.get("action")
        return ToolCall(ts, call_id, "local_shell", dict(action) if isinstance(action, dict) else {})
    name = str(payload.get("name", ""))
    namespace = payload.get("namespace")
    if isinstance(namespace, str) and namespace:
        name = (
            f"{namespace.rstrip('_')}__{name}"  # an MCP tool: ``mcp__<server>`` and the tool, as Claude Code spells it
        )
    arguments: object = None
    raw_arguments = payload.get("arguments")
    if isinstance(raw_arguments, str):
        try:
            arguments = json.loads(raw_arguments)
        except ValueError:
            arguments = None
    return ToolCall(ts, call_id, name, arguments if isinstance(arguments, dict) else {})


def _tool_result(ts: dt.datetime | None, payload: Mapping[str, Any]) -> TranscriptRecord:
    output = payload.get("output")
    failed = payload.get("success") is False
    text = ""
    if isinstance(output, str):
        text = output
        try:
            loaded = json.loads(
                output
            )  # older files wrap a shell result as {"output": ..., "metadata": {"exit_code": n}}
        except ValueError:
            loaded = None
        if isinstance(loaded, dict) and isinstance(loaded.get("output"), str):
            text = loaded["output"]
            metadata = loaded.get("metadata")
            code = metadata.get("exit_code") if isinstance(metadata, dict) else None
            failed = failed or (isinstance(code, int) and not isinstance(code, bool) and code != 0)
    elif isinstance(output, list):
        text = "\n".join(str(block.get("text", "")) for block in output if isinstance(block, dict))
    return ToolResult(ts, str(payload.get("call_id", "")), failed, text[:TEXT_LIMIT])


def _token_count(ts: dt.datetime | None, payload: Mapping[str, Any], model: str | None) -> list[TranscriptRecord]:
    """One ``Usage`` from a ``token_count`` event: the response's own counts, not the running total.

    Codex counts ``input_tokens`` including the cached part (and the cache-write part), so those are taken out of the input
    count and reported as cache read and write. A repeated event (same running total) carries the same ``message_id``, which
    the usage statistics count once.
    """
    info = payload.get("info")
    last = info.get("last_token_usage") if isinstance(info, dict) else None
    if not isinstance(last, dict):
        return []
    total = info.get("total_token_usage") if isinstance(info, dict) else None
    running = total.get("total_tokens") if isinstance(total, dict) else None
    response = last.get("total_tokens")
    cached = _count(last.get("cached_input_tokens"))
    written = _count(last.get("cache_write_input_tokens"))
    if not (_count(last.get("input_tokens")) or _count(last.get("output_tokens"))):
        return []
    identity = f"tokens:{running}:{response}" if isinstance(running, int) and isinstance(response, int) else None
    return [
        Usage(
            ts,
            identity,
            model,
            max(0, _count(last.get("input_tokens")) - cached - written),
            _count(last.get("output_tokens")),
            cached,
            written,
        )
    ]


def codex_home(environ: Mapping[str, str], home: Path) -> Path:
    """Return Codex's home folder: ``$CODEX_HOME`` if set, else ``.codex`` in the user's home."""
    chosen = environ.get("CODEX_HOME", "").strip()
    return Path(chosen) if chosen else home / ".codex"


def find_rollout(home: Path, session_id: str) -> Path | None:
    """Return the rollout file of a session under ``home/sessions`` (the newest if there are several), or ``None``.

    The file name ends with the session id; ``session_id`` that is not made of letters, digits and ``-`` finds nothing.
    """
    if not _SESSION_ID.fullmatch(session_id):
        return None
    found = sorted((home / "sessions").glob(f"*/*/*/rollout-*-{session_id}.jsonl"))
    return found[-1] if found else None


def session_id_of(path: Path) -> str:
    """Return the session id in a rollout file's name (``rollout-<time>-<id>.jsonl``), or the whole stem if it has none."""
    found = _ROLLOUT.match(path.stem)
    return found.group(1) if found else path.stem


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
