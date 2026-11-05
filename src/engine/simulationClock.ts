/**
 * The simulation clock (design 012 P8, 013 section 6.5): turns elapsed real time into ticks of length \(h\). Pure: it reads no clock, the shell tells it how much time passed and what the last ticks cost.
 * \(h\) is the longest of three lengths, capped by `maxTickSeconds`: the configured `tickSeconds`, the steady frame period (ticks never run faster than the display), and what the ticks' cost asks for (ticks take at most
 * `tickBudgetShare` of the last half second of real time). A frame has at most three ticks. When it needs more, \(h\) grows for that frame, up to `maxTickSeconds`; what still does not fit is dropped and reported, never paid back later.
 * The frame period is a median of the last few samples and the ticks' share an average over the last half second, so one odd frame does not move the period, and moves the share only by what it adds to the half second: a single frame whose ticks cost more than the share of the half second, about 0.17 s at a share of one third, does lengthen \(h\). A frame's ticks are rounded to the nearest whole number: at \(h\) equal to the frame period, a frame slightly short
 * of the period still gets its tick. The world then runs at most half a tick ahead of real time.
 */

/** The clock's settings; they are options of the experience. */
export interface SimulationClockOptions {
  /** The tick length \(h\) the world runs at when nothing makes it longer, in seconds. */
  readonly tickSeconds: number;
  /** The longest tick, in seconds. */
  readonly maxTickSeconds: number;
  /** The share of the last half second of real time the ticks may take before \(h\) grows, between 0 and 1. */
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

/** How much real time the ticks' share of it is measured over, in seconds (maintainer, 2026-11-05). */
const loadWindowSeconds = 0.5;

/** How many frames the load window can hold: half a second up to 1000 Hz. Past that its oldest frames leave early. */
const loadWindowFrames = 512;

/** How far under their share the ticks must fall, as a part of it, before the tick length may come back. In between it holds, so a load sitting at the share does not move it up and down. */
const loadHoldBand = 0.1;

/** Shortest real time between two notices, in seconds. */
const behindNoticeIntervalSeconds = 1;

/** The median of the last {@link medianWindow} samples, the mean of the two middle ones when their number is even; 0 before the first. */
function createRecentMedian() {
  const samples: number[] = [];
  const sorted = new Float64Array(medianWindow);
  let next = 0;
  return {
    push(value: number): void {
      samples[next] = value;
      next = (next + 1) % medianWindow;
    },
    median(): number {
      if (samples.length === 0) return 0;
      // An insertion sort into preallocated storage: this runs in every frame, and `Array.prototype.sort` allocates.
      const count = samples.length;
      for (let index = 0; index < count; index += 1) {
        const value = samples[index]!;
        let slot = index;
        while (slot > 0 && sorted[slot - 1]! > value) {
          sorted[slot] = sorted[slot - 1]!;
          slot -= 1;
        }
        sorted[slot] = value;
      }
      return (sorted[(count - 1) >> 1]! + sorted[count >> 1]!) / 2;
    },
  };
}

/**
 * What the ticks cost over the last {@link loadWindowSeconds} of real time: a ring of frames with running sums, so a frame costs one write and on average one eviction.
 * A frame longer than the window stays alone in it, with what the ticks before it cost: a hidden tab reads as no load until the next half second has passed. Until half a second has passed the share is still taken of the whole
 * window, so the first frames do not read as a load they have not sustained.
 */
function createRecentLoad() {
  const elapsed = new Float64Array(loadWindowFrames);
  const costs = new Float64Array(loadWindowFrames);
  const ticks = new Float64Array(loadWindowFrames);
  let oldest = 0;
  let count = 0;
  let elapsedSum = 0;
  let costSum = 0;
  let tickSum = 0;

  function evictOldest(): void {
    elapsedSum -= elapsed[oldest]!;
    costSum -= costs[oldest]!;
    tickSum -= ticks[oldest]!;
    oldest = (oldest + 1) % loadWindowFrames;
    count -= 1;
  }

  return {
    push(elapsedSeconds: number, costSeconds: number, tickCount: number): void {
      if (count === loadWindowFrames) evictOldest();
      const slot = (oldest + count) % loadWindowFrames;
      elapsed[slot] = elapsedSeconds;
      costs[slot] = costSeconds;
      ticks[slot] = tickCount;
      count += 1;
      elapsedSum += elapsedSeconds;
      costSum += costSeconds;
      tickSum += tickCount;
      while (count > 1 && elapsedSum - elapsed[oldest]! >= loadWindowSeconds) evictOldest();
    },
    /** The part of the window the ticks took. */
    share: (): number => costSum / Math.max(elapsedSum, loadWindowSeconds),
    /** What one tick cost on average; 0 with no tick in the window. */
    costPerTick: (): number => (tickSum > 0 ? costSum / tickSum : 0),
  };
}

/** Creates a clock. */
export function createSimulationClock(options: SimulationClockOptions): SimulationClock {
  const { tickSeconds, maxTickSeconds, tickBudgetShare } = options;

  const framePeriods = createRecentMedian();
  const load = createRecentLoad();
  let accumulatedSeconds = 0;
  let ticksOfLastFrame = 0;
  // The tick length the ticks' cost asks for: the one at which they take their share. It jumps up with the cost and comes back slowly.
  let loadTickSeconds = 0;
  // How long the ticks have fitted under the hold band without a break; the tick length comes back only after a whole window of it.
  let secondsFitting = 0;
  let unreportedBehindSeconds = 0;
  let secondsSinceNotice = behindNoticeIntervalSeconds;

  function steadyTickSeconds(framePeriodSeconds: number): number {
    const share = load.share();
    const costTickSeconds = load.costPerTick() / tickBudgetShare;
    if (share > tickBudgetShare) loadTickSeconds = Math.min(maxTickSeconds, Math.max(costTickSeconds, loadTickSeconds));
    secondsFitting = share < tickBudgetShare * (1 - loadHoldBand) ? secondsFitting + framePeriodSeconds : 0;
    if (secondsFitting >= loadWindowSeconds) {
      loadTickSeconds = Math.max(Math.min(costTickSeconds, loadTickSeconds), loadTickSeconds * Math.exp(-loadRecoveryPerSecond * framePeriodSeconds));
    }
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
      load.push(elapsedSeconds, lastTicksCostSeconds, ticksOfLastFrame);
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
