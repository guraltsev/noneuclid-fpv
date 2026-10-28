import { describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import {
  createWorldFocusMessageDefinition,
  formatWorldFocusMessageTextForLegacyFallback,
} from "../../src/ui/worldInteractionDefinition";
import type { RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";

describe("worldInteractionDefinition", () => {
  it("emits context edit for signs", () => {
    const definition = createWorldFocusMessageDefinition({
      object: baseObject("placed-flag", "Sign"),
      selectedTool: "none",
    });

    expect(definition?.actions).toMatchObject([{ id: "edit-sign", intent: "context-menu", label: "Edit" }]);
    expect(formatWorldFocusMessageTextForLegacyFallback(definition, "desktop")).toBe("Sign\nRight click / F - Edit");
  });

  it("emits context menu for geodesic emitters", () => {
    const definition = createWorldFocusMessageDefinition({
      object: {
        ...baseObjectFields("geodesic-cannon-a", "geodesic-cannon", "Geodesic emitter"),
        geodesicIds: [],
        aimYawRadians: 0,
      } as RuntimeWorldObject,
      selectedTool: "none",
    });

    expect(definition?.actions).toMatchObject([{ id: "open-object-menu", intent: "context-menu", label: "Emitter menu" }]);
    expect(formatWorldFocusMessageTextForLegacyFallback(definition, "xr")).toBe("Geodesic emitter\nSide trigger - Emitter menu");
  });

  it("emits primary read action for help hubs", () => {
    const definition = createWorldFocusMessageDefinition({
      object: {
        ...baseObjectFields("question-a", "asset", "Help hub"),
        assetPath: "questionblock/questionBlock.glb",
        interactable: { label: "Read", action: "open-tutorial" },
        tutorialPages: [{ title: "Move", body: "Use arrows." }],
      } as RuntimeWorldObject,
      selectedTool: "none",
    });

    expect(definition?.actions).toMatchObject([{ id: "open-tutorial", intent: "primary", label: "Read" }]);
    expect(formatWorldFocusMessageTextForLegacyFallback(definition, "desktop")).toBe("Help hub\nLeft click - Read");
  });

  it("emits primary extend for open geodesic segments only when available", () => {
    const definition = createWorldFocusMessageDefinition({
      object: segment(),
      selectedTool: "none",
      canExtendGeodesic: true,
    });
    const locked = createWorldFocusMessageDefinition({
      object: segment(),
      selectedTool: "none",
      canExtendGeodesic: false,
    });

    expect(definition?.actions).toMatchObject([{ id: "extend-geodesic", intent: "primary", label: "Extend" }]);
    expect(formatWorldFocusMessageTextForLegacyFallback(definition, "desktop")).toBe("Geodesic G1\nLeft click - Extend");
    expect(formatWorldFocusMessageTextForLegacyFallback(locked, "desktop")).toBe("Geodesic G1");
  });

  it("emits tool-specific primary actions for geodesic segments", () => {
    expect(createWorldFocusMessageDefinition({
      object: segment(),
      selectedTool: "measure-length",
    })?.actions).toMatchObject([{ id: "measure-length", label: "Measure length" }]);
    expect(createWorldFocusMessageDefinition({
      object: segment(),
      selectedTool: "protractor",
    })?.actions).toMatchObject([{ id: "select-protractor-side", label: "Select side" }]);
  });

  it("emits primary remove for measurements and angles", () => {
    expect(createWorldFocusMessageDefinition({
      object: {
        ...baseObjectFields("measurement-a", "measured-geodesic-length", "G1 length = 5 m"),
        geodesicId: "g-a",
        lengthMeters: 5,
        labelPoint: { x: 0, y: 0, z: 0 },
      } as RuntimeWorldObject,
      selectedTool: "none",
    })?.actions).toMatchObject([{ id: "remove-measurement", intent: "primary", label: "Remove" }]);

    expect(createWorldFocusMessageDefinition({
      object: {
        ...baseObjectFields("angle-a", "protractor-angle", "G1 angle G2 = 90 deg"),
        centerObjectId: "center",
        centerPoint: { x: 0, y: 0, z: 0 },
        first: { geodesicId: "g-a", segmentId: "s-a", yawRadians: 0 },
        second: { geodesicId: "g-b", segmentId: "s-b", yawRadians: Math.PI / 2 },
        angleRadians: Math.PI / 2,
        angleDegrees: 90,
        radiusMeters: 0.3,
      } as RuntimeWorldObject,
      selectedTool: "none",
    })?.actions).toMatchObject([{ id: "remove-angle", intent: "primary", label: "Delete measurement" }]);
  });
});

function baseObject(kind: RuntimeWorldObject["kind"], label: string): RuntimeWorldObject {
  return {
    ...baseObjectFields(`${kind}-a`, kind, label),
  } as RuntimeWorldObject;
}

function baseObjectFields(id: string, kind: RuntimeWorldObject["kind"], label: string) {
  return {
    id,
    kind,
    cellId: "cell-a",
    localPose: identityRigidTransform3,
    portalRenderable: true,
    tooltip: { label },
  };
}

function segment(): RuntimeWorldObject {
  return {
    ...baseObject("geodesic-segment", "Geodesic G1"),
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
  } as RuntimeWorldObject;
}
