"""The curator: findings about the notes from the event log, and the reversible maintenance that may follow (design 11.2).

``analyse`` is a plain function of the notes, the events and ``[maintenance]``: it returns a ``CuratorReport`` of findings
(weak summaries, useful notes, misleading notes, duplicate clusters, drift, candidates, external notes, notes with too
little data) and of proposals, each naming the switch that allows it and whether that switch is on. It changes nothing and
calls no model, so it is the dry run. ``apply_proposals`` performs the proposals whose switch is on, one commit and one
``curated`` or ``status_changed`` event each, with a reason that carries the numbers; it is the only place where the
curator writes, through the ``store`` functions.

Rules that hold for every action: evidence counts independent sessions and at least ``minimum_independent_sessions`` of
them are needed before a finding leads to a proposal (design 10.5, except the explicit cases of ``mark_stale``); surfaced
and read counts start after the last change of a note's title, summary or tags, and grades after the last revision of its
title or body (the text they judged); a note with ``trust: external`` is only ever reported, never promoted or rewritten,
because its text came from outside the project, and its declaring ``supersedes`` retires nothing (a superseding note must
itself be ``active`` with ``trust: normal``); a proposal is applied only to the version it was made for; at most
``max_notes_per_run`` notes change in a run. A model-written action whose answer changes nothing is recorded as a
``curated`` event with ``changed: []``, which counts as a change of retrieval text for the evidence boundary, so the same
finding does not call the model again until new sessions give new evidence. Never done by any switch: rewriting a
technical claim, merging notes, deleting notes (design 11.2).

Imports: ``notes``, ``events``, ``store``, ``config``, ``reports`` and ``grading``. Nothing is printed and no process is
started here; a model is asked only through the ``Grader`` function it is given.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from project_knowledge.config import Config, MaintenanceConfig
from project_knowledge.events import Event, EventContext, new_event
from project_knowledge.grading import (
    CURATOR_PROMPT_VERSION,
    Grader,
    GraderError,
    SummaryProposal,
    call_data,
    propose_retrieval_text,
)
from project_knowledge.notes import Note, NoteError, VersionedNote, format_timestamp
from project_knowledge.reports import (
    FALSE_POSITIVE_OUTCOMES,
    USEFUL_OUTCOMES,
    NoteStats,
    content_revisions,
    note_stats,
)
from project_knowledge.store import (
    KnowledgeBranch,
    NoChangeError,
    StoreError,
    change_status,
    curate_note,
    read_note,
    record_curation_skip,
    record_events,
)

LIVE = ("active", "candidate")  # the statuses of notes that are retrieved
ACTIONS = ("mark_stale", "archive", "promote", "link_related", "add_tags", "rewrite_summary")
SWITCHES = {
    "mark_stale": "auto_mark_stale",
    "archive": "auto_archive",
    "promote": "auto_promote_candidates",
    "link_related": "auto_link_related",
    "add_tags": "auto_add_tags",
    "rewrite_summary": "auto_rewrite_summary",
}
TEXT_FIELDS = ("summary", "tags", "title")  # a change of one of them is a change of how the note is found
MAX_TAGS_ON_A_NOTE = 12  # the curator stops adding tags to a note at this many


@dataclass(frozen=True)
class Finding:
    """One thing the curator found: its ``kind``, the notes, a sentence for people, the counts behind it, a sample flag."""

    kind: str
    note_ids: tuple[str, ...]
    summary: str
    numbers: Mapping[str, Any]
    insufficient_data: bool = False


@dataclass(frozen=True)
class Proposal:
    """A reversible change the curator would make: ``action`` on ``note_id`` (as of ``note_version``), and why.

    ``switch`` is the ``[maintenance]`` key that allows it and ``enabled`` its value. ``to_status`` is set for the
    actions that change the status, ``changes`` for ``link_related`` (the model-written actions have neither: the model
    is asked when they are applied, never in a dry run).
    """

    action: str
    note_id: str
    note_version: str
    reason: str
    switch: str
    enabled: bool
    numbers: Mapping[str, Any]
    to_status: str | None = None
    changes: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """Return the proposal as plain data for ``knowledge curate --json``."""
        return {
            "action": self.action,
            "note_id": self.note_id,
            "to_status": self.to_status,
            "reason": self.reason,
            "switch": f"maintenance.{self.switch}",
            "enabled": self.enabled,
            "numbers": dict(self.numbers),
        }


@dataclass(frozen=True)
class CuratorReport:
    """What the curator found among ``notes`` notes, and what it proposes."""

    notes: int
    findings: tuple[Finding, ...]
    proposals: tuple[Proposal, ...]

    def of_kind(self, kind: str) -> list[Finding]:
        """Return the findings of one kind."""
        return [finding for finding in self.findings if finding.kind == kind]

    def as_dict(self) -> dict[str, Any]:
        """Return the report as plain data for ``knowledge curate --json``."""
        return {
            "notes": self.notes,
            "findings": [
                {
                    "kind": f.kind,
                    "notes": list(f.note_ids),
                    "summary": f.summary,
                    "numbers": dict(f.numbers),
                    "insufficient_data": f.insufficient_data,
                }
                for f in self.findings
            ],
            "proposals": [proposal.as_dict() for proposal in self.proposals],
        }

    def as_text(self) -> str:
        """Return the report as text for people: findings grouped by kind, then the proposals and their switches."""
        lines = [f"Curator report over {self.notes} note(s)."]
        for kind in sorted({f.kind for f in self.findings}, key=_kind_order):
            lines += ["", f"{_TITLES[kind]}:"]
            lines += [
                f"  {', '.join(f.note_ids)}: {f.summary}{'  [insufficient_data]' if f.insufficient_data else ''}"
                for f in self.findings
                if f.kind == kind
            ]
        if not self.findings:
            lines.append("Nothing to report.")
        if self.proposals:
            lines += ["", "Proposed actions (each is a commit and an event; a switch that is off only proposes):"]
            lines += [
                f"  {p.action} {p.note_id}{f' -> {p.to_status}' if p.to_status else ''}: {p.reason} "
                f"[maintenance.{p.switch} is {'on' if p.enabled else 'off'}]"
                for p in self.proposals
            ]
        lines += [
            "",
            "Nothing here rewrites a technical claim, merges notes or deletes a note; those are for a person.",
        ]
        return "\n".join(lines)


_TITLES = {
    "weak_summary": "Surfaced often, read rarely (the summary or search words may be weak)",
    "overbroad": "Read often, rarely useful (the summary or scope may be too broad)",
    "misleading": "Graded misleading or stale in several sessions",
    "useful": "Repeatedly useful across distinct sessions",
    "drift": "Source files that no longer exist",
    "expired": "Past their expiry date",
    "candidate_positive": "Candidate notes with positive grades",
    "candidate_idle": "Candidate notes with no grade after a long time",
    "external": "Notes with trust: external (never changed automatically)",
    "duplicate_cluster": "Probable duplicates",
    "insufficient_data": "Too few independent sessions to judge",
}


def _kind_order(kind: str) -> int:
    return list(_TITLES).index(kind)


# ---------------------------------------------------------------------------------------------------------------------
# Findings and proposals


def source_exists(root: Path) -> Callable[[str], bool]:
    """Return the check of ``analyse`` for ``source_files``: does the path exist in the code at ``root`` (the checkout)?

    A pattern with ``*``, ``?`` or ``[`` exists if anything matches it. A path outside the repository, or a pattern that
    cannot be matched, is taken to exist: the curator never claims a file is gone that it cannot look at.
    """
    base = root.resolve()

    def exists(path: str) -> bool:
        if any(char in path for char in "*?["):
            try:
                return any(base.glob(path))
            except (ValueError, NotImplementedError):
                return True
        target = (base / path).resolve()
        return target.exists() if target.is_relative_to(base) else True

    return exists


def analyse(
    notes: Sequence[VersionedNote],
    events: Sequence[Event],
    config: MaintenanceConfig,
    *,
    now: dt.datetime,
    exists: Callable[[str], bool],
    duplicate_pairs: Sequence[tuple[str, str, float]] = (),
) -> CuratorReport:
    """Return the findings and proposals for ``notes`` given the event log; nothing is changed (this is the dry run).

    ``exists`` says whether a ``source_files`` path still exists in the code. ``duplicate_pairs`` are the
    ``(id, id, similarity)`` pairs of ``search.duplicates.duplicate_pairs``, which needs the embedding model and is
    therefore computed by the caller.
    """
    by_id = {versioned.note.id: versioned for versioned in notes}
    stats = note_stats(events, retrieval_since=_retrieval_since(events), grades_since=content_revisions(events))
    findings: list[Finding] = []
    for versioned in sorted(notes, key=lambda item: item.note.id):
        findings += _findings_of(versioned.note, stats.get(versioned.note.id), config, now, exists)
    findings += _cluster_findings(duplicate_pairs)

    proposals = _proposals(by_id, stats, findings, duplicate_pairs, config, now)
    return CuratorReport(len(by_id), tuple(findings), tuple(proposals))


def _retrieval_since(events: Sequence[Event]) -> dict[str, str]:
    """The time of the last change of title, summary or tags of each note (a revision or a curation).

    A ``curated`` event with ``changed: []`` counts too: it records that a model-written action was tried and changed
    nothing, and the finding behind it starts again from new sessions.
    """
    since: dict[str, str] = {}
    for event in events:
        if event.type in ("revised", "curated") and event.note_id:
            changed = event.data.get("changed")
            tried = event.type == "curated" and changed == []
            if tried or (isinstance(changed, list) and set(changed) & set(TEXT_FIELDS)):
                since[event.note_id] = max(since.get(event.note_id, ""), event.ts)
    return since


def _findings_of(
    note: Note,
    stats: NoteStats | None,
    config: MaintenanceConfig,
    now: dt.datetime,
    exists: Callable[[str], bool],
) -> list[Finding]:
    """The findings about one note (every rule of design 11.2 that concerns a single note)."""
    minimum = config.minimum_independent_sessions
    found: list[Finding] = []
    zero = NoteStats(note.id, 0, 0, 0, 0, 0, {})
    s = stats or zero
    useful = s.share(USEFUL_OUTCOMES)
    numbers = {
        "surfaced": s.surfaced,
        "read": s.read,
        "read_of_surfaced": s.read_of_surfaced,
        "graded": s.graded,
        "unknown": s.unknown,
        "outcomes": dict(s.outcomes),
    }
    low = s.surfaced < minimum and s.graded < minimum

    if (
        note.status in LIVE
        and s.surfaced >= minimum
        and s.read_of_surfaced / s.surfaced <= config.weak_summary_max_read_rate
    ):
        found.append(
            Finding(
                "weak_summary",
                (note.id,),
                f"read in {s.read_of_surfaced} of {s.surfaced} sessions that were shown it; "
                f"the content may be fine, the summary or its search words may not say when it helps",
                numbers,
            )
        )
    if (
        note.status in LIVE
        and s.read >= minimum
        and s.graded >= minimum
        and (useful or 0.0) <= config.overbroad_max_useful_share
    ):
        found.append(
            Finding(
                "overbroad",
                (note.id,),
                f"useful in {s.count(USEFUL_OUTCOMES)} of {s.graded} graded sessions although it is read in {s.read}",
                numbers,
            )
        )
    bad = s.count(("misleading", "stale"))
    if note.status in LIVE and bad >= config.repeated_min_sessions:
        found.append(
            Finding(
                "misleading",
                (note.id,),
                f"graded misleading or stale in {bad} of {s.graded} graded sessions; its content needs a person "
                f"(a superseding note keeps the old one)",
                numbers,
                insufficient_data=s.graded < minimum,
            )
        )
    if note.status == "active" and s.graded >= minimum and (useful or 0.0) >= config.useful_min_share:
        skill = note.type == "procedure"
        found.append(
            Finding(
                "useful",
                (note.id,),
                f"graded used or helpful in {s.count(USEFUL_OUTCOMES)} of {s.graded} graded sessions"
                + ("; as a procedure it may be worth a native skill (design 12)" if skill else ""),
                {**numbers, "consider_skill": skill},
            )
        )
    if note.status in (*LIVE, "stale"):
        missing = [path for path in note.source_files if not exists(path)]
        if missing:
            found.append(
                Finding(
                    "drift",
                    (note.id,),
                    f"{len(missing)} of {len(note.source_files)} source file(s) no longer exist: {', '.join(missing)}",
                    {"missing": missing, "source_files": list(note.source_files)},
                )
            )
    if note.status in LIVE and note.expires_at and note.expires_at <= format_timestamp(now):
        found.append(Finding("expired", (note.id,), f"expires_at {note.expires_at} has passed", {}))
    if note.status == "candidate":
        positive = s.count(USEFUL_OUTCOMES)
        enough = s.graded >= minimum and (useful or 0.0) >= config.useful_min_share
        if positive and (enough or s.graded < minimum):
            found.append(
                Finding(
                    "candidate_positive",
                    (note.id,),
                    f"graded used or helpful in {positive} of {s.graded} graded sessions"
                    + ("; it is trust: external, so a person decides" if note.trust == "external" else ""),
                    numbers,
                    insufficient_data=s.graded < minimum,
                )
            )
        age = (now - dt.datetime.strptime(note.created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)).days
        if age >= config.candidate_idle_days and s.graded + s.unknown == 0:
            found.append(Finding("candidate_idle", (note.id,), f"{age} days old and never graded", {"age_days": age}))
    if note.trust == "external" and note.status in (*LIVE, "stale"):
        found.append(
            Finding("external", (note.id,), f"status {note.status}; its text came from outside the project", {})
        )
    if stats is not None and low and note.status in LIVE:
        found.append(
            Finding(
                "insufficient_data",
                (note.id,),
                f"surfaced in {s.surfaced} and graded in {s.graded} sessions (at least {minimum} are needed)",
                numbers,
                insufficient_data=True,
            )
        )
    return found


def _cluster_findings(pairs: Sequence[tuple[str, str, float]]) -> list[Finding]:
    """Group duplicate pairs into clusters (a note similar to two others joins all three)."""
    parent: dict[str, str] = {}

    def find(item: str) -> str:
        while parent.setdefault(item, item) != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    for first, second, _ in pairs:
        parent[find(first)] = find(second)
    clusters: dict[str, set[str]] = defaultdict(set)
    for first, second, _ in pairs:
        clusters[find(first)] |= {first, second}
    result = []
    for members in sorted(clusters.values(), key=sorted):
        ids = tuple(sorted(members))
        similar = {f"{a} {b}": round(value, 3) for a, b, value in pairs if a in members}
        result.append(
            Finding(
                "duplicate_cluster",
                ids,
                f"{len(ids)} notes repeat each other; linking them as related is safe, merging them is for a person",
                {"similarity": similar},
            )
        )
    return result


def _proposals(
    notes: Mapping[str, VersionedNote],
    stats: Mapping[str, NoteStats],
    findings: Sequence[Finding],
    duplicate_pairs: Sequence[tuple[str, str, float]],
    config: MaintenanceConfig,
    now: dt.datetime,
) -> list[Proposal]:
    """Turn the findings into proposals (design 11.2, the allowed actions); each rests on enough independent sessions."""
    minimum = config.minimum_independent_sessions
    result: list[Proposal] = []
    off = {action: bool(getattr(config, SWITCHES[action])) for action in ACTIONS}

    def propose(action: str, versioned: VersionedNote, reason: str, numbers: Mapping[str, Any], **extra: Any) -> None:
        result.append(
            Proposal(
                action, versioned.note.id, versioned.version, reason, SWITCHES[action], off[action], numbers, **extra
            )
        )

    # An explicit successor or expiry: the one case where fewer than the minimum number of sessions is enough.
    superseded: set[str] = set()
    successors = {
        v.note.supersedes: v.note.id
        for v in notes.values()
        if v.note.supersedes and v.note.status == "active" and v.note.trust == "normal"
    }
    for note_id, versioned in sorted(notes.items()):
        note = versioned.note
        if note_id in successors and note.status in (*LIVE, "stale"):
            superseded.add(note_id)
            propose(
                "mark_stale",
                versioned,
                f"{successors[note_id]} declares that it supersedes this note",
                {"superseded_by": successors[note_id]},
                to_status="superseded",
            )
        elif note.status in LIVE and note.expires_at and note.expires_at <= format_timestamp(now):
            propose("mark_stale", versioned, f"expires_at {note.expires_at} has passed", {}, to_status="stale")

    for note_id, versioned in sorted(notes.items()):
        note, s = versioned.note, stats.get(note_id)
        if s is None or s.graded < minimum or note_id in superseded:
            continue
        numbers = {"graded": s.graded, "outcomes": dict(s.outcomes)}
        wrong = s.share(FALSE_POSITIVE_OUTCOMES) or 0.0
        if note.status in (*LIVE, "stale") and wrong >= config.archive_min_false_positive_share:
            propose(
                "archive",
                versioned,
                f"graded irrelevant, misleading or stale in {s.count(FALSE_POSITIVE_OUTCOMES)} of {s.graded} sessions",
                numbers,
                to_status="archived",
            )
        useful = s.share(USEFUL_OUTCOMES) or 0.0
        if (
            note.status == "candidate"
            and note.trust == "normal"
            and useful >= config.useful_min_share
            and not s.count(("misleading", "stale"))
        ):
            propose(
                "promote",
                versioned,
                f"graded used or helpful in {s.count(USEFUL_OUTCOMES)} of {s.graded} sessions, never misleading or stale",
                numbers,
                to_status="active",
            )

    partners: dict[str, dict[str, float]] = defaultdict(dict)
    for first, second, similarity in duplicate_pairs:
        partners[first][second] = partners[second][first] = similarity
    for here in sorted(partners):
        note = notes[here].note
        new = [other for other in sorted(partners[here]) if other not in note.related]
        if new:
            propose(
                "link_related",
                notes[here],
                f"{', '.join(new)} repeat(s) this note; they are linked as related, not merged",
                {"similarity": {other: round(partners[here][other], 3) for other in new}},
                changes={"related": [*note.related, *new]},
            )

    misleading = {f.note_ids[0] for f in findings if f.kind == "misleading"}
    for finding in findings:
        versioned = notes[finding.note_ids[0]]
        if finding.kind != "weak_summary" or versioned.note.trust != "normal" or versioned.note.id in misleading:
            continue
        if versioned.note.id in superseded:
            continue
        reason = f"{finding.summary}; the small model proposes better words when this is applied"
        propose("add_tags", versioned, reason, finding.numbers)
        propose("rewrite_summary", versioned, reason, finding.numbers)
    return sorted(result, key=lambda p: (ACTIONS.index(p.action), p.note_id))


# ---------------------------------------------------------------------------------------------------------------------
# Applying


@dataclass(frozen=True)
class ActionResult:
    """What happened to one proposal: ``applied`` (with its commit), ``skipped`` (and why) or ``failed`` (and why)."""

    action: str
    note_id: str
    status: str
    detail: str
    commit: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return the result as plain data for ``knowledge curate --json``."""
        return {
            "action": self.action,
            "note_id": self.note_id,
            "status": self.status,
            "detail": self.detail,
            "commit": self.commit,
        }


def apply_proposals(
    branch: KnowledgeBranch,
    report: CuratorReport,
    config: Config,
    *,
    grader: Grader | None,
    context: EventContext,
    now: dt.datetime,
) -> list[ActionResult]:
    """Perform the proposals whose switch is on, for at most ``max_notes_per_run`` notes, and say what happened to each.

    Each action is one commit on the knowledge branch and one ``curated`` or ``status_changed`` event with the reason.
    The actions on one note run in order, each on the version the one before left; once a note's status has changed the
    rest of its proposals are skipped, because they were made for its old state. The two model-written actions share
    one model call per note (``grader``); without a grader they are skipped, when the model fails they are failed, and
    nothing is written for them. When the answer changes nothing, the action is skipped and a ``curated`` event with
    ``changed: []`` records it (the finding does not come back until new evidence). A note for which the model was asked
    counts against the limit, whatever came of the answer, so a broken grader cannot be paid for in a loop. A proposal is
    applied only to the version it was made for.
    """
    results: list[ActionResult] = []
    by_note: dict[str, list[Proposal]] = {}
    for proposal in report.proposals:  # already in the order of ``ACTIONS``
        if proposal.enabled:
            by_note.setdefault(proposal.note_id, []).append(proposal)
    budget = config.maintenance.max_notes_per_run
    for note_id, proposals in by_note.items():
        if budget <= 0:
            results += [
                ActionResult(p.action, note_id, "skipped", "the limit of notes per run is reached") for p in proposals
            ]
            continue
        done, spent = _apply_to_note(branch, proposals, config, grader, context, now)
        budget -= spent or any(result.status != "skipped" for result in done)
        results += done
    return results


def _apply_to_note(
    branch: KnowledgeBranch,
    proposals: Sequence[Proposal],
    config: Config,
    grader: Grader | None,
    context: EventContext,
    now: dt.datetime,
) -> tuple[list[ActionResult], bool]:
    """Apply the proposals of one note in order, each on the version the previous one produced.

    Returns the results and whether the model was asked (a call that changed nothing is still a call).
    """
    results: list[ActionResult] = []
    version = proposals[0].note_version
    answer: SummaryProposal | None = None
    model_failed = status_changed = False
    for proposal in proposals:
        note_id = proposal.note_id
        details: dict[str, Any] = {"by": "curator", "evidence": dict(proposal.numbers)}
        if status_changed:
            results.append(ActionResult(proposal.action, note_id, "skipped", "the note's status changed in this run"))
            continue
        trying = False  # the model has answered and its answer is about to be applied
        try:
            if proposal.to_status:
                changed = change_status(
                    branch,
                    note_id,
                    proposal.to_status,
                    reason=proposal.reason,
                    context=context,
                    now=now,
                    expected_version=version,
                    details={**details, "action": proposal.action},
                )
                status_changed = True
                what = f"-> {proposal.to_status}"
            else:
                if proposal.action == "link_related":
                    fields: Mapping[str, object] = proposal.changes
                elif grader is None or model_failed:
                    results.append(ActionResult(proposal.action, note_id, "skipped", "no model answer is available"))
                    continue
                else:
                    current = read_note(branch, note_id)
                    if current.version != version:
                        raise NoteError(f"{note_id} changed since the decision was made (version {current.version})")
                    if answer is None:
                        answer = _ask_model(
                            branch, grader, current.note, note_id, context, now, config.brief.max_summary_tokens
                        )
                    details |= {"model": answer.model, "prompt_version": CURATOR_PROMPT_VERSION}
                    fields = _model_fields(proposal.action, current.note, answer)
                    trying = True
                changed = curate_note(
                    branch,
                    note_id,
                    fields,
                    action=proposal.action,
                    reason=proposal.reason,
                    context=context,
                    now=now,
                    redact_secrets=config.privacy.redact_secrets,
                    max_summary_tokens=config.brief.max_summary_tokens,
                    expected_version=version,
                    details=details,
                )
                what = ", ".join(sorted(fields))
        except (NoteError, StoreError) as error:
            detail = "no change proposed" if isinstance(error, NoChangeError) else str(error)
            if trying and _record_unapplied(branch, proposal, detail, details, context, now, version):
                detail += " (recorded)"
            results.append(ActionResult(proposal.action, note_id, "skipped", detail))
        except GraderError as error:
            model_failed = True
            results.append(ActionResult(proposal.action, note_id, "failed", f"the small model failed: {error}"))
        else:
            version = changed.version
            results.append(ActionResult(proposal.action, note_id, "applied", what, changed.commit))
    return results, answer is not None or model_failed


def _ask_model(
    branch: KnowledgeBranch,
    grader: Grader,
    note: Note,
    note_id: str,
    context: EventContext,
    now: dt.datetime,
    max_summary_tokens: int,
) -> SummaryProposal:
    """Ask the small model about one note and record the call as a ``model_call`` event, whatever came of it.

    The event is written as soon as the call returns, so a failed call, an invalid answer and an answer that is not
    applied each leave their cost on the record (design 10.3). A failure is raised again after it is recorded.

    Raises
    ------
    GraderError
        If the call failed or its answer is not valid.
    """
    try:
        answer = propose_retrieval_text(grader, note, max_summary_chars=4 * max_summary_tokens)
    except GraderError as error:
        failed = call_data("curator", None, error)
        if failed is not None:
            record_events(branch, [new_event("model_call", context, now=now, note_id=note_id, data=failed)], now=now)
        raise
    answered = call_data("curator", answer.reply)
    record_events(branch, [new_event("model_call", context, now=now, note_id=note_id, data=answered)], now=now)
    return answer


def _record_unapplied(
    branch: KnowledgeBranch,
    proposal: Proposal,
    why: str,
    details: Mapping[str, Any],
    context: EventContext,
    now: dt.datetime,
    version: str,
) -> bool:
    """Record that a model answer was not applied (it changed nothing, or could not be); say whether that was written.

    The event moves the evidence boundary, so the finding is not raised again at once (the cost of the call is on its
    ``model_call`` event). If it cannot be written the action stays a plain skip: the next run asks again.
    """
    try:
        record_curation_skip(
            branch,
            proposal.note_id,
            action=proposal.action,
            reason=f"{proposal.reason}; {why}" if why == "no change proposed" else f"answer not applied: {why}",
            context=context,
            now=now,
            expected_version=version,
            details=details,
        )
    except (NoteError, StoreError):
        return False
    return True


def _model_fields(action: str, note: Note, answer: SummaryProposal) -> dict[str, object]:
    """The fields a model-written action changes: the summary, or the tags with the new ones added (at most 12 in all)."""
    if action == "rewrite_summary":
        return {"summary": answer.summary}
    tags = list(note.tags)
    for tag in answer.tags:
        if tag.lower() not in {existing.lower() for existing in tags} and len(tags) < MAX_TAGS_ON_A_NOTE:
            tags.append(tag)
    return {"tags": tags}
