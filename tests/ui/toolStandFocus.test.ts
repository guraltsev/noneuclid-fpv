/**
 * The tool stand as the player meets it (design 017 section 9.2): the registry record of a stand item is named for its tool
 * and offers "Take the <Tool>" as its main action, the focus message and the hint strip say so, the table is the "Tool
 * stand", and the item is a pickable but walk-through object. The toasts that follow taking a tool name the key on
 * desktop and the belt in VR.
 */
import { describe, expect, it } from "vitest";
import { createHintStripDefinition, formatHintStripLine } from "../../src/ui/hintStripDefinition";
import { createWorldFocusMessageDefinition } from "../../src/ui/worldInteractionDefinition";
import { toolStandText } from "../../src/ui/vocabulary";
import { createToolStandItem, createToolStandTable } from "../../src/world-objects/library";
import { createRuntimeStaticAssetObject } from "../../src/world-objects/runtimeObjectRegistry";
import type { AssetObjectSpec } from "../../src/cell-complex/specs";

function recordOf(spec: object) {
  return createRuntimeStaticAssetObject(spec as AssetObjectSpec, "room");
}

describe("tool stand records", () => {
  const laser = recordOf(createToolStandItem("toolStand-emitter", "geodesicEmitters/emitter", { position: [0, 0.6, 0] }));

  it("names an item for its tool and makes Use on it take the tool", () => {
    expect(laser.tooltip?.label).toBe("Laser");
    expect(laser.interactable).toMatchObject({ label: "Take the Laser", action: "take-tool", toolId: "geodesicEmitters/emitter" });
    expect(laser.displayHelpMessage).toBe("Places a laser that fires straight beams");
  });

  it("lets the player walk through an item, but not the table, and names the table", () => {
    const table = recordOf(createToolStandTable("toolStand", { position: [0, 0, 0] }));

    expect(laser.do_not_collide_with).toContain("user");
    expect(laser.collision).toBeDefined();
    expect(table.do_not_collide_with).toBeUndefined();
    expect(table.tooltip?.label).toBe("Tool stand");
    expect(table.interactable).toBeUndefined();
  });

  it("offers Take the Laser as the focus action and as the hint strip's click", () => {
    const definition = createWorldFocusMessageDefinition({ object: laser, selectedTool: "none" });

    expect(definition?.title).toBe("Laser");
    expect(definition?.actions).toMatchObject([{ id: "take-tool", intent: "primary", label: "Take the Laser" }]);
    const line = formatHintStripLine(createHintStripDefinition({
      inputMode: "desktop",
      selectedTool: "none",
      carrying: false,
      menuOpen: false,
      focus: { objectKind: "asset", actions: definition!.actions },
    }));
    expect(line).toBe("Left click: take the Laser");
  });

  it("says which key takes the tool next time, or that it is on the belt in VR", () => {
    expect(toolStandText.nextTimeKey("Laser", "1")).toBe("Laser · press 1 next time");
    expect(toolStandText.nextTimeBelt("Laser")).toBe("Laser · it is on your belt");
  });

  it("refuses an item for a tool that has none", () => {
    expect(() => createToolStandItem("x", "geodesicModel/tie" as never, { position: [0, 0, 0] })).toThrow(/no tool stand item/);
  });
});
