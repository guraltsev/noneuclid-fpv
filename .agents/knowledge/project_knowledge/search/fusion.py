"""Reciprocal rank fusion of several rankings.

Part of ``search`` (imports ``config`` for the constant). The fused score of a document is the sum over the rankings that
contain it of ``1 / (k + rank)`` with ranks starting at 1, so it depends only on the ranks and needs no normalisation of
the underlying scores (design section 7.4).
"""

from __future__ import annotations

from collections.abc import Sequence

from project_knowledge.config import RRF_K


def fuse(rankings: Sequence[Sequence[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Fuse rankings (each a list of IDs, best first) into ``(id, score)`` pairs, best score first, ties by ID."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for position, identifier in enumerate(ranking, start=1):
            scores[identifier] = scores.get(identifier, 0.0) + 1.0 / (k + position)
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))
