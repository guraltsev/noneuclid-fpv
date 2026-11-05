/**
 * The simulation clock (design 012 P8, 013 section 6.5): turns elapsed real time into ticks of length \(h\). Pure: it reads no clock, the shell tells it how much time passed and what the last ticks cost.
 * \(h\) is the longest of three lengths, capped by `maxTickSeconds`: the configured `tickSeconds`, the steady frame period (ticks never run faster than the display), and what the ticks' cost asks for (ticks take at most
 * `tickBudgetShare` of real time). A frame has at most three ticks. When it needs more, \(h\) grows for that frame, up to `maxTickSeconds`; what still does not fit is dropped and reported, never paid back later.
 * The frame period and the tick cost are medians of the last few samples, so one odd frame moves neither. A frame's ticks are rounded to the nearest whole number: at \(h\) equal to the frame period, a frame slightly short
 * of the period still gets its tick. The world then runs at most half a tick ahead of real time.
 */

/** The clock's settings; they are options of the experience. */
export interface SimulationClockOptions {
  /** The tick length \(h\) the world runs at when nothing makes it longer, in seconds. */
  readonly tickSeconds: number;
  /** The longest tick, in seconds. */
  readonly maxTickSeconds: number;
  /** The share of real time the ticks may take before \(h\) grows, between 0 and 1. */
  readonly tickBudgetShare: number;
}

/** What one frame runs. */
export interface ClockAdvance {
  /** How many steps this frame runs: none, one or several. */
  readonly ticks: number;
  /** The length of each of them, in seconds. */
  readonly tickSeconds: number;
  /** The real time this frame dropped, in seconds: it is not run, now or later. */
  readonly behindSeconds: number;
}

/** Handle returned by {@link createSimulationClock}. */
export interface SimulationClock {
  /** Once per frame: `elapsedSeconds` is the real time since the last call, uncapped, and `lastTicksCostSeconds` how long the ticks of the last call took. */
  advance(elapsedSeconds: number, lastTicksCostSeconds: number): ClockAdvance;
  /** The seconds dropped since the last notice when a notice is due, at most once per second of real time; otherwise 0. */
  takeBehindNotice(): number;
}

/** The most ticks one frame runs (confirmed by the maintainer, 2026-11-05). */
const maxTicksPerFrame = 3;

/** How many samples a median looks at. An even number: a cadence alternating two periods, a display missing every second vsync, then fills it half and half at every frame, and its median stays the mean of the two. */
const medianWindow = 10;

/** How fast the length the ticks' cost asked for comes back once they fit, as a rate per second: from \(1/30\) to \(1/90\) s in about two seconds. */
const loadRecoveryPerSecond = 0.5;

/** Shortest real time between two notices, in seconds. */
const behindNoticeIntervalSeconds = 1;

const ascending = (a: number, b: number): number => a - b;

/** The median of the last {@link medianWindow} samples, the mean of the two middle ones when their number is even; 0 before the first. */
function createRecentMedian() {
  const samples: number[] = [];
  const sorted: number[] = [];
  let next = 0;
  return {
    push(value: number): void {
      samples[next] = value;
      next = (next + 1) % medianWindow;
    },
    median(): number {
      if (samples.length === 0) return 0;
      // Written by index: `sorted` keeps its storage from frame to frame, and is never longer than `samples`.
      for (let index = 0; index < samples.length; index += 1) sorted[index] = samples[index]!;
      sorted.sort(ascending);
      return (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2;
    },
  };
}

/** Creates a clock. */
export function createSimulationClock(options: SimulationClockOptions): SimulationClock {
  const { tickSeconds, maxTickSeconds, tickBudgetShare } = options;

  const framePeriods = createRecentMedian();
  const tickCosts = createRecentMedian();
  let accumulatedSeconds = 0;
  let ticksOfLastFrame = 0;
  // The tick length the ticks' cost asks for; it jumps up with the cost and comes back slowly.
  let loadTickSeconds = 0;
  let unreportedBehindSeconds = 0;
  let secondsSinceNotice = behindNoticeIntervalSeconds;

  function steadyTickSeconds(framePeriodSeconds: number): number {
    const costTickSeconds = tickCosts.median() / tickBudgetShare;
    const recovered = loadTickSeconds * Math.exp(-loadRecoveryPerSecond * framePeriodSeconds);
    loadTickSeconds = Math.min(maxTickSeconds, Math.max(costTickSeconds, recovered));
    return Math.min(maxTickSeconds, Math.max(tickSeconds, framePeriodSeconds, loadTickSeconds));
  }

  function run(ticks: number, length: number, behindSeconds: number): ClockAdvance {
    ticksOfLastFrame = ticks;
    unreportedBehindSeconds += behindSeconds;
    return { ticks, tickSeconds: length, behindSeconds };
  }

  return {
    advance(elapsedSeconds, lastTicksCostSeconds) {
      if (elapsedSeconds > 0) framePeriods.push(elapsedSeconds);
      if (ticksOfLastFrame > 0) tickCosts.push(lastTicksCostSeconds / ticksOfLastFrame);
      secondsSinceNotice += elapsedSeconds;
      accumulatedSeconds += elapsedSeconds;

      const steady = steadyTickSeconds(framePeriods.median());
      const wanted = Math.max(0, Math.round(accumulatedSeconds / steady));
      if (wanted <= maxTicksPerFrame) {
        accumulatedSeconds -= wanted * steady;
        return run(wanted, steady, 0);
      }
      const needed = accumulatedSeconds / maxTicksPerFrame;
      const behindSeconds = needed <= maxTickSeconds ? 0 : accumulatedSeconds - maxTicksPerFrame * maxTickSeconds;
      accumulatedSeconds = 0;
      return run(maxTicksPerFrame, Math.min(needed, maxTickSeconds), behindSeconds);
    },
    takeBehindNotice() {
      if (unreportedBehindSeconds === 0 || secondsSinceNotice < behindNoticeIntervalSeconds) return 0;
      const seconds = unreportedBehindSeconds;
      unreportedBehindSeconds = 0;
      secondsSinceNotice = 0;
      return seconds;
    },
  };
}
