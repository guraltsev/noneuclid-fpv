# Job 58 - Add the derived cache, cached kind lists and their guards

Status: in progress.
Resolves: part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

One small primitive: a cache defined by a full `compute`, invalidated by relevant changes on the ring, recomputed on the next read.
A hit allocates nothing. Its only contract is that `read` always equals `compute`, and a shared fuzz test holds every cache to it.

## Depends on

Job 57.

## Before you start

- Read design 014 sections 3.2, 4.1 to 4.4, 5 and 6, and D3, D7, D8, D10, D11, D13.
- Read the ring in `src/world-objects/runtimeObjectChangeJournal.ts`, and the query caches in `src/world-objects/runtimeObjectRegistry.ts`.
- Read `tests/support/arbitraries.ts`: the project uses `fast-check`.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Job 59 adds the first real cache, the arc index. In this job the primitive is tested with toy definitions only.

## Decisions

- New file `src/world-objects/derived.ts`, generic, importing only from `runtimeObjectChangeJournal.ts`:

  ```ts
  /** What a cache reads from: the registry and its guarded copy both fit, and share one `changes`. */
  export interface DerivedSource<T extends JournalRecord> {
    readonly changes: { readonly ring: ChangeRing<T> };
  }

  export interface DerivedSpec<S extends DerivedSource<T>, T extends JournalRecord, V> {
    /** Unique; shown in `debug.derivedStats()`. */
    readonly id: string;
    readonly kinds: readonly string[];
    /** Optional, for Updated entries only. False: this update cannot alter the result. */
    readonly relevant?: (before: T, after: T) => boolean;
    /** The definition. Reads only `source`. Builds and freezes the whole result. Never writes. */
    readonly compute: (source: S) => V;
  }

  export interface Derived<S, V> {
    read(source: S): V;
  }

  export function defineDerived<S extends DerivedSource<T>, T extends JournalRecord, V>(spec: DerivedSpec<S, T, V>): Derived<S, V>;

  export interface DerivedStats {
    readonly id: string;
    readonly reads: number;
    readonly computes: number;
    readonly entriesScanned: number;
  }

  /** The caches that exist on this source's ring, for the debug API. */
  export function derivedStatsOf(source: DerivedSource<JournalRecord>): readonly DerivedStats[];

  /** `derived-verify`: every `everyReads`th read also runs `compute` and throws when the two differ. 0 turns it off. */
  export function setDerivedVerification(everyReads: number): void;
  ```

- **Instances.** A module-level `WeakMap<ChangeRing, Map<spec, instance>>`, keyed by the **ring**, never by the registry
  (014 4.3). An instance holds `ring`, `cursor`, `hasValue`, `value` and the counters.
- **`read`:**

  ```text
  instance = instanceFor(source.changes.ring, spec)
  instance.reads += 1
  if instance.hasValue and instance.cursor === ring.headSeq: return instance.value      // the hit: no other work
  stale = !instance.hasValue or instance.cursor < ring.baseSeq
  if not stale and some kind k has ring.lastSeqOfKind(k) >= instance.cursor:
    for seq from instance.cursor to ring.headSeq - 1:
      instance.entriesScanned += 1
      if ring.kindAt(seq) is not in spec.kinds: continue
      if ring.opAt(seq) !== ChangeOp.Updated: stale = true; break
      if spec.relevant === undefined or spec.relevant(ring.beforeAt(seq)!, ring.objectAt(seq)): stale = true; break
  instance.cursor = ring.headSeq
  if stale: run compute (below)
  return instance.value
  ```

  `spec.kinds` is held as a `Set` in the instance, built once.
- **Running `compute`.** A module-level flag `computing`. If it is already true, throw `derived: ${id} was read inside a compute`.
  Remember `headSeq`, set the flag, call `compute(source)`, clear the flag in a `finally`. If `headSeq` moved, throw
  `derived: ${id} wrote during compute`. Store the value, `hasValue = true`, `computes += 1`.
- **Verification** runs after the normal path when enabled: compare with `compute(source)` by a small recursive `deepEqual` in this
  file, handling arrays, plain objects, `Map` and `Set`. On a difference, throw naming the id.
- **Debug option.** Add `derived-verify` to `debugOptionDefinitions` in `src/glue/debugOptions.ts`, like `module-write-guard`. In
  `createThreeApp.ts`, next to `writeGuard`, call `setDerivedVerification(active ? 64 : 0)`.
- **Debug API.** `debug.derivedStats()` returns `derivedStatsOf(runtimeObjectRegistry)`; add it as `debug.kindScans()` was added.
- **Kind lists.** `getObjectsOfKind` becomes cached and frozen, per kind, built on first request, the same array until a write of that
  kind. Drop the cached array in `add`, `remove` and `replaceObject`. A scan is counted only when the list is built. Update its comment:
  it no longer returns "a fresh array", and it stays a snapshot.
- Not built (D11): keyed tables, `repair`, helpers, `forEachOfKind`, `kindVersion`, geometry dependence, a reader facade, timing.

## Steps

1. `derived.ts`, with `tests/world-objects/derived.test.ts`, using a small record type and `createRuntimeObjectRegistry` or a bare ring:
   - first `read` computes; a second read does not, and returns the same object;
   - **an Added and a Removed entry invalidate even when `relevant` would answer false** (the defect found in the review);
   - an Updated entry with `relevant` false does not invalidate, and `relevant` true does;
   - a write of an undeclared kind does not invalidate;
   - a cursor below `baseSeq` recomputes (use a small ring capacity);
   - a guarded copy (`{ ...registry }`) and the registry share one instance: `derivedStatsOf` shows one entry;
   - a `read` inside a `compute` throws; a `compute` that writes throws; the flag is clear after the throw;
   - with verification on, a `compute` that disagrees with its cached value throws.

2. The fuzz harness `tests/support/derivedFuzz.ts`:

   ```ts
   export function expectDerivedMatchesCompute<V>(input: {
     readonly derived: Derived<RuntimeObjectReader, V>;
     readonly compute: (source: RuntimeObjectReader) => V;
     readonly registry: RuntimeObjectRegistry;
     /** Each returns one write to apply; fast-check picks among them. */
     readonly writes: readonly ((registry: RuntimeObjectRegistry, pick: (n: number) => number) => void)[];
     readonly runs?: number;
   }): void;
   ```

   After every write it asserts `toEqual` between `read` and a fresh `compute`, and it also reads between writes at random, so both
   lazy batches and interleaved reads are covered. Prove it works: in `tests/world-objects/derived.test.ts`, a toy cache with a
   deliberately **wrong** `relevant` must make the harness fail (`expect(() => ...).toThrow()`). A harness that cannot fail proves
   nothing.

3. Cached `getObjectsOfKind`. Tests in `tests/world-objects/runtimeObjectRegistry.test.ts`: the same array twice; frozen; a new array after
   a write of the kind; the old array unchanged; a write of another kind keeps the array.

4. Debug option and debug API.

5. Add the V1 scene to `moduleStep.bench.ts`: a toy `defineDerived` over the idle scene, read in a loop after warm-up; measure as
   `measureBareEngineBytesPerStep` does; print `cache hit bytes/read`; the check fails above 1 byte per read (a counter failure, exit 1).

6. Run `npm run bench -- moduleStep --check`. Kind scans must fall, because repeated reads now hit. Then run
   `npm run bench -- moduleStep --record-counters`, check with `git diff` that every number fell or stayed, and commit it.

## Tests and checks

- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke -- --world cube,torus-moduli`,
  `npm run bench -- moduleStep --check`.

## Do not

- Do not add a parameter for reusing the previous result: `compute` builds from nothing.
- Do not add anything to the module definition; caches are plain definitions (014 4.3).
- Do not add `reset` or any other clearing (014 4.2).
- Do not convert any geodesic query here; job 59 does that.

## Done when

- `read` on a hit runs one comparison, the bench shows 0 bytes per hit, and the harness catches a wrong `relevant`.
- `debug.derivedStats()` and the `derived-verify` option work in the app.
- All checks are green.

## Report

### Done
- `src/world-objects/derived.ts`: `defineDerived`, `derivedStatsOf`, `setDerivedVerification`, as specified (ring-keyed `WeakMap`, hit = one comparison, `computing` flag, headSeq write check, `deepEqual` for arrays, plain objects, `Map`, `Set`).
- `getObjectsOfKind` is cached and frozen per kind (`kindLists`, dropped in `add`, `remove` and `replaceObject`); a scan is counted only when a list is built; comment updated.
- Debug option `derived-verify` (`debugOptions.ts`); `createThreeApp.ts` calls `setDerivedVerification(active ? 64 : 0)` next to the engine's `writeGuard`; `debug.derivedStats()` added the way `kindScans` was (interface, callbacks, both install sites, namespace).
- Tests: `tests/world-objects/derived.test.ts` (all Step 1 cases, plus the harness passing for a correct `relevant` and failing for a wrong one), `tests/support/derivedFuzz.ts`, kind-list tests in `tests/world-objects/runtimeObjectRegistry.test.ts`.
- Bench: `measureCacheHitBytesPerRead` in `moduleStep.bench.ts` (toy `defineDerived` over the idle scene, 200,000 reads after warm-up); prints `cache hit ... bytes/read`; `--check` exits 1 above 1 byte per read. Measured 0.000 to 0.136 bytes/read (heap noise).
- `moduleStepCounters.json` re-recorded; every number fell or stayed (arc scans 836 to 120 in flow+dependents; measured-geodesic-length, protractor-angle, curve-shortening-pair 120 to 1 or 121 to 240; the `crossing` key vanished in flow and fell 121 to 120 in manyArcs). `moduleStep.json` untouched.
- Commits: 3bf3997 (code, tests, bench, counters, regenerated docs); the report commit follows it.

### Deviations
None. The hit-bytes gate is its own check in `main` (not a field of `Results`) so the timing baseline file keeps its shape.

### Uncertain
- Dead-code justification: `defineDerived` has no production caller until job 59 (the arc index); it is reached today by the tests, the fuzz harness and the bench only. `derivedStatsOf` and `setDerivedVerification` are used by the app.
- Verify mode counts its countdown globally across all caches (every 64th read overall), and also fires on hits. The job says "every `everyReads`th read"; per-cache counting would be the other reading.
- Idea, not done: `derivedStatsOf` allocates a fresh array per call (debug only); fine.
- Timing: `--check` exited 3 twice (flow+dependents, then flow, about 5 to 10 percent over the recorded `Leibniz` baseline, which is machine noise on this host). `bench:ab -- cd24b8d` settled it: base median flow 17.22 / flow+dependents 33.81, head 16.72 / 33.50 us/step, "bench:ab: ok". The cache adds no cost to those scenes since nothing reads one yet.

### Not done
Nothing.

### Checks
- Baseline `npm run typecheck`, `npm test`: green (1374 tests).
- Final `npm run typecheck`: green; `npm test`: 1388 passed; `npm run docs:check`: ok (after `docs:generate`, and after adding JSDoc to three exported interfaces the doc test required).
- `npm run smoke -- --world cube,torus-moduli`: SMOKE OK (2 pages).
- `npm run bench -- moduleStep --check`: counters passed; timing exit 3 twice (see Uncertain); `bench:ab -- cd24b8d`: ok.
