import { describe, expect, it, vi } from "vitest";
import {
  createXrSessionRestartCoordinator,
  type RestartableXrSession,
} from "../../src/render/three/xrSessionRestart";

function createSession(): RestartableXrSession & { dispatchEnd(): void } {
  const listeners: Array<() => void> = [];

  return {
    end: vi.fn(async () => undefined),
    addEventListener(type, listener) {
      if (type === "end") {
        listeners.push(listener);
      }
    },
    dispatchEnd() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("XR session restart coordinator", () => {
  it("runs immediately when there is no active XR session", () => {
    const coordinator = createXrSessionRestartCoordinator();
    const restart = vi.fn();

    coordinator.requestRestart(undefined, restart);

    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("waits for the XR session to end before restarting", async () => {
    const coordinator = createXrSessionRestartCoordinator();
    const session = createSession();
    const restart = vi.fn();

    coordinator.requestRestart(session, restart);
    await Promise.resolve();

    expect(session.end).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();

    session.dispatchEnd();

    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated restart requests while the session is ending", async () => {
    const coordinator = createXrSessionRestartCoordinator();
    const session = createSession();
    const firstRestart = vi.fn();
    const latestRestart = vi.fn();

    coordinator.requestRestart(session, firstRestart);
    coordinator.requestRestart(session, latestRestart);
    await Promise.resolve();
    session.dispatchEnd();

    expect(session.end).toHaveBeenCalledTimes(1);
    expect(firstRestart).not.toHaveBeenCalled();
    expect(latestRestart).toHaveBeenCalledTimes(1);
  });

  it("reports session end failures without restarting", async () => {
    const error = new Error("cannot leave VR");
    const session = createSession();
    vi.mocked(session.end).mockRejectedValueOnce(error);
    const coordinator = createXrSessionRestartCoordinator();
    const restart = vi.fn();
    const onEndFailed = vi.fn();

    coordinator.requestRestart(session, restart, onEndFailed);
    await vi.waitFor(() => expect(onEndFailed).toHaveBeenCalledWith(error));

    expect(restart).not.toHaveBeenCalled();
  });
});
