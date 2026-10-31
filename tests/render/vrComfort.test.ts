/**
 * VR comfort vignette policy (src/render/three/vrComfort.ts): darkens everything outside a cone around the view
 * direction while artificial locomotion (stick move or turn) is active, to reduce visual-vestibular mismatch. The
 * visible cone is half the camera's field of view by default, configurable and clamped via
 * `antiNauseaVisibleFovScale`; opacity fades toward 1 while active and toward 0 once locomotion stops, at the
 * configured fade rate.
 */
import { describe, expect, it } from "vitest";
import {
  advanceComfortVignetteOpacity,
  defaultVrComfortOptions,
  isArtificialLocomotionActive,
  resolveComfortVignetteAngles,
} from "../../src/render/three/vrComfort";

describe("VR comfort vignette", () => {
  it("uses half of the normal FOV as the default fully visible cone", () => {
    const angles = resolveComfortVignetteAngles(70);

    expect(angles.visibleFovDegrees).toBeCloseTo(35);
    expect(angles.innerConeRadians).toBeCloseTo((35 * Math.PI / 180) / 2);
  });

  it("lets the visible FOV scale be configured and clamped", () => {
    expect(resolveComfortVignetteAngles(80, { antiNauseaVisibleFovScale: 0.25 }).visibleFovDegrees)
      .toBeCloseTo(20);
    expect(resolveComfortVignetteAngles(80, { antiNauseaVisibleFovScale: 2 }).visibleFovDegrees)
      .toBeCloseTo(80);
  });

  it("activates only for artificial locomotion frames", () => {
    expect(isArtificialLocomotionActive({
      localDisplacement: { x: 0.1, y: 0, z: 0 },
      yawDeltaRadians: 0,
    })).toBe(true);
    expect(isArtificialLocomotionActive({
      localDisplacement: { x: 0, y: 0, z: 0 },
      yawDeltaRadians: 0.1,
    })).toBe(true);
    expect(isArtificialLocomotionActive({
      localDisplacement: { x: 0, y: 0, z: 0 },
      yawDeltaRadians: 0,
    })).toBe(false);
  });

  it("fades opacity toward the active target", () => {
    expect(advanceComfortVignetteOpacity(0, true, defaultVrComfortOptions.antiNauseaFadeSeconds))
      .toBe(1);
    expect(advanceComfortVignetteOpacity(1, false, defaultVrComfortOptions.antiNauseaFadeSeconds))
      .toBe(0);
  });
});
