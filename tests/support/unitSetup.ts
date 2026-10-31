/**
 * Setup for the `unit` project (`_docs/tests.md` §5, §8.4): runs once per test file, before its tests.
 *
 * - Fixes the fast-check seed, so property tests are deterministic (Q6) unless the run opts out.
 * - Guards `setTimeout`/`setInterval` so a unit test cannot wait on a real clock; fake timers
 *   (`vi.useFakeTimers()`) and a delay of exactly 0 are always allowed.
 */
import path from "node:path";
import fc from "fast-check";
import { beforeAll, expect, vi } from "vitest";
import { unitTimerExemptions } from "./unitTimerExemptions";

const DEFAULT_SEED = 20261031;

const fcSeedEnv = process.env.FC_SEED;
if (fcSeedEnv === "random") {
  // Explicit opt-out: let fast-check draw its own seed for exploration (_docs/tests.md §8.4).
} else {
  const seed = fcSeedEnv ? Number.parseInt(fcSeedEnv, 10) : DEFAULT_SEED;
  fc.configureGlobal({ seed });
}

let guardThisFile = true;

beforeAll(() => {
  const testPath = expect.getState().testPath;
  if (!testPath) return;
  const relPath = path.relative(process.cwd(), testPath).split(path.sep).join("/");
  guardThisFile = !unitTimerExemptions.has(relPath);
});

type TimerFn = (handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => unknown;

function guardTimer<Fn extends TimerFn>(real: Fn): Fn {
  return ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (guardThisFile && (delay ?? 0) > 0 && !vi.isFakeTimers()) {
      throw new Error(
        `unit tier: real timers are not allowed (delay ${delay} ms); inject the clock or use vi.useFakeTimers() (_docs/tests.md §5)`,
      );
    }
    return real(handler, delay, ...args);
  }) as Fn;
}

const realSetTimeout = globalThis.setTimeout.bind(globalThis) as unknown as TimerFn;
const realSetInterval = globalThis.setInterval.bind(globalThis) as unknown as TimerFn;

globalThis.setTimeout = guardTimer(realSetTimeout) as typeof globalThis.setTimeout;
globalThis.setInterval = guardTimer(realSetInterval) as typeof globalThis.setInterval;
