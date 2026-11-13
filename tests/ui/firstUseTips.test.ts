/**
 * `tests/ui/firstUseTips.test.ts` - unit tier.
 *
 * The first-use tips are pure data and transitions: each belt tool has an ordered list of steps with the event that finishes a step, a tip moves on when that event happens (and not for any other), "Next" moves on by hand, the control names fill the placeholders of a step's text, and the set of tips already seen round-trips through its stored form.
 */
import { describe, expect, it } from "vitest";
import {
  advanceTipOnEvent,
  currentTipStep,
  firstUseTips,
  isLastTipStep,
  markTipSeen,
  nextTipStep,
  parseSeenTips,
  renderTipText,
  serializeSeenTips,
  shouldShowFirstUseTip,
  startTip,
  tipStepsFor,
} from "../../src/ui/firstUseTips";

const names = { use: "Left click", menu: "Right click / F", hand: "0" };

describe("first-use tips", () => {
  it("has steps for every belt tool and none for the Hand", () => {
    for (const toolId of Object.keys(firstUseTips)) {
      expect(tipStepsFor(toolId).length, toolId).toBeGreaterThan(0);
    }
    expect(tipStepsFor("none")).toEqual([]);
    expect(startTip("none")).toBeUndefined();
  });

  it("starts the laser tip at placing a laser and moves on only for that step's event", () => {
    const start = startTip("geodesicEmitters/emitter");
    expect(start).toEqual({ toolId: "geodesicEmitters/emitter", stepIndex: 0 });
    expect(currentTipStep(start!)?.advanceOn).toBe("laser-placed");

    expect(advanceTipOnEvent(start!, "sign-placed")).toBe(start);
    expect(advanceTipOnEvent(start!, "beam-extended")).toBe(start);

    const second = advanceTipOnEvent(start!, "laser-placed");
    expect(second?.stepIndex).toBe(1);
    expect(renderTipText(currentTipStep(second!)!, names)).toBe("Aim at the beam and use Left click to make it longer");
  });

  it("ends the tip after the last step, by Next or by its event", () => {
    const sign = startTip("placedFlags/flag")!;
    const last = nextTipStep(sign)!;
    expect(isLastTipStep(sign)).toBe(false);
    expect(isLastTipStep(last)).toBe(true);
    expect(nextTipStep(last)).toBeUndefined();
    expect(advanceTipOnEvent(sign, "sign-placed")).toEqual(last);
    expect(advanceTipOnEvent(last, "sign-placed")).toBe(last);
  });

  it("fills every placeholder with the name of the control of the device", () => {
    for (const toolId of Object.keys(firstUseTips)) {
      for (const step of tipStepsFor(toolId)) {
        const text = renderTipText(step, names);
        expect(text, toolId).not.toMatch(/[{}]/);
      }
    }
    const menuStep = tipStepsFor("geodesicEmitters/emitter")[2]!;
    expect(renderTipText(menuStep, { ...names, menu: "Grip" })).toContain("use Grip for its menu");
  });

  it("shows a tip once: the seen set remembers the tool, and survives its stored form", () => {
    let seen = parseSeenTips(null);
    expect(shouldShowFirstUseTip(seen, "worldMap/map")).toBe(true);
    seen = markTipSeen(seen, "worldMap/map");
    expect(shouldShowFirstUseTip(seen, "worldMap/map")).toBe(false);
    expect(shouldShowFirstUseTip(seen, "placedFlags/flag")).toBe(true);
    expect(shouldShowFirstUseTip(seen, "none")).toBe(false);

    expect([...parseSeenTips(serializeSeenTips(seen))]).toEqual(["worldMap/map"]);
    expect([...parseSeenTips("not json")]).toEqual([]);
    expect([...parseSeenTips('{"a":1}')]).toEqual([]);
    expect([...parseSeenTips('["a", 3, "b"]')]).toEqual(["a", "b"]);
  });
});
