"""Hook entry points: what Claude Code and Codex run on prompt submission, compaction and session end.

This is an interface module (``coding_style.md``) and one of the two places that fail open (design 15): whatever goes
wrong, ``handle_hook`` returns normally, logs an ``operational_error`` event if it can, and never makes the coding
session wait or fail. It reads nothing itself: the caller passes the payload text, the clock, the environment and the
function that starts a detached process, and prints the returned text.

``UserPromptSubmit`` adds a brief to the first prompt of a session and to the first prompt after a compaction.
``PreCompact`` and ``SessionEnd`` start the session job as a detached process and return at once, so hook timeouts never
constrain it. Every hook does nothing when ``KNOWLEDGE_DISABLE`` is set (the recursion guard, design 8.2).

Payload fields used (all events; Codex documents the same names as Claude Code, so one mapping serves both): ``session_id``,
``transcript_path`` (Codex may send null: the rollout file is then found by session id), ``cwd``; ``UserPromptSubmit``
also ``prompt``. The hook output for ``UserPromptSubmit`` is
``{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": <brief>}}``.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from project_knowledge.config import load_config
from project_knowledge.events import check_names, new_event
from project_knowledge.grading import Grader
from project_knowledge.notes import redact_text
from project_knowledge.operations import (
    EmbedderLoader,
    clear_active_session,
    event_context,
    holdout_withheld,
    load_embedder_or_warn,
    log_brief,
    make_brief,
    mark_briefed,
    mark_compacted,
    needs_brief,
    selection_grader,
    write_active_session,
)
from project_knowledge.store import KnowledgeBranch, open_branch, record_events
from project_knowledge.transcripts.codex import codex_home, find_rollout

DISABLE_VARIABLE = "KNOWLEDGE_DISABLE"
ERROR_MESSAGE_CHARS = 200
ENTRY_SCRIPT = Path(__file__).resolve().parents[1] / "knowledge.py"
HOOK_EVENTS = ("UserPromptSubmit", "PreCompact", "SessionEnd")

# Starts the session job: (argument list, working directory). Tests pass a recording stand-in.
SpawnJob = Callable[[Sequence[str], Path], None]


class HookError(Exception):
    """A hook payload or event cannot be handled; the message says why. It is logged, never shown to the session."""


@dataclass(frozen=True)
class HookInput:
    """The fields of a Claude Code hook payload that the hooks use, normalised."""

    session_id: str | None
    transcript_path: Path | None
    cwd: Path | None
    prompt: str | None


def handle_hook(
    event: str,
    payload_text: str,
    *,
    root: Path,
    runtime: str,
    now: dt.datetime,
    environ: Mapping[str, str],
    load_embedder: EmbedderLoader,
    spawn: SpawnJob | None = None,
    holdout_draw: Callable[[], float] | None = None,
    grader: Grader | None = None,
) -> str:
    """Run the hook for ``event`` and return the text to print on standard output (empty for none). Never raises."""
    if _disabled(environ):
        return ""
    spawn = spawn or spawn_detached
    session_id: str | None = None
    try:
        payload = parse_payload(payload_text)
        session_id = payload.session_id
        return _dispatch(
            event,
            payload,
            root=root,
            runtime=runtime,
            now=now,
            environ=environ,
            load_embedder=load_embedder,
            spawn=spawn,
            draw=holdout_draw or random.random,
            grader=grader,
        )
    except Exception as error:
        _log_error(root, runtime, session_id, event, error, now)
        return ""


def _dispatch(
    event: str,
    payload: HookInput,
    *,
    root: Path,
    runtime: str,
    now: dt.datetime,
    environ: Mapping[str, str],
    load_embedder: EmbedderLoader,
    spawn: SpawnJob,
    draw: Callable[[], float],
    grader: Grader | None,
) -> str:
    if event not in HOOK_EVENTS:
        raise HookError(f"unsupported hook event {event!r}; supported: {', '.join(HOOK_EVENTS)}")
    if payload.session_id is None:
        raise HookError("the payload has no session_id")
    check_names(runtime, payload.session_id)
    branch = open_branch(root)
    config = load_config(branch.config_path)

    if event == "UserPromptSubmit":
        write_active_session(branch, runtime, payload.session_id, now)
        if not needs_brief(branch, config, runtime, payload.session_id):
            return ""
        if holdout_withheld(branch, config, runtime, payload.session_id, draw):
            mark_briefed(branch, runtime, payload.session_id)  # the experiment's other group: a session without a brief
            return ""
        embedder, _ = load_embedder_or_warn(load_embedder, branch, config)
        selector = selection_grader(config, runtime, environ, grader)
        made = make_brief(branch, config, payload.prompt, embedder=embedder, selector=selector)
        mark_briefed(branch, runtime, payload.session_id)  # only now: a failure above leaves the next prompt to retry
        if made is not None and made.selection_error is not None:
            _log_error(root, runtime, payload.session_id, event, made.selection_error, now)  # the plain ranking is used
        if made is None:
            return ""
        try:
            log_brief(branch, config, event_context(root, runtime, payload.session_id, None), now, made)
        except Exception as error:
            _log_error(root, runtime, payload.session_id, event, error, now)
        if not made.brief.text:
            return ""
        return json.dumps(
            {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": made.brief.text}}
        )

    # PreCompact and SessionEnd: the next prompt after a compaction gets a brief again; the job reads the transcript.
    if event == "PreCompact":
        mark_compacted(branch, runtime, payload.session_id)
    else:
        clear_active_session(branch.state_dir, runtime, payload.session_id, now)
    if event in config.session_job.triggers:
        transcript = payload.transcript_path
        if transcript is None and runtime == "codex":  # Codex may send null: find the rollout file by session id
            transcript = find_rollout(codex_home(environ, Path.home()), payload.session_id)
        if transcript is None:
            raise HookError("the payload has no transcript_path and no transcript was found for the session")
        spawn(session_job_command(root, runtime, payload.session_id, transcript), root)
    return ""


def parse_payload(text: str) -> HookInput:
    """Parse the hook payload JSON and return its normalised fields.

    Raises
    ------
    HookError
        If the text is not a JSON object. Missing fields are ``None``; the hooks that need them say so.
    """
    try:
        loaded = json.loads(text)
    except ValueError as error:
        raise HookError("the hook payload is not valid JSON") from error
    if not isinstance(loaded, dict):
        raise HookError("the hook payload must be a JSON object")
    return HookInput(
        session_id=_text(loaded, "session_id"),
        transcript_path=_path(loaded, "transcript_path"),
        cwd=_path(loaded, "cwd"),
        prompt=_text(loaded, "prompt"),
    )


def session_job_command(root: Path, runtime: str, session_id: str, transcript: Path) -> list[str]:
    """Return the argument list that runs ``knowledge session-job`` for a transcript with the running interpreter."""
    return [
        sys.executable,
        str(ENTRY_SCRIPT),
        "session-job",
        "--root",
        str(root),
        "--runtime",
        runtime,
        "--session",
        session_id,
        "--transcript",
        str(transcript),
    ]


def spawn_detached(command: Sequence[str], cwd: Path) -> None:
    """Start ``command`` as a detached process that outlives this one, with no console and no inherited streams.

    On Windows the process gets ``DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`` and asks to leave the job object of the
    session (``CREATE_BREAKAWAY_FROM_JOB``), because a job object that kills its processes when it closes would
    otherwise end the session job together with the session. If the system refuses the breakaway, the process is
    started without it. Elsewhere it starts its own session.
    """
    options: dict[str, Any] = {"cwd": cwd, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL}
    options["stderr"] = subprocess.DEVNULL
    if sys.platform != "win32":
        options["start_new_session"] = True
        subprocess.Popen(list(command), close_fds=True, **options)
        return
    detached = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(
            list(command),
            close_fds=True,
            creationflags=detached | subprocess.CREATE_BREAKAWAY_FROM_JOB,
            **options,
        )
    except OSError:  # the job object does not allow breakaway
        subprocess.Popen(list(command), close_fds=True, creationflags=detached, **options)


# ---------------------------------------------------------------------------------------------------------------------
# Helpers


def _disabled(environ: Mapping[str, str]) -> bool:
    """Whether ``KNOWLEDGE_DISABLE`` is set to anything but an empty value, ``0`` or ``false``."""
    return environ.get(DISABLE_VARIABLE, "").strip().lower() not in ("", "0", "false")


def _text(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value else None


def _path(payload: Mapping[str, Any], key: str) -> Path | None:
    value = _text(payload, key)
    return Path(value) if value else None


def _log_error(
    root: Path, runtime: str, session_id: str | None, event: str, error: Exception, now: dt.datetime
) -> None:
    """Record an ``operational_error`` event for a failed hook if the branch can be written; otherwise say nothing."""
    try:
        branch: KnowledgeBranch = open_branch(root)
        name = session_id if session_id else f"manual-{now:%Y-%m-%d}"
        context = event_context(root, runtime, name, None)
        message = redact_text(str(error))[0][:ERROR_MESSAGE_CHARS]
        data = {"hook": event[:40], "error": type(error).__name__, "message": message}
        record_events(branch, [new_event("operational_error", context, now=now, data=data)], now=now)
    except Exception:
        return
