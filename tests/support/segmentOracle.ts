/**
 * Test oracle for design 014 (V5): the stored segments of every arc are a function of the arc and the world.
 *
 * Realizing an arc again (the straight chord of its portal word, as `commitRealizedTraces` stores it) must give the segments the registry holds.
 * A stale arc is skipped: it keeps its old path on purpose while a carry is unresolved (design 013 section 13.1).
 */
import { expect } from "vitest";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { realizeIntervalChord } from "../../src/world-objects/geodesic/intervals";
import {
  buildDerivedSegmentsFromTraces,
  getGeodesicSegments,
  withAnchoredTargetTerminal,
} from "../../src/world-objects/geodesic/segments";
import type { GeodesicSegmentObject } from "../../src/world-objects/geodesic/objects";
import type { RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

const numberTolerance = 1e-9;

// `highlightState` is runtime display state, not derived from the arc.
function withoutHighlight(segment: GeodesicSegmentObject): Record<string, unknown> {
  const { highlightState, ...rest } = segment as GeodesicSegmentObject & { readonly highlightState?: unknown };
  void highlightState;
  return rest;
}

function expectClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number" && typeof actual === "number") {
    expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(numberTolerance);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    expect(actual.length, `${path}.length`).toBe(expected.length);
    expected.forEach((item, index) => expectClose(actual[index], item, `${path}[${index}]`));
  } else if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      expectClose((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    }
  } else {
    expect(actual, path).toEqual(expected);
  }
}

/** Expects every non-stale arc's stored segments to equal the ones its realization would store (numbers within 1e-9, ignoring `highlightState`). */
export function expectSegmentsAreRealizedFromArcs(world: CompiledCellComplex, registry: RuntimeObjectRegistry): void {
  for (const arc of registry.getObjectsOfKind("geodesicModel/arc")) {
    if (arc.stale) {
      continue;
    }
    const realization = realizeIntervalChord({ world, registry, interval: arc, allowUnexpectedPortalWord: true });
    expect(realization.kind, `realizing ${arc.id}`).toBe("ok");
    if (realization.kind !== "ok") {
      continue;
    }
    const expected = buildDerivedSegmentsFromTraces({
      registry,
      geodesicId: arc.id,
      traces: withAnchoredTargetTerminal(registry, arc, realization.traces),
    });
    const stored = getGeodesicSegments(registry, arc.id);
    expect(stored.length, `segment count of ${arc.id}`).toBe(expected.length);
    expected.forEach((segment, index) => {
      expectClose(withoutHighlight(stored[index]!), withoutHighlight(segment), `${arc.id}:segment:${index}`);
    });
  }
}
