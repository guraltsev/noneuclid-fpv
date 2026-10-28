import { describe, expect, it } from "vitest";
import { chooseActiveScenePointer } from "../../src/render/three/scenePointers";

describe("scenePointers", () => {
  it("prefers a selected pointer over hover-only pointers", () => {
    const active = chooseActiveScenePointer([
      {
        id: "desktop-aimer",
        kind: "desktop-aimer",
        hoveredTargetId: "tool:place-flag",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: true,
      },
      {
        id: "controller:left",
        kind: "xr-controller",
        selectPressed: true,
        selectStarted: true,
        selectEnded: false,
        dominant: false,
      },
    ]);

    expect(active?.id).toBe("controller:left");
  });

  it("falls back to the dominant hovered pointer", () => {
    const active = chooseActiveScenePointer([
      {
        id: "controller:left",
        kind: "xr-controller",
        hoveredTargetId: "reload-world",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: false,
      },
      {
        id: "controller:right",
        kind: "xr-controller",
        hoveredTargetId: "debug-overlay-toggle",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: true,
      },
    ]);

    expect(active?.id).toBe("controller:right");
  });
});
