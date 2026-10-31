import { describe, expect, it } from "vitest";
import {
  createXrSessionState,
  detectXrSessionState,
  statusLabel,
  transitionXrSessionState,
  type XrNavigatorLike,
} from "../../src/render/three/xrSessionState";

describe("XR session state", () => {
  it("labels the public session statuses", () => {
    expect(statusLabel("unknown")).toBe("Checking VR support");
    expect(statusLabel("available")).toBe("VR available");
    expect(statusLabel("entering")).toBe("Entering VR");
    expect(statusLabel("active")).toBe("VR active");
    expect(statusLabel("ended")).toBe("VR ended");
    expect(statusLabel("failed", "permission denied")).toBe("VR failed: permission denied");
  });

  it("classifies insecure contexts separately from unsupported browsers", async () => {
    const navigatorLike: XrNavigatorLike = {};
    const state = await detectXrSessionState(navigatorLike, false);

    expect(state.status).toBe("insecure-context");
    expect(state.secureContext).toBe(false);
    expect(state.immersiveVrSupported).toBe(false);
  });

  it("reports unsupported when secure but navigator.xr is missing", async () => {
    await expect(detectXrSessionState({}, true)).resolves.toMatchObject({
      status: "unsupported",
      secureContext: true,
      immersiveVrSupported: false,
    });
  });

  it("updates when immersive-vr support resolves", async () => {
    await expect(
      detectXrSessionState({ xr: { isSessionSupported: async () => true } }, true),
    ).resolves.toMatchObject({
      status: "available",
      immersiveVrSupported: true,
    });
  });

  it("turns support check rejection into a readable failure state", async () => {
    await expect(
      detectXrSessionState({ xr: { isSessionSupported: async () => Promise.reject(new Error("blocked")) } }, true),
    ).resolves.toMatchObject({
      status: "failed",
      failureMessage: "blocked",
    });
  });

  it("preserves context while transitioning through enter and end states", () => {
    const available = createXrSessionState("available", {
      secureContext: true,
      immersiveVrSupported: true,
    });

    expect(transitionXrSessionState(available, "entering")).toMatchObject({
      status: "entering",
      immersiveVrSupported: true,
    });
    expect(transitionXrSessionState(available, "active")).toMatchObject({
      status: "active",
      immersiveVrSupported: true,
    });
    expect(transitionXrSessionState(available, "ended")).toMatchObject({
      status: "ended",
      secureContext: true,
    });
  });
});
