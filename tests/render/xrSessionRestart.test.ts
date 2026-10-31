/**
 * XR session restart coordination (src/render/three/xrSessionRestart.ts): runs a restart action (world change, app
 * restart) only after the current immersive session has fully ended, so a restart never races a still-presenting
 * session. With no session the restart runs immediately. At most one `end()` is in flight; a newer restart request
 * while one is ending replaces the pending callback rather than queuing a second one.
 *
 * The `XRSession` is faked by tests/support/fakeXr.ts's `createFakeXrSession`.
 */
import { describe, expect, it, vi } from "vitest";
import { createXrSessionRestartCoordinator } from "../../src/render/three/xrSessionRestart";
import { createFakeXrSession } from "../support/fakeXr";

describe("XR session restart coordinator", () => {
  it("runs immediately when there is no active XR session", () => {
    const coordinator = createXrSessionRestartCoordinator();
    const restart = vi.fn();

    coordinator.requestRestart(undefined, restart);

    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("waits for the XR session to end before restarting", async () => {
    const coordinator = createXrSessionRestartCoordinator();
    const session = createFakeXrSession();
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
    const session = createFakeXrSession();
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
    const session = createFakeXrSession();
    vi.mocked(session.end).mockRejectedValueOnce(error);
    const coordinator = createXrSessionRestartCoordinator();
    const restart = vi.fn();
    const onEndFailed = vi.fn();

    coordinator.requestRestart(session, restart, onEndFailed);
    await vi.waitFor(() => expect(onEndFailed).toHaveBeenCalledWith(error));

    expect(restart).not.toHaveBeenCalled();
  });
});
