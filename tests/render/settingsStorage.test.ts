/**
 * `tests/render/settingsStorage.test.ts` - unit tier.
 *
 * What Settings and Help remember (src/render/three/settingsStorage.ts): the stored text size, look steps, Invert Y and opened How to cards are read back into the menu state and nothing invalid gets through; the saver writes only what changed; storage that throws or is missing loses nothing but the memory; and the steps map to growing factors.
 */
import { describe, expect, it } from "vitest";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import {
  createSettingsSaver,
  loadStoredSettings,
  mouseSensitivityFactors,
  textSizeRootFactors,
  turnSpeedFactors,
  type SettingsStorage,
} from "../../src/render/three/settingsStorage";

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { readonly values: Map<string, string>; readonly writes: string[] } {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}

describe("settings storage", () => {
  it("reads valid values and ignores invalid ones", () => {
    const storage = memoryStorage({
      "noneuclid.textSize": "large",
      "noneuclid.mouseSensitivity": "enormous",
      "noneuclid.turnSpeed": "fast",
      "noneuclid.invertY": "true",
      "noneuclid.helpCardsRead": '["Basics", 3, "Laser"]',
    });

    expect(loadStoredSettings(storage)).toEqual({ textSize: "large", turnSpeed: "fast", invertYEnabled: true, helpCardsRead: ["Basics", "Laser"] });
    expect(loadStoredSettings(undefined)).toEqual({});
    expect(loadStoredSettings(memoryStorage({ "noneuclid.helpCardsRead": "{" }))).toEqual({});
  });

  it("writes only the values that changed", () => {
    const storage = memoryStorage();
    const initial = createRuntimeMenuState({ selectedWorldId: "cube" });
    const save = createSettingsSaver(storage, initial);

    save(initial);
    expect(storage.writes).toEqual([]);

    save({ ...initial, textSize: "small", helpCardsRead: ["Basics"] });
    expect(storage.writes.sort()).toEqual(["noneuclid.helpCardsRead", "noneuclid.textSize"]);
    expect(storage.values.get("noneuclid.textSize")).toBe("small");

    save({ ...initial, textSize: "small", helpCardsRead: ["Basics"] });
    expect(storage.writes).toHaveLength(2);
  });

  it("survives storage that throws", () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const initial = createRuntimeMenuState({ selectedWorldId: "cube" });

    expect(loadStoredSettings(broken)).toEqual({});
    expect(() => createSettingsSaver(broken, initial)({ ...initial, textSize: "large" })).not.toThrow();
  });

  it("gives the steps growing factors with medium as the unchanged default", () => {
    expect(mouseSensitivityFactors.medium).toBe(1);
    expect(mouseSensitivityFactors.low).toBeLessThan(1);
    expect(mouseSensitivityFactors.high).toBeGreaterThan(1);
    expect(turnSpeedFactors.slow).toBeLessThan(turnSpeedFactors.medium);
    expect(turnSpeedFactors.fast).toBeGreaterThan(turnSpeedFactors.medium);
    expect(textSizeRootFactors.small).toBeLessThan(textSizeRootFactors.medium);
    expect(textSizeRootFactors.large).toBeGreaterThan(textSizeRootFactors.medium);
  });
});
