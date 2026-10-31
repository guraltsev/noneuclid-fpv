import { describe, expect, it } from "vitest";
import {
  renderCameraDepthRangeRatio,
  renderCameraFarMeters,
  renderCameraNearMeters,
} from "../../src/render/three/renderCameraClip";

describe("render camera clip policy", () => {
  it("keeps the near plane close but not so tiny that far static objects lose depth precision", () => {
    expect(renderCameraNearMeters).toBeGreaterThanOrEqual(0.03);
    expect(renderCameraNearMeters).toBeLessThanOrEqual(0.05);
    expect(renderCameraFarMeters).toBe(250);
    expect(renderCameraDepthRangeRatio()).toBeLessThanOrEqual(10_000);
  });
});
