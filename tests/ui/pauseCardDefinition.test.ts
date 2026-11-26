/**
 * Tests of the pure pause card definition: the controls rows match the input-intent table, the title is the config's name or a neutral default, and the description is the first sentence of the first goal page.
 */
import { describe, expect, it } from "vitest";
import { getInputHintGlyph } from "../../src/ui/inputIntents";
import { createPauseCardDefinition, firstSentence } from "../../src/ui/pauseCardDefinition";

describe("pause card definition", () => {
  it("builds the controls rows from the input intents", () => {
    const card = createPauseCardDefinition({});
    expect(card.controls.map((row) => row.verb)).toEqual([
      "Look", "Walk", "Use", "Menu", "Switch tool", "Put tool away", "Pick up / put down", "Next target", "What's this?", "Start over", "Undo",
    ]);
    expect(card.controls[0]?.glyphLabel).toBe(getInputHintGlyph("desktop", "look").label);
    expect(card.controls[1]?.glyphLabel).toBe(getInputHintGlyph("desktop", "move").label);
    expect(card.controls[2]?.glyphLabel).toBe(getInputHintGlyph("desktop", "primary").label);
    expect(card.controls[3]?.glyphLabel).toBe(getInputHintGlyph("desktop", "context-menu").label);
    expect(card.controls[8]?.glyphLabel).toBe(getInputHintGlyph("desktop", "help").label);
    expect(card.controls[4]?.glyphLabel).toBe("1–5 · wheel");
  });

  it("lists every key with its own label, and Walk names WASD", () => {
    const labels = Object.fromEntries(createPauseCardDefinition({}).controls.map((row) => [row.verb, row.glyphLabel]));
    expect(labels).toMatchObject({
      Walk: "W A S D / arrow keys",
      "Put tool away": "0",
      "Pick up / put down": "G",
      "Next target": "Tab",
      "Start over": "Hold R",
      Undo: "U",
    });
  });

  it("leaves out pick up and put down when the Laser tool is not available", () => {
    const verbs = createPauseCardDefinition({ laserToolAvailable: false }).controls.map((row) => row.verb);
    expect(verbs).not.toContain("Pick up / put down");
    expect(verbs).toContain("Put tool away");
  });

  it("lists the four main-menu actions", () => {
    expect(createPauseCardDefinition({}).actions).toEqual(["help", "settings", "go-home", "start-over"]);
  });

  it("prefers the config's display name, else a neutral title", () => {
    expect(createPauseCardDefinition({ configDisplayName: "Activity 1" }).title).toBe("Activity 1");
    expect(createPauseCardDefinition({}).title).toBe("Explore");
  });

  it("takes the first sentence of the first goal page, and omits the line without one", () => {
    const withGoal = createPauseCardDefinition({
      goalPages: [{ title: "Goal", body: "Explore the world. Use landmarks.\n\nMore text." }],
    });
    expect(withGoal.description).toBe("Explore the world.");
    expect(createPauseCardDefinition({}).description).toBeUndefined();
    expect(createPauseCardDefinition({ goalPages: [{ title: "Goal", body: "  " }] }).description).toBeUndefined();
  });

  it("finds the first sentence of text with no full stop", () => {
    expect(firstSentence("No stop here")).toBe("No stop here");
  });
});
