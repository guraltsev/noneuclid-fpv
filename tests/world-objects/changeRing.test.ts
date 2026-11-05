/**
 * `tests/world-objects/changeRing.test.ts` — unit tier.
 *
 * The change ring behind the journal (design 014 section 3.1): absolute sequence numbers, the oldest stored number, per-kind
 * marks that are never reset, the record before a write, growth under retention, and a cleared journal that keeps its capacity.
 * Rings use a small capacity so that wrapping and growth happen in a few entries.
 */
import { describe, expect, it } from "vitest";
import { ChangeOp, createChangeRing, type ChangeRingStore, createRuntimeObjectChangeJournal } from "../../src/world-objects/runtimeObjectChangeJournal";

interface Rec {
  readonly id: string;
  readonly kind: string;
}
const rec = (n: number, kind = "k"): Rec => ({ id: `r${n}`, kind });

describe("change ring", () => {
  it("keeps raising sequence numbers and starts with baseSeq 0", () => {
    const ring = createChangeRing<Rec>(4);
    expect([ring.headSeq, ring.baseSeq]).toEqual([0, 0]);
    for (let i = 0; i < 3; i += 1) ring.record(ChangeOp.Added, rec(i));
    expect([ring.headSeq, ring.baseSeq]).toEqual([3, 0]);
  });

  it("raises baseSeq once the capacity is passed with no retention, and reads old slots back", () => {
    const journal = createRuntimeObjectChangeJournal<Rec>(4);
    for (let i = 0; i < 10; i += 1) {
      journal.record(ChangeOp.Added, rec(i));
      if (i % 2 === 1) journal.clear();
    }
    const ring = journal.ring;
    expect((ring as ChangeRingStore<Rec>).capacity).toBe(4);
    expect(ring.headSeq).toBe(10);
    expect(ring.baseSeq).toBe(6);
    for (let seq = ring.baseSeq; seq < 10; seq += 1) expect(ring.idAt(seq)).toBe(`r${seq}`);
  });

  it("answers lastSeqOfKind and never resets it", () => {
    const journal = createRuntimeObjectChangeJournal<Rec>(4);
    journal.record(ChangeOp.Added, rec(0, "a"));
    journal.record(ChangeOp.Added, rec(1, "b"));
    journal.record(ChangeOp.Added, rec(2, "a"));
    expect(journal.ring.lastSeqOfKind("a")).toBe(2);
    expect(journal.ring.lastSeqOfKind("b")).toBe(1);
    expect(journal.ring.lastSeqOfKind("c")).toBe(-1);
    journal.clear();
    expect(journal.ring.lastSeqOfKind("a")).toBe(2);
    expect(journal.lastIndexOfKind("a")).toBe(-1);
  });

  it("gives beforeAt for each op", () => {
    const ring = createChangeRing<Rec>(8);
    const first = rec(0);
    const second = { ...first };
    ring.record(ChangeOp.Added, first);
    ring.record(ChangeOp.Updated, second, first);
    ring.record(ChangeOp.Removed, second, second);
    expect(ring.beforeAt(0)).toBeUndefined();
    expect(ring.beforeAt(1)).toBe(first);
    expect(ring.objectAt(1)).toBe(second);
    expect(ring.beforeAt(2)).toBe(second);
    expect(ring.objectAt(2)).toBe(second);
    expect([ring.opAt(0), ring.opAt(1), ring.opAt(2)]).toEqual([ChangeOp.Added, ChangeOp.Updated, ChangeOp.Removed]);
  });

  it("keeps every retained entry readable, in order, through two doublings", () => {
    const journal = createRuntimeObjectChangeJournal<Rec>(4);
    for (let i = 0; i < 3; i += 1) journal.record(ChangeOp.Added, rec(i));
    journal.clear();
    journal.retainFrom(2);
    for (let i = 3; i < 20; i += 1) journal.record(ChangeOp.Added, rec(i));
    const ring = journal.ring;
    expect(ring.baseSeq).toBeLessThanOrEqual(2);
    for (let seq = 2; seq < 20; seq += 1) expect(ring.idAt(seq)).toBe(`r${seq}`);
    const grown = createChangeRing<Rec>(4);
    for (let i = 0; i < 20; i += 1) grown.record(ChangeOp.Added, rec(i));
    expect(grown.capacity).toBe(32);
    expect(grown.baseSeq).toBe(0);
    for (let seq = 0; seq < 20; seq += 1) expect(grown.idAt(seq)).toBe(`r${seq}`);
  });

  it("keeps its capacity when the journal is cleared every frame and never retains", () => {
    const journal = createRuntimeObjectChangeJournal<Rec>(8);
    for (let i = 0; i < 80; i += 1) {
      journal.record(ChangeOp.Added, rec(i));
      if (i % 3 === 2) journal.clear();
    }
    expect((journal.ring as ChangeRingStore<Rec>).capacity).toBe(8);
    expect(journal.ring.baseSeq).toBe(80 - 8);
  });
});
