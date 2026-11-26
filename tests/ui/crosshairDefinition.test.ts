/**
 * Tests of the pure crosshair definition: one case per tool and aim row of design 018 section 5, and the toast gate.
 */
import { describe, expect, it } from "vitest";
import { createCrosshairDefinition, createRefusalToastGate, type CrosshairAim } from "../../src/ui/crosshairDefinition";
import type { RuntimeToolId } from "../../src/glue/toolIds";

function look(selectedTool: RuntimeToolId, aim: CrosshairAim | undefined, menuOpen = false) {
  return createCrosshairDefinition({ selectedTool, aim, menuOpen });
}
const floor: CrosshairAim = { objectKind: "floor", withinRange: false };
const near = (objectKind: string, extra: Partial<CrosshairAim> = {}): CrosshairAim => ({ objectKind, withinRange: true, ...extra });
const far = (objectKind: string, extra: Partial<CrosshairAim> = {}): CrosshairAim => ({ objectKind, withinRange: false, ...extra });

describe("crosshair definition", () => {
  it("is idle with the sky, a closed gate or an open menu", () => {
    expect(look("none", undefined)).toEqual({ state: "idle" });
    expect(look("geodesicEmitters/emitter", floor, true)).toEqual({ state: "idle" });
  });

  describe("Hand", () => {
    it("is ready on a usable object in range", () => {
      expect(look("none", near("geodesicEmitters/emitter", { usableByHand: true }))).toEqual({ state: "ready" });
    });
    it("refuses a usable object that is too far", () => {
      expect(look("none", far("placedFlags/flag", { usableByHand: true }))).toEqual({ state: "refused", reason: "Too far" });
    });
    it("is idle on the floor and on objects with no use", () => {
      expect(look("none", floor)).toEqual({ state: "idle" });
      expect(look("none", near("asset", { usableByHand: false }))).toEqual({ state: "idle" });
    });
  });

  describe("Laser", () => {
    const tool = "geodesicEmitters/emitter";
    it("is ready on the floor, a beam and a meeting point, at any distance", () => {
      expect(look(tool, floor).state).toBe("ready");
      expect(look(tool, far("geodesicModel/segment")).state).toBe("ready");
      expect(look(tool, near("geodesicModel/crossing")).state).toBe("ready");
    });
    it("is ready on a laser in range and refuses one that is too far", () => {
      expect(look(tool, near("geodesicEmitters/emitter")).state).toBe("ready");
      expect(look(tool, far("geodesicEmitters/emitter"))).toEqual({ state: "refused", reason: "Too far" });
    });
    it("refuses a sign and ignores decor", () => {
      expect(look(tool, near("placedFlags/flag"))).toEqual({ state: "refused", reason: "Aim at the floor" });
      expect(look(tool, near("asset")).state).toBe("idle");
    });
  });

  describe("Sign", () => {
    const tool = "placedFlags/flag";
    it("is ready on the floor only", () => {
      expect(look(tool, floor).state).toBe("ready");
      expect(look(tool, near("geodesicModel/segment"))).toEqual({ state: "refused", reason: "Aim at the floor" });
      expect(look(tool, near("asset")).state).toBe("idle");
    });
  });

  describe("Ruler", () => {
    const tool = "geodesicMeasurements/length";
    it("is ready on a beam in range", () => {
      expect(look(tool, near("geodesicModel/segment")).state).toBe("ready");
    });
    it("refuses a beam too far and any other object", () => {
      expect(look(tool, far("geodesicModel/segment"))).toEqual({ state: "refused", reason: "Too far" });
      expect(look(tool, near("geodesicEmitters/emitter"))).toEqual({ state: "refused", reason: "Aim at a beam" });
    });
    it("is idle on the floor", () => {
      expect(look(tool, floor).state).toBe("idle");
    });
  });

  describe("Protractor", () => {
    const tool = "geodesicMeasurements/protractor";
    it("at the centre step is ready on a laser or a meeting point in range", () => {
      expect(look(tool, near("geodesicEmitters/emitter", { protractorStep: "center" })).state).toBe("ready");
      expect(look(tool, near("geodesicModel/crossing", { protractorStep: "center" })).state).toBe("ready");
    });
    it("at the centre step refuses a far laser and a beam", () => {
      expect(look(tool, far("geodesicEmitters/emitter", { protractorStep: "center" }))).toEqual({ state: "refused", reason: "Too far" });
      expect(look(tool, near("geodesicModel/segment", { protractorStep: "center" }))).toEqual({ state: "refused", reason: "Aim at a laser or a meeting point" });
      expect(look(tool, floor).state).toBe("idle");
    });
    it("at the side step is ready on a valid side", () => {
      expect(look(tool, near("geodesicModel/segment", { protractorStep: "side", protractorSideValid: true })).state).toBe("ready");
    });
    it("at the side step refuses an invalid object and a far side", () => {
      expect(look(tool, near("geodesicModel/segment", { protractorStep: "side", protractorSideValid: false }))).toEqual({ state: "refused", reason: "Aim at a beam" });
      expect(look(tool, far("geodesicModel/segment", { protractorStep: "side", protractorSideValid: true }))).toEqual({ state: "refused", reason: "Too far" });
      expect(look(tool, { ...floor, protractorStep: "side" }).state).toBe("idle");
    });
  });

  describe("Join and laser modes", () => {
    it("Join is ready on a beam in range and refuses one too far", () => {
      expect(look("geodesicModel/tie", near("geodesicModel/segment")).state).toBe("ready");
      expect(look("geodesicModel/tie", far("geodesicModel/segment"))).toEqual({ state: "refused", reason: "Too far" });
    });
    it("pick up, turn and aim are ready wherever the aim is", () => {
      for (const tool of ["geodesicEmitters/carry", "geodesicEmitters/rotate", "geodesicEmitters/aim"] as const) {
        expect(look(tool, floor).state).toBe("ready");
      }
    });
    it("the Map announces nothing", () => {
      expect(look("worldMap/map", near("placedFlags/flag")).state).toBe("idle");
    });
  });
});

describe("refusal toast gate", () => {
  it("shows a reason at most once per 1.5 s and shows a different reason at once", () => {
    const gate = createRefusalToastGate();
    expect(gate.shouldShow("Too far", 0)).toBe(true);
    expect(gate.shouldShow("Too far", 1000)).toBe(false);
    expect(gate.shouldShow("Aim at a beam", 1100)).toBe(true);
    expect(gate.shouldShow("Aim at a beam", 2700)).toBe(true);
  });
});
