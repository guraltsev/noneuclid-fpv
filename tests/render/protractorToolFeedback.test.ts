import { describe, expect, it } from "vitest";
import {
  createProtractorToolFeedback,
  protractorToolFeedbackSignature,
} from "../../src/render/three/protractorToolFeedback";

function options(hoverYaw: number) {
  return {
    center: { cellId: "c", objectId: "vertex-1", point: { x: 0, y: 0, z: 0 } } as never,
    centerLocked: true,
    first: { geodesicId: "g1", yawRadians: 0.5 } as never,
    hover: { geodesicId: "g2", yawRadians: hoverYaw } as never,
  };
}

describe("protractorToolFeedbackSignature", () => {
  it("is equal for equal inputs and differs for a hover yaw that moved by 1e-3", () => {
    expect(protractorToolFeedbackSignature(options(1))).toBe(protractorToolFeedbackSignature(options(1)));
    expect(protractorToolFeedbackSignature(options(1))).not.toBe(protractorToolFeedbackSignature(options(1.001)));
  });

  it("is the signature of the built feedback", () => {
    const feedback = createProtractorToolFeedback(options(1));

    expect(feedback?.signature).toBe(protractorToolFeedbackSignature(options(1)));
  });
});
