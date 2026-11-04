"""Hybrid search: keyword and semantic rankings, fused, thresholded and ordered (design section 7.4).

Part of ``search`` (imports ``notes`` and ``config``). Only ``active`` and ``candidate`` notes are searched. A note enters
the keyword ranking if it shares a search term with the query and scores at least ``KEYWORD_MIN_RATIO`` of the best
keyword score; it enters the semantic ranking if its similarity to the query reaches the embedder's ``min_similarity``.
The rankings are fused by reciprocal rank; notes below the minimum quality are dropped. Notes that are ``candidate`` or
``trust: external`` come after all other notes (design sections 7.4 and 14.2). Without an embedder only keywords are used.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from project_knowledge.config import AUTO_MIN_RANK, KEYWORD_MIN_RATIO, RRF_K, RetrievalConfig
from project_knowledge.notes import SEARCHABLE_STATUSES, Note, VersionedNote
from project_knowledge.search.bm25 import rank_keyword
from project_knowledge.search.embeddings import Embedder, cosine, embed_notes
from project_knowledge.search.fusion import fuse

# How often each field is repeated in the text that BM25 sees, so a match in the title or tags outweighs one in the body.
TITLE_WEIGHT = 3
SUMMARY_WEIGHT = 2
TAGS_AND_FILES_WEIGHT = 2


@dataclass(frozen=True)
class SearchHit:
    """One result: the note and its version, its position in each ranking (``None`` if absent) and in the result."""

    note: Note
    version: str
    keyword_rank: int | None
    semantic_rank: int | None
    fused_rank: int
    score: float


def search(
    query: str,
    notes: Sequence[VersionedNote],
    *,
    retrieval: RetrievalConfig,
    embedder: Embedder | None = None,
    cache_path: Path | None = None,
    limit: int | None = None,
) -> list[SearchHit]:
    """Return the notes relevant to ``query``, best first, at most ``limit`` of them (all that pass if ``None``).

    ``embedder`` enables the semantic ranking and ``cache_path`` is where its vectors are cached; both may be
    ``None``. No network is used. An empty result means nothing passed the relevance threshold.
    """
    candidates = {versioned.note.id: versioned for versioned in notes if versioned.note.status in SEARCHABLE_STATUSES}
    if not candidates or not query.strip():
        return []

    # Keyword ranking: BM25, keeping matches close to the best one.
    scored = rank_keyword(query, {identifier: _keyword_text(v.note) for identifier, v in candidates.items()})
    keyword = [identifier for identifier, score in scored if scored and score >= KEYWORD_MIN_RATIO * scored[0][1]]

    # Semantic ranking: cosine similarity to the query, keeping notes the model considers related.
    semantic: list[str] = []
    if embedder is not None:
        vectors = embed_notes(list(candidates.values()), embedder, cache_path)
        (query_vector,) = embedder.queries([query])
        similarity = {
            identifier: cosine(query_vector, vectors[versioned.version]) for identifier, versioned in candidates.items()
        }
        semantic = [
            identifier
            for identifier, value in sorted(similarity.items(), key=lambda item: (-item[1], item[0]))
            if value >= embedder.min_similarity
        ]

    # Fuse, drop what is below the minimum quality, and put candidate and external notes after the rest.
    minimum = 1.0 / (RRF_K + AUTO_MIN_RANK) if retrieval.min_quality == "auto" else float(retrieval.min_quality)
    fused = [(identifier, score) for identifier, score in fuse([keyword, semantic]) if score >= minimum]
    fused.sort(key=lambda item: (_is_demoted(candidates[item[0]].note), -item[1], item[0]))

    hits = [
        SearchHit(
            note=candidates[identifier].note,
            version=candidates[identifier].version,
            keyword_rank=keyword.index(identifier) + 1 if identifier in keyword else None,
            semantic_rank=semantic.index(identifier) + 1 if identifier in semantic else None,
            fused_rank=position,
            score=score,
        )
        for position, (identifier, score) in enumerate(fused, start=1)
    ]
    return hits if limit is None else hits[:limit]


def _keyword_text(note: Note) -> str:
    """Return the text BM25 sees for a note: fields repeated by weight, then the body."""
    tags_and_files = " ".join([*note.tags, *note.source_files])
    return " ".join(
        [
            " ".join([note.title] * TITLE_WEIGHT),
            " ".join([note.summary] * SUMMARY_WEIGHT),
            " ".join([tags_and_files] * TAGS_AND_FILES_WEIGHT),
            note.body,
        ]
    )


def _is_demoted(note: Note) -> bool:
    """Return whether a note is ranked after all others: a candidate, or one built from external content."""
    return note.status == "candidate" or note.trust == "external"
