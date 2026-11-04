# Job 57 - Keep every change readable: a ring behind the journal, cursors that survive endFrame

Status: queued.
Resolves: part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

Today `endFrame` wipes the journal and resets every derive tick's cursor, so a write made between `engine.step` and `endFrame` is
never seen by any tick, and a lazy cache has nothing to read. Put a ring with absolute sequence numbers behind the journal. The
frame view keeps its interface; ticks and (in job 58) caches read the ring.

## Depends on

Job 56.

## Before you start

- Read design 014 sections 3.1 and 9, and design 013 sections 6.2 to 6.4.
- Read `src/world-objects/runtimeObjectChangeJournal.ts`, `src/engine/moduleTicks.ts`, the `endFrame` of `src/engine/worldEngine.ts`,
  and `replaceObject` in `src/world-objects/runtimeObjectRegistry.ts`.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

- The shell's frame (`createThreeApp.ts`): `engine.step`, then `advanceCurveShorteningPairs` and direct refreshes, later
  `engine.endFrame()`.
- `registry.changes` is used by the engine and tests. `participants.journal` uses the same factory and stays frame-only in meaning.
- `guardRegistry` copies the registry with a spread, so `changes` is the same object in both copies. Keep `changes` a plain property.

## Decisions

- The ring goes **in `src/world-objects/runtimeObjectChangeJournal.ts`**, next to the journal, generic in the record. `ChangeOp` and
  `JournalRecord` stay there, because the tests import `ChangeOp` from that path. A separate file would make a type cycle.

  ```ts
  export interface ChangeRing<T extends JournalRecord> {
    readonly headSeq: number;
    readonly baseSeq: number;
    lastSeqOfKind(kind: string): number;
    opAt(seq: number): ChangeOp;
    idAt(seq: number): string;
    kindAt(seq: number): string;
    objectAt(seq: number): T;
    beforeAt(seq: number): T | undefined;
  }
  ```

- Storage: parallel arrays of a power-of-two capacity, starting at 8192; the slot of `seq` is `seq & (capacity - 1)`.
  `baseSeq = max(0, headSeq - capacity)`. `lastSeqByKind: Map<string, number>` is never reset, so `touchedKinds` is deleted.
- `beforeAt`: undefined for Added, the replaced record for Updated, the removed record for Removed.
- **Retention.** The journal keeps `retainFromSeq`, starting at 0. `record` first checks `headSeq - retainFromSeq >= capacity`; if so it
  doubles the capacity and re-lays the entries by their new slots. So nothing at or after `retainFromSeq` is ever overwritten.
- **`clear()` sets both `frameStartSeq` and `retainFromSeq` to `headSeq`.** This matters: `participants.journal` is cleared every frame and never
  calls anything else, and if `clear` left `retainFromSeq` at 0 that journal would double for ever. An owner with cursors lowers it again right
  after, with `retainFrom(seq)`.
- `retainFrom(seq)` goes on `RuntimeObjectChangeJournal` beside `clear`, not on `ChangeRing` and not on the recorder only: the engine holds
  `registry.changes` by that type.
- **The journal is a view of the ring.** `RuntimeObjectChangeJournal<T>` keeps `length`, `opAt`, `idAt`, `kindAt`, `objectAt`,
  `lastIndexOfKind` and `clear`, all addressed from 0 at the frame start, and adds `readonly ring: ChangeRing<T>` and
  `readonly frameStartSeq: number`. `lastIndexOfKind(kind)` is `lastSeq - frameStart`, or -1 when that is negative.
- `record(op, object, before?)`. The registry passes the previous record in `replaceObject`, and the object itself on `remove`.
- **An update that changes the kind** (`previous.kind !== next.kind` in `replaceObject`) is recorded as `Removed(previous)` then
  `Added(next)`, so a reader of either kind sees it.
- **Ticks.** `cursor` and `changesFrom`, `changesTo` are absolute sequence numbers. A tick starts at `ring.baseSeq`. `runIdleable` and
  `runEventHandlers` use `frameStartSeq` to `headSeq`. `runDeriveTick`: **when the tick does not wake, set `entry.cursor = headSeq`**; it
  had nothing to read, and a sleeping tick must not hold the ring back.
- `resetCursors` is replaced by `resetEventCursors`: event cursors still reset, because `endFrame` clears the events. Derive cursors do
  not.
- Add `lowestCursor()` to the tick runner: the lowest derive cursor, or `Number.POSITIVE_INFINITY` with no derive ticks.
- `engine.endFrame`, in order: `registry.changes.clear()`; `participants.journal.clear()`; clear events and results;
  `ticks.resetEventCursors()`; then `registry.changes.retainFrom(min(registry.changes.frameStartSeq, ticks.lowestCursor()))`.
- The `StepContext` comment on `changesFrom` and `changesTo` says they are sequence numbers, read through `ctx.objects.changes.ring`.
- A module may read `ctx.objects.changes.ring`. Add it to nothing else: `WorldReadView.objects` already exposes `changes`.

## Steps

1. Write the ring (`createChangeRing`), with tests in a new file `tests/world-objects/changeRing.test.ts`: sequence numbers keep rising; `baseSeq` rises once
   capacity is passed, with no retention; old slots read back correctly; `lastSeqOfKind`; `beforeAt` for each op; growth under
   retention keeps every entry at or after `retainFromSeq` readable, in order, through two doublings; **a journal that is cleared every frame
   and never calls `retainFrom` keeps its capacity** (write ten times the capacity, clearing every few entries, and check that `baseSeq`
   rises). Use a small capacity in tests (a factory parameter).

2. Rebuild the journal in the same file as a view of the ring. `tests/world-objects/runtimeObjectChangeJournal.test.ts` must pass **with no
   change**: if it does not, the view is wrong.

3. Pass `before` from the registry, and record a kind change as two entries. Add a registry test for that.

4. Change `moduleTicks.ts` and `worldEngine.ts` as decided.

5. Change these assertions in `tests/engine/worldEngine.test.ts`, and **only** these. Record each under `### Deviations`:
   - In the test with `wants` and `a/other`: the ranges were `[[0, 2]]` and `[[0, 2], [2, 3]]`; they become `[[1, 2]]` and
     `[[1, 2], [2, 3]]`, because a pass that does not wake moves the cursor.
   - "starts every cursor again after endFrame clears the journal": rename it to "keeps each cursor across endFrame"; the expected
     ranges become `[[0, 1], [1, 2]]`.

6. Add tests to `tests/engine/worldEngine.test.ts`:
   - **a write after `step` and before `endFrame` reaches the next derive pass** (the defect this job fixes): a `derive` tick subscribes
     a kind; `step`, then `registry.add`, then `endFrame`, then `step`; the tick's second run covers exactly that entry, and reading
     `ctx.objects.changes.ring.objectAt(ctx.changesFrom)` returns the record.
   - a tick that sleeps through more writes of other kinds than the ring's capacity still reads its next entry;
   - `endFrame` does not move a derive cursor, and leaves `registry.changes.length` at 0.

7. Update the header comments of `runtimeObjectChangeJournal.ts`, `moduleTicks.ts`, `worldEngine.ts` and the registry, which all describe
   clearing.

## Tests and checks

- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke -- --world cube,torus-moduli`,
  `npm run bench -- moduleStep --check`. The bare engine allocation limit (16 bytes per step) must still hold.
- Counters: `writes` must not change. One kind change is not in any bench scene.

## Do not

- Do not delete `lastIndexOfKind` or `objectAt`, and do not rename them.
- Do not give a cache any retention (014 3.1).
- Do not change anything in `src/world-objects/geodesic/`.

## Done when

- `grep -n "touchedKinds\|resetCursors" src -r` is empty.
- The journal test file is unchanged, and the new tick test passes.
- All checks are green.
