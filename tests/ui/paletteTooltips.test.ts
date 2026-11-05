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
    expect(resolvePaletteTooltipLabel("go-home")).toBe("Home");
    expect(resolvePaletteTooltipLabel("reload-world")).toBe("Reload");
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:add-geodesic")).toBe("Add geodesic");
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:carry")).toBe("Move emitter while maintaining attached geodesics");
    // The tie action comes from the tie tool's descriptor, and its button carries its own tooltip, so the table has no entry for it.
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:tie-and-detach")).toBeUndefined();
    expect(resolvePaletteTooltipLabel("geodesic-cannon-action:delete:g-a")).toBe("Delete geodesic");
    expect(resolvePaletteTooltipLabel("question-help:tutorial")).toBe("Tutorial");
    expect(resolvePaletteTooltipLabel("question-help:goal")).toBe("Goal");
    expect(resolvePaletteTooltipLabel("goal:next")).toBe("Next page");
    expect(resolvePaletteTooltipLabel("sign-action:trash")).toBe("Delete sign");
  });

  it("names tool tiles and sign controls", () => {
    expect(resolvePaletteTooltipLabel("tool:measure-length")).toBe("Measure length");
    expect(resolvePaletteTooltipLabel("tool:protractor")).toBe("Measure angle");
    expect(resolvePaletteTooltipLabel("tool:geodesic-cannon")).toBe("Create and terminate straight lines");
    expect(resolvePaletteTooltipLabel("tool-options:place-sign")).toBe("Sign options");
    expect(resolvePaletteTooltipLabel("sign-type:WoodenSign1")).toBe("Choose sign type");
  });
});
