import { describe, expect, it } from "vitest";
import { resolveGeodesicCannonAimYawFromAbsolutePoints } from "../../src/render/three/geodesicCannonAimTarget";

describe("resolveGeodesicCannonAimYawFromAbsolutePoints", () => {
  it("computes yaw from the absolute emitter source to the absolute crosshair target", () => {
    const yaw = resolveGeodesicCannonAimYawFromAbsolutePoints({
      source: { x: 1, y: 2, z: 1.08 },
      target: { x: 3, y: 5, z: 0 },
    });

    expect(yaw).toBeCloseTo(Math.atan2(3, 2));
  });

  it("ignores z when computing the yaw", () => {
    const yaw = resolveGeodesicCannonAimYawFromAbsolutePoints({
      source: { x: 1, y: 2, z: 10 },
      target: { x: 1, y: 5, z: -20 },
    });

    expect(yaw).toBeCloseTo(Math.PI / 2);
  });
});
