/**
 * The toast queue (design 017 section 8.3): short messages that appear for a moment, at most two at a time.
 * Pure and renderer-neutral: the desktop DOM view and the VR wrist panel both read `visible()` and draw it. The queue owns the clock only through the times passed in: `tick(nowMs)` drops expired toasts, and `push` stamps a toast with `options.nowMs` (or the configured clock, `performance.now` by default).
 * Rules: a third toast pushes out the oldest visible one; pushing the text of a toast that is still visible restarts its timer (and replaces its action) instead of stacking.
 */

/** An optional button on a toast, for example the undo that follows "World reset". */
export interface ToastAction {
  /** Words on the button, from the vocabulary. */
  readonly label: string;
  /** Machine id the view reports back when the button is used, for example "undo". */
  readonly id: string;
}

/** A message on screen. */
export interface Toast {
  /** Unique within one queue, increasing; a restarted duplicate keeps its id. */
  readonly id: number;
  readonly text: string;
  readonly action?: ToastAction;
  /** Monotonic time in milliseconds at which the toast goes away. */
  readonly expiresAtMs: number;
}

/** Tuning of {@link createToastQueue}. */
export interface ToastQueueOptions {
  /** How long a toast stays, in milliseconds; the design says 2500. */
  readonly durationMs: number;
  /** How many toasts show at once; the design says 2. */
  readonly maxVisible: number;
  /** Clock used by `push` when no `nowMs` is given; defaults to `performance.now`. */
  readonly now?: () => number;
}

/** Options of one `push`. */
export interface ToastPushOptions {
  readonly action?: ToastAction;
  /** Time of the push in milliseconds; defaults to the queue's clock. */
  readonly nowMs?: number;
}

/** Handle created by {@link createToastQueue}. */
export interface ToastQueue {
  /** Shows `text` as a toast, restarting an identical visible one. */
  push(text: string, options?: ToastPushOptions): void;
  /** Drops the toasts that expired by `nowMs`; call once per frame. */
  tick(nowMs: number): void;
  /** The toasts to draw, oldest first. The array is replaced, not mutated, whenever the set changes. */
  visible(): readonly Toast[];
}

/** Creates an empty queue. */
export function createToastQueue(options: ToastQueueOptions): ToastQueue {
  const now = options.now ?? (() => performance.now());
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  return {
    push(text, pushOptions = {}) {
      const expiresAtMs = (pushOptions.nowMs ?? now()) + options.durationMs;
      const existing = toasts.find((toast) => toast.text === text);
      if (existing) {
        const restarted: Toast = { ...existing, action: pushOptions.action, expiresAtMs };
        toasts = toasts.map((toast) => (toast === existing ? restarted : toast));
        return;
      }
      const added: Toast = { id: nextId++, text, action: pushOptions.action, expiresAtMs };
      const all = [...toasts, added];
      toasts = all.slice(Math.max(0, all.length - options.maxVisible));
    },
    tick(nowMs) {
      if (toasts.some((toast) => toast.expiresAtMs <= nowMs)) {
        toasts = toasts.filter((toast) => toast.expiresAtMs > nowMs);
      }
    },
    visible() {
      return toasts;
    },
  };
}
