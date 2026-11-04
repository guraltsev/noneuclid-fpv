"""Reading a transcript in bounded chunks that end at a line end, for every runtime (design 8.3).

``read_chunks_with`` owns the file handling (byte offsets, a line longer than the chunk, an unfinished last line) and is
given the runtime's own line parser, so each reader only says how to understand lines. Reading in chunks of any size
gives the same records as reading the whole file.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

from project_knowledge.transcripts.records import Coverage, TranscriptRecord, Usage

# A runtime's line parser: complete lines in, records, parse coverage and the id of the last record out.
ParseLines = Callable[[bytes], tuple[list[TranscriptRecord], Coverage, str | None]]


@dataclass(frozen=True)
class Chunk:
    """The records of one bounded read: where it ended, how much was understood, the last record id seen and the id of
    the last model response in it (``None`` if it has none)."""

    records: list[TranscriptRecord]
    end: int
    coverage: Coverage
    last_uuid: str | None
    last_message_id: str | None = None


def read_chunks_with(parse: ParseLines, path: Path, offset: int, chunk_bytes: int) -> Iterator[Chunk]:
    """Yield the transcript from byte ``offset`` on, in chunks of about ``chunk_bytes`` that end at a line end.

    The caller moves its cursor to ``Chunk.end`` after it has processed a chunk (the generator is lazy, so the next chunk
    is read only when asked for). A last line without a line end is not read: the runtime may still be writing it. A
    single line longer than ``chunk_bytes`` is read whole.
    """
    with path.open("rb") as handle:
        handle.seek(offset)
        position = offset
        while True:
            data = handle.read(max(chunk_bytes, 1))
            if not data:
                return
            while b"\n" not in data:  # a line longer than the chunk: keep reading until it ends
                more = handle.read(max(chunk_bytes, 1))
                if not more:
                    return  # an unfinished last line: leave it for the next read
                data += more
            used = data.rindex(b"\n") + 1
            handle.seek(position + used)  # give back the unfinished line at the end of the data
            records, coverage, last_uuid = parse(data[:used])
            position += used
            responses = [r.message_id for r in records if isinstance(r, Usage) and r.message_id is not None]
            yield Chunk(records, position, coverage, last_uuid, responses[-1] if responses else None)
