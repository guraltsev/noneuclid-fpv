# Job 62 - Make the client write check measure writes

Status: in progress.
Resolves: issue [91](../../_issues/91_legacy_world_writers_list_does_not_measure_writes.md).

## Goal

Clients hold a registry they cannot write through, and the list of files that still need the writer is exact.

## Depends on

Nothing.

## Before you start

- Read issue 91 and 013 sections 6.1, 12.2 and 14. Re-check its per-file claims: they came from a read-only audit.

## Decisions

- Files in `render/`, `ui/` and `runtime/` receive `RuntimeObjectReader` by default. A file that still writes takes the new type
  `LegacyWorldWriter`, which is `RuntimeObjectRegistry` under a name that can be searched for.
- `legacyWorldWriters` becomes the list of files that name `LegacyWorldWriter` or call a world-objects mutator. `docs:check` fails on a
  file outside the list that does either, and on a listed file that does neither, so the list stays exact.
- `RuntimeObjectReader.changes` stops exposing `clear` and `retainFrom`: clients read the ring only.
- The list may only shrink; the existing test stays.

## Steps

1. The types, then pass the reader wherever a client only reads. Typecheck finds the writers.
2. The check in `scripts/docs/lib.mjs`, with tests in `tests/project/moduleImportRules.test.ts`, covering `runtime/`.
3. Record the file count and the count of write calls in the job's Report: later jobs compare with them.

## Tests and checks

Typecheck, tests, `docs:check`. No behaviour changes: no assertion changes.

## Do not

Do not move any write into a command here.

## Done when

The 8 files that only read are off the list, the two unlisted writers are on it, and `grep -rn "legacyWorldWriters" scripts` shows the check.
