"""Keyword ranking with BM25 over note text, held in memory.

Part of ``search`` (imports ``config`` for the BM25 parameters). Identifiers are split into their words (``snake_case``,
``camelCase``) but also kept whole, so a query for an exact function name, file name or error string matches notes that
contain it.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Mapping

from project_knowledge.config import BM25_B, BM25_K1

# Words that carry no meaning for matching; without them a query like "the build of the project" would match every note.
STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "do",
        "for",
        "from",
        "has",
        "have",
        "how",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "no",
        "not",
        "of",
        "on",
        "or",
        "so",
        "such",
        "that",
        "the",
        "their",
        "then",
        "there",
        "these",
        "they",
        "this",
        "to",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "you",
        "your",
    ]
)

_WORD = re.compile(r"[A-Za-z0-9_]+")
_PART = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+")


def tokenize(text: str) -> list[str]:
    """Split text into lowercase search terms: identifiers whole and in parts, without stop words or single letters."""
    terms: list[str] = []
    for word in _WORD.findall(text):
        parts = [part.lower() for part in _PART.findall(word)]
        if len(parts) > 1:
            terms.append(word.lower())
        terms.extend(parts)
    return [term for term in terms if len(term) > 1 and term not in STOPWORDS]


def rank_keyword(
    query: str, documents: Mapping[str, str], *, k1: float = BM25_K1, b: float = BM25_B
) -> list[tuple[str, float]]:
    """Rank documents (ID to text) against a query by BM25; return ``(id, score)`` best first, matches only.

    A document appears only if it shares at least one search term with the query. Ties are broken by ID so the order is
    reproducible. The inverse document frequency is ``ln(1 + (N - n + 0.5) / (n + 0.5))``, which stays positive for
    terms that occur in most documents.
    """
    tokens = {identifier: Counter(tokenize(text)) for identifier, text in documents.items()}
    if not tokens:
        return []
    average_length = sum(sum(counts.values()) for counts in tokens.values()) / len(tokens) or 1.0
    wanted = set(tokenize(query))

    # Count how many documents contain each query term, for the inverse document frequency.
    frequency = {term: sum(1 for counts in tokens.values() if term in counts) for term in wanted}
    scores: dict[str, float] = {}
    for identifier, counts in tokens.items():
        length = sum(counts.values())
        score = 0.0
        for term in wanted:
            occurrences = counts.get(term, 0)
            if occurrences == 0:
                continue
            idf = math.log(1 + (len(tokens) - frequency[term] + 0.5) / (frequency[term] + 0.5))
            score += idf * occurrences * (k1 + 1) / (occurrences + k1 * (1 - b + b * length / average_length))
        if score > 0:
            scores[identifier] = score
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))
