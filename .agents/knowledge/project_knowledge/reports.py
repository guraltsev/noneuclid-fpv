"""Reports over the event log: the funnel, grades, usage and slices of design section 10, and the per-note statistics.

This module imports ``events`` and ``notes`` only and prints nothing. Counts are of unique (note, session) pairs, where
a session is a runtime together with a session id. Key rules: a ``read_failed`` event is never a read; a note read
without having been surfaced in the same session counts as read but not towards the read rate; a surfaced note that was
not read says nothing about its content; a read with no grade is *ungraded*, never negative; a pair's grade is the last
one other than ``unknown`` that the grader gave it; a self-assessment is counted apart from grades (design section 10.2).
``note_stats`` gives the same counts per note to the curator (``curate.py``).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from project_knowledge.events import Event
from project_knowledge.notes import CALL_OUTCOMES, CALL_PURPOSES, GRADE_OUTCOMES, Note

PairKey = tuple[str, str, str]  # (runtime, session id, note id)


@dataclass(frozen=True)
class NoteFunnel:
    """The funnel counts of one note: sessions that surfaced it, that read it, and that did both."""

    note_id: str
    surfaced: int
    read: int
    read_of_surfaced: int


@dataclass(frozen=True)
class RuntimeFunnel:
    """The funnel counts of one runtime (Claude Code, Codex, ...): its sessions and its (note, session) pairs."""

    runtime: str
    sessions: int
    surfaced: int
    read: int
    read_of_surfaced: int


@dataclass(frozen=True)
class Funnel:
    """The surfaced to read funnel for a period.

    ``surfaced`` and ``read`` count unique (note, session) pairs; ``read_of_surfaced`` counts the pairs that are in both;
    ``read_rate`` is ``read_of_surfaced / surfaced``, or ``None`` when nothing was surfaced; ``read_failed`` counts
    failed read events; ``sessions`` counts sessions with any surfaced or read event.
    """

    since: dt.date | None
    until: dt.date | None
    surfaced: int
    read: int
    read_of_surfaced: int
    read_rate: float | None
    read_failed: int
    sessions: int
    by_note: tuple[NoteFunnel, ...]
    by_runtime: tuple[RuntimeFunnel, ...] = ()

    def as_dict(self) -> dict[str, object]:
        """Return the funnel as the plain mapping printed by ``knowledge report --json``."""
        return {
            "period": {
                "since": self.since.isoformat() if self.since else None,
                "until": self.until.isoformat() if self.until else None,
            },
            "surfaced": self.surfaced,
            "read": self.read,
            "read_of_surfaced": self.read_of_surfaced,
            "read_rate": self.read_rate,
            "read_failed": self.read_failed,
            "sessions": self.sessions,
            "by_note": [
                {
                    "note_id": row.note_id,
                    "surfaced": row.surfaced,
                    "read": row.read,
                    "read_of_surfaced": row.read_of_surfaced,
                }
                for row in self.by_note
            ],
            "by_runtime": [
                {
                    "runtime": row.runtime,
                    "sessions": row.sessions,
                    "surfaced": row.surfaced,
                    "read": row.read,
                    "read_of_surfaced": row.read_of_surfaced,
                }
                for row in self.by_runtime
            ],
        }

    def as_text(self) -> str:
        """Return the funnel as the readable text printed by ``knowledge report``, with counts beside the rate."""
        period = f"{self.since or 'the start'} to {self.until or 'now'}" if self.since or self.until else "all time"
        rate = "no notes surfaced" if self.read_rate is None else f"{self.read_rate:.1%}"
        lines = [
            f"Funnel, {period} ({self.sessions} session(s))",
            f"  surfaced (note, session pairs): {self.surfaced}",
            f"  read (note, session pairs):     {self.read}",
            f"  read after being surfaced:      {self.read_of_surfaced} of {self.surfaced} ({rate})",
            f"  failed reads:                   {self.read_failed}",
        ]
        if self.by_note:
            lines.append("By note:")
            lines += [
                f"  {row.note_id}  surfaced {row.surfaced}, read {row.read}, read after surfaced {row.read_of_surfaced}"
                for row in self.by_note
            ]
        if self.by_runtime:
            lines.append("By runtime:")
            lines += [
                f"  {row.runtime}  {row.sessions} session(s), surfaced {row.surfaced}, read {row.read}, "
                f"read after surfaced {row.read_of_surfaced}"
                for row in self.by_runtime
            ]
        lines.append("A read is not a grade, and a surfaced note that was not read says nothing about its content.")
        return "\n".join(lines)


def funnel(events: Iterable[Event], *, since: dt.date | None = None, until: dt.date | None = None) -> Funnel:
    """Count the surfaced to read funnel over events whose UTC date is within ``since`` to ``until`` (both inclusive)."""
    surfaced: set[PairKey] = set()
    read: set[PairKey] = set()
    sessions: set[tuple[str, str]] = set()
    failed = 0

    # Keep each (note, session) pair once, whatever the number of events that mention it.
    for event in events:
        day = dt.date.fromisoformat(event.ts[:10])
        if (since and day < since) or (until and day > until):
            continue
        if event.type == "read_failed":
            failed += 1
        elif event.type in ("surfaced", "read") and event.note_id is not None:
            pair = (event.runtime, event.session_id, event.note_id)
            (surfaced if event.type == "surfaced" else read).add(pair)
            sessions.add((event.runtime, event.session_id))

    both = surfaced & read
    per_note: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for pairs, column in ((surfaced, 0), (read, 1), (both, 2)):
        for _runtime, _session, note_id in pairs:
            per_note[note_id][column] += 1
    rows = sorted(per_note.items(), key=lambda item: (-item[1][0], item[0]))
    runtimes = sorted({runtime for runtime, _ in sessions})
    by_runtime = tuple(
        RuntimeFunnel(
            runtime,
            sum(1 for name, _ in sessions if name == runtime),
            sum(1 for pair in surfaced if pair[0] == runtime),
            sum(1 for pair in read if pair[0] == runtime),
            sum(1 for pair in both if pair[0] == runtime),
        )
        for runtime in runtimes
    )
    return Funnel(
        since=since,
        until=until,
        surfaced=len(surfaced),
        read=len(read),
        read_of_surfaced=len(both),
        read_rate=len(both) / len(surfaced) if surfaced else None,
        read_failed=failed,
        sessions=len(sessions),
        by_note=tuple(NoteFunnel(note_id, *counts) for note_id, counts in rows),
        by_runtime=by_runtime,
    )


# ---------------------------------------------------------------------------------------------------------------------
# Pairs: what happened to one note in one session

USEFUL_OUTCOMES = ("used", "helpful")
FALSE_POSITIVE_OUTCOMES = (
    "irrelevant",
    "misleading",
    "stale",
)  # design 10.2: the summary promised what the note lacked
UNKNOWN_KEY = "unknown"
AGE_BUCKETS = ("under 7 days", "7 to 29 days", "30 to 89 days", "90 days or more")
USAGE_SUMS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "turns",
    "messages",
    "tool_calls",
    "failed_tool_calls",
    "duration_seconds",
    "notes_surfaced",
    "notes_read",
    "notes_written",
    "brief_chars",
    "read_chars",
)
HOLDOUT_MEANS = ("input_tokens", "output_tokens", "turns", "tool_calls", "failed_tool_calls")
CHARS_PER_TOKEN = 4  # the design's conservative estimate (section 7.4)


@dataclass(frozen=True)
class Pair:
    """Everything the log says about one note in one session: shown (how), opened, graded (by whom), self-assessed."""

    runtime: str
    session_id: str
    note_id: str
    surfaced: bool
    read: bool
    triggers: frozenset[str]
    models: frozenset[str]
    outcome: str | None  # the last grade other than ``unknown``
    graded: bool  # any grade at all, ``unknown`` included
    grader_models: frozenset[str]
    self_outcome: str | None


def pairs(
    events: Iterable[Event],
    *,
    since: dt.date | None = None,
    until: dt.date | None = None,
    after: Mapping[str, str] | None = None,
    grades_after: Mapping[str, str] | None = None,
) -> list[Pair]:
    """Fold events (within the period) into one ``Pair`` per (runtime, session, note).

    ``after`` maps a note id to a time: ``surfaced`` and ``read`` events of that note at or before it are ignored (the
    curator uses it so that evidence about an earlier wording of a summary does not count). ``grades_after`` does the same
    for ``graded`` events (the curator uses it so that grades of a text that was corrected since do not count). Without
    them nothing is cut: the report describes everything that happened.
    """
    cut = after or {}
    grade_cut = grades_after or {}
    table: dict[tuple[str, str, str], dict[str, Any]] = {}
    for event in sorted(events, key=lambda item: item.ts):  # stable: the file order decides within a second
        day = dt.date.fromisoformat(event.ts[:10])
        if (since and day < since) or (until and day > until) or event.note_id is None:
            continue
        if event.type not in ("surfaced", "read", "graded", "self_assessed"):
            continue
        if event.type in ("surfaced", "read") and event.ts <= cut.get(event.note_id, ""):
            continue
        if event.type == "graded" and event.ts <= grade_cut.get(event.note_id, ""):
            continue
        row = table.setdefault(
            (event.runtime, event.session_id, event.note_id),
            {"triggers": set(), "models": set(), "graders": set(), "surfaced": False, "read": False, "graded": False},
        )
        if event.model:
            row["models"].add(event.model)
        outcome = event.data.get("outcome")
        if event.type == "surfaced":
            row["surfaced"] = True
            row["triggers"].add(str(event.data.get("trigger", UNKNOWN_KEY)))
        elif event.type == "read":
            row["read"] = True
        elif event.type == "graded":
            row["graded"] = True
            if event.data.get("grader_model"):
                row["graders"].add(str(event.data["grader_model"]))
            if outcome in GRADE_OUTCOMES and outcome != "unknown":
                row["outcome"] = outcome
        elif outcome in GRADE_OUTCOMES:
            row["self_outcome"] = outcome
    return [
        Pair(
            runtime,
            session,
            note_id,
            row["surfaced"],
            row["read"],
            frozenset(row["triggers"]),
            frozenset(row["models"]),
            row.get("outcome"),
            row["graded"],
            frozenset(row["graders"]),
            row.get("self_outcome"),
        )
        for (runtime, session, note_id), row in sorted(table.items())
    ]


@dataclass(frozen=True)
class Cohort:
    """The funnel of design 10.2 for a set of pairs, with the counts behind every rate.

    ``graded`` counts the pairs with a grade other than ``unknown``; ``unknown`` those graded only ``unknown``;
    ``ungraded_reads`` the pairs that were read and have no grade at all. ``insufficient_data`` is the report flag of
    design 10.5: fewer than ``minimum`` independent graded sessions (a pair is one session of one note).
    """

    surfaced: int
    read: int
    read_of_surfaced: int
    graded: int
    unknown: int
    ungraded_reads: int
    outcomes: Mapping[str, int]
    minimum: int

    @property
    def insufficient_data(self) -> bool:
        """Whether there are too few graded pairs to read anything into the rates (design 10.5)."""
        return self.graded < self.minimum

    def count(self, labels: Sequence[str]) -> int:
        """The graded pairs whose grade is one of ``labels``."""
        return sum(self.outcomes.get(label, 0) for label in labels)

    def as_dict(self) -> dict[str, Any]:
        """Return the cohort as plain data; each rate is ``{"count", "of", "rate"}`` so the counts are never lost."""
        return {
            "surfaced": self.surfaced,
            "read": self.read,
            "read_of_surfaced": self.read_of_surfaced,
            "read_rate": _rate(self.read_of_surfaced, self.surfaced),
            "graded": self.graded,
            "unknown": self.unknown,
            "ungraded_reads": self.ungraded_reads,
            "useful_after_read": _rate(self.count(USEFUL_OUTCOMES), self.graded),
            "material_use": _rate(self.count(("used",)), self.graded),
            "misleading_or_stale": _rate(self.count(("misleading", "stale")), self.graded),
            "summary_false_positives": _rate(self.count(FALSE_POSITIVE_OUTCOMES), self.graded),
            "outcomes": {label: self.outcomes.get(label, 0) for label in GRADE_OUTCOMES if label != "unknown"},
            "insufficient_data": self.insufficient_data,
        }


def _rate(count: float, of: float) -> dict[str, Any]:
    return {"count": count, "of": of, "rate": count / of if of else None}


def cohort_of(group: Iterable[Pair], minimum: int) -> Cohort:
    """Count the funnel steps of a set of pairs."""
    members = list(group)
    outcomes: dict[str, int] = defaultdict(int)
    for pair in members:
        if pair.outcome is not None:
            outcomes[pair.outcome] += 1
    return Cohort(
        surfaced=sum(pair.surfaced for pair in members),
        read=sum(pair.read for pair in members),
        read_of_surfaced=sum(pair.surfaced and pair.read for pair in members),
        graded=sum(pair.outcome is not None for pair in members),
        unknown=sum(pair.graded and pair.outcome is None for pair in members),
        ungraded_reads=sum(pair.read and not pair.graded for pair in members),
        outcomes=dict(outcomes),
        minimum=minimum,
    )


def content_revisions(events: Iterable[Event]) -> dict[str, str]:
    """The time of the last revision of each note that changed its title or body (the text that grades judge)."""
    since: dict[str, str] = {}
    for event in events:
        changed = event.data.get("changed")
        if event.type == "revised" and event.note_id and isinstance(changed, list) and {"title", "body"} & set(changed):
            since[event.note_id] = max(since.get(event.note_id, ""), event.ts)
    return since


@dataclass(frozen=True)
class NoteStats:
    """The session counts of one note for the curator: surfaced, read, read after surfaced, and grades by outcome."""

    note_id: str
    surfaced: int
    read: int
    read_of_surfaced: int
    graded: int
    unknown: int
    outcomes: Mapping[str, int]

    def count(self, labels: Sequence[str]) -> int:
        """The graded sessions whose grade is one of ``labels``."""
        return sum(self.outcomes.get(label, 0) for label in labels)

    def share(self, labels: Sequence[str]) -> float | None:
        """The share of graded sessions with one of ``labels``, or ``None`` when no session was graded."""
        return self.count(labels) / self.graded if self.graded else None


def note_stats(
    events: Iterable[Event],
    *,
    retrieval_since: Mapping[str, str] | None = None,
    grades_since: Mapping[str, str] | None = None,
) -> dict[str, NoteStats]:
    """Return the statistics of every note that appears in the events, over all time.

    ``retrieval_since`` maps a note id to the time of its last change of retrieval text; surfaced and read counts start
    after it (``pairs``, ``after``), so a rewritten summary is judged on how it performs, not on its predecessor.
    ``grades_since`` maps a note id to the time its title or body last changed (``content_revisions``); grades given
    before it are not counted, because they judged text that no longer exists.
    """
    by_note: dict[str, list[Pair]] = defaultdict(list)
    for pair in pairs(events, after=retrieval_since, grades_after=grades_since):
        by_note[pair.note_id].append(pair)
    stats = {}
    for note_id, group in by_note.items():
        cohort = cohort_of(group, 0)
        stats[note_id] = NoteStats(
            note_id,
            cohort.surfaced,
            cohort.read,
            cohort.read_of_surfaced,
            cohort.graded,
            cohort.unknown,
            cohort.outcomes,
        )
    return stats


# ---------------------------------------------------------------------------------------------------------------------
# Slices (design 10.4)


def _age_bucket(note: Note, now: dt.datetime) -> str:
    created = dt.datetime.strptime(note.created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)
    days = (now - created).days
    return AGE_BUCKETS[0 if days < 7 else 1 if days < 30 else 2 if days < 90 else 3]


def _slices(
    members: Sequence[Pair], notes: Mapping[str, Note], now: dt.datetime, minimum: int
) -> dict[str, list[dict[str, Any]]]:
    """Group the pairs by each slice of design 10.4; a pair may fall in several groups of the multi-valued slices."""

    def of_note(getter: Callable[[Note], str]) -> Callable[[Pair], list[str]]:
        return lambda pair: [getter(notes[pair.note_id])] if pair.note_id in notes else [UNKNOWN_KEY]

    keys: dict[str, Callable[[Pair], list[str]]] = {
        "note_type": of_note(lambda note: note.type),
        "age": of_note(lambda note: _age_bucket(note, now)),
        "evidence_level": of_note(lambda note: note.evidence_level or "none"),
        "creation_method": of_note(lambda note: note.created_by.method),
        "runtime": lambda pair: [pair.runtime],
        "model": lambda pair: sorted(pair.models) or [UNKNOWN_KEY],
        "trigger": lambda pair: sorted(pair.triggers),  # a pair that was never surfaced has no trigger
        "grader_model": lambda pair: sorted(pair.grader_models),
    }
    result: dict[str, list[dict[str, Any]]] = {}
    for name, key in keys.items():
        groups: dict[str, list[Pair]] = defaultdict(list)
        for pair in members:
            for value in key(pair):
                groups[value].append(pair)
        order = AGE_BUCKETS if name == "age" else sorted(groups)
        result[name] = [
            {
                "key": value,
                "notes": len({pair.note_id for pair in groups[value]}),
                **cohort_of(groups[value], minimum).as_dict(),
            }
            for value in order
            if value in groups
        ]
    return result


# ---------------------------------------------------------------------------------------------------------------------
# Usage (design 10.3)


def _usage(events: Iterable[Event], since: dt.date | None, until: dt.date | None, minimum: int) -> dict[str, Any]:
    """Aggregate the ``session_usage`` events per session, runtime and model, with the knowledge system's own overhead."""
    sessions: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        day = dt.date.fromisoformat(event.ts[:10])
        if (since and day < since) or (until and day > until):
            continue
        if event.type == "session_usage":
            row = sessions.setdefault(
                (event.runtime, event.session_id),
                {**dict.fromkeys(USAGE_SUMS, 0), "models": set(), "withheld": None},
            )
            for name in USAGE_SUMS:
                value = event.data.get(name)
                row[name] += value if isinstance(value, int) and not isinstance(value, bool) else 0
            row["models"].update(str(model) for model in event.data.get("models", []) if isinstance(model, str))
            if isinstance(event.data.get("brief_withheld"), bool):
                row["withheld"] = event.data["brief_withheld"]

    def total(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
        members = list(rows)
        return {"sessions": len(members), **{name: sum(row[name] for row in members) for name in USAGE_SUMS}}

    def grouped(label: Callable[[tuple[str, str], dict[str, Any]], str], name: str) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for session, row in sessions.items():
            groups[label(session, row)].append(row)
        return [{name: key, **total(groups[key])} for key in sorted(groups)]

    everything = total(sessions.values())
    overhead = (everything["brief_chars"] + everything["read_chars"]) // CHARS_PER_TOKEN
    input_side = everything["input_tokens"] + everything["cache_read_tokens"] + everything["cache_write_tokens"]
    by_session = sorted(
        (
            {
                "runtime": runtime,
                "session_id": session_id,
                "models": sorted(row["models"]),
                **{name: row[name] for name in USAGE_SUMS},
                "brief_withheld": row["withheld"],
            }
            for (runtime, session_id), row in sessions.items()
        ),
        key=lambda item: (-(item["input_tokens"] + item["output_tokens"]), item["runtime"], item["session_id"]),
    )
    return {
        "totals": everything,
        "knowledge_overhead": {
            "brief_chars": everything["brief_chars"],
            "read_chars": everything["read_chars"],
            "estimated_tokens": overhead,
            "share_of_input_side_tokens": _rate(overhead, input_side),
        },
        "by_runtime": grouped(lambda session, _row: session[0], "runtime"),
        "by_model": grouped(lambda _session, row: "+".join(sorted(row["models"])) or UNKNOWN_KEY, "model"),
        "by_session": by_session,
        "holdout": _holdout(sessions, minimum),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Spend (design 10.3): what each model-calling part costs, next to what the sessions cost

TOKEN_KINDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
PRICE_KEYS = dict(zip(TOKEN_KINDS, ("input", "output", "cache_read", "cache_write"), strict=True))
SESSION_PURPOSES = ("grader", "brief_selection")  # the calls that a session causes; the curator's belong to no session
OVERHEAD_METHOD = (
    "Estimate, not a measurement: the characters of briefs and of full note reads divided by 4 are the tokens injected; "
    "an injected token stays in the context and is read again by every later model response of its range, so a brief "
    "(injected at the start of the range) counts once per response of the range and a note read (at an unknown point, "
    "taken as the middle) half as often. Responses of later ranges are not counted, so it can be low. Where the "
    "tool descriptions of the knowledge MCP server could be measured, their size is added once per session, assuming "
    "that the server is registered."
)


@dataclass(frozen=True)
class Call:
    """One call of the small model, from a ``model_call`` event or an older event that carried only a cost."""

    purpose: str
    outcome: str
    session: tuple[str, str]  # (runtime, session id) of the session that caused it
    model: str | None
    tokens: Mapping[str, int]  # only the kinds that the CLI reported
    reported_usd: float | None


def _whole(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0 else None


def _calls(events: Iterable[Event], since: dt.date | None, until: dt.date | None) -> list[Call]:
    """The calls of the small model in the period.

    Older histories have no ``model_call`` event: a ``graded`` event with ``grader_cost_usd``, a ``selector_call`` event and
    a ``curated`` event with ``cost_usd`` each stand for one successful call whose tokens are unknown. A history has either
    form for one call, never both (the writer of ``model_call`` stopped writing them).
    """
    calls = []
    for event in events:
        day = dt.date.fromisoformat(event.ts[:10])
        if (since and day < since) or (until and day > until):
            continue
        data = event.data
        who = (event.runtime, event.session_id)
        model = data.get("model") if isinstance(data.get("model"), str) else None
        if event.type == "model_call":
            if data.get("purpose") in CALL_PURPOSES and data.get("outcome") in CALL_OUTCOMES:
                tokens = {kind: data[kind] for kind in TOKEN_KINDS if _whole(data.get(kind)) is not None}
                calls.append(Call(data["purpose"], data["outcome"], who, model, tokens, _number(data.get("cost_usd"))))
        elif event.type == "graded" and _number(data.get("grader_cost_usd")) is not None:
            grader = data.get("grader_model") if isinstance(data.get("grader_model"), str) else None
            calls.append(Call("grader", "ok", who, grader, {}, _number(data["grader_cost_usd"])))
        elif event.type == "selector_call":
            calls.append(Call("brief_selection", "ok", who, model, {}, _number(data.get("cost_usd"))))
        elif event.type == "curated" and _number(data.get("cost_usd")) is not None:
            calls.append(Call("curator", "ok", who, model, {}, _number(data["cost_usd"])))
    return calls


def _estimate(model: str | None, tokens: Mapping[str, int], pricing: Mapping[str, Mapping[str, float]]) -> float | None:
    """The USD of ``tokens`` at the configured price of ``model``; ``None`` unless the model is priced and all four kinds are known."""
    price = pricing.get(model or "")
    if price is None or any(kind not in tokens for kind in TOKEN_KINDS):
        return None
    return sum(tokens[kind] * price[PRICE_KEYS[kind]] for kind in TOKEN_KINDS) / 1_000_000


def _money(calls: Sequence[Call], pricing: Mapping[str, Mapping[str, float]]) -> dict[str, Any]:
    """The USD of ``calls``: the cost the CLI reported, else an estimate from tokens and ``[pricing]``, else unknown.

    ``amount`` adds up the calls that have a figure (``None`` if none has); the counts say how many were reported, estimated
    and unknown, so an unknown call is never counted as free.
    """
    amounts, reported, estimated = [], 0, 0
    for call in calls:
        if call.reported_usd is not None:
            amounts.append(call.reported_usd)
            reported += 1
            continue
        guess = _estimate(call.model, call.tokens, pricing)
        if guess is not None:
            amounts.append(guess)
            estimated += 1
    return {
        "amount": round(sum(amounts), 6) if amounts else None,
        "reported_calls": reported,
        "estimated_calls": estimated,
        "unknown_calls": len(calls) - reported - estimated,
    }


def _tokens(calls: Sequence[Call]) -> dict[str, Any]:
    """The tokens of ``calls`` by kind (``None`` when no call reported that kind), their total and how many reported."""
    result: dict[str, Any] = {}
    for kind in TOKEN_KINDS:
        known = [call.tokens[kind] for call in calls if kind in call.tokens]
        result[kind] = sum(known) if known else None
    reporting = sum(1 for call in calls if call.tokens)
    result["total"] = sum(value for value in result.values() if value is not None) if reporting else None
    result["calls_reporting"] = reporting
    return result


def _purpose_row(name: str, calls: Sequence[Call], pricing: Mapping[str, Mapping[str, float]]) -> dict[str, Any]:
    outcomes = {outcome: sum(1 for call in calls if call.outcome == outcome) for outcome in CALL_OUTCOMES}
    return {
        "purpose": name,
        "calls": len(calls),
        "failed_calls": len(calls) - outcomes["ok"],
        "outcomes": outcomes,
        "tokens": _tokens(calls),
        "usd": _money(calls, pricing),
    }


def _spend(
    events: Sequence[Event],
    since: dt.date | None,
    until: dt.date | None,
    minimum: int,
    pricing: Mapping[str, Mapping[str, float]],
    tool_description_chars: int | None,
) -> dict[str, Any]:
    """Per purpose the calls, failures, tokens and USD, and per session and in total the share of the session's spend.

    The calls of the grader and of the brief selection run outside the session (a separate process that keeps no
    transcript), so they are *added* to what the session cost; the share compares them with the session's own tokens.
    The briefs, note reads and tool descriptions are inside the session; their size is an estimate (``OVERHEAD_METHOD``).
    A figure that no call or record reported is ``None``, and every rate carries its counts.
    """
    calls = _calls(events, since, until)
    purposes = [_purpose_row(name, [c for c in calls if c.purpose == name], pricing) for name in CALL_PURPOSES]
    tool_tokens = None if tool_description_chars is None else tool_description_chars // CHARS_PER_TOKEN

    # The sessions with a usage record, summed over their records.
    sessions: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        day = dt.date.fromisoformat(event.ts[:10])
        if event.type != "session_usage" or (since and day < since) or (until and day > until):
            continue
        row = sessions.setdefault(
            (event.runtime, event.session_id),
            {"tokens": dict.fromkeys(TOKEN_KINDS, 0), "models": set(), "notes_read": 0, "injected": 0, "reread": 0},
        )
        for kind in TOKEN_KINDS:
            row["tokens"][kind] += _whole(event.data.get(kind)) or 0
        row["models"].update(str(model) for model in event.data.get("models", []) if isinstance(model, str))
        row["notes_read"] += _whole(event.data.get("notes_read")) or 0
        brief = _whole(event.data.get("brief_chars")) or 0
        read = _whole(event.data.get("read_chars")) or 0
        messages = _whole(event.data.get("messages")) or 0
        row["injected"] += (brief + read) // CHARS_PER_TOKEN
        row["reread"] += (brief * messages + read * messages // 2) // CHARS_PER_TOKEN
    for key, row in sessions.items():
        row["calls"] = [call for call in calls if call.purpose in SESSION_PURPOSES and call.session == key]
    unmatched = sum(1 for call in calls if call.purpose in SESSION_PURPOSES and call.session not in sessions)

    def group(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
        own = [call for row in rows for call in row["calls"]]
        session_tokens = sum(sum(row["tokens"].values()) for row in rows)
        call_tokens = _tokens(own)
        overhead = sum(row["injected"] + row["reread"] + (tool_tokens or 0) for row in rows)
        session_usd = [
            _estimate(next(iter(row["models"])) if len(row["models"]) == 1 else None, row["tokens"], pricing)
            for row in rows
        ]
        known = [amount for amount in session_usd if amount is not None]
        calls_usd = _money(own, pricing)
        complete = bool(rows) and len(known) == len(rows) and calls_usd["unknown_calls"] == 0
        return {
            "sessions": len(rows),
            "insufficient_data": len(rows) < minimum,
            "session_tokens": session_tokens,
            "calls": {
                "count": len(own),
                "tokens": call_tokens["total"],
                "calls_without_tokens": len(own) - call_tokens["calls_reporting"],
            },
            "calls_share_of_session_tokens": (
                _rate(call_tokens["total"], session_tokens)
                if call_tokens["total"] is not None
                else {"count": None, "of": session_tokens, "rate": None}  # no call reported tokens: unknown, not 0
            ),
            "injected_tokens": sum(row["injected"] for row in rows),
            "reread_tokens": sum(row["reread"] for row in rows),
            "tool_description_tokens": None if tool_tokens is None else tool_tokens * len(rows),
            "overhead_share_of_session_tokens": _rate(overhead, session_tokens),
            "session_usd": {"amount": round(sum(known), 6) if known else None, "sessions_known": len(known)},
            "calls_usd": calls_usd,
            "calls_share_of_session_usd": (
                _rate(calls_usd["amount"] or 0.0, round(sum(known), 6)) if complete and sum(known) else None
            ),
        }

    by_session = [
        {"runtime": runtime, "session_id": session_id, "notes_read": row["notes_read"], **group([row])}
        for (runtime, session_id), row in sessions.items()
    ]
    by_session.sort(key=lambda item: (-item["session_tokens"], item["runtime"], item["session_id"]))
    reading = [row for row in sessions.values() if row["notes_read"] > 0]
    others = [row for row in sessions.values() if row["notes_read"] == 0]
    return {
        "purposes": purposes,
        "total": _purpose_row("all", calls, pricing),
        "priced_models": sorted(pricing),
        "tool_description_tokens_per_session": tool_tokens,
        "calls_without_session_record": unmatched,
        "shares": {
            "all": group(list(sessions.values())),
            "with_notes_read": group(reading),
            "without_notes_read": group(others),
        },
        "by_session": by_session,
        "overhead_method": OVERHEAD_METHOD,
    }


def _holdout(sessions: Mapping[tuple[str, str], dict[str, Any]], minimum: int) -> dict[str, Any] | None:
    """Compare the sessions that got the brief with those that did not (design 10.3); ``None`` if there is no experiment.

    Only sessions that recorded a decision (``brief_withheld``) are in it. Means are per session; the comparison is
    descriptive, and flagged ``insufficient_data`` when either group has fewer than ``minimum`` sessions.
    """
    groups = {
        "briefed": [row for row in sessions.values() if row["withheld"] is False],
        "withheld": [row for row in sessions.values() if row["withheld"] is True],
    }
    if not any(groups.values()):
        return None
    result: dict[str, Any] = {}
    for name, rows in groups.items():
        result[name] = {"sessions": len(rows)} | {
            f"mean_{field}": (sum(row[field] for row in rows) / len(rows) if rows else None) for field in HOLDOUT_MEANS
        }
    result["insufficient_data"] = any(len(rows) < minimum for rows in groups.values())
    return result


# ---------------------------------------------------------------------------------------------------------------------
# The whole report


@dataclass(frozen=True)
class Report:
    """The report of design 10: the surfaced to read funnel, the graded funnel, usage, slices and per-note rows."""

    funnel: Funnel
    cohort: Cohort
    self_assessed: Mapping[str, int]
    usage: Mapping[str, Any]
    spend: Mapping[str, Any]
    slices: Mapping[str, list[dict[str, Any]]]
    notes: list[dict[str, Any]]
    minimum: int

    def as_dict(self) -> dict[str, Any]:
        """Return the report as the mapping printed by ``knowledge report --json``.

        The keys are those of the surfaced to read funnel (``Funnel.as_dict``), plus ``funnel`` (the graded funnel with
        counts), ``self_assessed``, ``usage``, ``spend`` (design 10.3), ``slices``, ``notes`` (one row per note; ``revised_after_grades`` is true
        when its title or body was revised after its first grade) and ``minimum_independent_sessions``.
        """
        return {
            **self.funnel.as_dict(),
            "funnel": self.cohort.as_dict(),
            "self_assessed": dict(self.self_assessed),
            "usage": dict(self.usage),
            "spend": dict(self.spend),
            "slices": dict(self.slices),
            "notes": self.notes,
            "minimum_independent_sessions": self.minimum,
        }

    def as_text(self) -> str:
        """Return the report as text for people: every rate with its counts, a flag where the sample is small."""
        cohort = self.cohort.as_dict()
        lines = [self.funnel.as_text(), "", "Grades (a read with no grade is ungraded, never negative):"]
        lines.append(
            f"  graded (note, session pairs): {cohort['graded']}, unknown: {cohort['unknown']}, "
            f"ungraded reads: {cohort['ungraded_reads']}{_flag(self.cohort.insufficient_data)}"
        )
        for label in ("useful_after_read", "material_use", "misleading_or_stale", "summary_false_positives"):
            lines.append(f"  {label.replace('_', ' ')}: {_show(cohort[label])}")
        lines.append("  outcomes: " + ", ".join(f"{name} {count}" for name, count in cohort["outcomes"].items()))
        if self.self_assessed:
            said = ", ".join(f"{name} {count}" for name, count in sorted(self.self_assessed.items()))
            lines.append(f"  self-assessed by agents (not grades): {said}")
        lines += self._usage_lines()
        lines += _spend_text(self.spend)
        for name, rows in self.slices.items():
            if rows:
                lines += ["", f"By {name.replace('_', ' ')}:"]
                lines += [_row_text(row, row["key"], f"{row['notes']} note(s)") for row in rows]
        if self.notes:
            lines += ["", "By note (graded sessions are independent sessions):"]
            lines += [_row_text(row, f"{row['note_id']} {row['title']}", None) for row in self.notes]
        return "\n".join(lines)

    def _usage_lines(self) -> list[str]:
        usage = self.usage
        totals, overhead = usage["totals"], usage["knowledge_overhead"]
        lines = ["", f"Usage ({totals['sessions']} session(s) with a usage record):"]
        lines.append(
            f"  tokens: input {totals['input_tokens']}, output {totals['output_tokens']}, "
            f"cache read {totals['cache_read_tokens']}, cache write {totals['cache_write_tokens']}"
        )
        lines.append(
            f"  turns {totals['turns']}, tool calls {totals['tool_calls']} (failed {totals['failed_tool_calls']}), "
            f"duration {totals['duration_seconds']} s"
        )
        lines.append(
            f"  knowledge system overhead: briefs {overhead['brief_chars']} chars, reads {overhead['read_chars']} chars, "
            f"about {overhead['estimated_tokens']} tokens ({_show(overhead['share_of_input_side_tokens'])} of input-side tokens)"
        )
        for kind in ("runtime", "model"):
            lines += [
                f"  {kind} {row[kind]}: {row['sessions']} session(s), input {row['input_tokens']}, output {row['output_tokens']}"
                for row in usage[f"by_{kind}"]
            ]
        holdout = usage["holdout"]
        if holdout:
            lines.append(
                "  holdout, sessions with and without the brief (descriptive only):"
                + _flag(holdout["insufficient_data"])
            )
            for name in ("briefed", "withheld"):
                group = holdout[name]
                means = ", ".join(
                    f"{field[5:].replace('_', ' ')} {_mean(group[field])}"
                    for field in group
                    if field.startswith("mean_")
                )
                lines.append(f"    {name}: {group['sessions']} session(s); mean per session: {means}")
        return lines


def _spend_text(spend: Mapping[str, Any]) -> list[str]:
    lines = ["", "Spend of the knowledge system's model calls (a figure nobody reported is unknown, never zero):"]
    for row in [*spend["purposes"], spend["total"]]:
        label = row["purpose"].replace("_", " ")
        failed = ", ".join(f"{name} {count}" for name, count in row["outcomes"].items() if name != "ok" and count)
        lines.append(
            f"  {label}: {row['calls']} call(s), {row['failed_calls']} failed" + (f" ({failed})" if failed else "")
        )
        lines.append(f"    {_tokens_text(row['tokens'], row['calls'])}")
        lines.append(f"    {_usd_text(row['usd'], row['calls'])}")
    priced = ", ".join(spend["priced_models"]) or "none; add [pricing] to config.toml for a USD estimate"
    lines.append(
        f"  USD is what the CLI reported, else an estimate from tokens at the configured price (models priced: {priced})."
    )
    lines.append(
        f"  {spend['calls_without_session_record']} grader or selection call(s) belong to a session with no usage record; "
        "the curator's calls belong to no session."
    )
    lines.append("Share of the sessions' own spend (tokens: input + output + cache read + cache write):")
    for name, title in (
        ("all", "all sessions"),
        ("with_notes_read", "sessions that read a note"),
        ("without_notes_read", "other sessions"),
    ):
        share = spend["shares"][name]
        calls = share["calls"]
        lines.append(f"  {title}: {share['sessions']} session(s){_flag(share['insufficient_data'])}")
        lines.append(
            f"    calls outside the session add {_show(share['calls_share_of_session_tokens'])} tokens"
            f" ({calls['count']} call(s), {calls['calls_without_tokens']} without a token figure, not counted)"
        )
        lines.append(
            f"    estimated overhead inside the session: {_show(share['overhead_share_of_session_tokens'])} tokens "
            f"(injected {share['injected_tokens']}, re-read {share['reread_tokens']}, "
            f"tool descriptions {_unknown(share['tool_description_tokens'])})"
        )
        usd = share["session_usd"]
        lines.append(
            f"    session USD (estimate): {_unknown(usd['amount'])} for {usd['sessions_known']} of {share['sessions']} session(s); "
            f"calls USD: {_unknown(share['calls_usd']['amount'])} (unknown for {share['calls_usd']['unknown_calls']} of {calls['count']}); "
            f"share: {'unknown' if share['calls_share_of_session_usd'] is None else _show_usd(share['calls_share_of_session_usd'])}"
        )
    lines.append(f"  Method: {spend['overhead_method']}")
    return lines


def _unknown(value: object) -> str:
    return "unknown" if value is None else str(value)


def _tokens_text(tokens: Mapping[str, Any], calls: int) -> str:
    kinds = ", ".join(f"{kind[:-7].replace('_', ' ')} {_unknown(tokens[kind])}" for kind in TOKEN_KINDS)
    return f"tokens: {kinds} (reported by {tokens['calls_reporting']} of {calls} call(s))"


def _usd_text(usd: Mapping[str, Any], calls: int) -> str:
    return (
        f"USD: {_unknown(usd['amount'])} (reported for {usd['reported_calls']}, estimated for {usd['estimated_calls']}, "
        f"unknown for {usd['unknown_calls']} of {calls} call(s))"
    )


def _show_usd(rate: Mapping[str, Any]) -> str:
    return f"{rate['count']} of {rate['of']} USD ({rate['rate']:.1%})" if rate["of"] else "no rate"


def _row_text(row: Mapping[str, Any], label: str, extra: str | None) -> str:
    where = f" ({extra})" if extra else ""
    return (
        f"  {label}{where}: surfaced {row['surfaced']}, read after surfaced {row['read_of_surfaced']} of {row['surfaced']}, "
        f"graded {row['graded']}, useful after read {_show(row['useful_after_read'])}{_flag(row['insufficient_data'])}"
        f"{'  [revised after some grades]' if row.get('revised_after_grades') else ''}"
    )


def _show(rate: Mapping[str, Any]) -> str:
    if rate["count"] is None:
        return f"unknown of {rate['of']}"
    return f"{rate['count']} of {rate['of']} ({rate['rate']:.1%})" if rate["of"] else f"{rate['count']} of 0 (no rate)"


def _flag(insufficient: bool) -> str:
    return "  [insufficient_data]" if insufficient else ""


def _mean(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}"


def build_report(
    events: Sequence[Event],
    notes: Mapping[str, Note],
    *,
    since: dt.date | None = None,
    until: dt.date | None = None,
    now: dt.datetime,
    minimum: int = 5,
    pricing: Mapping[str, Mapping[str, float]] | None = None,
    tool_description_chars: int | None = None,
) -> Report:
    """Build the whole report for a period: ``notes`` (by id) give the slices their note fields, ``now`` the age of a note.

    ``pricing`` is the ``[pricing]`` table (USD per million tokens by model name; ``PRICE_KEYS``), empty by default.
    ``tool_description_chars`` is the measured size of the knowledge MCP server's tool descriptions, ``None`` if not measured.
    """
    members = pairs(events, since=since, until=until)
    by_note: dict[str, list[Pair]] = defaultdict(list)
    for pair in members:
        by_note[pair.note_id].append(pair)
    revised = content_revisions(events)
    first_grade: dict[str, str] = {}
    for event in sorted(events, key=lambda item: item.ts):
        if event.type == "graded" and event.note_id:
            first_grade.setdefault(event.note_id, event.ts)
    rows = []
    for note_id, group in by_note.items():
        known = notes.get(note_id)
        rows.append(
            {
                "note_id": note_id,
                "title": known.title if known else "(note not found)",
                "status": known.status if known else None,
                **cohort_of(group, minimum).as_dict(),
                # The grades are all counted above; this says that some of them judged an earlier body or title.
                "revised_after_grades": note_id in first_grade and revised.get(note_id, "") > first_grade[note_id],
            }
        )
    rows.sort(key=lambda row: (-row["surfaced"], row["note_id"]))
    self_assessed: dict[str, int] = defaultdict(int)
    for pair in members:
        if pair.self_outcome:
            self_assessed[pair.self_outcome] += 1
    return Report(
        funnel=funnel(events, since=since, until=until),
        cohort=cohort_of(members, minimum),
        self_assessed=dict(self_assessed),
        usage=_usage(events, since, until, minimum),
        spend=_spend(events, since, until, minimum, pricing or {}, tool_description_chars),
        slices=_slices(members, notes, now, minimum),
        notes=rows,
        minimum=minimum,
    )
