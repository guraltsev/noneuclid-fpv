/**
 * XR session controller (src/render/three/xrSessionController.ts): the session state the shell reads, entering a session,
 * and restarts that wait for a presenting session to end. The WebXR boundary is faked by tests/support/fakeXr.ts.
 * A restart while presenting ends the session first and runs after its `end` event; a session that fails to end sets the
 * state to "failed" and the restart never runs. Disposal ends the session and detaches the `end` handling.
 */
import { createTestEngine } from "../support/engine";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createXrSessionController, type XrRendererLike } from "../../src/render/three/xrSessionController";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createTestClientSession } from "../support/clientSession";
import { createFakeXrSession } from "../support/fakeXr";

type FakeSession = ReturnType<typeof createFakeXrSession>;

function createController(options: { readonly session?: FakeSession; readonly presenting?: boolean; readonly supported?: boolean } = {}) {
  const xrSession = options.session ?? createFakeXrSession();
  const resetAfterSessionEnd = vi.fn();
  const xr: XrRendererLike = {
    isPresenting: options.presenting ?? true,
    getSession: () => xrSession as never,
    setSession: vi.fn(async () => undefined),
  };
  const controller = createXrSessionController({
    entryUi: { update: vi.fn() },
    navigator: {
      xr: {
        isSessionSupported: async () => options.supported ?? true,
        requestSession: async () => xrSession as never,
      },
    },
    secureContext: true,
    session: createTestClientSession(),
    engine: createTestEngine(),
    initialPlayerPose: createDefaultPlayerPose("room-a"),
    xr,
    xrRig: { root: new THREE.Group(), getSharedRenderRootCellId: (pose) => pose.cellId },
    resetAfterSessionEnd,
    disposeOnTeardown: [],
    readRenderDebugFields: () => ({}),
  });
  return { controller, xrSession, resetAfterSessionEnd };
}

describe("XR session controller", () => {
  it("runs a restart at once when no session is presenting", () => {
    const { controller } = createController({ presenting: false });
    const restart = vi.fn();

    controller.requestAppRestart(restart);

    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("ends a presenting session first and restarts after its end event", async () => {
    const { controller, xrSession } = createController();
    const restart = vi.fn();

    controller.requestAppRestart(restart);
    await Promise.resolve();

    expect(xrSession.end).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
    xrSession.dispatchEnd();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("marks the state failed and skips the restart when ending the session fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const xrSession = createFakeXrSession();
    vi.mocked(xrSession.end).mockRejectedValueOnce(new Error("cannot end"));
    const { controller } = createController({ session: xrSession });
    const restart = vi.fn();

    controller.requestAppRestart(restart);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.sessionState().status).toBe("failed");
    expect(controller.sessionState().failureMessage).toBe("cannot end");
    expect(restart).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("enters a session once support is detected and resets the rig when it ends", async () => {
    const { controller, xrSession, resetAfterSessionEnd } = createController();
    controller.detectAvailability();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.sessionState().status).toBe("available");

    await controller.enterVr();
    expect(controller.sessionState().status).toBe("active");
    xrSession.dispatchEnd();

    expect(controller.sessionState().status).toBe("ended");
    expect(resetAfterSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("does not enter a session before support is known", async () => {
    const { controller } = createController();

    await controller.enterVr();

    expect(controller.sessionState().status).toBe("unknown");
  });

  it("ends the session on disposal and ignores a late end event", async () => {
    const { controller, xrSession, resetAfterSessionEnd } = createController();
    controller.detectAvailability();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.enterVr();

    controller.endActiveXrSessionOnDispose();
    xrSession.dispatchEnd();

    expect(xrSession.end).toHaveBeenCalledTimes(1);
    expect(resetAfterSessionEnd).not.toHaveBeenCalled();
  });
});
