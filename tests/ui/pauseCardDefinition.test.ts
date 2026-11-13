/**
 * Tests of the pure pause card definition: the controls rows match the input-intent table, the title falls back from the config's name to the world's, and the description is the first sentence of the first goal page.
 */
import { describe, expect, it } from "vitest";
import { getInputHintGlyph } from "../../src/ui/inputIntents";
import { createPauseCardDefinition, firstSentence, prettyWorldName } from "../../src/ui/pauseCardDefinition";

describe("pause card definition", () => {
  it("builds the controls rows from the input intents", () => {
    const card = createPauseCardDefinition({ worldName: "001-basic-cube" });
    expect(card.controls.map((row) => row.verb)).toEqual(["Look", "Walk", "Use", "Menu", "Switch tool", "What's this?"]);
    expect(card.controls[0]?.glyphLabel).toBe(getInputHintGlyph("desktop", "look").label);
    expect(card.controls[1]?.glyphLabel).toBe(getInputHintGlyph("desktop", "move").label);
    expect(card.controls[2]?.glyphLabel).toBe(getInputHintGlyph("desktop", "primary").label);
    expect(card.controls[3]?.glyphLabel).toBe(getInputHintGlyph("desktop", "context-menu").label);
    expect(card.controls[5]?.glyphLabel).toBe(getInputHintGlyph("desktop", "help").label);
    expect(card.controls[4]?.glyphLabel).toBe("Right click on the floor");
  });

  it("lists the four main-menu actions", () => {
    expect(createPauseCardDefinition({ worldName: "x" }).actions).toEqual(["help", "settings", "go-home", "start-over"]);
  });

  it("prefers the config's display name, else the world's name", () => {
    expect(createPauseCardDefinition({ worldName: "001-basic-cube", configDisplayName: "Activity 1" }).title).toBe("Activity 1");
    expect(createPauseCardDefinition({ worldName: "001-basic-cube" }).title).toBe("Basic cube");
    expect(prettyWorldName("torus_moduli")).toBe("Torus moduli");
  });

  it("takes the first sentence of the first goal page, and omits the line without one", () => {
    const withGoal = createPauseCardDefinition({
      worldName: "w",
      goalPages: [{ title: "Goal", body: "Explore the world. Use landmarks.\n\nMore text." }],
    });
    expect(withGoal.description).toBe("Explore the world.");
    expect(createPauseCardDefinition({ worldName: "w" }).description).toBeUndefined();
    expect(createPauseCardDefinition({ worldName: "w", goalPages: [{ title: "Goal", body: "  " }] }).description).toBeUndefined();
  });

  it("finds the first sentence of text with no full stop", () => {
    expect(firstSentence("No stop here")).toBe("No stop here");
  });
});
