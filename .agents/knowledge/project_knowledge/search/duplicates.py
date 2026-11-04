"""Duplicate detection for a new note: high similarity to an existing note plus overlapping tags or source files.

Part of ``search`` (imports ``notes``). The rule (design section 7.6, "high semantic similarity + overlapping tags/files"):
with an embedder, an existing searchable note is a probable duplicate when the cosine similarity of the two notes' texts is
at least ``SIMILARITY_WITH_OVERLAP`` and they share a tag or a source file, or at least ``SIMILARITY_ALONE`` whatever they
share. Without an embedder the same rule is applied to the overlap of the words of title and summary (Jaccard index) with
``LEXICAL_WITH_OVERLAP`` and ``LEXICAL_ALONE``. The check only reports; it never merges anything.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from project_knowledge.notes import SEARCHABLE_STATUSES, Duplicate, Note, VersionedNote
from project_knowledge.search.bm25 import tokenize
from project_knowledge.search.embeddings import Embedder, cosine, embed_notes, note_embedding_text

# Embedding cosine thresholds. Measured with bge-small on a few hand-written pairs: a paraphrase of the same finding
# scored 0.91 and notes about different findings 0.47 to 0.58. So 0.85 needs the extra evidence of shared tags or files
# before a note counts as a duplicate, and 0.95 stands on its own. To be tuned on real notes.
SIMILARITY_WITH_OVERLAP = 0.85
SIMILARITY_ALONE = 0.95
# Word-overlap thresholds for the keyword-only fallback: half the words in common with shared tags or files, four fifths alone.
LEXICAL_WITH_OVERLAP = 0.5
LEXICAL_ALONE = 0.8
MAX_REPORTED = 5


def find_duplicates(
    candidate: Note,
    existing: Sequence[VersionedNote],
    *,
    embedder: Embedder | None = None,
    cache_path: Path | None = None,
) -> list[Duplicate]:
    """Return the existing notes that ``candidate`` probably repeats, most similar first, at most five."""
    others = [versioned for versioned in existing if versioned.note.status in SEARCHABLE_STATUSES]
    if not others:
        return []

    # Measure how alike the candidate is to each existing note, by embeddings if there is a model, else by words.
    if embedder is not None:
        vectors = embed_notes(others, embedder, cache_path)
        (own,) = embedder.passages([note_embedding_text(candidate)])
        similarity = {v.note.id: cosine(own, vectors[v.version]) for v in others}
        with_overlap, alone = SIMILARITY_WITH_OVERLAP, SIMILARITY_ALONE
    else:
        own_words = set(tokenize(f"{candidate.title} {candidate.summary}"))
        similarity = {v.note.id: _jaccard(own_words, set(tokenize(f"{v.note.title} {v.note.summary}"))) for v in others}
        with_overlap, alone = LEXICAL_WITH_OVERLAP, LEXICAL_ALONE

    found = []
    for versioned in others:
        value = similarity[versioned.note.id]
        if _is_duplicate(candidate, versioned.note, value, with_overlap, alone):
            found.append(Duplicate(versioned.note.id, versioned.note.title, value))
    return sorted(found, key=lambda item: (-item.similarity, item.note_id))[:MAX_REPORTED]


def duplicate_pairs(
    notes: Sequence[VersionedNote], *, embedder: Embedder | None = None, cache_path: Path | None = None
) -> list[tuple[str, str, float]]:
    """Return every pair of searchable notes that probably repeat each other, as ``(first id, second id, similarity)``.

    This is the rule of ``find_duplicates`` applied to all pairs of the branch at once (the curator's duplicate
    clusters, design 11.2); the pairs are in id order and the notes are only measured, never changed.
    """
    searchable = sorted((v for v in notes if v.note.status in SEARCHABLE_STATUSES), key=lambda v: v.note.id)
    if len(searchable) < 2:
        return []
    if embedder is not None:
        vectors = embed_notes(searchable, embedder, cache_path)
        with_overlap, alone = SIMILARITY_WITH_OVERLAP, SIMILARITY_ALONE

        def measure(first: VersionedNote, second: VersionedNote) -> float:
            return cosine(vectors[first.version], vectors[second.version])
    else:
        with_overlap, alone = LEXICAL_WITH_OVERLAP, LEXICAL_ALONE

        def measure(first: VersionedNote, second: VersionedNote) -> float:
            words = (set(tokenize(f"{item.note.title} {item.note.summary}")) for item in (first, second))
            return _jaccard(*words)

    found = []
    for position, first in enumerate(searchable):
        for second in searchable[position + 1 :]:
            value = measure(first, second)
            if _is_duplicate(first.note, second.note, value, with_overlap, alone):
                found.append((first.note.id, second.note.id, value))
    return found


def _is_duplicate(first: Note, second: Note, similarity: float, with_overlap: float, alone: float) -> bool:
    """The rule: similar enough alone, or similar enough and sharing a tag or a source file."""
    shares = bool(set(first.tags) & set(second.tags)) or bool(set(first.source_files) & set(second.source_files))
    return similarity >= alone or (shares and similarity >= with_overlap)


def _jaccard(first: set[str], second: set[str]) -> float:
    return len(first & second) / len(first | second) if first | second else 0.0
