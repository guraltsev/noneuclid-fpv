# 014 - Derived state: caches, invalidation and allocation guards

Status: **proposed** (2026-11-04), reviewed against the code on 2026-11-04 (section 11), built by jobs 56 to 60 and merged on
2026-11-05. Section 9's amendments are applied to 013. Only what is marked **Agreed** is
agreed; the rest stands until the maintainer says otherwise. It builds on
[013](013-world-engine-clients-and-modules.md) (change journal 6.2, derive pass 6.4, caches 9.3) and proposes amendments
to it, listed in section 9. It does not edit 013. Jobs 51 to 60 follow this note where the two differ.

## 1. Why

Design 013 moves the code to **state plus derived information**: real state is stored once, and everything else is
computed from it. That is right, but it creates one recurring failure: *a derived quantity is recomputed by scanning the
world every time somebody asks*. It costs nothing in a unit test and a great deal in a frame loop.

The measured case (job 51, reverted; see the batch report and the note K-20261104-43d0): the curve shortening flow
rebuilds arcs on every vertex move, each rebuild asked "is this arc tied?", and `isTied` scanned every arc. For the same
bench workload `getObjectsOfKind` was called on arcs

| Caller | Job 50 (stored field) | Job 51 (derived) |
| --- | --- | --- |
| `getGeodesicEndpointAttachmentsForAnchor` | 150,732 | 150,732 |
| `incidentArcEnds` / `arcsAtVertex` | 50,400 | 50,400 |
| `isTied` (segment display state) | 0 | 201,180 |
| other | 840 | 840 |
| **total** | **201,972** | **403,152** |

Each call is a linear scan of all arcs that also allocates three arrays (`getObjectsOfKind` is a spread, a `map` and a
`filter`). Two things follow. The regression is one more instance of a pattern the baseline already pays for (the first
two rows are the same question, "which arc ends are on this anchor", asked 201,132 times per run). And a cache keyed by
the registry **version** would not help: the flow writes every step, so the version changes every step.

What is needed is a small, uniform kit with this shape:

1. **By default a derived quantity is recomputed completely when it is invalidated.** Simple, obviously correct.
2. **Smart (incremental) repair is optional**, written only for a cache that is *measured to be hot*, or when there is
   time.
3. A read that hits **allocates nothing**, and the system **tells us which caches are hot**.

### 1.1 What the numbers say (measured 2026-11-04)

One flow+dependents run to the merge on the job 51 code with D2 applied: 120 steps, instrumented registry.

| Quantity | Value |
| --- | --- |
| Reads of "which arc ends are here" (today, each a scan) | 836 (7 per step) |
| Arc writes | 240; **238 of the 239 updates keep both anchors** |
| Recomputes of a cache invalidated by *any* arc write | 120 (one per step) |
| Recomputes of a cache invalidated only when an anchor changes | **3** in the prototype (below): the first read and the merge, which writes in stages |
| Journal entries | 1,918 (16 per step, 62 percent of them segment remove and add) |

So the plain cache with a `relevant` filter removes the scans, and **no `repair` is needed for it**. The filter, not the
repair, is what makes the default work under a write-read interleave: a change is only a change if the cache could tell.

Timing, three alternating rounds, medians in microseconds per step:

| Commit | flow | flow+dependents | flow+dependents, range |
| --- | --- | --- | --- |
| job 50 (`ee65c50`) | 16.17 | 30.92 | 29.11 to 31.92 |
| job 51 (`869024b`) | 16.61 | 30.59 | 29.71 to 30.68 |
| job 51 with D2 | 15.12 | 28.14 | 27.63 to 31.85 |

The 5 percent regression that stopped the batch **did not reproduce**: the ranges overlap, and the spread on unchanged
code is as wide as the effect. The clock also drifts: a later session on the same day measured job 50 at 23.04 and 43.89,
over its own limits. The extra scans are real and countable; the clock on this machine cannot see them. This is why D12
makes counters the gate, and why timing is only ever compared within one session. Note also that the bench's flow scene
has two arcs, so it cannot show what removing a scan is worth.

**A prototype confirmed this.** The ring, the cache and the arc index were built as jobs 57 to 59 specify, on job 51's code
with D2, in a scratch copy. It typechecked. Of 1,360 tests only the two engine tests job 57 names failed, plus the
documentation test, because the prototype had no headers. The journal test passed unchanged and no geodesic assertion
changed. In a flow run the cache had 839 reads and 3 computes; a hit took 25 nanoseconds and 0.005 bytes. Idle allocation
fell from 640 to 554 bytes per step. In one session against job 50, flow was 22.89 against 23.04 and flow+dependents 42.30
against 43.89: no cost.

## 2. Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | **Derived information is never stored on the objects it is derived from.** No `motionState`-like flag on an arc. It lives in a derived cache, is computed from one object on demand, or is a field of a materialized record (D9). So `connectionState` may stay on a *segment*, which is itself derived from the arc, and is rewritten whenever the segment is. Section 2.1 classifies every stored field. | Proposed (013's own rule, stated as a rule; corrected in review) |
| D2 | **The "moving" segment colour and the "moving" aiming rule are abolished** (maintainer, 2026-11-04): a tied arc is drawn and aimed like any other. **The "connected" colour stays**: a geodesic with no free end is drawn in a different colour. A segment's display state is therefore "open" or "connected", and the aim picker no longer skips any segment by it. The tie-detach selection highlight stays. This removes the tied-ness query that caused the job 51 regression. Whether "no free end" means one arc with an emitter at each end, or a whole curve, is open (section 10, question 8); until answered, the jobs keep today's arc-level rule. | **Agreed** (maintainer, 2026-11-04) |
| D3 | **One primitive: a derived cache with a full `compute`.** Invalidated by relevant changes, recomputed completely on the next read. This is the default and the definition of the answer. | Proposed (maintainer, 2026-11-04) |
| D4 | **`repair` is an optional second function** that may patch the cached result from the pending changes, or decline. It is added when the cache is hot (section 5) or when effort allows. It is never required, and by D11 it is not built in this wave. | Proposed (maintainer, 2026-11-04) |
| D5 | **Invalidation is by change, not by version**: each cache reads a shared change ring from its own cursor (section 3). | Proposed |
| D6 | **Updates are lazy.** A write costs one ring entry. Nothing is recomputed or repaired until the cache is read. | Proposed (maintainer's request) |
| D7 | **A read that hits allocates nothing** and costs a few integer comparisons. Enforced by tests and the bench (section 6). | Proposed |
| D8 | **Every cache is checked against its own full `compute`** by a shared fuzz test. The test matters for the plain cache too: a wrong `kinds` or `relevant` makes a plain cache silently stale (section 6, V2). | Proposed (extended in review) |
| D9 | **Three kinds of non-real state, and a rule for choosing.** A **lazy cache** is pulled by readers and answers questions. A **materialized record** is pushed into the registry, by a rebuild or a derive tick, because clients must see it as an object (segments, crossings, length and angle labels). A **memo** remembers the outcome of an attempt or an identity; it is not a function of state, and losing it is harmless. If a client draws it, materialize it; if code asks it, cache it. | Proposed (review) |
| D10 | **`relevant` sees updates only.** An add or a remove of a declared kind always invalidates. An update that changes an object's kind is recorded as a remove and an add. | Proposed (review; the first version would have missed removals) |
| D11 | **Build only what has a reader** (the maintainer's rule: code only tests reach is stale). This wave builds the ring, the plain cache, its counters and guards, and one cache. The keyed table, `repair`, its helpers and geometry dependence stay specified here (4.5) and are built with their first consumer. | Proposed (review) |
| D12 | **Counters are the performance gate.** The bench records scans and writes per scene, which are exact and repeatable, and `--check` compares them exactly. Timing stays as a coarse alarm, settled by an A/B run against the job's start commit. | Proposed (review) |
| D13 | **A cache depends on registry objects of its declared kinds, and on nothing else**: not participants, control slots, the clock or the world. Something that needs those is computed on demand, or is a derive tick with `wants`. No cache reads another cache in this wave. | Proposed (review) |
| D14 | **Read tracking is a fourth kind, for records that depend on many things.** A tick keeps, per materialized record, a memo of what its last refresh read (`world-objects/trackedReads.ts`) and refreshes the record only when a write hit that read set. Added after job 55 to fix stale angles; `geodesicMeasurementsModule({ trackReads })`, on by default. It uses a global observer of cache reads, which G5 rejected for caches: accepted here, because only the recorder installs it. Measured 2026-11-05 (noisy host): one length and one angle, plain 27.96 and tracked 34.05 microseconds per step; 32 lengths on arcs the flow does not touch, measurements add about 169 to 222 plain and 99 to 105 tracked (two runs). So it loses a little with few records and wins with many. | **Agreed** (maintainer, 2026-11-05) |

### 2.1 Every stored thing, classified

Checked against the code on 2026-11-04.

| Stored thing | Class | Why |
| --- | --- | --- |
| Arc `start`, `end`, `startCellId`, `portalWord` | real | They are the arc: its ends and its homotopy class. |
| Vertex and emitter pose; a length's `geodesicId`; an angle's two sides | real | What the user placed or chose. |
| Arc `stale` | real, transient | Not derivable: it records that a rebuild failed and the path shown is *old*, which is history (013 13.1, **Agreed**). |
| Segment geometry, halves, `connectionState`, tooltip | materialized | A function of the arc, its anchors and the world, **except for a stale arc**, whose segments are kept on purpose. |
| Segment `geodesicNumber` | **real, in the wrong place** | Commented "optional cache", but it is read back as the truth: G2 stays G2 when G1 is deleted, so it cannot be recomputed. It moves to the arc (job 60). |
| Segment `highlightState` | client tool state | Stays on the segment until a client overlay exists (013 13.1, **Agreed**). Not derived; the oracle ignores it. |
| Crossing markers; length and angle values | materialized | Functions of the segments (and, for lengths, of the local player: D13 makes that a tick with `wants`). |
| Arc ends by anchor, tied vertices, `isTied`, an emitter's geodesics | lazy cache | Questions code asks: the arc index (section 7). |
| Crossing id memory (`geodesicIntersectionMemoryByRegistry`) | memo | An identity, kept so a selection survives a moving crossing. |
| The flow's `quiet` set | memo | The outcome of an attempt. "This vertex cannot move" depends on the step length and so on `deltaSeconds`: it is not a function of state, though 013 calls it a cache. |

## 3. The foundation: a change ring and kind lists

### 3.1 The journal becomes a ring with absolute sequence numbers

Today's journal (013 6.2) is cleared by `endFrame`. A cache that is read lazily, possibly a frame later, would have lost
the entries it needs. Worse, the shell's frame runs `engine.step`, then the flow and other direct writes, then `endFrame`:
those writes are wiped before any derive tick reads them, so 013 6.3 does not hold for them. Instead of one journal per
consumer, keep **one ring and many cursors**:

```ts
export interface ChangeRing<T extends JournalRecord> {
  /** Sequence number of the next write. Never reset; a 53-bit integer cannot overflow in practice. */
  readonly headSeq: number;
  /** Sequence number of the oldest entry still held. A cursor below it has missed entries. */
  readonly baseSeq: number;
  /** Highest sequence number written for this kind, or -1. O(1), no allocation. */
  lastSeqOfKind(kind: string): number;
  opAt(seq: number): ChangeOp;
  idAt(seq: number): string;
  kindAt(seq: number): string;
  /** The record after the write; for Removed, the record that was removed. */
  objectAt(seq: number): T;
  /** The record before the write: undefined for Added, the replaced record for Updated, the removed record for Removed. */
  beforeAt(seq: number): T | undefined;
}
```

- **The frame view keeps its interface.** `registry.changes` stays what it is, with `length`, `opAt(index)` and the rest
  addressed from 0 at the frame start, and gains `ring`. Its `clear` moves the frame start and discards nothing. Existing
  readers and the existing journal tests see no difference. Absolute sequence numbers are spoken only through `ring`.
- Parallel arrays overwritten in place, as today. Starting capacity 8192 entries, a power of two: about 512 flow steps at
  the measured 16 entries per step.
- **Nothing unread is lost.** The ring never overwrites an entry at or after its retention floor, the lower of the
  frame start and the lowest derive tick cursor: when full, it doubles. `clear` raises the floor to the head, so a journal
  with no cursors, the participants', never grows; an owner with cursors lowers it again. So the frame view and ticks never miss entries,
  even when a deformation commit writes every object in one frame, and the growth is paid once. A tick that a pass does
  not wake moves its cursor to the head, because it had nothing to read, so a sleeping tick cannot hold the floor down.
- **A cache does not hold the floor.** A cache whose cursor is below `baseSeq` has missed entries and recomputes fully,
  which is what a plain cache does anyway. So overflow costs it nothing extra and no reader can leak memory.
- The ring keeps up to its capacity of old records alive. That is the price of `beforeAt`.

### 3.2 Kind lists that do not copy

`getObjectsOfKind` becomes what the per-cell queries already are (the registry's own header says so): **cached, frozen,
and the same array until a write of that kind**. It is still a snapshot: a later write returns a new array and never
alters one already returned, so a caller may write while looping over it, as `removeUnusedFreeGeodesicEnds` does.

No `forEachOfKind` and no `kindVersion`: nothing needs them, and a callback over the live set would break that loop.

This does not by itself help code that scans after every write, because each write of the kind discards the array. That
is what the cache is for, and what G4 forbids.

## 4. The cache

### 4.1 The default: invalidate, then recompute completely

A cache is defined once, at module level, and read with the registry in hand:

```ts
export const arcIndex = defineDerived<RuntimeObjectReader, RuntimeWorldObject, ArcIndex>({
  id: "geodesicModel/arcIndex",
  kinds: ["geodesicModel/arc", "geodesicModel/vertex"],
  /** Optional filter, for updates only (D10): false when this update cannot alter the result. */
  relevant: (before, after) => anchorsDiffer(before, after),
  /** The definition. Reads only `source`, builds the whole result, and writes nothing. */
  compute: (source) => buildArcIndex(source),
});

arcIndex.read(registry);   // sync, then return the cached result, recomputing it first if it is stale
```

`read` costs one comparison when nothing was written since the last read. Otherwise it syncs:

```text
1. if there is no result yet                                  -> stale
2. if cursor < ring.baseSeq                                   -> stale (missed entries)
3. if lastSeqOfKind(k) < cursor for every k in kinds          -> nothing of ours changed (the common case, O(|kinds|))
4. else for seq in [cursor, head), for entries of our kinds:
     op is Added or Removed                                   -> stale
     no `relevant` given, or relevant(beforeAt, objectAt)     -> stale
5. cursor = head
```

If stale, `read` runs `compute` once and stores the result. Two checks guard it, both one comparison: a nested `read`
inside a `compute` throws (D13), and a `compute` that moved `headSeq` throws (it wrote).

The primitive reads as a pure function of state with a memory: `read(source)` must always equal `compute(source)`. That
sentence is the whole contract, and V2 tests it.

### 4.2 Why there is no reset

A cache needs no clearing. Everything that changes its inputs, a load included, goes through the registry and so through
the ring. A world change makes a new registry, hence a new ring and new instances. 013 9.3's "cleared by `reset()`" does
not apply to a cache, and the `reset` hook it names was never built.

### 4.3 Instances are keyed by the ring

The geometry code calls `isTied(registry, id)` and has no engine in hand, so a definition finds its instance from what it
is given. The key is `source.changes.ring`, in a module-level `WeakMap`, **not** the registry: with the write guard on,
`guardRegistry` hands modules a copy (`{...registry}`), and a cache keyed by the registry would exist twice. The ring is
the same object through both.

Definitions stay in plain modules; the module definition does not list them. There is nothing for composition to check
while no cache reads another (D13).

### 4.4 Lists out of a cache

A cached result and everything in it is frozen and is replaced, never edited. A caller may loop over a returned list while
writing, exactly as with `getObjectsOfKind`: the list is a snapshot, and an id in it may be gone by the time it is reached.

### 4.5 Specified, built with the first consumer (D11)

**Keyed table.** The same primitive with a per-key `compute`, each key computed lazily:

```ts
defineDerivedTable<K, V>({
  kinds,
  relevant?,
  /** REQUIRED. Which keys a change can affect: call `mark(key)` for each, or use the named default below. */
  affected: AffectedKeys<K>,
  compute: (key, source) => V,
})
```

**There is no silent default for `affected`** (**Agreed**, maintainer, 2026-11-04). The author writes one of two things. The
first implementation of any keyed table passes the named default, exported by the kit:

```ts
affected: invalidateAllKeys,   // every relevant change drops every key; correct, and slow only if the table is hot
```

`invalidateAllKeys` is a plain exported function, so `grep invalidateAllKeys` lists every keyed table that has not been
optimised: the places to look at when the counters name a hot cache. Replacing it with a function that names the keys is
the optimisation.

**`repair`.** Called instead of `compute` when the pending changes are few; it patches the state from them and returns true,
or returns false to fall back. Rules the first version missed:

- `compute` must never read a partly patched state, so a repair that declines cannot corrupt the result.
- A repair must keep the **order** `compute` produces. Lists here are in registry insertion order and callers depend on it
  (the flow's Gauss-Seidel sweep, `arcsAtVertex`), so a helper that appends a moved member is wrong, not "always exact".
- It respects 4.4: it replaces a changed list, it does not edit it. The cost is proportional to one key's list.

Helpers come with their first user: `reverseIndexRepair({ keysOf })` for "which objects point at this one",
`staleKeysRepair({ affected })` for a table, `deltaRepair({ contribution })` for a sum or count, `appendRepair` for a list
that only grows. Each ships with the fuzz test of section 6.

**Geometry.** A cache that depends on geometry would declare it and be invalidated by a geometry commit. Today the engine
has no `transformGeometry` and no epoch; the commit is in the shell, which replaces the world object. So the natural
epoch is the **identity of the world object**, which needs no counter. No cache in this wave depends on geometry: the arc
index holds ids only.

**A cache reading a cache.** It would declare the dependency and compare a revision counter of the other cache. Not
needed: the arc index computes tied vertices in the same pass.

## 5. Deciding what is hot

The rule: **write the plain cache first; add `repair` only where the numbers ask for it.**

Every cache keeps cheap integer counters, reachable from the debug API (`debug.derivedStats()`), which is what makes them
live code and tells a person in the browser what is hot:

| Counter | Meaning |
| --- | --- |
| `reads` | calls to `read` |
| `computes` | full recomputations |
| `entriesScanned` | ring entries looked at |

The registry counts scans the same way: each time it walks a kind to build a list, by kind (`debug.kindScans()`).

**A cache is hot when `computes` per step is above 0.5 in a bench scene that is not changing the cache's real input.** First
look at `relevant`: the flow's arc writes looked like an interleave and were not, because they keep the anchors. Then at the
caller. `repair` is the last resort.

The two numbers to look at are `computes` per step and **reads per compute**. Timed profiling (`derived-profile`) is not
built: nothing needs it yet, and the clock is what failed us (section 1.1).

The `moduleStep` bench gets a counter table per scene and a many-arcs scene (D12). `--check` compares the counters exactly
against `scripts/bench/baselines/moduleStepCounters.json`: a number that rose fails the job and names the kind.

## 6. Guards

**Rules**

- **G1. No allocation on a hit.** A cache read when nothing relevant has changed allocates nothing.
- **G2. No fresh arrays out.** Accessors return a number, a boolean, a stable object, or a frozen list owned by the cache.
- **G3. No closure per call.** `relevant` and `compute` are created once, in the definition.
- **G4. No kind scan in a per-step function** outside a cache's own `compute`. Ask a cache, or justify per-action use. This
  covers `getAll().filter(...)`, which is the same scan by another name.
- **G5. A cache reads only what it declared.** The fuzz test and the verify mode catch a miss; a runtime reader facade is not
  built, because it would cost every read.

**Tests and tools**

- **V1. Allocation scene.** The `moduleStep` bench gets "idle read hits": every cache read after warm-up allocates
  0 bytes.
- **V2. Oracle fuzz.** A shared harness takes any cache, applies thousands of random adds, updates and removes, and after
  each batch requires `read` to equal a fresh `compute`. The writes must include updates to fields that `relevant` *ignores*
  and to objects of kinds it does not declare, or the test cannot catch a wrong filter.
- **V3. Counters are tests.** Scenario tests assert them: "a flow run to the merge computes the arc index at most 6 times, with
  no scan of the arc kind outside `compute`".
- **V4. Verify mode.** A debug option `derived-verify` makes every 64th read also run `compute` and compare, for the
  maintainer's browser sessions, as `module-write-guard` is for writes.
- **V5. Materialized oracle.** The same idea for what the registry stores: for every arc that is not stale, realizing it
  again gives its stored segments, ignoring `highlightState`. Run at the end of the flow, carry and tie tests. This is what
  "a function of state" means for a record.

## 7. Applying it

### 7.1 The case that started this

1. D2 removes the "moving" state, so the segment display state no longer asks whether the arc is tied: 477 scans per flow
   run are gone by that change alone (measured). The remaining "connected" test, both ends on emitters, looks at two objects
   and is O(1).
2. Every query about arc ends becomes one cache, the **arc index**: `kinds` arc and vertex, `relevant` true only when an
   arc's anchors differ. It holds ends by anchor, an emitter's geodesics, and the tied vertices. `tiedVertexCount` and
   `forEachTiedVertex` then meet 13.1's "O(1), no allocation", which job 51 could not (its report says so), and which job
   53's `isIdle` needs. By section 1.1 it recomputes three times in a flow run. It gets no `repair`.
3. The other `isTied` callers (whole-curve removal at a forbidden-zone chord, carry end, debug dumps) read the index too.
4. The `getAll().filter(...)` scans in `measureLengthTool.ts` and `protractorTool.ts` (three per flow step) become
   `getSegmentsOfGeodesic` or `getObjectsOfKind` (G4).

### 7.2 Where derived state lives

In `src/world-objects/`: the ring in `runtimeObjectChangeJournal.ts`, beside the journal it serves, and the cache in
`derived.ts`, both generic in the record type and importing no registry. **No new layer.** The first version put a `derived` layer above `world-objects`, but `world-objects/geodesic/`
is the first consumer and a layer can only import below itself, so that could never have compiled under `docs:check`.

## 8. Plan

The order differs from the first version: **job 51 goes first.** Its code re-applies exactly (the tree is identical to the
one it was written on), and the new code is then written once, against the final names.

| Order | Job | What |
| --- | --- | --- |
| 1 | 51 | Re-apply `eccd27c..869024b` as one patch; apply D2. |
| 2 | 56 | Scan counters, exact counter baseline, many-arcs scene, `bench:ab` (D12). |
| 3 | 57 | Change ring; tick cursors survive `endFrame` (section 3). |
| 4 | 58 | `defineDerived`, cached kind lists, stats, verify mode, fuzz harness (sections 3.2, 4 to 6). |
| 5 | 59 | The arc index; every arc-end query moves onto it (7.1). |
| 6 | 60 | `geodesicNumber` moves to the arc; the materialized oracle V5. |
| 7 to 10 | 52, 53, 54, 55 | As in 013, revised: 52 on the ring; 53 on the arc index, with `quiet` a memo and no hooks. |

## 9. Proposed amendments to 013

- 6.2: the journal gains a ring with absolute sequence numbers and `beforeAt`; `journal.ring`. The frame view keeps its
  interface.
- 6.3: `endFrame` moves the frame start; it no longer resets tick cursors. A write after `step` and before `endFrame` reaches
  the next derive pass.
- 6.4: a derive tick's cursor and `changesFrom`, `changesTo` are sequence numbers, read through `ctx.objects.changes.ring`.
  A pass that does not wake a tick moves its cursor to the head.
- 9.1: `reset` and `transformGeometry` are not built; nothing in this wave needs them.
- 9.3: "Caches (derived)" are this note's cache, or a memo. A cache needs no `reset`.
- 13.1: `isTied` no longer serves display. `tiedVertexCount` and `forEachTiedVertex` read the arc index.
- 13.2: `quiet` is a memo, not a cache. It empties through the `wake` tick alone: a geometry commit deletes every arc that
  does not connect emitters, and the tick sees those removals; a load makes a new engine.

## 10. Open questions

1. **Ring capacity.** Mostly settled: 16 entries per flow step measured, and retention (3.1) means capacity is a starting
   size, not a limit. A deformation commit's real count is still to measure.
2. Closed (review): hot is `computes` per step, not a share of the frame (section 5).
3. Closed (maintainer, 2026-11-04): a keyed table must pass `affected`; the dumb choice is the named function
   `invalidateAllKeys`, so optimisation sites are found by search (4.5).
4. **Client caches.** The renderer and the aim picker also derive things. They would create caches over the read view with
   their own cursors; `engine.read.objects.changes.ring` is readable, so nothing blocks this. A replica for a worker or a
   network applies the same entries (013 6.6).
5. **Derived values that depend on derived values.** Forbidden for now (D13); the design is in 4.5.
6. **`before` retention.** `beforeAt` keeps replaced records alive until the ring wraps. If that is a problem, store only
   the fields a filter needs.
7. **Name.** "derived" against "cache" against "view". 013 section 3 avoids "system"; settle with the vocabulary.
8. **What "connected" means.** At arc level (both ends of the arc are on emitters) it is O(1) and is what the code does
   today, but a tied chain emitter, vertex, emitter then shows as not connected, because its arcs each have a vertex end.
   At curve level (the whole chain has no free end, or is a closed loop) it matches "no free end", but tying would have to
   rewrite the segments of every arc of the curve, since `connectionState` is materialized on them. Which is meant? **Default
   until answered: arc level.** A tied curve is drawn open and turns connected when it has merged into one arc between
   emitters.

## 11. Review (2026-11-04)

Each point was checked against the code on `batch-48-55` or measured on job 51's commits.

| Finding | Effect | Fixed in |
| --- | --- | --- |
| `relevant(before, after)` ran on removals with `before` = `after` (or undefined for adds): an anchor filter answers false, so **a removed arc would stay in the cache** | wrong answers | D10, 4.1 |
| A `derived` layer above `world-objects` cannot be imported by `world-objects/geodesic/` | could not compile under `docs:check` | 7.2 |
| A `WeakMap` by registry splits under the write guard, whose `{...registry}` is a different object | two caches, split statistics | 4.3 |
| A bounded ring could overwrite entries the current frame's readers need; "clients see no difference" was false | lost changes in a large frame | 3.1 |
| An unwoken tick's cursor stayed behind, so it would have fallen off the ring | lost changes, or a memory floor | 3.1 |
| `reverseIndexRepair` edited lists in place, against G2, and broke insertion order, which callers rely on | wrong order, broken loops | 4.4, 4.5 |
| `compute` was given `previous` to reuse; a declined repair could leak into it | silent drift | removed, 4.5 |
| D1 forbade `connectionState` while 7.1 kept it | contradiction | D1 |
| `dependsOnGeometry` needs an engine epoch, but a cache is found from a registry; `transformGeometry` does not exist in the engine | not implementable as written | 4.5, deferred |
| "clear on `reset()`": `ModuleInstance` has no such hook, and a true cache needs none | dead requirement | 4.2 |
| "Every existing journal test unchanged": `worldEngine.test.ts` pins cursors resetting at `endFrame` | job would have looked like a regression | job 57 lists the changes |
| V2 said a plain cache "passes trivially"; a wrong `kinds` or `relevant` is exactly how a plain cache goes stale | false comfort | V2 |
| Writes between `engine.step` and `endFrame` never reach a derive tick; job 52 assumed they did | the crossing tick would miss the flow | 3.1, job 52 |
| 7.1 expected `repair` might be needed under the interleave; the filter makes it unnecessary | a large optional build | 1.1, 7.1 |
| The tied-vertex index that 13.1 and job 53's `isIdle` require was missing from the plan | job 53 would have rediscovered job 51's failure | 7.1 |
| `quiet` was called a cache but depends on `deltaSeconds`; `geodesicNumber` was called a cache but is real | D1 and 9.3 misapplied | 2.1 |
| Timing gate at the noise floor, on a two-arc scene | stopped a batch on an unreproducible 5 percent | D12 |
| Foundation first meant writing against old names, then porting across a 70-file patch | avoidable conflict | section 8 |
| Kit items with no consumer (`forEachOfKind`, `kindVersion`, table, helpers, profile) | stale code under the maintainer's rule | D11 |

Considered and rejected: replacing the ring with a per-kind dirty callback at write time. It is simpler for caches, but
derive ticks and the frame view still need ordered entries, so it would add a second mechanism, not remove one.

## Decision log

| Date | Change |
| --- | --- |
| 2026-11-04 | Document created after the job 51 bisect. Agreed (maintainer): the segment colour rule and the segment aiming rule are abolished (D2). Requested (maintainer): a consistent system for derived information with a cache, invalidation, guards against copying and allocation, and lazy updates. |
| 2026-11-04 | Revised at the maintainer's direction: the default is a full recompute on invalidation (D3); smart incremental repair is an optional helper, written when a cache is measured to be hot or when effort allows (D4, section 5). The earlier version made incremental maintenance the base. |
| 2026-11-04 | Corrected (maintainer): the "connected" colour stays; only the "moving" colour and the aiming rule are abolished (D2). |
| 2026-11-04 | Agreed (maintainer): a keyed table has no silent default for which keys a change invalidates; it passes `affected`, and the dumb choice is the named function `invalidateAllKeys`, so unoptimised tables can be found by search. |
| 2026-11-04 | Reviewed against the code at the maintainer's request (section 11). Proposed, not yet agreed: D9 to D13, the corrections to D1, D8 and sections 3 to 7, and the new job order of section 8. Measurements added (1.1). |
| 2026-11-05 | Agreed (maintainer): D14, read tracking for measurements, on by default. A first attempt to replace it with a full refresh won on the one-record bench scene, but that scene cannot show what tracking is for; a bench scene with many lengths now times both modes. |
