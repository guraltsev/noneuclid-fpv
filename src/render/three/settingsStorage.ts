/**
 * What Settings and Help remember between visits (design 017 sections 8.6 and 8.7): the text size, the mouse sensitivity, the turn speed, Invert Y and the How to cards that were opened.
 * Role: the shell reads the stored values once, at construction, to seed the menu state, and calls the saver every frame with the current menu state; the saver writes only what changed. Storage can throw (private windows, blocked site data) or be absent; then nothing is remembered and the defaults hold.
 * Also holds the numbers behind the steps: the factors that the sensitivity and turn speed steps give the look controls, and the document font scale of each text size.
 */
import type { RuntimeMenuState, RuntimeMouseSensitivity, RuntimeTextSize, RuntimeTurnSpeed } from "../../runtime/runtimeMenuState";

/** The part of `Storage` the module uses, so tests can pass a plain object. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The remembered values; a field is absent when nothing valid was stored. */
export interface StoredSettings {
  readonly textSize?: RuntimeTextSize;
  readonly mouseSensitivity?: RuntimeMouseSensitivity;
  readonly turnSpeed?: RuntimeTurnSpeed;
  readonly invertYEnabled?: boolean;
  readonly helpCardsRead?: readonly string[];
}

const keys = {
  textSize: "noneuclid.textSize",
  mouseSensitivity: "noneuclid.mouseSensitivity",
  turnSpeed: "noneuclid.turnSpeed",
  invertY: "noneuclid.invertY",
  helpCardsRead: "noneuclid.helpCardsRead",
} as const;

const textSizes: readonly RuntimeTextSize[] = ["small", "medium", "large"];
const mouseSensitivities: readonly RuntimeMouseSensitivity[] = ["low", "medium", "high"];
const turnSpeeds: readonly RuntimeTurnSpeed[] = ["slow", "medium", "fast"];

function oneOf<T extends string>(allowed: readonly T[], raw: string | null): T | undefined {
  return allowed.find((candidate) => candidate === raw);
}

/** Reads the remembered values; anything missing, invalid or unreadable is left out. */
export function loadStoredSettings(storage: SettingsStorage | undefined): StoredSettings {
  if (storage === undefined) return {};
  try {
    const textSize = oneOf(textSizes, storage.getItem(keys.textSize));
    const mouseSensitivity = oneOf(mouseSensitivities, storage.getItem(keys.mouseSensitivity));
    const turnSpeed = oneOf(turnSpeeds, storage.getItem(keys.turnSpeed));
    const invertY = storage.getItem(keys.invertY);
    let helpCardsRead: readonly string[] | undefined;
    const rawRead = storage.getItem(keys.helpCardsRead);
    if (rawRead !== null) {
      const parsed: unknown = JSON.parse(rawRead);
      if (Array.isArray(parsed)) helpCardsRead = parsed.filter((entry): entry is string => typeof entry === "string");
    }
    return {
      ...(textSize !== undefined ? { textSize } : {}),
      ...(mouseSensitivity !== undefined ? { mouseSensitivity } : {}),
      ...(turnSpeed !== undefined ? { turnSpeed } : {}),
      ...(invertY === "true" ? { invertYEnabled: true } : {}),
      ...(helpCardsRead !== undefined ? { helpCardsRead } : {}),
    };
  } catch {
    return {};
  }
}

/** The values of a menu state in the form they are stored: the defaults are written as medium, off and none. */
function storedFormOf(menu: RuntimeMenuState): Readonly<Record<keyof typeof keys, string>> {
  return {
    textSize: menu.textSize ?? "medium",
    mouseSensitivity: menu.mouseSensitivity ?? "medium",
    turnSpeed: menu.turnSpeed ?? "medium",
    invertY: String(menu.invertYEnabled === true),
    helpCardsRead: JSON.stringify(menu.helpCardsRead ?? []),
  };
}

/**
 * Creates the saver: `save(menu)` writes the values that differ from what it last saw (the first call compares with `initialMenu`, the state the stored values seeded). Failures to write are ignored.
 */
export function createSettingsSaver(storage: SettingsStorage | undefined, initialMenu: RuntimeMenuState): (menu: RuntimeMenuState) => void {
  let last = storedFormOf(initialMenu);
  return (menu) => {
    const next = storedFormOf(menu);
    for (const name of Object.keys(keys) as (keyof typeof keys)[]) {
      if (next[name] === last[name]) continue;
      try {
        storage?.setItem(keys[name], next[name]);
      } catch {
        // Storage is only a convenience.
      }
    }
    last = next;
  };
}

/** The factor each mouse sensitivity step gives the mouse look gain. */
export const mouseSensitivityFactors: Readonly<Record<RuntimeMouseSensitivity, number>> = { low: 0.5, medium: 1, high: 2 };

/** The factor each turn speed step gives the keyboard turn rate. */
export const turnSpeedFactors: Readonly<Record<RuntimeTurnSpeed, number>> = { slow: 0.6, medium: 1, fast: 1.6 };

/** The factor of the root font size of the page (the heads-up display is sized in rem) for each text size. */
export const textSizeRootFactors: Readonly<Record<RuntimeTextSize, number>> = { small: 0.875, medium: 1, large: 1.25 };
