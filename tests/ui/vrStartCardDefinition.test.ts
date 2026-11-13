/**
 * The VR start card definition (src/ui/vrStartCardDefinition.ts, design 017 section 8.1): the controllers of the
 * current layout with the verb on each button, generated from the input-intent table, so one controller lists the
 * stick press and the upper-face hold while two controllers list a pointer hand and a belt hand.
 */
import { describe, expect, it } from "vitest";
import { createVrStartCardDefinition, vrStartCardLines } from "../../src/ui/vrStartCardDefinition";

describe("VR start card", () => {
  it("lists the pointer hand and the belt hand with two controllers", () => {
    const lines = vrStartCardLines(createVrStartCardDefinition("two-controllers"));

    expect(lines).toContain("Pointer hand");
    expect(lines).toContain("Trigger: Use");
    expect(lines).toContain("Grip: Menu");
    expect(lines).toContain("A: Pick up");
    expect(lines).toContain("B: What's this?");
    expect(lines).toContain("Belt hand");
    expect(lines).toContain("Left trigger: Switch tool");
    expect(lines).toContain("X: Main menu");
    expect(lines.at(-1)).toBe("Pull the trigger to start");
  });

  it("swaps the letters and the belt side when left-handed", () => {
    const lines = vrStartCardLines(createVrStartCardDefinition("two-controllers", true));

    expect(lines).toContain("X: Pick up");
    expect(lines).toContain("Y: What's this?");
    expect(lines).toContain("A: Main menu");
    expect(lines).toContain("Right trigger: Switch tool");
  });

  it("names one controller by its letters, with the stick press and the hold", () => {
    const right = vrStartCardLines(createVrStartCardDefinition("one-right"));
    const left = vrStartCardLines(createVrStartCardDefinition("one-left"));

    expect(right).toContain("Your controller");
    expect(right).toContain("A: Pick up");
    expect(right).toContain("Hold B: Main menu");
    expect(right).toContain("Stick press: Switch tool");
    expect(left).toContain("X: Pick up");
    expect(left).toContain("Y: What's this?");
    expect(left).toContain("Hold Y: Main menu");
  });
});
