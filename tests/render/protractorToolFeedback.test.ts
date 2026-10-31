/**
 * Protractor tool in-scene feedback (src/render/three/protractorToolFeedback.ts): the center marker, direction
 * rays and angle sector shown while a protractor measurement is half-finished. The angle sector is drawn only
 * once both a first and a hovered direction exist; a single direction gets only its ray. The returned
 * `signature` is a cache key of every input that affects the drawing, used by `createThreeApp` to skip rebuilding
 * when nothing changed; it is read from the built feedback, not recomputed separately, so the two can never drift.
 */
import { describe, expect, it } from "vitest";
import {
  createProtractorToolFeedback,
  protractorToolFeedbackSignature,
} from "../../src/render/three/protractorToolFeedback";

function options(overrides: { readonly first?: boolean; readonly hover?: boolean } = {}) {
  return {
    center: { cellId: "c", objectId: "vertex-1", point: { x: 0, y: 0, z: 0 }, geodesicIds: [] },
    centerLocked: true,
    first: overrides.first === false ? undefined : { geodesicId: "g1", yawRadians: 0.5, segmentId: "s1" },
    hover: overrides.hover === false ? undefined : { geodesicId: "g2", yawRadians: 1, segmentId: "s2" },
  };
}

describe("createProtractorToolFeedback", () => {
  it("draws the angle sector only once both a first and a hovered direction exist", () => {
    expect(createProtractorToolFeedback(options())!.root.getObjectByName("protractor-feedback-angle-preview")).toBeDefined();
    expect(createProtractorToolFeedback(options({ hover: false }))!.root.getObjectByName("protractor-feedback-angle-preview")).toBeUndefined();
    expect(createProtractorToolFeedback(options({ first: false }))!.root.getObjectByName("protractor-feedback-angle-preview")).toBeUndefined();
  });

  it("returns a signature matching the standalone signature function for the same options", () => {
    const feedback = createProtractorToolFeedback(options());

    expect(feedback?.signature).toBe(protractorToolFeedbackSignature(options()));
    expect(feedback?.signature).not.toBe(protractorToolFeedbackSignature(options({ hover: false })));
  });
});
