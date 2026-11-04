"""Operations: the compositions of the core that every interface shares.

``store`` may not import ``search``, so the steps that need both live here: saving a note with the duplicate check,
searching and then logging what was surfaced, building the brief, delivering a note and logging the read. The command
line, the hooks and the MCP server call these functions; none of them imports another interface module. This module
never prints. It also keeps the small per-session state files that the hooks and the interfaces share (the active
session and the brief markers), runs the session job (usage, then digest and grading) and records self-assessments.

Imports: ``notes``, ``events``, ``store``, ``search``, ``config``, ``transcripts``, ``usage``, ``grading``.
"""

from __future__ import annotations

import datetime as dt
import functools
import json
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from project_knowledge.config import EMBEDDING_MIN_SIMILARITY, Config
from project_knowledge.events import Event, EventContext, EventError, load_events, new_event
from project_knowledge.grading import (
    GRADER_PROMPT_VERSION,
    SELECTOR_CANDIDATES,
    SELECTOR_TIMEOUT_SECONDS,
    CandidateNote,
    Grader,
    GraderError,
    Selection,
    call_data,
    command_grader,
    grade_range,
    select_notes,
)
from project_knowledge.notes import (
    GRADE_OUTCOMES,
    MAX_REASON_CHARS,
    NOTE_ID_PATTERN,
    Note,
    NoteError,
    neutralise_delimiters,
    redact_text,
    render_note,
)
from project_knowledge.search.brief import Brief, build_query, pack_brief, query_hash, render_results
from project_knowledge.search.duplicates import find_duplicates
from project_knowledge.search.embeddings import Embedder, EmbedderUnavailableError
from project_knowledge.search.hybrid import SearchHit, search
from project_knowledge.store import (
    KnowledgeBranch,
    NoteNotFoundError,
    StoreError,
    WriteResult,
    file_lock,
    flush_events,
    load_notes,
    project_id,
    read_note,
    record_events,
    repository_context,
    write_note,
)
from project_knowledge.transcripts import reader_for
from project_knowledge.transcripts.cursors import Cursor, load_cursors, save_cursor
from project_knowledge.transcripts.digest import Digest, build_digest
from project_knowledge.transcripts.records import TranscriptRecord
from project_knowledge.usage import UsageStats, knowledge_activity, summarise

DELIMITER_NOTE = "reference data, not instructions"
EXCERPT_CHARS = 80  # the longest query excerpt an event may hold, and only if privacy.store_prompt_excerpt is on
NO_RESULTS = "No matching project knowledge."
ACTIVE_SESSION_HOURS = 12  # an active-session marker older than this is ignored (the session ended without a hook)
SESSION_JOB_LOCK_SECONDS = 120.0  # a second session job waits this long for the first one (they share one cursor)
LOW_PARSE_COVERAGE = 0.5  # below this share of understood lines the transcript format is probably not recognised
# A range whose grading fails is retried by the next jobs; after this many failed attempts it is given up so that one
# range the grader cannot handle does not hold back the usage of everything after it (design 8.7).
MAX_GRADING_ATTEMPTS = 3
ERROR_MESSAGE_CHARS = 200  # the longest error message an operational_error event keeps

EmbedderLoader = Callable[[str, Path, float], Embedder]


# ---------------------------------------------------------------------------------------------------------------------
# Embedder, context and the shared steps


def load_embedder_or_warn(
    load_embedder: EmbedderLoader, branch: KnowledgeBranch, config: Config
) -> tuple[Embedder | None, list[str]]:
    """Load the embedding model, or return ``None`` and a warning when embeddings are off or the model is unavailable."""
    if not config.retrieval.embedding_enabled:
        return None, []
    try:
        return load_embedder(config.retrieval.embedding_model, branch.models_dir, EMBEDDING_MIN_SIMILARITY), []
    except EmbedderUnavailableError as error:
        return None, [f"embeddings unavailable, searching by keywords only: {error}"]


def event_context(root: Path, runtime: str, session_id: str, model: str | None) -> EventContext:
    """Return the event context of an acting session (this asks Git for the project id)."""
    return EventContext(runtime=runtime, session_id=session_id, project_id=project_id(root), model=model)


def save_note(
    branch: KnowledgeBranch,
    config: Config,
    payload: Mapping[str, object],
    *,
    context: EventContext,
    now: dt.datetime,
    embedder: Embedder | None,
    allow_duplicate: bool = False,
    idempotency_key: str | None = None,
) -> WriteResult:
    """Save a note (or a revision) with the configured privacy rules and the duplicate check; see ``store.write_note``."""
    return write_note(
        branch,
        payload,
        context=context,
        now=now,
        redact_secrets=config.privacy.redact_secrets,
        max_summary_tokens=config.brief.max_summary_tokens,
        check_duplicates=functools.partial(find_duplicates, embedder=embedder, cache_path=branch.embeddings_path),
        allow_duplicate=allow_duplicate,
        idempotency_key=idempotency_key,
    )


def search_notes(
    branch: KnowledgeBranch, config: Config, query: str, *, embedder: Embedder | None, limit: int | None
) -> list[SearchHit]:
    """Search the notes of the branch (committing outside edits first); ``limit`` defaults to ``brief.max_items``."""
    return search(
        query,
        load_notes(branch).notes,
        retrieval=config.retrieval,
        embedder=embedder,
        cache_path=branch.embeddings_path,
        limit=limit or config.brief.max_items,
    )


def search_text(hits: Sequence[SearchHit], config: Config) -> str:
    """Render search hits as the ``<project-knowledge>`` block, or the sentence that nothing matched."""
    return render_results(hits, config.brief.max_summary_tokens) if hits else NO_RESULTS


@dataclass(frozen=True)
class BriefResult:
    """A brief and the query it was built from; ``brief.text`` is empty when no note passed the threshold.

    ``selection`` is the small model's choice if it made one (``offered`` is how many candidates it was shown), and
    ``selection_error`` why it could not (the brief is then the plain ranking).
    """

    query: str
    brief: Brief
    selection: Selection | None = None
    selection_error: GraderError | None = None
    offered: int = 0


def selection_grader(
    config: Config, runtime: str, environ: Mapping[str, str], injected: Grader | None
) -> Grader | None:
    """Return the model that selects notes for the brief, or ``None`` when ``retrieval.small_model_select`` is off.

    The selection runs the same isolated small-model invocation as grading (``injected`` replaces it in tests), with the
    shorter ``SELECTOR_TIMEOUT_SECONDS`` because the first prompt of a session waits for it. With ``grader.runtime``
    ``off`` there is no model (the configuration refuses that together with the switch).
    """
    if not config.retrieval.small_model_select or config.grader.runtime == "off":
        return None
    if injected is not None:
        return injected
    quick = replace(config.grader, timeout_seconds=min(config.grader.timeout_seconds, SELECTOR_TIMEOUT_SECONDS))
    return command_grader(quick, runtime, environ=environ)


def make_brief(
    branch: KnowledgeBranch,
    config: Config,
    prompt: str | None,
    *,
    embedder: Embedder | None,
    selector: Grader | None = None,
) -> BriefResult | None:
    """Build the session-start brief from the prompt and the repository context; ``None`` when briefs are disabled.

    The brief is deterministic and uses no model unless a ``selector`` is given (``selection_grader``): then the best
    ``SELECTOR_CANDIDATES`` hits are offered to it and only the ones it judges relevant are kept, in ranking order
    (design 7.4 step 6). If the model fails, the plain ranking is used and the error is returned in the result.
    """
    if not config.brief.enabled:
        return None
    repository = repository_context(branch.root)
    query = build_query(prompt, repository.branch, repository.changed_files)
    hits = search(
        query,
        load_notes(branch).notes,
        retrieval=config.retrieval,
        embedder=embedder,
        cache_path=branch.embeddings_path,
    )
    selection: Selection | None = None
    failure: GraderError | None = None
    offered = hits[:SELECTOR_CANDIDATES] if selector is not None else []
    if selector is not None and hits:
        try:
            selection = select_notes(selector, query, [(h.note.id, h.note.title, h.note.summary) for h in offered])
            hits = [hit for hit in offered if hit.note.id in selection.ids]
        except GraderError as error:
            failure = error
    brief = pack_brief(
        hits,
        token_budget=config.brief.token_budget,
        max_items=config.brief.max_items,
        max_summary_tokens=config.brief.max_summary_tokens,
    )
    return BriefResult(query, brief, selection, failure, len(offered))


def log_surfaced(
    branch: KnowledgeBranch,
    config: Config,
    context: EventContext,
    now: dt.datetime,
    trigger: str,
    query: str,
    hits: Sequence[SearchHit],
    *,
    brief_chars: int | None = None,
) -> None:
    """Record one ``surfaced`` event per hit shown, with its ranks and a hash (never the text) of the query.

    ``brief_chars`` is the number of characters a brief injected; it goes on the first event only, so that summing
    ``brief_chars`` over events counts each brief once (design 8.6).
    """
    events = []
    for position, hit in enumerate(hits):
        data: dict[str, Any] = {
            "trigger": trigger,
            "query_hash": query_hash(query),
            "keyword_rank": hit.keyword_rank,
            "semantic_rank": hit.semantic_rank,
            "fused_rank": hit.fused_rank,
        }
        if brief_chars is not None and position == 0:
            data["brief_chars"] = brief_chars
        if config.privacy.store_prompt_excerpt:
            data["query_excerpt"] = redact_text(query)[0][:EXCERPT_CHARS]  # a credential never reaches the branch
        events.append(new_event("surfaced", context, now=now, note_id=hit.note.id, note_version=hit.version, data=data))
    if events:
        record_events(branch, events, now=now)


def log_brief(
    branch: KnowledgeBranch, config: Config, context: EventContext, now: dt.datetime, made: BriefResult
) -> None:
    """Record what a brief did: a ``model_call`` event if the small model was asked, then the ``surfaced`` events.

    The ``model_call`` event (purpose ``brief_selection``) exists whatever came of the call: an answer that selected no
    note (no ``surfaced`` event then), an invalid answer, a timeout or an error of the CLI. It holds the model, the
    tokens and cost the CLI reported, the ``query_hash``, ``offered`` and, if the model answered, ``selected``. A model
    that could not be started (no CLI) made no call and leaves no event.
    """
    if made.selection is not None or made.selection_error is not None:
        extra: dict[str, Any] = {"query_hash": query_hash(made.query), "offered": made.offered}
        if made.selection is not None:
            extra["selected"] = len(made.selection.ids)
        data = call_data(
            "brief_selection", made.selection.reply if made.selection else None, made.selection_error, **extra
        )
        if data is not None:
            record_events(branch, [new_event("model_call", context, now=now, data=data)], now=now)
    log_surfaced(branch, config, context, now, "brief", made.query, made.brief.hits, brief_chars=len(made.brief.text))


@dataclass(frozen=True)
class DeliveredNote:
    """A note ready to hand over: its fields, its version, the delimited text and the size that a ``read`` records."""

    note: Note
    version: str
    text: str
    chars: int


def deliver_note(branch: KnowledgeBranch, note_id: str, *, context: EventContext, now: dt.datetime) -> DeliveredNote:
    """Read a note for delivery. A note that cannot be read is logged as ``read_failed`` (never ``read``) and the error raised.

    The caller hands ``text`` over and then calls ``log_read``, so a ``read`` is recorded only after delivery.
    """
    try:
        found = read_note(branch, note_id)
    except (NoteNotFoundError, NoteError) as error:
        reason = "not_found" if isinstance(error, NoteNotFoundError) else "invalid_note"
        known = note_id if NOTE_ID_PATTERN.fullmatch(note_id) else None
        data = {"reason": reason} if known else {"reason": reason, "requested": note_id[:80]}
        record_events(branch, [new_event("read_failed", context, now=now, note_id=known, data=data)], now=now)
        raise
    body = neutralise_delimiters(render_note(found.note))
    opening = f'<project-knowledge-note id="{found.note.id}" version="{found.version}" note="{DELIMITER_NOTE}">'
    wrapped = f"{opening}\n{body.rstrip()}\n</project-knowledge-note>"
    return DeliveredNote(found.note, found.version, wrapped, len(body))


def log_read(branch: KnowledgeBranch, delivered: DeliveredNote, *, context: EventContext, now: dt.datetime) -> None:
    """Record the ``read`` event of a note that has been delivered."""
    event = new_event(
        "read",
        context,
        now=now,
        note_id=delivered.note.id,
        note_version=delivered.version,
        data={"chars": delivered.chars},
    )
    record_events(branch, [event], now=now)


def results_payload(
    trigger: str, query: str, hits: Sequence[SearchHit], text: str, warnings: Sequence[str]
) -> dict[str, Any]:
    """Return the ``--json`` object of ``search`` and ``brief`` (design 13.2)."""
    return {
        "trigger": trigger,
        "query_hash": query_hash(query),
        "notes": [
            {
                "id": hit.note.id,
                "title": hit.note.title,
                "summary": hit.note.summary,
                "version": hit.version,
                "keyword_rank": hit.keyword_rank,
                "semantic_rank": hit.semantic_rank,
                "fused_rank": hit.fused_rank,
            }
            for hit in hits
        ],
        "text": text,
        "warnings": list(warnings),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Session state: the active session and the brief markers (derived files in .agents/.state/knowledge/)


def write_active_session(branch: KnowledgeBranch, runtime: str, session_id: str, now: dt.datetime) -> None:
    """Remember which session the hooks saw last, so the MCP server and commands run by the agent can log into it."""
    _write_json(
        branch.state_dir / "active-session.json",
        {"runtime": runtime, "session_id": session_id, "ts": now.astimezone(dt.UTC).isoformat()},
    )


def read_active_session(state_dir: Path, now: dt.datetime) -> tuple[str, str] | None:
    """Return ``(runtime, session_id)`` of the session the hooks saw last, or ``None`` if unknown or older than 12 hours."""
    record = _read_json(state_dir / "active-session.json")
    try:
        seen = dt.datetime.fromisoformat(str(record["ts"]))
        if now - seen > dt.timedelta(hours=ACTIVE_SESSION_HOURS):
            return None
        return str(record["runtime"]), str(record["session_id"])
    except (KeyError, ValueError, TypeError):
        return None


def resolve_session(
    state_dir: Path, *, runtime: str | None, session_id: str | None, now: dt.datetime, environ: Mapping[str, str]
) -> tuple[str, str]:
    """Return the ``(runtime, session id)`` that events are logged under (design 10.1).

    Explicit values win, then ``KNOWLEDGE_RUNTIME`` and ``KNOWLEDGE_SESSION_ID``, then the session the hooks saw last
    (when it is recent and of the same runtime), then ``cli`` and ``manual-<UTC date>``.
    """
    runtime = runtime or environ.get("KNOWLEDGE_RUNTIME") or None
    session_id = session_id or environ.get("KNOWLEDGE_SESSION_ID") or None
    if session_id is None:
        active = read_active_session(state_dir, now)
        if active is not None and runtime in (None, active[0]):
            return active
        session_id = f"manual-{now:%Y-%m-%d}"
    return runtime or "cli", session_id


def clear_active_session(state_dir: Path, runtime: str, session_id: str, now: dt.datetime) -> None:
    """Forget the active session if it is this one (the session has ended)."""
    if read_active_session(state_dir, now) == (runtime, session_id):
        (state_dir / "active-session.json").unlink(missing_ok=True)


def needs_brief(branch: KnowledgeBranch, config: Config, runtime: str, session_id: str) -> bool:
    """Say whether this prompt gets a brief: the first prompt of the session, or the first after a compaction.

    This only reads the marker. The caller builds the brief and then calls ``mark_briefed``; if building raises, the
    marker is untouched and the next prompt tries again (design 7.2).
    """
    if not config.brief.enabled or config.brief.trigger == "session_start":
        return False
    marker = _read_json(_brief_marker(branch, runtime, session_id))
    return not marker or bool(marker.get("compacted") and config.brief.after_compaction)


def holdout_withheld(
    branch: KnowledgeBranch, config: Config, runtime: str, session_id: str, draw: Callable[[], float]
) -> bool:
    """Say whether this session is in the holdout and gets no brief (design 10.3, ``[experiment] holdout_fraction``).

    A decision that was stored for the session always stands, whatever the fraction is by then (a session is in one
    group for its whole length, also if the configuration changes in the middle of it). Without a stored decision, with
    the fraction 0 (the default) nobody is held out, ``draw`` is not asked and nothing is written. Otherwise the session
    is drawn once, by ``draw()`` (a number in [0, 1), injected so tests can seed it): it is withheld when the draw is
    below the fraction, and the decision is stored, so every later prompt of the session (after a compaction, or after a
    failed first attempt) gets the same answer. The session job records it in ``session_usage`` as ``brief_withheld``.
    """
    path = _holdout_file(branch, runtime, session_id)
    stored = _read_json(path).get("withheld")
    if isinstance(stored, bool):
        return stored
    fraction = config.experiment.holdout_fraction
    if fraction <= 0:
        return False
    withheld = draw() < fraction
    _write_json(path, {"withheld": withheld})
    return withheld


def read_holdout(branch: KnowledgeBranch, runtime: str, session_id: str) -> bool | None:
    """Return the session's stored holdout decision (``True``: no brief), or ``None`` if it was never drawn."""
    stored = _read_json(_holdout_file(branch, runtime, session_id)).get("withheld")
    return stored if isinstance(stored, bool) else None


def _holdout_file(branch: KnowledgeBranch, runtime: str, session_id: str) -> Path:
    return branch.state_dir / "holdout" / f"{runtime}-{session_id}.json"


def mark_briefed(branch: KnowledgeBranch, runtime: str, session_id: str) -> None:
    """Record that the prompt was answered: the marker is created and the compaction flag cleared.

    It is called once the brief has been built, whether or not a note matched, so a session is briefed once.
    """
    _write_json(_brief_marker(branch, runtime, session_id), {"compacted": False})


def mark_compacted(branch: KnowledgeBranch, runtime: str, session_id: str) -> None:
    """Note that the session was compacted, so its next prompt gets a brief again."""
    path = _brief_marker(branch, runtime, session_id)
    if path.is_file():
        _write_json(path, {"compacted": True})


def _brief_marker(branch: KnowledgeBranch, runtime: str, session_id: str) -> Path:
    return branch.state_dir / "briefs" / f"{runtime}-{session_id}.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    """Write a small state file atomically (a temporary file, then a replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8", newline="\n")
    temporary.replace(path)


# ---------------------------------------------------------------------------------------------------------------------
# The session job


@dataclass(frozen=True)
class SessionJobResult:
    """What a session job did: the usage events written (one per transcript chunk), the commits, the new cursor.

    ``graded`` counts the ``graded`` events written and ``candidates`` the candidate notes saved (both 0 without a grader).
    """

    events_written: int
    commits: tuple[str, ...]
    offset: int
    warnings: tuple[str, ...]
    graded: int = 0
    candidates: int = 0


@dataclass(frozen=True)
class _GradingPlan:
    """What to ask the grader about one transcript range: the digest and the notes opened (``(id, version)`` pairs)."""

    digest: Digest
    opened: tuple[tuple[str, str], ...]


def run_session_job(
    branch: KnowledgeBranch,
    config: Config,
    transcript: Path,
    *,
    runtime: str,
    session_id: str,
    now: dt.datetime,
    model: str | None = None,
    chunk_bytes: int | None = None,
    grader: Grader | None = None,
    load_embedder: Callable[[], Embedder | None] | None = None,
) -> SessionJobResult:
    """Read the unread part of a transcript, log its usage, grade it, flush, and advance the cursor (design 8.3, 8.7).

    Each chunk is handled alone, in this order: its ``session_usage`` event (keyed by the byte range, so a repeat is
    skipped) is recorded; then, if a ``grader`` is given and the range read a note or shows a discovery signal, the digest
    is graded (``graded`` events, candidate notes through the write path); only then is the cursor moved past the chunk.
    Without a ``grader`` no model is called and the job is the usage job of Phase 2.

    The rule between grading and the cursor: the range is first marked *pending* in the cursor (its end is stored, the
    start stays), before its usage event is written, and the cursor leaves it only when grading succeeded or was not
    needed. A crash after the usage event therefore replays exactly that range (the same bytes, so the same range key and
    no second usage event, even if the transcript has grown). A grading failure (the grader missing, timing out or
    answering invalidly, or the store or the files failing while the answer is recorded) never removes the usage event,
    leaves the range pending and stops the job there, so the next job replays the range and grades it again; the events
    and notes already recorded carry idempotency keys, so nothing is written twice. Every such failure counts: after
    ``MAX_GRADING_ATTEMPTS`` failed attempts the range is given up, an ``operational_error`` event says so, and the cursor moves on; its notes stay ungraded, never graded badly.
    A transcript whose format was not understood (low parse coverage) is not graded.

    ``load_embedder`` is called, once and only if a candidate note is to be saved, for the duplicate check.

    Raises
    ------
    StoreError, EventError, OSError
        If the lock, Git or the files fail; the cursor stays where it was (or at the pending range).
    """
    size = chunk_bytes or config.session_job.chunk_bytes
    context = event_context(branch.root, runtime, session_id, model)
    key = str(transcript.resolve())
    warnings: list[str] = []
    written = graded = candidates = 0
    # One job at a time per repository: two jobs (PreCompact, then SessionEnd) share one cursor file.
    with file_lock(branch.state_dir / "session-job.lock", timeout=SESSION_JOB_LOCK_SECONDS):
        cursor = load_cursors(branch.state_dir).get(key, Cursor(0, None))
        file_size = transcript.stat().st_size
        if file_size < cursor.offset:
            cursor = Cursor(0, None)  # the file is shorter than what was read: it was replaced, so start again
        if cursor.pending_end is not None and cursor.pending_end > file_size:
            cursor = Cursor(cursor.offset, cursor.last_uuid, cursor.last_message_id)  # the pending range is gone
        while True:
            # A pending range is replayed with exactly its own bytes (it ended at a line end), whatever has grown since.
            window = cursor.pending_end - cursor.offset if cursor.pending_end is not None else size
            chunk = next(iter(reader_for(runtime)(transcript, cursor.offset, window)), None)
            if chunk is None:
                break
            stats = summarise(chunk.records, chunk.coverage, continued_from=cursor.last_message_id)
            understood = not (stats.coverage.share < LOW_PARSE_COVERAGE and stats.coverage.lines)
            if not understood:
                warnings.append(
                    f"only {stats.coverage.share:.0%} of the transcript lines in bytes {cursor.offset}-{chunk.end} "
                    "were understood; the transcript format may have changed, so the range is not graded"
                )
            # Mark the range pending before anything is written for it: a crash after the usage event is logged must
            # replay these very bytes (the same range key), whatever the transcript has grown by then.
            attempts = cursor.grading_attempts if cursor.pending_end == chunk.end else 0
            pending = replace(cursor, pending_end=chunk.end, grading_attempts=attempts)
            if stats.has_activity:
                save_cursor(branch.state_dir, key, pending)
                written += _record_usage(branch, context, stats, cursor.offset, chunk.end, now)

            # Grade the range if there is something to grade; a failure leaves the range pending and ends the job.
            plan = None
            if grader is not None and understood and stats.has_activity and attempts < MAX_GRADING_ATTEMPTS:
                plan = _plan_grading(branch, config, context, chunk.records, cursor.offset, chunk.end)
            if grader is not None and plan is not None:
                try:
                    done = _grade_range(
                        branch, config, context, plan, grader, load_embedder, now, cursor.offset, chunk.end
                    )
                except (GraderError, StoreError, EventError, OSError) as error:
                    # Every failure of this stage counts, so a range that fails for a reason of its own (a note the
                    # store refuses, a full disk) does not make the grader be paid again at the end of every session.
                    attempts += 1
                    given_up = attempts >= MAX_GRADING_ATTEMPTS
                    cursor = replace(pending, grading_attempts=attempts)
                    save_cursor(branch.state_dir, key, cursor)  # the count first: logging may fail too
                    try:
                        _log_grading_error(
                            branch, context, error, cursor.offset, chunk.end, attempts, now, given_up=given_up
                        )
                    except (StoreError, EventError, OSError) as logging_error:
                        warnings.append(f"the grading failure could not be logged ({logging_error})")
                    if not given_up:
                        warnings.append(
                            f"grading bytes {pending.offset}-{chunk.end} failed ({error}); the range is kept and the "
                            f"next job tries again (attempt {attempts} of {MAX_GRADING_ATTEMPTS})"
                        )
                        break
                    warnings.append(
                        f"grading bytes {pending.offset}-{chunk.end} failed {attempts} times ({error}); the range is "
                        "given up and its notes stay ungraded"
                    )
                else:
                    graded += done[0]
                    candidates += done[1]
                    warnings += done[2]

            # Only now is the range finished: move the cursor past it and clear the pending mark.
            cursor = Cursor(
                chunk.end, chunk.last_uuid or cursor.last_uuid, chunk.last_message_id or cursor.last_message_id
            )
            save_cursor(branch.state_dir, key, cursor)
        commits = flush_events(branch)
    return SessionJobResult(written, tuple(commits), cursor.offset, tuple(warnings), graded, candidates)


def _session_events(branch: KnowledgeBranch, context: EventContext) -> list[Event]:
    """Return the events logged under the acting session, oldest first."""
    events, _ = load_events(branch.events_dir)
    return [event for event in events if event.session_id == context.session_id and event.runtime == context.runtime]


def _record_usage(
    branch: KnowledgeBranch, context: EventContext, stats: UsageStats, start: int, end: int, now: dt.datetime
) -> int:
    """Write the ``session_usage`` event of one transcript range; return how many events were written (0 or 1).

    The knowledge activity counted in it is that of the session's events after the previous range's window and up to
    the last timestamp of this range.
    """
    mine = _session_events(branch, context)
    windows = [str(e.data["window_end"]) for e in mine if e.type == "session_usage" and "window_end" in e.data]
    activity = knowledge_activity(mine, after=max(windows, default=None), until=stats.last_ts or now)
    data = stats.as_event_data(activity)
    data["idempotency_key"] = f"range:{start}-{end}"
    data["range"] = {"start": start, "end": end}
    withheld = read_holdout(branch, context.runtime, context.session_id)
    if withheld is not None:
        data["brief_withheld"] = withheld  # the holdout experiment's group of this session (design 10.3)
    event = new_event("session_usage", context, now=now, data=data)
    return len(record_events(branch, [event], now=now))


# ---------------------------------------------------------------------------------------------------------------------
# Grading a range


def _plan_grading(
    branch: KnowledgeBranch,
    config: Config,
    context: EventContext,
    records: Sequence[TranscriptRecord],
    start: int,
    end: int,
) -> _GradingPlan | None:
    """Decide whether a range needs the grader, and with what: its digest and the notes opened in it.

    The notes opened are those of the session's ``read`` events inside the range's window of time (the same window as the
    usage event's) together with the reads the digest saw whose result showed a version, provided the session logged a
    ``read`` of that note and version or the note exists: a transcript line that only looks like a read (an agent
    printing text, a note id made up) opens nothing. The grader runs only if a note
    was opened or, with capture on, the range shows a discovery signal (``session_job.grade_only_if_reads_or_signals``
    false asks it for every range with conversation). Returns ``None`` when there is nothing to ask.
    """
    events = _session_events(branch, context)
    window = _range_window(events, start, end)
    if window is None:
        return None  # no usage event was written for the range, so it holds no conversation
    after, until = window
    digest = build_digest(
        records, max_tokens=config.session_job.digest_max_tokens, redact=lambda text: redact_text(text)[0]
    )
    opened: dict[tuple[str, str], None] = {}
    logged: set[tuple[str, str]] = set()
    for event in events:
        if event.type == "read" and event.note_id and event.note_version:
            logged.add((event.note_id, event.note_version))
            if (after is None or event.ts > after) and event.ts <= until:
                opened[(event.note_id, event.note_version)] = None
    for read in digest.reads:
        if not read.failed and read.version and _is_real_read(branch, logged, read.note_id, read.version):
            opened[(read.note_id, read.version)] = None

    extract = config.capture.session_extract
    gate = config.session_job.grade_only_if_reads_or_signals
    if not opened and not (extract and (digest.has_discovery_signal or not gate)):
        return None
    return _GradingPlan(digest, tuple(opened))


def _is_real_read(branch: KnowledgeBranch, logged: set[tuple[str, str]], note_id: str, version: str) -> bool:
    """Whether a read the digest saw is a real one: logged for the session with that version, or of a note that exists."""
    if (note_id, version) in logged:
        return True
    try:
        read_note(branch, note_id)
    except NoteNotFoundError:
        return False
    return True


def _range_window(events: Sequence[Event], start: int, end: int) -> tuple[str | None, str] | None:
    """Return ``(after, until)``: the time window of the range ``start``-``end`` in the session's events.

    ``until`` is the ``window_end`` of the range's own usage event; ``after`` is the largest ``window_end`` of the
    session's earlier ranges (``None`` for the first). ``None`` if the range has no usage event.
    """
    own = f"range:{start}-{end}"
    until: str | None = None
    after: str | None = None
    for event in events:
        if event.type != "session_usage" or "window_end" not in event.data:
            continue
        if event.data.get("idempotency_key") == own:
            until = str(event.data["window_end"])
        elif isinstance(event.data.get("range"), dict) and event.data["range"].get("end", end + 1) <= start:
            after = max(after or "", str(event.data["window_end"]))
    return None if until is None else (after, until)


def _grade_range(
    branch: KnowledgeBranch,
    config: Config,
    context: EventContext,
    plan: _GradingPlan,
    grader: Grader,
    load_embedder: Callable[[], Embedder | None] | None,
    now: dt.datetime,
    start: int,
    end: int,
) -> tuple[int, int, list[str]]:
    """Ask the grader about a range and record the answer; return ``(graded events, candidate notes, warnings)``.

    The ``graded`` events and the candidate notes carry idempotency keys of the range, so grading the same range again
    (after a failure half way) writes nothing twice. Candidate notes go through ``save_note``: validation, secret scan and
    duplicate check, with status ``extract_status`` and method ``session_extract``; a note that fails them is skipped
    with a warning. A candidate is ``trust: external`` if the grader says so or the range used a tool that fetches
    outside content (design 14.2).

    Raises
    ------
    GraderError
        If the grader failed or its answer is invalid; only the ``model_call`` event of the failed call has been
        recorded then.
    """
    where = f"{start}-{end}"
    warnings: list[str] = []
    where_data: dict[str, Any] = {"range": {"start": start, "end": end}}
    try:
        result = grade_range(grader, plan.digest, plan.opened, extract=config.capture.session_extract)
    except GraderError as error:
        # The call was made and paid for whatever its answer: it leaves exactly one event, here (design 10.3).
        failed = call_data("grader", None, error, **where_data)
        if failed is not None:
            record_events(branch, [new_event("model_call", context, now=now, data=failed)], now=now)
        raise
    answered = call_data(
        "grader", result.reply, None, **where_data, grades=len(result.grades), candidates=len(result.candidates)
    )
    if answered is not None:
        record_events(branch, [new_event("model_call", context, now=now, data=answered)], now=now)

    # The grades, one event each, pinned to the version that was opened.
    events = []
    for grade in result.grades:
        data: dict[str, Any] = {
            "outcome": grade.outcome,
            "evidence": redact_text(grade.evidence)[0],
            "grader_model": result.model,
            "prompt_version": GRADER_PROMPT_VERSION,
            "digest_version": plan.digest.version,
            "digest_tokens": plan.digest.tokens,
            "range": {"start": start, "end": end},
            "idempotency_key": f"grade:{where}:{grade.note_id}:{grade.version}",
        }
        events.append(
            new_event("graded", context, now=now, note_id=grade.note_id, note_version=grade.version, data=data)
        )
    graded = len(record_events(branch, events, now=now)) if events else 0

    # Candidate notes: only when capture is on, through the one write path.
    saved = 0
    candidates = result.candidates if config.capture.session_extract else ()
    embedder = load_embedder() if load_embedder is not None and candidates else None
    for number, candidate in enumerate(candidates, start=1):
        payload = _candidate_payload(candidate, config, context, result.model, plan.digest.external_content)
        try:
            outcome = save_note(
                branch,
                config,
                payload,
                context=context,
                now=now,
                embedder=embedder,
                idempotency_key=f"extract:{where}:{number}",
            )
        except NoteError as error:
            warnings.append(f"candidate note {number} ({candidate.title[:60]!r}) was not saved: {error}")
            continue
        if outcome.status == "duplicate":
            similar = ", ".join(found.note_id for found in outcome.duplicates)
            warnings.append(f"candidate note {number} ({candidate.title[:60]!r}) was not saved: it repeats {similar}")
        elif outcome.status == "written":
            saved += 1
    return graded, saved, warnings


def _candidate_payload(
    candidate: CandidateNote, config: Config, context: EventContext, grader_model: str, external: bool
) -> dict[str, object]:
    """Return the write request for a candidate note (see ``_grade_range``)."""
    payload: dict[str, object] = {
        "title": candidate.title,
        "summary": candidate.summary,
        "type": candidate.type,
        "status": config.capture.extract_status,
        "confidence": "low",  # nobody has confirmed it; a later grade or the curator may raise it
        "created_by": {"method": "session_extract", "model": grader_model},
        "source_session": context.session_id,
        "trust": "external" if external or candidate.trust == "external" else "normal",
        "body": candidate.body,
    }
    if candidate.evidence_level is not None:
        payload["evidence_level"] = candidate.evidence_level
    if candidate.source_files:
        payload["source_files"] = list(candidate.source_files)
    if candidate.tags:
        payload["tags"] = list(candidate.tags)
    return payload


def _log_grading_error(
    branch: KnowledgeBranch,
    context: EventContext,
    error: Exception,
    start: int,
    end: int,
    attempt: int,
    now: dt.datetime,
    *,
    given_up: bool,
) -> None:
    """Record an ``operational_error`` event for a failed grading attempt of a range (``given_up`` on the last)."""
    data = {
        "job": "grading",
        "error": type(error).__name__,
        "message": redact_text(str(error))[0][:ERROR_MESSAGE_CHARS],
        "range": {"start": start, "end": end},
        "attempt": attempt,
        "given_up": given_up,
    }
    record_events(branch, [new_event("operational_error", context, now=now, data=data)], now=now)


# ---------------------------------------------------------------------------------------------------------------------
# Self-assessment


def assess_note(
    branch: KnowledgeBranch,
    note_id: str,
    outcome: str,
    reason: str | None,
    *,
    context: EventContext,
    now: dt.datetime,
) -> str:
    """Record the coding agent's own rating of a note as a ``self_assessed`` event and return the note's version.

    The event pins the version the note has now (outside edits are committed first). The reason is secret-scanned and
    cut to ``MAX_REASON_CHARS`` characters. The note is not delivered, so no ``read`` is logged.

    Raises
    ------
    NoteError
        If ``outcome`` is not a grade label (design 3.1).
    NoteNotFoundError
        If there is no such note.
    """
    if outcome not in GRADE_OUTCOMES:
        raise NoteError(f"outcome must be one of {', '.join(GRADE_OUTCOMES)}; got {outcome!r}")
    found = read_note(branch, note_id)
    data: dict[str, Any] = {"outcome": outcome}
    if reason and reason.strip():
        data["reason"] = redact_text(reason.strip())[0][:MAX_REASON_CHARS]
    event = new_event("self_assessed", context, now=now, note_id=found.note.id, note_version=found.version, data=data)
    record_events(branch, [event], now=now)
    return found.version
