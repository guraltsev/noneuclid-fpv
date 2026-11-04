/**
 * `tests/render/geometryDebugHelpers.test.ts` — unit tier.
 *
 * `createGeometryDebugHelpers` installs the hand-driven torus-skew helpers while they apply. These tests use a stand-in geometry
 * session and a stub `window`: the helpers appear for a torus-skew deformation and step the pending target from the current one,
 * and none are installed when the deformation is not a torus skew and the debug level is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldGeometrySession } from "../../src/runtime/worldGeometrySession";
import type { WindowWithGeometryDebugHelpers } from "../../src/render/three/appDebugHelpers";
import { createGeometryDebugHelpers } from "../../src/render/three/geometryDebugHelpers";
import { createTestClientSession } from "../support/clientSession";

const stubWindow: Partial<WindowWithGeometryDebugHelpers> = {};

function createHarness(kind: "torus-skew" | "none") {
  const current = kind === "torus-skew" ? { kind: "torus-skew", skewXMeters: 1 } : { kind: "none" };
  const setTarget = vi.fn();
  const geometrySession = {
    state: { current, target: current },
    setTarget,
    cancel: vi.fn(),
  } as unknown as WorldGeometrySession;
  const helpers = createGeometryDebugHelpers({ session: createTestClientSession(), geometrySession });
  return { helpers, setTarget };
}

afterEach(() => {
  delete stubWindow.noneuclidGeometry;
  vi.unstubAllGlobals();
});

describe("createGeometryDebugHelpers", () => {
  it("installs helpers that step the skew from the current deformation", () => {
    vi.stubGlobal("window", stubWindow);
    const { helpers, setTarget } = createHarness("torus-skew");

    helpers.installIfAvailable();
    stubWindow.noneuclidGeometry?.StepTorusSkew(0.5);

    expect(setTarget).toHaveBeenCalledWith({ kind: "torus-skew", skewXMeters: 1.5 });
  });

  it("leaves no helpers when the deformation is not a torus skew and debug is off", () => {
    vi.stubGlobal("window", stubWindow);
    const { helpers } = createHarness("none");

    helpers.installIfAvailable();

    expect(stubWindow.noneuclidGeometry).toBeUndefined();
  });
});
