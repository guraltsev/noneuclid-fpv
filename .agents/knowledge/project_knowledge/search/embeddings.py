"""Local text embeddings for notes, and the derived cache of note vectors keyed by blob hash.

Part of ``search`` (imports ``notes``). An ``Embedder`` is a model behind two plain functions; the real one is created by
``load_fastembed`` (imported on first use, so commands that do not search start fast) and tests pass a fake. The cache is a
derived file, never committed: ``numpy`` ``.npz`` holding the model name, the note versions (Git blob hashes) and one
float32 vector per version. A cache written for another model, a damaged cache, or a failure to save it only costs
re-embedding; it never changes results.
"""

from __future__ import annotations

import math
import zipfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from project_knowledge.notes import Note, VersionedNote

BODY_CHARS_EMBEDDED = 1200  # the model reads at most 512 tokens anyway; the start of the body is the useful part

Vectors = Callable[[Sequence[str]], list[list[float]]]


class EmbedderUnavailableError(RuntimeError):
    """The embedding model cannot be loaded (not installed, not downloaded, or no network for the first download)."""


@dataclass(frozen=True)
class Embedder:
    """A text embedding model.

    ``passages`` embeds documents and ``queries`` embeds search queries (models such as BGE treat them differently).
    ``min_similarity`` is the cosine similarity below which two texts are not considered related for this model, so
    that an unrelated query does not "match" the nearest note.
    """

    model: str
    passages: Vectors
    queries: Vectors
    min_similarity: float


def load_fastembed(model: str, cache_dir: Path, min_similarity: float) -> Embedder:
    """Load a ``fastembed`` ONNX model (CPU, no network once downloaded) from ``cache_dir``.

    Raises
    ------
    EmbedderUnavailableError
        If ``fastembed`` is missing, or the model files cannot be loaded or downloaded.
    """
    try:
        from fastembed import TextEmbedding  # noqa: PLC0415 - heavy import, only when a search needs it

        loaded = TextEmbedding(model_name=model, cache_dir=str(cache_dir))
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        raise EmbedderUnavailableError(f"cannot load the embedding model {model}: {error}") from error

    def passages(texts: Sequence[str]) -> list[list[float]]:
        return [vector.tolist() for vector in loaded.passage_embed(list(texts))]

    def queries(texts: Sequence[str]) -> list[list[float]]:
        return [vector.tolist() for vector in loaded.query_embed(list(texts))]

    return Embedder(model=model, passages=passages, queries=queries, min_similarity=min_similarity)


def note_embedding_text(note: Note) -> str:
    """Return the text that represents a note to the embedding model: title, summary, tags and the start of the body."""
    return f"{note.title}. {note.summary} {' '.join(note.tags)}\n{note.body[:BODY_CHARS_EMBEDDED]}"


def cosine(first: Sequence[float], second: Sequence[float]) -> float:
    """Return the cosine similarity of two vectors, 0.0 if either has no length."""
    dot = sum(a * b for a, b in zip(first, second, strict=True))
    norm = math.sqrt(sum(a * a for a in first)) * math.sqrt(sum(b * b for b in second))
    return dot / norm if norm else 0.0


def embed_notes(
    notes: Sequence[VersionedNote], embedder: Embedder, cache_path: Path | None, *, rebuild: bool = False
) -> dict[str, list[float]]:
    """Return a vector for each note version, reusing the cache and embedding only versions it lacks.

    The cache is rewritten to hold exactly the versions in ``notes``. ``rebuild`` ignores any existing cache.
    ``cache_path`` may be ``None`` to work without a cache.
    """
    known = {} if rebuild or cache_path is None else _load_cache(cache_path, embedder.model)
    wanted = {versioned.version: versioned.note for versioned in notes}
    missing = [version for version in wanted if version not in known]

    # Embed what the cache lacks in one batch.
    if missing:
        fresh = embedder.passages([note_embedding_text(wanted[version]) for version in missing])
        known.update(zip(missing, fresh, strict=True))
    vectors = {version: known[version] for version in wanted}

    # Keep exactly the current versions in the cache; a failed save only costs time on the next run.
    if cache_path is not None and (missing or rebuild):
        _save_cache(cache_path, embedder.model, vectors)
    return vectors


def _load_cache(path: Path, model: str) -> dict[str, list[float]]:
    """Read the cache, or return an empty one if it is absent, damaged, or written for another model."""
    import numpy as np  # noqa: PLC0415

    if not path.is_file():
        return {}
    try:
        with np.load(path, allow_pickle=False) as stored:
            if str(stored["model"]) != model:
                return {}
            return {
                str(version): vector.tolist()
                for version, vector in zip(stored["versions"], stored["vectors"], strict=True)
            }
    except (OSError, EOFError, ValueError, KeyError, zipfile.BadZipFile):
        return {}


def _save_cache(path: Path, model: str, vectors: dict[str, list[float]]) -> None:
    """Write the cache next to its final name and move it into place; ignore failures (the cache is derived)."""
    import numpy as np  # noqa: PLC0415

    if not vectors:
        return
    temporary = path.with_name(path.name + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as handle:
            np.savez(
                handle,
                model=np.array(model),
                versions=np.array(list(vectors), dtype=str),
                vectors=np.array(list(vectors.values()), dtype=np.float32).reshape(len(vectors), -1),
            )
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)
