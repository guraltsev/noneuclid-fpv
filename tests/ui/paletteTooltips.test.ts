/**
 * `tests/ui/paletteTooltips.test.ts` — unit tier.
 *
 * `resolvePaletteTooltipLabel` names a palette control's tooltip from its control id, including ids that carry
 * extra data (a geodesic cannon action, a specific geodesic id, a sign type). These tests check the label for
 * every control class: global actions, geodesic-cannon actions, question-help and goal paging, sign actions, tool
 * tiles, and tool options.
 */
import { describe, expect, it } from "vitest";
import { resolvePaletteTooltipLabel } from "../../src/ui/paletteTooltips";

describe("paletteTooltips", () => {
  it("names global and object palette controls concisely", () => {
    expect(resolvePaletteTooltipLabel("go-home")).toBe("Go home");
    expect(resolvePaletteTooltipLabel("reload-world")).toBe("Start over");
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:add-geodesic")).toBe("Fire one more beam from this laser");
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:carry")).toBe("Pick up the laser: linked beams stay attached, free ones are removed");
    // The tie action comes from the tie tool's descriptor, and its button carries its own tooltip, so the table has no entry for it.
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:tie-and-detach")).toBeUndefined();
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:delete:g-a")).toBe("Delete beam");
    expect(resolvePaletteTooltipLabel("question-help:tutorial")).toBe("How to");
    expect(resolvePaletteTooltipLabel("question-help:goal")).toBe("Things to try");
    expect(resolvePaletteTooltipLabel("goal:next")).toBe("Next page");
    expect(resolvePaletteTooltipLabel("sign-action:trash")).toBe("Delete sign");
  });

  it("names tool tiles and sign controls", () => {
    expect(resolvePaletteTooltipLabel("tool:geodesicMeasurements/length")).toBe("Ruler: Measures a beam end to end");
    expect(resolvePaletteTooltipLabel("tool:geodesicMeasurements/protractor")).toBe("Protractor: Measures the angle between two beams");
    expect(resolvePaletteTooltipLabel("tool:geodesicEmitters/emitter")).toBe("Laser: Places a laser that fires straight beams");
    expect(resolvePaletteTooltipLabel("tool-options:place-sign")).toBe("Sign options");
    expect(resolvePaletteTooltipLabel("sign-type:WoodenSign1")).toBe("Choose sign type");
  });

  it("names the main menu buttons", () => {
    expect(resolvePaletteTooltipLabel("main-menu:help")).toBe("Help");
    expect(resolvePaletteTooltipLabel("main-menu:go-home")).toBe("Go home");
    expect(resolvePaletteTooltipLabel("main-menu:nothing")).toBeUndefined();
  });
});
