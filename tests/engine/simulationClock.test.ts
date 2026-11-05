/**
 * `tests/engine/simulationClock.test.ts` - unit tier.
 *
 * The simulation clock of design 012 P8, on its own: how a steady display sets the tick length and the ticks per frame, that one odd frame moves nothing, how the cost of the ticks lengthens them and how they come back, the limit of
 * three ticks per frame, what a hitch drops, and how often the notice of dropped time is due.
 */
import { describe, expect, it } from "vitest";
import { createSimulationClock, type ClockAdvance, type SimulationClock } from "../../src/engine/simulationClock";
import { defaultSimulationClockOptions } from "../../src/runtime/experience";

const tick90 = 1 / 90;
const tick30 = 1 / 30;

const newClock = (): SimulationClock => createSimulationClock(defaultSimulationClockOptions);

/** Runs `frames` frames of `period` seconds, each reporting that a tick costs `tickCostSeconds`; returns what each frame ran. */
function runFrames(clock: SimulationClock, period: number, frames: number, tickCostSeconds = 0): ClockAdvance[] {
  const advances: ClockAdvance[] = [];
  let lastCost = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const advance = clock.advance(period, lastCost);
    lastCost = advance.ticks * tickCostSeconds;
    advances.push(advance);
  }
  return advances;
}

const lastOf = (advances: readonly ClockAdvance[]): ClockAdvance => advances[advances.length - 1]!;

describe("a steady display", () => {
  it.each([60, 72, 90])("runs one tick in every frame at %i Hz, with the frame period as its length", (hertz) => {
    for (const advance of runFrames(newClock(), 1 / hertz, 200)) {
      expect(advance.ticks).toBe(1);
      expect(advance.tickSeconds).toBeCloseTo(1 / hertz, 12);
      expect(advance.behindSeconds).toBe(0);
    }
  });

  it("keeps the default tick at 120 Hz, so that some frames have no tick", () => {
    const advances = runFrames(newClock(), 1 / 120, 120);

    expect(advances.every((advance) => advance.tickSeconds === tick90)).toBe(true);
    expect(advances.filter((advance) => advance.ticks === 0).length).toBe(30);
    expect(Math.max(...advances.map((advance) => advance.ticks))).toBe(1);
  });

  it("gives a frame slightly short of the period its tick all the same", () => {
    const clock = newClock();
    runFrames(clock, 1 / 72, 20);
    for (let frame = 0; frame < 200; frame += 1) {
      const jitter = (frame % 2 === 0 ? 1 : -1) * 0.0005;
      expect(clock.advance(1 / 72 + jitter, 0).ticks).toBe(1);
    }
  });

  it.each([60, 72, 90, 120])("sums its ticks to real time within one tick at %i Hz", (hertz) => {
    const frames = hertz * 30;
    const advances = runFrames(newClock(), 1 / hertz, frames);
    const simulated = advances.reduce((sum, advance) => sum + advance.ticks * advance.tickSeconds, 0);

    expect(Math.abs(simulated - frames / hertz)).toBeLessThanOrEqual(lastOf(advances).tickSeconds);
  });

  it("does not move the tick for one slow frame", () => {
    const clock = newClock();
    const before = lastOf(runFrames(clock, 1 / 72, 20)).tickSeconds;

    const slow = clock.advance(0.05, 0);
    const after = clock.advance(1 / 72, 0);

    expect(after.tickSeconds).toBe(before);
    expect(slow.behindSeconds).toBe(0);
    expect(after.ticks).toBe(1);
  });

  it.each([
    ["1/60 and 1/30 s", 1 / 60, 1 / 30],
    ["1/72 and 2/72 s", 1 / 72, 2 / 72],
  ])("keeps one tick length on a cadence alternating %s", (_name, short, long) => {
    const clock = newClock();
    const lengths = new Set<number>();
    let simulated = 0;
    let real = 0;
    for (let frame = 0; frame < 2000; frame += 1) {
      const elapsed = frame % 2 === 0 ? short : long;
      const advance = clock.advance(elapsed, 0);
      real += elapsed;
      simulated += advance.ticks * advance.tickSeconds;
      if (frame >= 20) lengths.add(advance.tickSeconds);
    }

    expect([...lengths]).toEqual([(short + long) / 2]);
    expect(Math.abs(simulated - real)).toBeLessThanOrEqual((short + long) / 2);
  });

  it("does not take a frame of no elapsed time for a fast display", () => {
    const clock = newClock();
    runFrames(clock, 1 / 60, 20);

    expect(lastOf(runFrames(clock, 0, 20))).toMatchObject({ ticks: 0 });
    expect(clock.advance(1 / 60, 0).tickSeconds).toBeCloseTo(1 / 60, 12);
  });

  it("follows a display that changes rate", () => {
    const clock = newClock();
    runFrames(clock, 1 / 60, 20);

    expect(lastOf(runFrames(clock, 1 / 72, 20)).tickSeconds).toBeCloseTo(1 / 72, 12);
    expect(lastOf(runFrames(clock, 1 / 120, 20)).tickSeconds).toBe(tick90);
  });
});

describe("the cost of the ticks", () => {
  it("leaves the tick alone while the ticks fit their share of the frame", () => {
    const advances = runFrames(newClock(), 1 / 72, 100, 0.3 / 72);

    expect(lastOf(advances).tickSeconds).toBeCloseTo(1 / 72, 12);
  });

  it("lengthens the tick when they exceed their share, until they fit", () => {
    const tickCost = 0.006;
    const advances = runFrames(newClock(), 1 / 90, 100, tickCost);

    expect(lastOf(advances).tickSeconds).toBeCloseTo(tickCost * 3, 12);
    const ticks = advances.slice(-54).reduce((sum, advance) => sum + advance.ticks, 0);
    expect((ticks * tickCost) / (54 / 90)).toBeLessThanOrEqual(1 / 3 + 0.02);
  });

  it("stops at the maximum tick and drops nothing while the frames keep up", () => {
    const advances = runFrames(newClock(), 1 / 90, 200, 0.05);

    expect(lastOf(advances).tickSeconds).toBe(tick30);
    expect(advances.every((advance) => advance.tickSeconds <= tick30 && advance.behindSeconds === 0)).toBe(true);
  });

  it("does not react to one expensive tick", () => {
    const clock = newClock();
    const before = lastOf(runFrames(clock, 1 / 72, 20)).tickSeconds;

    clock.advance(1 / 72, 0.05);

    expect(clock.advance(1 / 72, 0).tickSeconds).toBe(before);
  });

  it("keeps one tick length when the ticks alternate between two costs", () => {
    const clock = newClock();
    const lengths = new Set<number>();
    let lastCost = 0;
    let ticksRun = 0;
    for (let frame = 0; frame < 400; frame += 1) {
      const advance = clock.advance(1 / 90, lastCost);
      if (advance.ticks > 0) {
        lastCost = ticksRun % 2 === 0 ? 0.006 : 0.008;
        ticksRun += 1;
      }
      if (frame >= 200) lengths.add(advance.tickSeconds);
    }

    expect(lengths.size).toBe(1);
    expect([...lengths][0]).toBeCloseTo(0.007 * 3, 9);
  });

  it("does not count a frame with no tick as a cheap one", () => {
    const clock = newClock();
    runFrames(clock, 1 / 120, 200, 0.01);

    expect(clock.advance(1 / 120, 0).tickSeconds).toBeGreaterThan(0.029);
  });

  it("comes back slowly once they fit", () => {
    const clock = newClock();
    runFrames(clock, 1 / 90, 200, 0.05);

    const halfSecond = lastOf(runFrames(clock, 1 / 90, 45)).tickSeconds;
    const backSoon = lastOf(runFrames(clock, 1 / 90, 90)).tickSeconds;
    const back = lastOf(runFrames(clock, 1 / 90, 360)).tickSeconds;

    expect(halfSecond).toBeGreaterThan(0.024);
    expect(backSoon).toBeLessThan(halfSecond);
    expect(backSoon).toBeGreaterThan(tick90);
    expect(back).toBe(tick90);
  });
});

describe("the load rule", () => {
  it("lengthens the frame's ticks to fit three, and goes back to the steady tick", () => {
    const clock = newClock();
    runFrames(clock, 1 / 90, 20);

    const heavy = clock.advance(0.06, 0);

    expect(heavy).toEqual({ ticks: 3, tickSeconds: expect.closeTo(0.02 + tick90 / 3, 2), behindSeconds: 0 });
    expect(clock.advance(1 / 90, 0)).toMatchObject({ ticks: 1, tickSeconds: expect.closeTo(tick90, 12) });
  });

  it("gives a 1 s hitch at most three ticks of the maximum and reports the rest", () => {
    const clock = newClock();
    runFrames(clock, 1 / 72, 20);

    const hitch = clock.advance(1, 0);

    expect(hitch.ticks).toBe(3);
    expect(hitch.tickSeconds).toBe(tick30);
    expect(hitch.behindSeconds).toBeGreaterThan(0.89);
  });

  it("carries no time past the frame that dropped it", () => {
    const clock = newClock();
    runFrames(clock, 1 / 72, 20);
    clock.advance(1, 0);

    const after = runFrames(clock, 1 / 72, 10);

    expect(after.every((advance) => advance.ticks === 1 && advance.behindSeconds === 0)).toBe(true);
  });

  it("never exceeds three ticks of the maximum, at any frame rate", () => {
    for (const period of [0.1, 0.2, 0.5, 2]) {
      for (const advance of runFrames(newClock(), period, 30)) {
        expect(advance.ticks).toBeLessThanOrEqual(3);
        expect(advance.tickSeconds).toBeLessThanOrEqual(tick30);
      }
    }
  });

  it("drops nothing at 10 Hz, the slowest display the limits still keep up with", () => {
    const advances = runFrames(newClock(), 0.1, 100);

    expect(advances.every((advance) => advance.behindSeconds === 0)).toBe(true);
  });

  it("falls behind by what three ticks of the maximum cannot hold, below 10 Hz", () => {
    const advance = lastOf(runFrames(newClock(), 0.2, 30));

    expect(advance).toEqual({ ticks: 3, tickSeconds: tick30, behindSeconds: expect.closeTo(0.1, 9) });
  });
});

describe("the notice of dropped time", () => {
  it("is due at once, then at most once per second, with what was dropped since", () => {
    const clock = newClock();
    expect(clock.takeBehindNotice()).toBe(0);

    clock.advance(1, 0);
    expect(clock.takeBehindNotice()).toBeCloseTo(0.9, 9);
    expect(clock.takeBehindNotice()).toBe(0);

    const notices: number[] = [];
    for (let frame = 0; frame < 25; frame += 1) {
      clock.advance(0.2, 0);
      notices.push(clock.takeBehindNotice());
    }

    expect(notices.filter((seconds) => seconds > 0).length).toBe(5);
  });
});
