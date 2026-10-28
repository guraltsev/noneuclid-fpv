/**
 * Minimal DOM loading screen shown while a world loads: a log of phase lines with the latest highlighted, plus an error state.
 * createLoadingStatus appends a "loading-screen" element to a container; track() yields to the browser for a paint before running a task so each phase message is visible before blocking work (such as compiling the world) begins.
 */
/** Handle to a loading screen that reports startup phases and errors. */
export interface LoadingStatus {
  /** Appends a new active log line for the phase, unless it repeats the current message. */
  setPhase(phase: string): void;
  /**
   * Shows the phase, waits for one animation frame so it paints, then runs the task and returns its result (rejections propagate).
   */
  track<T>(phase: string, task: () => T | Promise<T>): Promise<T>;
  /** Marks the screen as failed and logs "Could not load world: <message>". */
  showError(message: string): void;
  /** Removes the loading screen from the DOM. */
  dispose(): void;
}

/** Options for createLoadingStatus. */
export interface LoadingStatusOptions {
  /** First log line; defaults to "Starting world". */
  readonly initialMessage?: string;
}

const defaultInitialMessage = "Starting world";

/** Creates and mounts a loading screen inside the container and returns its controller. */
export function createLoadingStatus(
  container: HTMLElement,
  options: LoadingStatusOptions = {},
): LoadingStatus {
  const root = document.createElement("div");
  root.className = "loading-screen";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const log = document.createElement("div");
  log.className = "loading-screen-log";
  root.append(log);
  container.append(root);

  let activeLine: HTMLDivElement | undefined;

  function appendLine(message: string): HTMLDivElement {
    activeLine?.classList.remove("loading-screen-line-active");

    const line = document.createElement("div");
    line.className = "loading-screen-line loading-screen-line-active";
    line.textContent = message;
    log.append(line);
    log.scrollTop = log.scrollHeight;
    return line;
  }

  const setMessage = (message: string) => {
    if (activeLine?.textContent === message) {
      return;
    }

    activeLine = appendLine(message);
  };

  activeLine = appendLine(options.initialMessage ?? defaultInitialMessage);

  return {
    setPhase(nextPhase) {
      setMessage(nextPhase);
    },
    async track(nextPhase, task) {
      setMessage(nextPhase);
      await waitForPaint();
      return await task();
    },
    showError(message) {
      root.classList.add("loading-screen-error");
      setMessage(`Could not load world: ${message}`);
    },
    dispose() {
      root.remove();
    },
  };
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
