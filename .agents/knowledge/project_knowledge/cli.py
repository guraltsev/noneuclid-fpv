"""The ``knowledge`` command line: parses arguments, calls the core, and prints text or ``--json``.

This is an interface module (``coding_style.md``): it may import anything below it, nothing imports it, and it is the
place that prints and resolves defaults from the environment and the clock. Every command takes ``--root`` (default: the
repository the drop-in is installed in), ``--json``, ``--session``, ``--runtime``, ``--model`` and ``--now``. Exit codes:
0 success, 1 error (message on stderr, or an error object with ``--json``), 2 usage error, 3 a write refused as a
probable duplicate.

The embedding model is loaded by ``load_embedder``, a parameter of ``main`` so that callers can supply another loader; when
the model cannot be loaded, search and brief fall back to keywords and say so on standard error.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from project_knowledge.config import ConfigError, load_config
from project_knowledge.curate import analyse, apply_proposals, source_exists
from project_knowledge.events import EventContext, EventError, check_names, load_events
from project_knowledge.grading import Grader, command_grader
from project_knowledge.hooks import SpawnJob, handle_hook
from project_knowledge.mcp_server import serve, tool_description_chars
from project_knowledge.notes import GRADE_OUTCOMES, STATUSES, NoteError, note_to_dict
from project_knowledge.operations import (
    EmbedderLoader,
    assess_note,
    deliver_note,
    event_context,
    load_embedder_or_warn,
    log_brief,
    log_read,
    log_surfaced,
    make_brief,
    resolve_session,
    results_payload,
    run_session_job,
    save_note,
    search_notes,
    search_text,
    selection_grader,
)
from project_knowledge.reports import build_report
from project_knowledge.search.duplicates import duplicate_pairs
from project_knowledge.search.embeddings import embed_notes, load_fastembed
from project_knowledge.store import (
    StoreError,
    change_status,
    flush_events,
    init_branch,
    load_notes,
    locate,
    open_branch,
)
from project_knowledge.transcripts import default_session_id, reader_for

# The repository the drop-in is installed in: this file is <root>/.agents/knowledge/project_knowledge/cli.py.
DEFAULT_ROOT = Path(__file__).resolve().parents[3]
EXIT_DUPLICATE = 3


class CliError(Exception):
    """A command was used wrongly in a way argparse cannot see (a bad time, malformed JSON on stdin)."""


EXPECTED_ERRORS = (NoteError, EventError, ConfigError, StoreError, CliError)


@dataclass(frozen=True)
class Invocation:
    """The resolved common options of one command: the repository, output format, clock and acting session."""

    root: Path
    as_json: bool
    now: dt.datetime
    runtime: str
    session_id: str
    model: str | None


def main(
    argv: Sequence[str] | None = None,
    *,
    load_embedder: EmbedderLoader = load_fastembed,
    spawn_job: SpawnJob | None = None,
    grader: Grader | None = None,
    holdout_draw: Callable[[], float] | None = None,
) -> int:
    """Run the command line with ``argv`` (default: ``sys.argv``) and return the exit code.

    ``grader`` replaces the model that ``session-job`` asks to grade, the curator asks for summaries and the brief asks to
    select notes (default: the runtime CLI that ``config.toml`` selects); ``holdout_draw`` replaces the random draw of the
    holdout experiment (a number in [0, 1)). They are the seams for callers that supply their own.
    """
    _use_utf8_output()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:  # argparse exits for --help and for usage errors; hand the code back to the caller
        if _is_hook_command(argv):
            return 0  # exit code 2 would make Claude Code block the prompt; a hook fails open (design 15)
        return stop.code if isinstance(stop.code, int) else (0 if stop.code is None else 2)
    args.load_embedder = load_embedder
    args.spawn_job = spawn_job
    args.grader = grader
    args.holdout_draw = holdout_draw
    try:
        return int(args.handler(args))
    except EXPECTED_ERRORS as error:
        _fail(bool(args.json), str(error))
        return 1


def _is_hook_command(argv: Sequence[str] | None) -> bool:
    """Whether the command line is the ``hook`` command (the first word; the common options belong to the commands)."""
    words = sys.argv[1:] if argv is None else argv
    return bool(words) and words[0] == "hook"


# ---------------------------------------------------------------------------------------------------------------------
# Commands


def _init(args: argparse.Namespace) -> int:
    """``knowledge init``: create or attach the knowledge branch worktree."""
    invocation = _invocation(args)
    result = init_branch(invocation.root)
    worktree = result.branch.worktree.relative_to(result.branch.root).as_posix()
    said = {
        "created": "created the knowledge branch",
        "attached": "attached the worktree to the existing knowledge branch",
        "exists": "the knowledge branch is already set up",
    }[result.status]
    _emit(
        invocation,
        {"status": result.status, "branch": result.branch.branch, "worktree": worktree},
        f"{said} '{result.branch.branch}' (worktree {worktree})",
    )
    return 0


def _write(args: argparse.Namespace) -> int:
    """``knowledge write``: save a note from JSON on stdin."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    payload = _read_json_object()
    embedder, embedder_warnings = load_embedder_or_warn(args.load_embedder, branch, config)

    result = save_note(
        branch,
        config,
        payload,
        context=_context(invocation),
        now=invocation.now,
        embedder=embedder,
        allow_duplicate=args.allow_duplicate,
        idempotency_key=args.idempotency_key,
    )

    duplicates = [
        {"id": found.note_id, "title": found.title, "similarity": round(found.similarity, 3)}
        for found in result.duplicates
    ]
    warnings = [*embedder_warnings, *result.warnings]
    payload_out: dict[str, Any] = {
        "status": result.status,
        "id": result.note.id if result.note else None,
        "version": result.version,
        "duplicates": duplicates,
        "redacted": list(result.redacted),
        "warnings": warnings,
    }
    _warn(invocation, embedder_warnings)
    if result.status == "duplicate":
        lines = ["not saved: this looks like a note that already exists:"]
        lines += [f"  {item['id']}  {item['title']}  (similarity {item['similarity']})" for item in duplicates]
        lines.append("Revise it by writing again with its id, or repeat the write with --allow-duplicate.")
        _emit(invocation, payload_out, "\n".join(lines))
        return EXIT_DUPLICATE

    lines = [f"{result.status} {payload_out['id']} (version {result.version})"]
    lines += [f"redacted: {kind}" for kind in result.redacted]
    lines += [f"warning: {warning}" for warning in result.warnings]
    _emit(invocation, payload_out, "\n".join(lines))
    return 0


def _read(args: argparse.Namespace) -> int:
    """``knowledge read <id>``: deliver a note with its version, then log ``read`` (or ``read_failed``)."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    context = _context(invocation)
    delivered = deliver_note(branch, args.note_id, context=context, now=invocation.now)

    # Deliver first; the ``read`` event is written only once the text has been handed over.
    _emit(
        invocation,
        {"id": delivered.note.id, "version": delivered.version, "note": note_to_dict(delivered.note)},
        delivered.text,
    )
    sys.stdout.flush()
    log_read(branch, delivered, context=context, now=invocation.now)
    return 0


def _search(args: argparse.Namespace) -> int:
    """``knowledge search <query>``: print matching summaries and log them as surfaced."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    query = " ".join(args.query)
    embedder, warnings = load_embedder_or_warn(args.load_embedder, branch, config)

    hits = search_notes(branch, config, query, embedder=embedder, limit=args.limit)
    text = search_text(hits, config)
    _warn(invocation, warnings)
    _emit(invocation, results_payload("search", query, hits, text, warnings), text)
    sys.stdout.flush()
    log_surfaced(branch, config, _context(invocation), invocation.now, "search", query, hits)
    return 0


def _brief(args: argparse.Namespace) -> int:
    """``knowledge brief``: build the session-start block from the prompt and repository context; empty if nothing fits."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    embedder, warnings = load_embedder_or_warn(args.load_embedder, branch, config)
    selector = selection_grader(config, invocation.runtime, os.environ, args.grader)
    made = make_brief(branch, config, args.query, embedder=embedder, selector=selector)
    if made is not None and made.selection_error is not None:
        warnings = [*warnings, f"small-model selection failed, using the ranking: {made.selection_error}"]
    if made is None:
        if invocation.as_json:
            _emit(invocation, results_payload("brief", "", [], "", []), "")
        return 0

    # Print nothing at all when no note passes, so the session starts clean.
    _warn(invocation, warnings)
    brief = made.brief
    if brief.text or invocation.as_json:
        _emit(invocation, results_payload("brief", made.query, list(brief.hits), brief.text, warnings), brief.text)
    sys.stdout.flush()
    log_brief(branch, config, _context(invocation), invocation.now, made)
    return 0


def _reindex(args: argparse.Namespace) -> int:
    """``knowledge reindex``: rebuild the embedding cache from every searchable note."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    if not config.retrieval.embedding_enabled:
        raise CliError("embeddings are switched off (retrieval.embedding_enabled = false); nothing to reindex")
    embedder, warnings = load_embedder_or_warn(args.load_embedder, branch, config)
    if embedder is None:
        raise CliError(warnings[0])

    notes = [versioned for versioned in load_notes(branch).notes if versioned.note.status in ("active", "candidate")]
    embed_notes(notes, embedder, branch.embeddings_path, rebuild=True)
    _emit(
        invocation,
        {"notes": len(notes), "model": embedder.model},
        f"embedded {len(notes)} note(s) with {embedder.model}",
    )
    return 0


def _report(args: argparse.Namespace) -> int:
    """``knowledge report``: the funnel, grades, usage and slices from the event logs (design 10)."""
    invocation = _invocation(args)
    since, until = _parse_day(args.since, "--since"), _parse_day(args.until, "--until")
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    events, problems = load_events(branch.events_dir)
    loaded = load_notes(branch)
    result = build_report(
        events,
        {versioned.note.id: versioned.note for versioned in loaded.notes},
        since=since,
        until=until,
        now=invocation.now,
        minimum=config.maintenance.minimum_independent_sessions,
        pricing=config.pricing,
        tool_description_chars=tool_description_chars(),
    )

    warnings = [f"skipped a damaged event line: {problem}" for problem in problems]
    warnings += [f"skipped a damaged note file: {problem}" for problem in loaded.problems]
    payload = {**result.as_dict(), "warnings": warnings}
    _warn(invocation, warnings)
    _emit(invocation, payload, result.as_text())
    return 0


def _status(args: argparse.Namespace) -> int:
    """``knowledge status <id> <status> --reason ...``: change a note's lifecycle status (design 11.1); also the restore."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    changed = change_status(
        branch,
        args.note_id,
        args.status,
        reason=" ".join(args.reason),
        context=_context(invocation),
        now=invocation.now,
    )
    _emit(
        invocation,
        {
            "id": args.note_id,
            "from": changed.previous_status,
            "to": args.status,
            "version": changed.version,
            "commit": changed.commit,
        },
        f"status_changed {args.note_id} {changed.previous_status} -> {args.status} (version {changed.version})",
    )
    return 0


def _curate(args: argparse.Namespace) -> int:
    """``knowledge curate [--dry-run]``: the curator's findings and proposals, and the actions whose switch is on (design 11.2)."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    loaded = load_notes(branch)
    events, problems = load_events(branch.events_dir)
    embedder, warnings = load_embedder_or_warn(args.load_embedder, branch, config)
    report = analyse(
        loaded.notes,
        events,
        config.maintenance,
        now=invocation.now,
        exists=source_exists(invocation.root),
        duplicate_pairs=duplicate_pairs(loaded.notes, embedder=embedder, cache_path=branch.embeddings_path),
    )
    warnings += [f"skipped a damaged event line: {problem}" for problem in problems]
    warnings += [f"skipped a damaged note file: {problem}" for problem in loaded.problems]

    actions: list[dict[str, Any]] = []
    text = report.as_text()
    if not args.dry_run:
        on = [proposal for proposal in report.proposals if proposal.enabled]
        grader: Grader | None = None
        if any(p.action in ("add_tags", "rewrite_summary") for p in on) and config.grader.runtime != "off":
            grader = args.grader or command_grader(config.grader, invocation.runtime, environ=os.environ)
        done = apply_proposals(branch, report, config, grader=grader, context=_context(invocation), now=invocation.now)
        actions = [result.as_dict() for result in done]
        text += (
            "\n\nActions taken:"
            if done
            else "\n\nNo action switch that matches a proposal is on in [maintenance]; nothing changed."
        )
        text += "".join(f"\n  {r.status} {r.action} {r.note_id}: {r.detail}" for r in done)
    _warn(invocation, warnings)
    _emit(
        invocation, {**report.as_dict(), "dry_run": bool(args.dry_run), "actions": actions, "warnings": warnings}, text
    )
    return 0


def _flush(args: argparse.Namespace) -> int:
    """``knowledge flush``: commit pending event files, one commit per session file."""
    invocation = _invocation(args)
    commits = flush_events(open_branch(invocation.root))
    said = f"committed {len(commits)} event file(s)" if commits else "no pending event files"
    _emit(invocation, {"committed": len(commits), "commits": commits}, said)
    return 0


def _session_job(args: argparse.Namespace) -> int:
    """``knowledge session-job --transcript FILE``: log usage for the unread part of a transcript, flush, advance the cursor."""
    transcript: Path = args.transcript
    if not transcript.is_file():
        raise CliError(f"no transcript at {transcript}")
    args.runtime, _ = _resolve(args)  # the runtime as every command resolves it; the session defaults to the file's
    args.session = args.session or default_session_id(args.runtime, transcript)
    invocation = _invocation(args)
    try:
        reader_for(invocation.runtime)
    except ValueError as error:
        raise CliError(f"session-job: {error}") from error
    branch = open_branch(invocation.root)
    config = load_config(branch.config_path)
    # No grader when grading is switched off in the config; otherwise the injected one, else the runtime CLI.
    grading: Grader | None = None
    if config.grader.runtime != "off":
        grading = args.grader or command_grader(config.grader, invocation.runtime, environ=os.environ)
    try:
        done = run_session_job(
            branch,
            config,
            transcript,
            runtime=invocation.runtime,
            session_id=invocation.session_id,
            now=invocation.now,
            model=invocation.model,
            grader=grading,
            load_embedder=lambda: load_embedder_or_warn(args.load_embedder, branch, config)[0],
        )
    except OSError as error:
        raise CliError(f"the session job failed, and the transcript will be read again next time: {error}") from error
    _warn(invocation, done.warnings)
    said = f"logged {done.events_written} session_usage event(s); committed {len(done.commits)} event file(s)"
    if done.graded or done.candidates:
        said += f"; graded {done.graded} note(s), saved {done.candidates} candidate note(s)"
    _emit(
        invocation,
        {
            "events": done.events_written,
            "commits": list(done.commits),
            "offset": done.offset,
            "warnings": list(done.warnings),
            "graded": done.graded,
            "candidates": done.candidates,
        },
        said,
    )
    return 0


def _assess(args: argparse.Namespace) -> int:
    """``knowledge assess <id> <outcome> [reason]``: record the agent's own rating of a note (optional, never required)."""
    invocation = _invocation(args)
    branch = open_branch(invocation.root)
    reason = " ".join(args.reason) if args.reason else None
    version = assess_note(branch, args.note_id, args.outcome, reason, context=_context(invocation), now=invocation.now)
    _emit(
        invocation,
        {"id": args.note_id, "version": version, "outcome": args.outcome},
        f"recorded self_assessed {args.note_id} {args.outcome} (version {version})",
    )
    return 0


def _mcp(args: argparse.Namespace) -> int:
    """``knowledge mcp``: serve the four tools over stdio until the client disconnects."""
    serve(
        args.root.resolve(),
        runtime=args.runtime or os.environ.get("KNOWLEDGE_RUNTIME"),
        load_embedder=args.load_embedder,
    )
    return 0


def _hook(args: argparse.Namespace) -> int:
    """``knowledge hook <event>``: handle a runtime hook; prints only the hook output and never fails (design 15)."""
    try:
        now = _parse_now(args.now) if args.now else dt.datetime.now(dt.UTC)
    except CliError:
        now = dt.datetime.now(dt.UTC)
    stream = sys.stdin
    try:
        raw = stream.buffer.read() if hasattr(stream, "buffer") else stream.read().encode("utf-8")
    except (OSError, ValueError):
        raw = b""
    output = handle_hook(
        args.event,
        raw.decode("utf-8", errors="replace"),
        root=args.root.resolve(),
        runtime=args.runtime or os.environ.get("KNOWLEDGE_RUNTIME") or "claude-code",
        now=now,
        environ=os.environ,
        load_embedder=args.load_embedder,
        spawn=args.spawn_job,
        holdout_draw=args.holdout_draw,
        grader=args.grader,
    )
    if output:
        print(output)
    return 0


# ---------------------------------------------------------------------------------------------------------------------
# Helpers for the commands


# ---------------------------------------------------------------------------------------------------------------------
# Arguments, defaults and output


def _build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--root", type=Path, default=DEFAULT_ROOT, help="the repository (default: where this tool is installed)"
    )
    common.add_argument("--json", action="store_true", help="print machine-readable JSON")
    common.add_argument("--session", help="session id (default: $KNOWLEDGE_SESSION_ID, else manual-<date>)")
    common.add_argument(
        "--runtime", help="runtime name, e.g. claude-code or codex (default: $KNOWLEDGE_RUNTIME, else cli)"
    )
    common.add_argument("--model", help="model id recorded in events (default: $KNOWLEDGE_MODEL)")
    common.add_argument("--now", help="the current time as ISO 8601, for replays and scenarios (default: the clock)")

    parser = argparse.ArgumentParser(prog="knowledge", description="Project knowledge notes on a Git branch.")
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")

    def add(name: str, handler: Callable[[argparse.Namespace], int], summary: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, parents=[common], help=summary, description=summary)
        sub.set_defaults(handler=handler)
        return sub

    add("init", _init, "create the knowledge branch and its worktree, or attach to an existing branch")
    write = add("write", _write, "save a note from JSON on stdin (frontmatter fields plus body)")
    write.add_argument("--idempotency-key", help="a retried write with the same key returns the first note")
    write.add_argument("--allow-duplicate", action="store_true", help="save even if a similar note exists")
    search_command = add("search", _search, "print the summaries of notes matching a query")
    search_command.add_argument("query", nargs="+", help="what you are looking at, in words")
    search_command.add_argument("--limit", type=int, help="most notes to print (default: brief.max_items)")
    brief = add("brief", _brief, "print the session-start block of relevant note summaries (nothing if none)")
    brief.add_argument("--query", help="the user's prompt; repository context is added to it")
    read = add("read", _read, "print a full note with its version")
    read.add_argument("note_id", help="note id, e.g. K-20261101-7f3a")
    assess = add("assess", _assess, "record your own rating of a note you read (optional)")
    assess.add_argument("note_id", help="note id, e.g. K-20261101-7f3a")
    assess.add_argument("outcome", choices=GRADE_OUTCOMES, help="how the note contributed (design 3.1)")
    assess.add_argument("reason", nargs="*", help="a short reason")
    report = add("report", _report, "count how many surfaced notes were read")
    report.add_argument("--since", help="only events on or after this date (YYYY-MM-DD, UTC)")
    report.add_argument("--until", help="only events up to the end of this date (YYYY-MM-DD, UTC)")
    status = add(
        "status", _status, "change a note's status (candidate, active, superseded, stale, archived), with a reason"
    )
    status.add_argument("note_id", help="note id, e.g. K-20261101-7f3a")
    status.add_argument("status", choices=STATUSES, help="the new status; active on an archived note restores it")
    status.add_argument("--reason", nargs="+", required=True, help="why (recorded in the event and the commit)")
    curate = add("curate", _curate, "report what the notes' history shows and do the maintenance whose switch is on")
    curate.add_argument("--dry-run", action="store_true", help="only report and propose; change nothing, ask no model")
    add("reindex", _reindex, "rebuild the embedding cache")
    add("flush", _flush, "commit pending event files")
    job = add("session-job", _session_job, "log the usage of the unread part of a transcript (what the hooks start)")
    job.add_argument("--transcript", type=Path, required=True, help="the runtime's transcript file")
    add(
        "mcp", _mcp, "run the MCP server (know_search, know_read, know_write, know_assess) on standard input and output"
    )
    hook = add("hook", _hook, "run the hook of a runtime event with its JSON payload on stdin; always exits 0")
    hook.add_argument("event", help="the event name: UserPromptSubmit, PreCompact or SessionEnd")
    return parser


def _resolve(args: argparse.Namespace) -> tuple[str, str]:
    """Return the ``(runtime, session id)`` of the options (``operations.resolve_session``)."""
    now = _parse_now(args.now) if args.now else dt.datetime.now(dt.UTC)
    return resolve_session(
        locate(args.root.resolve()).state_dir,
        runtime=args.runtime,
        session_id=args.session,
        now=now,
        environ=os.environ,
    )


def _invocation(args: argparse.Namespace) -> Invocation:
    """Resolve the common options: the clock, then the session and runtime (``operations.resolve_session``)."""
    now = _parse_now(args.now) if args.now else dt.datetime.now(dt.UTC)
    root = args.root.resolve()
    runtime, session_id = _resolve(args)
    check_names(runtime, session_id)
    return Invocation(
        root=root,
        as_json=bool(args.json),
        now=now,
        runtime=runtime,
        session_id=session_id,
        model=args.model or os.environ.get("KNOWLEDGE_MODEL") or None,
    )


def _context(invocation: Invocation) -> EventContext:
    """Return the event context of an invocation (this asks Git for the project id)."""
    return event_context(invocation.root, invocation.runtime, invocation.session_id, invocation.model)


def _parse_now(text: str) -> dt.datetime:
    try:
        moment = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise CliError(f"--now must be an ISO 8601 time such as 2026-11-01T14:02:11Z; got {text!r}") from error
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def _parse_day(text: str | None, option: str) -> dt.date | None:
    if text is None:
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError as error:
        raise CliError(f"{option} must be a date such as 2026-11-01; got {text!r}") from error


def _read_json_object() -> Mapping[str, object]:
    """Read standard input as UTF-8 JSON and return it, which must be an object."""
    stream = sys.stdin
    try:
        text = stream.buffer.read().decode("utf-8") if hasattr(stream, "buffer") else stream.read()
    except UnicodeDecodeError as error:
        raise CliError(f"standard input is not valid UTF-8: {error}") from error
    try:
        loaded = json.loads(text)
    except json.JSONDecodeError as error:
        raise CliError(f"standard input is not valid JSON: {error}") from error
    if not isinstance(loaded, dict):
        raise CliError("standard input must be a JSON object with the note fields and body")
    return loaded


def _emit(invocation: Invocation, payload: Mapping[str, Any], text: str) -> None:
    """Print the JSON payload with ``--json``, else the text."""
    print(json.dumps(payload) if invocation.as_json else text)


def _warn(invocation: Invocation, warnings: Sequence[str]) -> None:
    """Print warnings on standard error in text mode (with ``--json`` they are in the payload)."""
    if not invocation.as_json:
        for warning in warnings:
            print(f"warning: {warning}", file=sys.stderr)


def _fail(as_json: bool, message: str) -> None:
    if as_json:
        print(json.dumps({"status": "error", "error": message}))
    else:
        print(f"error: {message}", file=sys.stderr)


def _use_utf8_output() -> None:
    """Make standard output UTF-8 with ``\\n`` line ends on every platform, so notes print the same everywhere."""
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", newline="\n")
