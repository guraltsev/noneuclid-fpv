"""Knowledge notes: the frontmatter schema, rendering and parsing, validation, note IDs and the secret scan.

This module sits at the bottom of the import direction (``coding_style.md``): it imports nothing from the project and
never runs Git or starts processes. A note is a frozen ``Note``; its file form is YAML frontmatter plus a Markdown body
(design section 6). Key invariants: ``parse_note(render_note(note)) == note`` for every valid note, nothing enters a
``Note`` without passing ``note_from_fields``, and every note written through ``prepare_note`` has passed the secret
scan (design section 14.3).
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass, fields, replace
from typing import Any

import yaml

SCHEMA_VERSION = 1
NOTE_TYPES = ("discovery", "procedure", "decision", "constraint", "antipattern", "environment", "open_question")
STATUSES = ("candidate", "active", "superseded", "stale", "archived")
CONFIDENCES = ("low", "medium", "high", "unknown")
EVIDENCE_LEVELS = ("observed", "reproduced", "tested", "source_verified", "hypothesis")
TRUST_LEVELS = ("normal", "external")
SEARCHABLE_STATUSES = ("active", "candidate")
# The grade labels of design 3.1; the grader and the optional self-assessment use the same vocabulary.
GRADE_OUTCOMES = ("used", "helpful", "not_needed", "irrelevant", "misleading", "stale", "unknown")
# ``model_call`` events (design 10.3): what the small model was asked for, and how the call ended.
CALL_PURPOSES = ("grader", "brief_selection", "curator")
CALL_OUTCOMES = ("ok", "invalid", "timeout", "error")

NOTE_ID_PATTERN = re.compile(r"K-\d{8}-[0-9a-f]{4,}")
TIMESTAMP_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
MAX_TITLE_CHARS = 200
MAX_REASON_CHARS = 500  # the longest reason a self-assessment, a status change or a curation keeps
BYTE_ORDER_MARK = chr(0xFEFF)

# Fields a caller of ``prepare_note`` may supply. The tool sets ``schema_version``, ``created_at`` and ``updated_at``,
# and ``created_by.runtime``; ``id`` selects an existing note to revise.
WRITE_FIELDS = frozenset(
    {
        "id",
        "title",
        "summary",
        "type",
        "status",
        "confidence",
        "evidence_level",
        "created_by",
        "source_session",
        "source_branch",
        "source_commit",
        "source_files",
        "tags",
        "related",
        "supersedes",
        "valid_when",
        "expires_at",
        "trust",
        "body",
    }
)


class NoteError(ValueError):
    """A note, a note file or a write request is invalid; the message says which field and why."""


class SecretFoundError(NoteError):
    """Note text contains something that looks like a credential and redaction is switched off."""


@dataclass(frozen=True)
class CreatedBy:
    """Who made a note: the runtime, optionally the model, and the method (``agent_write``, ``session_extract``)."""

    runtime: str
    method: str
    model: str | None = None


@dataclass(frozen=True)
class Note:
    """One knowledge note (design section 6.1). Build it with ``note_from_fields`` so it is validated."""

    id: str
    title: str
    summary: str
    type: str
    status: str
    confidence: str
    created_at: str
    updated_at: str
    created_by: CreatedBy
    body: str
    schema_version: int = SCHEMA_VERSION
    evidence_level: str | None = None
    source_session: str | None = None
    source_branch: str | None = None
    source_commit: str | None = None
    source_files: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    related: tuple[str, ...] = ()
    supersedes: str | None = None
    valid_when: str | None = None
    expires_at: str | None = None
    trust: str = "normal"


@dataclass(frozen=True)
class VersionedNote:
    """A note together with its version: the Git blob hash of the committed file (design section 5.4)."""

    note: Note
    version: str


@dataclass(frozen=True)
class Duplicate:
    """An existing note that a new note probably repeats, with the similarity (0 to 1) that made it a candidate."""

    note_id: str
    title: str
    similarity: float


@dataclass(frozen=True)
class PreparedNote:
    """A validated, secret-scanned note ready to be stored, with what changed on the way."""

    note: Note
    revised: bool
    changed: tuple[str, ...]
    redacted: tuple[str, ...]
    warnings: tuple[str, ...]


# ---------------------------------------------------------------------------------------------------------------------
# Rendering and parsing


def render_note(note: Note) -> str:
    """Return the file text of a note: YAML frontmatter, a blank line, the Markdown body, one final newline.

    Every string is written as a double-quoted scalar with characters YAML would mishandle escaped, so reading the file
    back gives exactly the same note.
    """
    lines = ["---", f"id: {_scalar(note.id)}", f"schema_version: {note.schema_version}"]
    lines += [f"title: {_scalar(note.title)}", f"summary: {_scalar(note.summary)}", f"type: {_scalar(note.type)}"]
    lines += [f"status: {_scalar(note.status)}", f"confidence: {_scalar(note.confidence)}"]
    if note.evidence_level is not None:
        lines.append(f"evidence_level: {_scalar(note.evidence_level)}")
    lines += [f"created_at: {_scalar(note.created_at)}", f"updated_at: {_scalar(note.updated_at)}"]
    created_by = {"runtime": note.created_by.runtime}
    if note.created_by.model is not None:
        created_by["model"] = note.created_by.model
    created_by["method"] = note.created_by.method
    lines.append("created_by: {" + ", ".join(f"{key}: {_scalar(value)}" for key, value in created_by.items()) + "}")
    for name in ("source_session", "source_branch", "source_commit"):
        if getattr(note, name) is not None:
            lines.append(f"{name}: {_scalar(getattr(note, name))}")
    for name in ("source_files", "tags", "related"):
        if getattr(note, name):
            lines.append(f"{name}: [" + ", ".join(_scalar(item) for item in getattr(note, name)) + "]")
    for name in ("supersedes", "valid_when", "expires_at"):
        if getattr(note, name) is not None:
            lines.append(f"{name}: {_scalar(getattr(note, name))}")
    lines += [f"trust: {_scalar(note.trust)}", "---", "", note.body, ""]
    return "\n".join(lines)


def parse_note(text: str) -> Note:
    """Parse the file text of a note into a validated ``Note``, raising ``NoteError`` on any problem."""
    # Normalise line endings, then split the frontmatter from the body at the first closing ``---`` line.
    lines = text.lstrip(BYTE_ORDER_MARK).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines[0].rstrip() != "---":
        raise NoteError("a note must start with a '---' frontmatter line")
    closing = next((index for index, line in enumerate(lines) if index > 0 and line.rstrip() == "---"), None)
    if closing is None:
        raise NoteError("the frontmatter is not closed by a '---' line")

    try:
        loaded = yaml.safe_load("\n".join(lines[1:closing]))
    except yaml.YAMLError as error:
        raise NoteError(f"the frontmatter is not valid YAML: {error}") from error
    if not isinstance(loaded, dict):
        raise NoteError("the frontmatter must be a mapping of fields")
    return note_from_fields(loaded, "\n".join(lines[closing + 1 :]))


def note_from_fields(raw: Mapping[str, object], body: str) -> Note:
    """Validate frontmatter fields and a body and build a ``Note``; raise ``NoteError`` naming the offending field."""
    # Reject keys that are not part of the schema, so a typo is an error rather than silently lost data.
    allowed = {field.name for field in fields(Note)} - {"body"}
    unknown = sorted(str(key) for key in raw if key not in allowed)
    if unknown:
        raise NoteError(f"unknown frontmatter field(s): {', '.join(unknown)}")
    required = ["id", "schema_version", "title", "summary", "type", "status", "confidence"]
    required += ["created_at", "updated_at", "created_by"]
    missing = [name for name in required if raw.get(name) is None]
    if missing:
        raise NoteError(f"missing required field(s): {', '.join(missing)}")

    # Unquoted YAML timestamps arrive as dates; turn them into the canonical UTC text.
    values = {key: _timestamp_text(value) if key.endswith("_at") else value for key, value in raw.items()}

    if values["schema_version"] != SCHEMA_VERSION or isinstance(values["schema_version"], bool):
        raise NoteError(f"schema_version must be {SCHEMA_VERSION}")
    title = _text("title", values["title"])
    if "\n" in title or len(title) > MAX_TITLE_CHARS:
        raise NoteError(f"title must be one line of at most {MAX_TITLE_CHARS} characters")
    body = normalize_body(body)
    if not body.strip():
        raise NoteError("the body must not be empty")
    _text("body", body)

    return Note(
        id=_note_id("id", values["id"]),
        title=title,
        summary=_text("summary", values["summary"]),
        type=_choice("type", values["type"], NOTE_TYPES),
        status=_choice("status", values["status"], STATUSES),
        confidence=_choice("confidence", values["confidence"], CONFIDENCES),
        created_at=_timestamp("created_at", values["created_at"]),
        updated_at=_timestamp("updated_at", values["updated_at"]),
        created_by=_created_by(values["created_by"]),
        body=body,
        evidence_level=_optional(values.get("evidence_level"), lambda v: _choice("evidence_level", v, EVIDENCE_LEVELS)),
        source_session=_optional(values.get("source_session"), lambda v: _text("source_session", v)),
        source_branch=_optional(values.get("source_branch"), lambda v: _text("source_branch", v)),
        source_commit=_optional(values.get("source_commit"), lambda v: _text("source_commit", v)),
        source_files=_text_list("source_files", values.get("source_files")),
        tags=_text_list("tags", values.get("tags")),
        related=tuple(_note_id("related", item) for item in _text_list("related", values.get("related"))),
        supersedes=_optional(values.get("supersedes"), lambda v: _note_id("supersedes", v)),
        valid_when=_optional(values.get("valid_when"), lambda v: _text("valid_when", v)),
        expires_at=_optional(values.get("expires_at"), lambda v: _timestamp("expires_at", v)),
        trust=_choice("trust", values.get("trust", "normal"), TRUST_LEVELS),
    )


def normalize_body(body: str) -> str:
    """Return a body with ``\\n`` line endings and no leading or trailing newlines, the form stored in a note."""
    return body.replace("\r\n", "\n").replace("\r", "\n").strip("\n")


_CLOSING_TAG = re.compile(r"<\s*/(\s*project-knowledge)", re.IGNORECASE)


def neutralise_delimiters(text: str) -> str:
    r"""Return ``text`` with every closing ``project-knowledge`` tag made inert (``</`` becomes ``<\/``).

    Note text is shown to a model between ``<project-knowledge...>`` delimiters (design section 14.1); text that could
    close the delimiter would let a note escape from the data block. Covers ``</project-knowledge>`` and
    ``</project-knowledge-note>`` in any case and with spaces.
    """
    return _CLOSING_TAG.sub(r"<\\/\1", text)


def check_status_change(old: str, new: str) -> None:
    """Raise ``NoteError`` unless a note may go from status ``old`` to status ``new`` (design 11.1).

    Any change between two different statuses is allowed except out of ``archived``, which is only restored to
    ``active``. A note keeps ``superseded`` as history, but a person may reopen it.
    """
    if new not in STATUSES:
        raise NoteError(f"status must be one of {', '.join(STATUSES)}; got {new!r}")
    if new == old:
        raise NoteError(f"the note is already {old}")
    if old == "archived" and new != "active":
        raise NoteError("an archived note can only be restored to active")


def clean_reason(reason: str) -> str:
    """Return a reason for a change as one line without secrets, at most ``MAX_REASON_CHARS`` characters; it may not be empty."""
    text = redact_text(" ".join(reason.split()))[0][:MAX_REASON_CHARS]
    if not text:
        raise NoteError("a reason is required")
    return text


def format_timestamp(moment: dt.datetime) -> str:
    """Format a moment as the UTC ISO 8601 text used in notes and events, such as ``2026-11-01T14:02:11Z``."""
    if moment.tzinfo is None:
        raise NoteError("timestamps must be timezone-aware")
    return moment.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------------------------------------------------
# Writing: IDs, preparing a note from a request


def new_note_id(today: dt.date, taken: Collection[str], rng: random.Random | None = None) -> str:
    """Return a fresh ID ``K-<yyyymmdd>-<4+ hex>`` that is not in ``taken``, retrying on collisions.

    After eight collisions in a row the hex part grows by one digit, so the search always ends.
    """
    rng = rng or random.SystemRandom()
    width = 4
    attempts = 0
    while True:
        candidate = f"K-{today:%Y%m%d}-{rng.getrandbits(4 * width):0{width}x}"
        if candidate not in taken:
            return candidate
        attempts += 1
        if attempts % 8 == 0:
            width += 1


def prepare_note(
    payload: Mapping[str, object],
    *,
    existing_notes: Mapping[str, Note],
    taken_ids: Collection[str] = (),
    runtime: str,
    model: str | None,
    now: dt.datetime,
    redact_secrets: bool,
    max_summary_tokens: int,
    rng: random.Random | None = None,
) -> PreparedNote:
    """Turn a write request into a validated, secret-scanned note: a new note, or a revision when ``id`` is given.

    ``payload`` holds the frontmatter fields a caller may set plus ``body``. A new note gets a fresh ID, status
    ``active`` unless the payload says ``candidate``, and timestamps from ``now``. A revision merges the payload into
    the existing note: fields not mentioned keep their value, and ``created_at`` and ``created_by`` are kept. Secrets
    is never one of ``taken_ids`` (IDs of note files that exist but could not be read). Secrets
    are replaced by ``[REDACTED:<kind>]`` when ``redact_secrets`` is true and otherwise raise ``SecretFoundError``.

    Raises
    ------
    NoteError
        For unknown or tool-set fields, a missing or invalid field, a status other than ``candidate`` or ``active``
        on a new note, a status on a revision, or an ``id`` that matches no existing note.
    """
    unknown = sorted(str(key) for key in payload if key not in WRITE_FIELDS)
    if unknown:
        raise NoteError(f"field(s) not accepted in a write request: {', '.join(unknown)}; accepted: {_accepted()}")

    stamp = format_timestamp(now)
    revising = payload.get("id") is not None
    previous: Note | None = None
    if revising:
        # A revision starts from the stored note; the tool keeps the creation fields.
        previous = existing_notes.get(str(payload["id"]))
        if previous is None:
            raise NoteError(f"cannot revise {payload['id']}: no such note")
        if "status" in payload:
            raise NoteError("status is changed by curation, not by write; leave it out of a revision")
        merged: dict[str, object] = {key: _field_value(previous, key) for key in _frontmatter_names()}
        merged.update({key: value for key, value in payload.items() if key not in ("id", "body", "created_by")})
        merged["updated_at"] = stamp
        merged["created_by"] = _field_value(previous, "created_by")
        body = str(payload["body"]) if payload.get("body") is not None else previous.body
    else:
        status = payload.get("status", "active")
        if status not in ("candidate", "active"):
            raise NoteError("a new note must have status 'candidate' or 'active'")
        supplied = payload.get("created_by") or {}
        if not isinstance(supplied, Mapping) or not set(supplied) <= {"model", "method"}:
            raise NoteError("created_by may only contain 'model' and 'method'")
        created_by: dict[str, object] = {"runtime": runtime, "method": supplied.get("method", "agent_write")}
        if (supplied.get("model") or model) is not None:
            created_by["model"] = supplied.get("model") or model
        merged = {key: value for key, value in payload.items() if key not in ("body", "created_by")}
        merged.update(
            id=new_note_id(now.astimezone(dt.UTC).date(), {*existing_notes, *taken_ids}, rng),
            schema_version=SCHEMA_VERSION,
            status=status,
            created_at=stamp,
            updated_at=stamp,
            created_by=created_by,
        )
        body = str(payload["body"]) if payload.get("body") is not None else ""

    # Validate the final form, so a revision is held to the same rules as a new note.
    note = note_from_fields(merged, body)

    # Secrets never reach the branch: redact them, or refuse the write.
    note, redacted = scrub_secrets(note, redact=redact_secrets)

    warnings = []
    if len(note.summary) > 4 * max_summary_tokens:
        warnings.append(f"the summary is longer than {max_summary_tokens} tokens; the brief will shorten it")
    changed: tuple[str, ...] = ()
    if previous is not None:
        changed = tuple(
            name
            for name in (*_frontmatter_names(), "body")
            if name != "updated_at" and _field_value(previous, name) != _field_value(note, name)
        )
    return PreparedNote(note=note, revised=revising, changed=changed, redacted=redacted, warnings=tuple(warnings))


# ---------------------------------------------------------------------------------------------------------------------
# The secret scan


@dataclass(frozen=True)
class SecretPattern:
    """One kind of credential: its name and a regular expression whose ``secret`` group is the part to redact."""

    kind: str
    regex: re.Pattern[str]


# Each pattern catches a distinct kind of credential. The values are deliberately conservative (long enough to be real
# keys), because a false positive only costs a redaction while a miss puts a credential into Git history.
SECRET_PATTERNS = (
    SecretPattern(
        "private-key",
        re.compile(
            r"(?P<secret>-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----"
            r"[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|\Z))"
        ),
    ),
    SecretPattern("aws-access-key", re.compile(r"\b(?P<secret>(?:AKIA|ASIA)[0-9A-Z]{16})\b")),
    SecretPattern(
        "github-token",
        re.compile(r"\b(?P<secret>gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b"),
    ),
    SecretPattern("anthropic-key", re.compile(r"\b(?P<secret>sk-ant-[A-Za-z0-9_-]{20,})")),
    SecretPattern("openai-key", re.compile(r"\b(?P<secret>sk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,})")),
    SecretPattern("slack-token", re.compile(r"\b(?P<secret>xox[abprs]-[A-Za-z0-9-]{10,})")),
    SecretPattern(
        "password-assignment",
        re.compile(
            r"(?i)(?<![a-z0-9])(?:password|passwd|pwd)(?![a-z0-9])[\"']?\s*[=:]\s*[\"']?"
            r"(?P<secret>(?![<{$*.\[])(?!(?:string|none|null|true|false|bool|redacted|example|changeme|placeholder)\b)"
            r"[^\s\"']{4,})"
        ),
    ),
)

# Every string a note writes to the branch that a caller can set. IDs, timestamps and fields restricted to a fixed
# list of values cannot hold a credential.
_TEXT_FIELDS = ("title", "summary", "body", "valid_when", "source_session", "source_branch", "source_commit")
_TEXT_LIST_FIELDS = ("source_files", "tags")


def find_secrets(text: str) -> list[str]:
    """Return the kinds of credential found in a text, one entry per match, in order of the pattern list."""
    return [pattern.kind for pattern in SECRET_PATTERNS for _ in pattern.regex.finditer(text)]


def redact_text(text: str) -> tuple[str, list[str]]:
    """Replace every credential in a text by ``[REDACTED:<kind>]``; return the new text and the kinds replaced."""
    kinds: list[str] = []
    for pattern in SECRET_PATTERNS:

        def replace_secret(match: re.Match[str], kind: str = pattern.kind) -> str:
            kinds.append(kind)
            start, end = match.span("secret")
            return (
                match.group(0)[: start - match.start()] + f"[REDACTED:{kind}]" + match.group(0)[end - match.start() :]
            )

        text = pattern.regex.sub(replace_secret, text)
    return text, kinds


def scrub_secrets(note: Note, *, redact: bool) -> tuple[Note, tuple[str, ...]]:
    """Redact the credentials in every free-text string of a note, or raise ``SecretFoundError`` if ``redact`` is false.

    Covers the title, summary, body, ``valid_when``, the source fields, ``source_files``, ``tags`` and the model and
    method in ``created_by``. Returns the note and the kinds redacted (empty when the note was clean).
    """
    kinds: list[str] = []
    changes: dict[str, Any] = {}

    def clean(value: str) -> str:
        cleaned, found = redact_text(value)
        kinds.extend(found)
        return cleaned

    for name in _TEXT_FIELDS:
        value = getattr(note, name)
        if value is not None and (cleaned := clean(value)) != value:
            changes[name] = cleaned
    for name in _TEXT_LIST_FIELDS:
        values = getattr(note, name)
        cleaned_values = tuple(clean(item) for item in values)
        if cleaned_values != values:
            changes[name] = cleaned_values
    model, method = note.created_by.model, note.created_by.method
    cleaned_model, cleaned_method = (None if model is None else clean(model)), clean(method)
    if (cleaned_model, cleaned_method) != (model, method):
        changes["created_by"] = replace(note.created_by, model=cleaned_model, method=cleaned_method)
    if kinds and not redact:
        raise SecretFoundError(f"the note contains what looks like a credential ({', '.join(sorted(set(kinds)))})")
    return (replace(note, **changes) if changes else note), tuple(kinds)


# ---------------------------------------------------------------------------------------------------------------------
# Field helpers


def _accepted() -> str:
    return ", ".join(sorted(WRITE_FIELDS))


def _frontmatter_names() -> tuple[str, ...]:
    return tuple(field.name for field in fields(Note) if field.name != "body")


def _field_value(note: Note, name: str) -> object:
    """Return a note field in the plain form ``note_from_fields`` accepts (tuples as lists, created_by as a mapping)."""
    value = getattr(note, name)
    if isinstance(value, CreatedBy):
        result: dict[str, object] = {"runtime": value.runtime, "method": value.method}
        if value.model is not None:
            result["model"] = value.model
        return result
    if isinstance(value, tuple):
        return list(value)
    return value


def _scalar(value: str) -> str:
    """Write a string as a double-quoted YAML scalar that survives a round trip through ``yaml.safe_load``."""
    # JSON string syntax is valid YAML. Escape what YAML would read differently: control characters, line separators
    # and anything outside its printable range.
    quoted = json.dumps(value, ensure_ascii=False)
    return "".join(_escape_for_yaml(char) for char in quoted)


def _escape_for_yaml(char: str) -> str:
    """Return a character unchanged if YAML reads it back as itself inside double quotes, else as a backslash-u escape."""
    code = ord(char)
    printable = 0x20 <= code <= 0x7E or 0xA0 <= code <= 0xD7FF or 0xE000 <= code <= 0xFFFD or code >= 0x10000
    # U+2028 and U+2029 are line breaks to YAML and U+FEFF is a byte order mark, although they count as printable.
    if printable and code not in (0x2028, 0x2029, 0xFEFF):
        return char
    return f"\\u{code:04x}"


def _timestamp_text(value: object) -> object:
    """Convert a date or datetime that YAML parsed from an unquoted timestamp to the canonical text."""
    if isinstance(value, dt.datetime):
        return format_timestamp(value if value.tzinfo else value.replace(tzinfo=dt.UTC))
    if isinstance(value, dt.date):
        return format_timestamp(dt.datetime(value.year, value.month, value.day, tzinfo=dt.UTC))
    return value


def _text(name: str, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise NoteError(f"{name} must be non-empty text")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise NoteError(f"{name} contains characters that cannot be stored as UTF-8") from error
    return value


def _choice(name: str, value: Any, choices: tuple[str, ...]) -> str:
    if value not in choices:
        raise NoteError(f"{name} must be one of {', '.join(choices)}; got {value!r}")
    return str(value)


def _note_id(name: str, value: Any) -> str:
    if not isinstance(value, str) or not NOTE_ID_PATTERN.fullmatch(value):
        raise NoteError(f"{name} must look like K-20261101-7f3a; got {value!r}")
    return value


def _timestamp(name: str, value: Any) -> str:
    if not isinstance(value, str) or not TIMESTAMP_PATTERN.fullmatch(value):
        raise NoteError(f"{name} must be a UTC time like 2026-11-01T14:02:11Z; got {value!r}")
    try:
        dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise NoteError(f"{name} is not a real time: {value!r}") from error
    return value


def _text_list(name: str, value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise NoteError(f"{name} must be a list of text")
    return tuple(_text(name, item) for item in value)


def _optional(value: Any, check: Any) -> Any:
    return None if value is None else check(value)


def _created_by(value: Any) -> CreatedBy:
    if not isinstance(value, Mapping) or not set(value) <= {"runtime", "model", "method"}:
        raise NoteError("created_by must be a mapping with runtime, method and optionally model")
    model = value.get("model")
    return CreatedBy(
        runtime=_text("created_by.runtime", value.get("runtime")),
        method=_text("created_by.method", value.get("method")),
        model=None if model is None else _text("created_by.model", model),
    )


def note_to_dict(note: Note) -> dict[str, Any]:
    """Return a note as a plain mapping for ``--json`` output: the frontmatter fields that are set, then ``body``."""
    result: dict[str, Any] = {}
    for name in _frontmatter_names():
        value = _field_value(note, name)
        if value is not None and value != []:
            result[name] = value
    result["body"] = note.body
    return result
