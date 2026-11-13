/**
 * `tests/ui/shapeMachinePanel.test.ts` - unit tier.
 *
 * The shape machine page of the palette definition: Shift and Height in meters to one decimal, one-meter steps that stop at the ends of their range, generic presets measured from the starting torus, the "Same world as the start" badge,
 * the number pad while a value is typed, and the Reshape world button with its reason.
 */
import { describe, expect, it } from "vitest";
import type { GeometryComputerActionsPaletteContent } from "../../src/ui/paletteDefinition";
import { createRuntimeMenuState, showRuntimeMenuGeometryComputerActions } from "../../src/runtime/runtimeMenuState";
import { createTestPaletteDefinition } from "../support/tools";

/** The shape machine page for a 15 m wide torus that started at (0, 15), with the given current and target and extra payload fields. */
function page(
  target: { readonly a: number; readonly b: number },
  extra: Partial<Parameters<typeof showRuntimeMenuGeometryComputerActions>[1]> = {},
  start: { readonly a: number; readonly b: number } = { a: 0, b: 15 },
): GeometryComputerActionsPaletteContent {
  const definition = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
    createRuntimeMenuState({ selectedWorldId: "torus" }),
    {
      computerId: "gc",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: start.a,
      currentDepthMeters: start.b,
      targetSkewXMeters: target.a,
      targetDepthMeters: target.b,
      startSkewXMeters: start.a,
      startDepthMeters: start.b,
      ...extra,
    },
  ));
  return definition.content as GeometryComputerActionsPaletteContent;
}

describe("shape machine panel definition", () => {
  it("names the two parameters Shift and Height with their values to one decimal", () => {
    const content = page({ a: 3, b: 20 });
    expect(content.parameters).toEqual([
      { axis: "a", name: "Shift", valueMeters: 3, valueLabel: "3.0 m", disabled: false },
      { axis: "b", name: "Height", valueMeters: 20, valueLabel: "20.0 m", disabled: false },
    ]);
  });

  it("offers only one-meter steps, and stops them at the ends of their range", () => {
    const middle = page({ a: 3, b: 20 });
    expect(middle.stepActions.map((action) => action.deltaMeters)).toEqual([-1, 1, -1, 1]);
    expect(middle.stepActions.every((action) => !action.disabled)).toBe(true);

    const corner = page({ a: 0, b: 30 });
    const byId = (axis: string, delta: number) => corner.stepActions.find((action) => action.axis === axis && action.deltaMeters === delta);
    expect(byId("a", -1)).toMatchObject({ disabled: true, disabledReason: "At the limit" });
    expect(byId("b", 1)).toMatchObject({ disabled: true, disabledReason: "At the limit" });
    expect(byId("a", 1)?.disabled).toBe(false);
    expect(byId("b", -1)?.disabled).toBe(false);
  });

  it("builds the four presets from the starting torus", () => {
    const targets = (content: GeometryComputerActionsPaletteContent) => Object.fromEntries(content.presets.map((preset) => [preset.id, [preset.aMeters, preset.bMeters]]));
    expect(page({ a: 5, b: 20 }).presets.map((preset) => preset.label)).toEqual(["Square", "Shift by half", "Shift by a whole width", "Tall"]);
    expect(targets(page({ a: 5, b: 20 }))).toEqual({
      square: [0, 15],
      "half-shift": [8, 15],
      "whole-shift": [15, 15],
      tall: [0, 30],
    });
    // From a start at the top of the shift range the shifts go back instead of out of range.
    expect(targets(page({ a: 5, b: 20 }, {}, { a: 25, b: 10 }))).toMatchObject({
      "half-shift": [17, 10],
      "whole-shift": [10, 10],
      tall: [25, 20],
    });
  });

  it("shows the badge while the target is the same flat torus as the start", () => {
    expect(page({ a: 0, b: 15 }).sameAsStart).toBe(true);
    expect(page({ a: 15, b: 15 }).sameAsStart).toBe(true);
    expect(page({ a: 15, b: 15 }).sameAsStartLabel).toBe("Same world as the start");
    expect(page({ a: 3, b: 15 }).sameAsStart).toBe(false);
    expect(page({ a: 0, b: 20 }).sameAsStart).toBe(false);
  });

  it("reshapes only when the target differs from the current shape, and says why not", () => {
    expect(page({ a: 0, b: 15 }).goAction).toEqual({ label: "Reshape world", disabled: true, disabledReason: "Nothing to change" });
    expect(page({ a: 15, b: 15 }).goAction).toEqual({ label: "Reshape world", disabled: false });
  });

  it("shows the number pad only while a value is being typed", () => {
    expect(page({ a: 3, b: 20 }).entry).toBeUndefined();
    const typing = page({ a: 3, b: 20 }, { entryAxis: "b", entryText: "12" });
    expect(typing.entry).toMatchObject({ axis: "b", name: "Height", text: "12", maxLength: 2 });
    expect(typing.entry?.prompt).toContain("Height");
  });

  it("keeps the modulus lines for the More row and folds it by default", () => {
    const folded = page({ a: 3, b: 20 });
    expect(folded.moreOpen).toBe(false);
    expect(folded.moreLines[0]).toBe("Width 15.0 m, fixed");
    expect(folded.moreLines[1]).toContain("modulus");
    expect(folded.moreLines[2]).toContain("Target");
    expect(page({ a: 3, b: 20 }, { moreOpen: true }).moreOpen).toBe(true);
  });

  it("is off outside the torus world, with one shared reason", () => {
    const off = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { computerId: "gc", available: false },
    )).content as GeometryComputerActionsPaletteContent;
    expect(off.sameAsStart).toBe(false);
    expect(off.moreLines).toEqual([]);
    for (const control of [...off.parameters, ...off.stepActions, ...off.presets, off.goAction]) {
      expect(control).toMatchObject({ disabled: true, disabledReason: "The shape machine only works in the torus world" });
    }
  });
});
