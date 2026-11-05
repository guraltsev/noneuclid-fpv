/**
 * Shared oracle fuzz for derived caches (design 014 V2): applies random writes to a registry and, after each, requires `read` to equal a fresh `compute`.
 * It also reads between writes at random, so both lazy batches (many writes, one read) and interleaved reads are covered. The writes the caller lists must include updates to fields `relevant` ignores and writes of kinds the cache does not declare, or a wrong filter cannot be caught.
 */
import fc from "fast-check";
import { expect } from "vitest";
import type { Derived } from "../../src/world-objects/derived";
import type { RuntimeObjectReader, RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

/** One write to apply to the registry; `pick(n)` gives a number in [0, n) chosen by fast-check. */
export type FuzzWrite = (registry: RuntimeObjectRegistry, pick: (n: number) => number) => void;

export function expectDerivedMatchesCompute<V>(input: {
  readonly derived: Derived<RuntimeObjectReader, V>;
  readonly compute: (source: RuntimeObjectReader) => V;
  readonly registry: RuntimeObjectRegistry;
  /** Each returns one write to apply; fast-check picks among them. */
  readonly writes: readonly FuzzWrite[];
  readonly runs?: number;
}): void {
  const { derived, compute, registry, writes } = input;
  const step = fc.record({
    write: fc.nat(writes.length - 1),
    picks: fc.array(fc.nat(1000), { minLength: 1, maxLength: 4 }),
    readBefore: fc.boolean(),
    readAfter: fc.boolean(),
  });
  fc.assert(
    fc.property(fc.array(step, { minLength: 1, maxLength: 40 }), (steps) => {
      for (const { write, picks, readBefore, readAfter } of steps) {
        if (readBefore) expect(derived.read(registry)).toEqual(compute(registry));
        let next = 0;
        writes[write]!(registry, (n) => picks[next++ % picks.length]! % Math.max(1, n));
        if (readAfter) expect(derived.read(registry)).toEqual(compute(registry));
      }
      expect(derived.read(registry)).toEqual(compute(registry));
    }),
    { numRuns: input.runs ?? 200 },
  );
}
