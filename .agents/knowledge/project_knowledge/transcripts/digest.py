"""The transcript digest: a compact, runtime-neutral text of a transcript range for the grader (design section 8.5).

``build_digest`` turns the records of either reader into one text that fits a token budget. Nothing in it depends on the
runtime. The digest is transient: it is built in memory, sent to the grader and discarded; it is never written to the
repository or the knowledge branch. The module imports only ``records`` (no project module), runs no process and prints
nothing.

Layout of the text: a header, a preamble that lists every note read and every discovery signal (always kept, cut only if
the budget cannot even hold that, and then ``Digest.complete_reads`` is false), then the numbered steps. When the steps do
not fit, they are kept in this order of priority, and gaps are marked:

0. every ``knowledge`` search, read and write call and its result, in full;
1. the stretch after each note read (the next ``WINDOW_STEPS`` steps, less truncated, because that is where use shows
   up) and the stretch around each discovery signal;
2. the prompts of the user;
3. everything else, truncated hard.

The size is estimated at four characters per token, like the rest of the tool, and ``Digest.text`` never exceeds the
budget: the line that marks omitted steps is reserved before the preamble is cut, and a budget too small even for that
is cut hard (``complete_reads`` is then false if a read is no longer named).

A ``redact`` function, if given, is applied to the text of every step before it is cut to length, so that a secret that
straddles a cut cannot leave a recognisable fragment behind.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from typing import Any

from project_knowledge.transcripts.records import (
    AssistantText,
    Prompt,
    ToolCall,
    ToolResult,
    TranscriptRecord,
    Usage,
)

DIGEST_VERSION = 1  # recorded in every ``graded`` event; raise it when the digest's content or layout changes

CHARS_PER_TOKEN = 4  # the tool's conservative estimate (design 7.4)
WINDOW_STEPS = 6  # the steps after a note read that are kept less truncated: "the next K steps" of design 8.5
SIGNAL_RADIUS = 3  # the steps kept around a discovery signal, before and after
GAP_MARKER_CHARS = 48  # an upper bound for the length of one "steps omitted" line, reserved for every kept step
MAX_SIGNAL_LINES = 20  # the preamble lists at most this many signals

# How much of a step survives at each fidelity: characters of prompts, assistant text and arguments, lines of a result at
# each end, characters per line. ``full`` is for knowledge calls, ``window`` for the stretch after a read.
_LIMITS: dict[str, dict[str, int]] = {
    "brief": {"prompt": 300, "text": 300, "args": 160, "lines": 3, "line": 160},
    "window": {"prompt": 600, "text": 1200, "args": 400, "lines": 8, "line": 300},
    "full": {"prompt": 2000, "text": 2000, "args": 2000, "lines": 40, "line": 500},
}
_FIDELITY_ORDER = ("full", "window", "brief")

# ---------------------------------------------------------------------------------------------------------------------
# Discovery signals (design 8.7). The whole rule set is here. A signal says "this range may hold a discovery"; it is a
# heuristic that only decides whether the grader is asked, never what it answers.

# Assistant text that names a cause or a finding.
ROOT_CAUSE_PATTERNS = (
    r"\broot cause\b",
    r"\bturns? out\b",
    r"\b(?:actual|real|underlying) (?:cause|problem|issue|reason)\b",
    r"\bthat explains\b",
    r"\bthe culprit\b",
    r"\bworkaround\b",
)
# Assistant text that drops an earlier diagnosis.
DIAGNOSIS_CHANGE_PATTERNS = (
    r"\bi was wrong\b",
    r"\bthat was wrong\b",
    r"\bnot the cause\b",
    r"\bmy (?:earlier|previous|first) (?:assumption|guess|hypothesis|theory)\b",
    r"\bon second thought\b",
    r"\bso the real\b",
)
# Failures of one tool in a row (knowledge tools excluded) that end in a success.
FAILURES_BEFORE_SUCCESS = 2

SIGNAL_KINDS = ("root_cause_phrase", "diagnosis_change", "failures_then_success")

# Tools that bring in content from outside the project: a note built from it is ``trust: external``. A tool is external
# if its whole name (lower case) is in ``EXTERNAL_TOOLS``, if the last part of an MCP name (``mcp__<server>__<tool>``) is,
# or if its name starts with one of ``EXTERNAL_PREFIXES`` (browser servers); a name that merely contains ``fetch``, like
# ``git_fetch``, is not. A shell command that downloads (``EXTERNAL_COMMAND``) is external too.
EXTERNAL_TOOLS = ("webfetch", "websearch", "web_search", "web_fetch", "fetch", "http_request")
EXTERNAL_PREFIXES = ("mcp__playwright__", "mcp__puppeteer__", "mcp__browser__", "browser_")
EXTERNAL_COMMAND = re.compile(
    r"(?<![\w-])(?:curl|wget|invoke-webrequest|invoke-restmethod|iwr)(?![\w-])", re.IGNORECASE
)

_KNOWLEDGE_TOOLS = ("search", "read", "write")
_NOTE_ID = re.compile(r"K-\d{8}-[0-9a-f]{4,}")
# A shell command of the tool: a ``know_<command>`` launcher, or (older installs) ``knowledge <command>``.
_SHELL_KNOWLEDGE = re.compile(
    r"(?:know_(search|read|write)(?:\.cmd)?\b|knowledge(?:\.cmd|\.py)?[\"']?\s+(?:[^\n]*?\s)?(search|read|write)\b)"
)
_RESULT_VERSION = re.compile(r'version(?:="|":\s*")([0-9a-f]{7,64})"')


@dataclass(frozen=True)
class NoteRead:
    """A note the agent opened: its id, the version if the result showed one, the steps of call and result, and failure."""

    note_id: str
    version: str | None
    position: int
    failed: bool
    end: int = 0  # the step of the result (the step of the call if there was none)


@dataclass(frozen=True)
class Signal:
    """A discovery signal: its kind (one of ``SIGNAL_KINDS``) and the step where it was seen."""

    kind: str
    position: int


@dataclass(frozen=True)
class Digest:
    """The digest of a range: the text, its estimated size, the reads and signals found, and what was left out.

    ``steps`` counts the steps of the range and ``kept_steps`` those in the text. ``complete_reads`` is false only when
    the budget could not hold the list of reads. ``external_content`` says the range used a tool that fetches outside
    content. ``version`` is ``DIGEST_VERSION``.
    """

    text: str
    tokens: int
    reads: tuple[NoteRead, ...]
    signals: tuple[Signal, ...]
    steps: int
    kept_steps: int
    complete_reads: bool
    external_content: bool
    version: int = DIGEST_VERSION

    @property
    def opened_ids(self) -> tuple[str, ...]:
        """The distinct ids of the notes read successfully, in the order first read."""
        return tuple(dict.fromkeys(read.note_id for read in self.reads if not read.failed))

    @property
    def has_discovery_signal(self) -> bool:
        """Whether the range shows any discovery signal."""
        return bool(self.signals)


@dataclass(frozen=True)
class _Step:
    position: int  # 1-based, over the records of the range without usage records
    record: Prompt | AssistantText | ToolCall | ToolResult


def build_digest(
    records: Iterable[TranscriptRecord], *, max_tokens: int, redact: Callable[[str], str] | None = None
) -> Digest:
    """Return the digest of ``records`` within ``max_tokens`` (estimated at four characters per token).

    ``redact`` (text in, text out) cleans the text of each step before it is cut; the digest module does not know what a
    secret is, the caller does.

    The reads and signals are found first; the steps are then kept by priority until the budget is used, so the stretch
    after each read and around each signal survives when the range is too large. ``Digest.text`` is at most
    ``max_tokens * 4`` characters.
    """
    budget = max(max_tokens, 1) * CHARS_PER_TOKEN
    cleaned = [_redacted(record, redact) for record in _conversation(records)] if redact else _conversation(records)
    steps = [_Step(number, record) for number, record in enumerate(cleaned, start=1)]
    calls = {step.record.call_id: step for step in steps if isinstance(step.record, ToolCall)}
    reads = _find_reads(steps)
    signals = _find_signals(steps, calls)

    # Mark which steps get which treatment, then choose the ones that fit, most important first.
    knowledge_steps = _knowledge_steps(steps)
    windows = _windows(steps, reads, signals)
    wanted = sorted(steps, key=lambda step: (_rank(step, knowledge_steps, windows), step.position))
    # The line for omitted steps is reserved up front (``GAP_MARKER_CHARS``), so the preamble cannot take the whole budget.
    preamble, complete = _preamble(steps, reads, signals, max(budget - GAP_MARKER_CHARS, 0))
    available = budget - len(preamble) - GAP_MARKER_CHARS
    chosen: dict[int, str] = {}
    for step in wanted:
        line = _fit(step, calls, knowledge_steps, windows, available)
        if line is None:
            continue
        chosen[step.position] = line
        available -= len(line) + 1 + GAP_MARKER_CHARS  # at most one new gap marker per kept step

    text = _assemble(preamble, chosen, len(steps))
    if len(text) > budget:  # a budget too small for the marker and the header: the hard limit wins
        text = text[:budget]
        complete = complete and all(read.note_id in text for read in reads)
    external = any(isinstance(step.record, ToolCall) and _is_external(step.record) for step in steps)
    return Digest(
        text=text,
        tokens=-(-len(text) // CHARS_PER_TOKEN),
        reads=tuple(reads),
        signals=tuple(signals),
        steps=len(steps),
        kept_steps=len(chosen),
        complete_reads=complete,
        external_content=external,
    )


def _is_external(call: ToolCall) -> bool:
    """Whether a tool call brings in content from outside the project (see ``EXTERNAL_TOOLS``)."""
    name = call.name.lower()
    tool = name.rsplit("__", 1)[-1] if name.startswith("mcp__") else name
    if name in EXTERNAL_TOOLS or tool in EXTERNAL_TOOLS or name.startswith(EXTERNAL_PREFIXES):
        return True
    return any(EXTERNAL_COMMAND.search(text) for key, text in _command_texts(call.arguments, ("command", "cmd")))


def _command_texts(arguments: Mapping[str, Any], keys: tuple[str, ...]) -> list[tuple[str, str]]:
    """Return the ``(key, text)`` of the shell command arguments (a string or a list of words)."""
    found: list[tuple[str, str]] = []
    for key in keys:
        value = arguments.get(key)
        if isinstance(value, str):
            found.append((key, value))
        elif isinstance(value, list):
            found.append((key, " ".join(str(item) for item in value)))
    return found


def _redacted(record: Prompt | AssistantText | ToolCall | ToolResult, redact: Callable[[str], str]) -> Any:
    """Return the record with ``redact`` applied to its text (every string of a call's arguments)."""
    if isinstance(record, Prompt | AssistantText | ToolResult):
        return replace(record, text=redact(record.text))
    return replace(record, arguments=_redacted_value(record.arguments, redact))


def _redacted_value(value: Any, redact: Callable[[str], str]) -> Any:
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, Mapping):
        return {key: _redacted_value(item, redact) for key, item in value.items()}
    if isinstance(value, list):
        return [_redacted_value(item, redact) for item in value]
    return value


# ---------------------------------------------------------------------------------------------------------------------
# Finding reads and signals


def _conversation(records: Iterable[TranscriptRecord]) -> list[Prompt | AssistantText | ToolCall | ToolResult]:
    """Return the records that carry conversation (token counts do not)."""
    return [record for record in records if not isinstance(record, Usage)]


def knowledge_call(call: ToolCall) -> tuple[str, str | None] | None:
    """Say whether a tool call is a ``knowledge`` search, read or write, and which note it names.

    Returns ``(kind, note id)`` with ``kind`` one of ``search``, ``read``, ``write`` (the note id is set for a read), or
    ``None``. An MCP tool is recognised by the end of its name (``mcp__<server>__<tool>``) and the argument it must have
    (``query``, ``id``, ``note``); a command run in a shell, by ``knowledge <command>`` in its text.
    """
    if call.name.startswith("mcp__"):
        tool = call.name.rsplit("__", 1)[-1].removeprefix("know_")  # the first version had no prefix
        arguments = call.arguments
        if tool == "search" and isinstance(arguments.get("query"), str):
            return "search", None
        if tool == "read" and isinstance(arguments.get("id"), str) and _NOTE_ID.fullmatch(arguments["id"]):
            return "read", arguments["id"]
        if tool == "write" and isinstance(arguments.get("note"), Mapping):
            return "write", None
        return None
    text = " ".join(_argument_texts(call.arguments))
    found = _SHELL_KNOWLEDGE.search(text)
    if found is None:
        return None
    kind = found.group(1) or found.group(2)
    note_id = _NOTE_ID.search(text) if kind == "read" else None
    if kind == "read" and note_id is None:
        return None
    return kind, note_id.group(0) if note_id else None


def _argument_texts(arguments: Mapping[str, Any]) -> list[str]:
    texts: list[str] = []
    for value in arguments.values():
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, list):
            texts.append(" ".join(str(item) for item in value))
    return texts


def _find_reads(steps: list[_Step]) -> list[NoteRead]:
    """Return the note reads of the range: one per call that opened a note, with the version its result showed."""
    results = {s.record.call_id: s for s in steps if isinstance(s.record, ToolResult)}
    reads: list[NoteRead] = []
    for step in steps:
        if not isinstance(step.record, ToolCall):
            continue
        known = knowledge_call(step.record)
        if known is None or known[0] != "read" or known[1] is None:
            continue
        result = results.get(step.record.call_id)
        record = result.record if result is not None else None
        text = record.text if isinstance(record, ToolResult) else ""
        found = _RESULT_VERSION.search(text)
        failed = isinstance(record, ToolResult) and record.is_error
        end = result.position if result is not None else step.position
        reads.append(NoteRead(known[1], found.group(1) if found else None, step.position, failed, end))
    return reads


def _find_signals(steps: list[_Step], calls: dict[str, _Step]) -> list[Signal]:
    """Apply the discovery rules of this module to the steps; signals come back in step order."""
    signals: list[Signal] = []
    streaks: dict[str, int] = {}
    for step in steps:
        record = step.record
        if isinstance(record, AssistantText):
            lowered = record.text.lower()
            if any(re.search(pattern, lowered) for pattern in ROOT_CAUSE_PATTERNS):
                signals.append(Signal("root_cause_phrase", step.position))
            if any(re.search(pattern, lowered) for pattern in DIAGNOSIS_CHANGE_PATTERNS):
                signals.append(Signal("diagnosis_change", step.position))
        elif isinstance(record, ToolResult):
            call = calls.get(record.call_id)
            if call is None or not isinstance(call.record, ToolCall) or knowledge_call(call.record) is not None:
                continue
            tool = call.record.name
            if record.is_error:
                streaks[tool] = streaks.get(tool, 0) + 1
            else:
                if streaks.get(tool, 0) >= FAILURES_BEFORE_SUCCESS:
                    signals.append(Signal("failures_then_success", step.position))
                streaks[tool] = 0
    return signals


# ---------------------------------------------------------------------------------------------------------------------
# Choosing what to keep


def _knowledge_steps(steps: list[_Step]) -> set[int]:
    """Return the positions of knowledge calls and of their results."""
    knowledge_ids = {
        step.record.call_id for step in steps if isinstance(step.record, ToolCall) and knowledge_call(step.record)
    }
    return {
        step.position
        for step in steps
        if isinstance(step.record, ToolCall | ToolResult) and step.record.call_id in knowledge_ids
    }


def _windows(steps: list[_Step], reads: list[NoteRead], signals: list[Signal]) -> set[int]:
    """Return the positions after each successful read and around each signal that deserve a fuller rendering."""
    kept: set[int] = set()
    last = len(steps)
    for read in reads:
        if not read.failed:
            kept.update(range(read.end + 1, min(read.end + WINDOW_STEPS, last) + 1))
    for signal in signals:
        kept.update(range(max(signal.position - SIGNAL_RADIUS, 1), min(signal.position + SIGNAL_RADIUS, last) + 1))
    return kept


def _rank(step: _Step, knowledge_steps: set[int], windows: set[int]) -> int:
    """Return the priority of a step (0 is kept first); see the module docstring."""
    if step.position in knowledge_steps:
        return 0
    if step.position in windows:
        return 1
    return 2 if isinstance(step.record, Prompt) else 3


def _fit(
    step: _Step, calls: dict[str, _Step], knowledge_steps: set[int], windows: set[int], available: int
) -> str | None:
    """Return the line of a step at the best fidelity that fits ``available`` characters (with its line end and gap), else ``None``."""
    start = {0: "full", 1: "window"}.get(_rank(step, knowledge_steps, windows), "brief")
    for fidelity in _FIDELITY_ORDER[_FIDELITY_ORDER.index(start) :]:
        line = _render(step, calls, _LIMITS[fidelity])
        if len(line) + 1 + GAP_MARKER_CHARS <= available:
            return line
    return None


def _preamble(steps: list[_Step], reads: list[NoteRead], signals: list[Signal], budget: int) -> tuple[str, bool]:
    """Return the header with the list of reads and signals, cut to the budget, and whether every read is in it."""
    lines = [f"DIGEST v{DIGEST_VERSION}: {len(steps)} steps. Each line is [step] KIND."]
    lines.append("Notes opened by the agent (id, version, step of the call):")
    lines += [
        f"- {read.note_id} version {read.version or 'unknown'} step {read.position}{' FAILED' if read.failed else ''}"
        for read in reads
    ] or ["- none"]
    shown = signals[:MAX_SIGNAL_LINES]
    if shown:
        lines.append("Discovery signals (kind, step):")
        lines += [f"- {signal.kind} step {signal.position}" for signal in shown]
    text = ""
    complete = True
    for number, line in enumerate(lines):
        if len(text) + len(line) + 1 > budget:
            complete = number > 1 + len(reads)  # the header and every read line fitted
            break
        text += line + "\n"
    return text, complete


def _assemble(preamble: str, chosen: dict[int, str], total: int) -> str:
    """Join the preamble and the kept lines in step order, with a marker for every stretch that was left out."""
    parts = [preamble.rstrip("\n")] if preamble else []
    previous = 0
    for position in sorted(chosen):
        if position > previous + 1:
            parts.append(f"[... {position - previous - 1} step(s) omitted ...]")
        parts.append(chosen[position])
        previous = position
    if total > previous:
        parts.append(f"[... {total - previous} step(s) omitted ...]")
    return "\n".join(parts)


# ---------------------------------------------------------------------------------------------------------------------
# Rendering one step


def _render(step: _Step, calls: dict[str, _Step], limits: Mapping[str, int]) -> str:
    record = step.record
    if isinstance(record, Prompt):
        return f"[{step.position}] USER: {_cut(record.text, limits['prompt'])}"
    if isinstance(record, AssistantText):
        return f"[{step.position}] ASSISTANT: {_cut(record.text, limits['text'])}"
    if isinstance(record, ToolCall):
        arguments = json.dumps(dict(record.arguments), ensure_ascii=True, default=str)
        return f"[{step.position}] CALL {record.name} {_cut(arguments, limits['args'])}"
    call = calls.get(record.call_id)
    origin = f"({call.position})" if call is not None else ""
    flag = "ERROR" if record.is_error else "ok"
    return f"[{step.position}] RESULT{origin} {flag}: {_ends(record.text, limits['lines'], limits['line'])}"


def _cut(text: str, limit: int) -> str:
    """Return ``text`` on one line, at most ``limit`` characters (the cut is marked)."""
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: max(limit - 3, 0)] + "..."


def _ends(text: str, lines: int, width: int) -> str:
    """Return the first and last ``lines`` lines of a result, each at most ``width`` characters, joined by `` | ``."""
    rows = [row.strip() for row in text.splitlines() if row.strip()]
    if len(rows) > 2 * lines:
        omitted = f"[{len(rows) - 2 * lines} lines omitted]"
        rows = [*rows[:lines], omitted, *rows[-lines:]]
    return " | ".join(_cut(row, width) for row in rows) or "(empty)"
