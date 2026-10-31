/**
 * `tests/ui/inputModeText.test.ts` — unit tier.
 *
 * `formatBodyForInputMode` rewrites a handful of known sentence patterns in authored help text (movement, the
 * help key, the primary-action phrasing) to the words of the current input mode (desktop or XR), leaving every
 * other sentence untouched. These tests check each known pattern for both modes and that unknown text passes
 * through unchanged.
 */
import { describe, expect, it } from "vitest";
import { formatBodyForInputMode } from "../../src/ui/inputModeText";

describe("formatBodyForInputMode", () => {
  const body = "Move with Arrow keys or the left stick. Press H or B while aiming at an object for its help. Other text.";

  it("rewrites known sentences for desktop", () => {
    expect(formatBodyForInputMode(body, "desktop")).toBe(
      "Move with Arrow keys. Press H while aiming at an object for its help. Other text.",
    );
  });

  it("rewrites known sentences for xr", () => {
    expect(formatBodyForInputMode(body, "xr")).toBe(
      "Move with the left stick. Press B while aiming at an object for its help. Other text.",
    );
  });

  it("handles both primary-action variants and passes unknown text through", () => {
    expect(formatBodyForInputMode("Use primary action or trigger for the selected/default action.", "xr")).toBe(
      "Trigger uses the selected/default action.",
    );
    expect(formatBodyForInputMode("Use primary action or trigger for the selected action.", "desktop")).toBe(
      "Left click uses the selected/default action.",
    );
    expect(formatBodyForInputMode("Nothing here.", "desktop")).toBe("Nothing here.");
  });
});
