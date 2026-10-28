/**
 * Coordinates "end the immersive session, then run a restart action" so restarts (world change, app restart) never run while a session is still presenting.
 * The restart callback runs exactly once, after the session's `end` event, or immediately when there is no session.
 * At most one `end()` is in flight; a newer request replaces the pending callback.
 */

/**
 * Structural subset of `XRSession` needed to end a session and observe its `end` event.
 */
export interface RestartableXrSession {
  end(): Promise<void>;
  addEventListener(type: "end", listener: () => void, options?: AddEventListenerOptions): void;
}

/**
 * Handle returned by `createXrSessionRestartCoordinator`.
 */
export interface XrSessionRestartCoordinator {
  /**
   * Requests `restart` after `session` ends. With no session, `restart` runs synchronously.
   * Otherwise it is stored (replacing any earlier pending restart), the session is asked to end once, and `restart` runs from the session's `end` event.
   * If `session.end()` rejects, the pending restart is dropped and `onEndFailed` receives the error.
   */
  requestRestart(
    session: RestartableXrSession | null | undefined,
    restart: () => void,
    onEndFailed?: (error: unknown) => void,
  ): void;
  /** Drops any pending restart and resets the in-flight flag; call at teardown. */
  cancel(): void;
}

/**
 * Creates a coordinator with its own pending-restart state (createThreeApp#shell creates one and calls `cancel` on dispose).
 * Holds no external resources.
 */
export function createXrSessionRestartCoordinator(): XrSessionRestartCoordinator {
  let pendingRestart: (() => void) | undefined;
  let endingSession = false;

  function completeRestart(): void {
    const restart = pendingRestart;
    pendingRestart = undefined;
    endingSession = false;
    restart?.();
  }

  return {
    requestRestart(session, restart, onEndFailed) {
      if (!session) {
        restart();
        return;
      }

      // A request while an end is already in flight just replaces the callback; the existing end listener will run it.
      pendingRestart = restart;

      if (endingSession) {
        return;
      }

      endingSession = true;
      // Register before calling end() so the event cannot be missed.
      session.addEventListener("end", completeRestart, { once: true });
      void session.end().catch((error) => {
        pendingRestart = undefined;
        endingSession = false;
        onEndFailed?.(error);
      });
    },
    cancel() {
      pendingRestart = undefined;
      endingSession = false;
    },
  };
}
