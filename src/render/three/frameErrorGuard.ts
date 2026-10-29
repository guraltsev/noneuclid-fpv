/**
 * Error containment for the animation loop.
 * three r0.164 requests the next animation frame only after the loop callback returns, so an exception thrown from a
 * frame would stop the loop for good (a frozen canvas, or a frozen world in an immersive session). The guard runs each
 * frame, and optional sub-phases, inside try/catch, reports each distinct failure once, runs a recovery callback (for
 * example a plain render) after a failed frame, and signals once when frames keep failing.
 * Pure TypeScript with no Three.js dependency, so it can be tested without WebGL.
 */

/** Configuration for {@link createFrameErrorGuard}. */
export interface FrameErrorGuardOptions {
  /** Number of consecutive failed frames after which `onPersistentFailure` is called (once per failure streak). */
  readonly maxConsecutiveFailures: number;
  /** Receives the first occurrence of each distinct `phase` + message pair; repeats are only counted. */
  readonly report: (phase: string, error: unknown) => void;
  /** Called once when a streak of failed frames reaches `maxConsecutiveFailures`; a successful frame ends the streak. */
  readonly onPersistentFailure: (error: unknown) => void;
}

/** Handle created by {@link createFrameErrorGuard}; owned by the frame loop that calls it. */
export interface FrameErrorGuard {
  /**
   * Runs one frame. If `frame` throws, the error is reported, the failure streak grows, and `recover` runs (its own
   * errors are reported as phase "recover"). Never throws.
   */
  runFrame(frame: () => void, recover: () => void): void;
  /**
   * Runs one phase inside a frame and contains its errors, so a failing phase (for example a tooltip) cannot stop
   * movement or rendering. Returns false if `phase` threw. Phase failures do not count toward the frame streak.
   */
  runPhase(phase: string, run: () => void): boolean;
  /** Consecutive failed frames so far (0 after a successful frame). */
  readonly consecutiveFailures: number;
  /** Failed frames plus failed phases since creation. */
  readonly totalFailures: number;
}

/** Creates a guard with an empty failure history. */
export function createFrameErrorGuard(options: FrameErrorGuardOptions): FrameErrorGuard {
  const reportedKeys = new Set<string>();
  let consecutiveFailures = 0;
  let totalFailures = 0;

  function record(phase: string, error: unknown): void {
    totalFailures += 1;
    const key = `${phase}\u0000${errorMessage(error)}`;
    if (reportedKeys.has(key)) {
      return;
    }
    reportedKeys.add(key);
    try {
      options.report(phase, error);
    } catch {
      // Reporting must never take the loop down.
    }
  }

  return {
    runFrame(frame, recover) {
      try {
        frame();
        consecutiveFailures = 0;
        return;
      } catch (error) {
        record("frame", error);
        consecutiveFailures += 1;
        if (consecutiveFailures === options.maxConsecutiveFailures) {
          try {
            options.onPersistentFailure(error);
          } catch (persistentFailureError) {
            record("persistent-failure", persistentFailureError);
          }
        }
      }
      try {
        recover();
      } catch (recoverError) {
        record("recover", recoverError);
      }
    },
    runPhase(phase, run) {
      try {
        run();
        return true;
      } catch (error) {
        record(phase, error);
        return false;
      }
    },
    get consecutiveFailures() {
      return consecutiveFailures;
    },
    get totalFailures() {
      return totalFailures;
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
