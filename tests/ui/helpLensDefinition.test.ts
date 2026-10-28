import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "../../src/glue/assetUrls";
import { createHelpLensDefinition } from "../../src/ui/helpLensDefinition";

describe("helpLensDefinition", () => {
  it("creates concise object-aware help from focus metadata", () => {
    const help = createHelpLensDefinition({
      inputMode: "desktop",
      selectedTool: "none",
      focus: {
        title: "Sign",
        helpTopicId: "sign",
        actions: [{ id: "edit-sign", label: "Edit", intent: "context-menu", available: true }],
      },
    });

    expect(help.title).toBe("Sign");
    expect(help.body).toBe("A placed note in the world. Right click its menu to edit text or delete it.");
    expect(help.rows).toEqual([{
      hint: {
        intent: "context-menu",
        mode: "desktop",
        label: "Right click",
        iconSrc: publicAssetUrl("icons/mouse-button-right.svg"),
      },
      label: "Edit",
    }]);
  });

  it("creates selected-tool help when no object is focused", () => {
    const help = createHelpLensDefinition({
      inputMode: "xr",
      selectedTool: "measure-length",
    });

    expect(help.title).toBe("Length tool");
    expect(help.rows).toMatchObject([
      { hint: { label: "Trigger" }, label: "choose geodesic" },
      { hint: { label: "Side trigger" }, label: "open choices" },
    ]);
  });

  it("formats explicit object help for desktop controls", () => {
    const help = createHelpLensDefinition({
      inputMode: "desktop",
      selectedTool: "none",
      focus: {
        title: "Help hub",
        displayHelpMessage: "Move with Arrow keys or the left stick. Look at nearby objects for prompts. Use primary action or trigger for the selected action. Use context action or side trigger for tools and object menus. Press H or B while aiming at an object for its help.",
        actions: [],
      },
    });

    expect(help.body).toBe("Move with Arrow keys. Look at nearby objects for prompts. Left click uses the selected/default action. Right click opens tools and object menus. Press H while aiming at an object for its help.");
    expect(help.rows).toEqual([]);
  });

  it("formats explicit object help for VR controls", () => {
    const help = createHelpLensDefinition({
      inputMode: "xr",
      selectedTool: "none",
      focus: {
        title: "Help hub",
        displayHelpMessage: "Move with Arrow keys or the left stick. Look at nearby objects for prompts. Use primary action or trigger for the selected action. Use context action or side trigger for tools and object menus. Press H or B while aiming at an object for its help.",
        actions: [],
      },
    });

    expect(help.body).toBe("Move with the left stick. Look at nearby objects for prompts. Trigger uses the selected/default action. Side trigger opens tools and object menus. Press B while aiming at an object for its help.");
    expect(help.rows).toEqual([]);
  });

  it("shows movement with the environment-specific explore help", () => {
    const help = createHelpLensDefinition({
      inputMode: "desktop",
      selectedTool: "none",
    });

    expect(help.rows[0]).toMatchObject({
      hint: {
        intent: "move",
        mode: "desktop",
        label: "Arrow keys",
        iconSrc: publicAssetUrl("icons/arrowkeys.svg"),
      },
      label: "move",
    });
  });
});
