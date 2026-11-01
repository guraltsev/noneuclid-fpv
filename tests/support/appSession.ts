/**
 * Shared test fake: a shell session with quiet defaults, so a test that exercises one factory sets only the fields that factory reads.
 */
import { defaultAppConfig } from "../../src/glue/appConfig";
import { defaultVrComfortOptions } from "../../src/glue/vrComfortOptions";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createAppSession, initialObjectIdSerials, type AppSession, type AppSessionState } from "../../src/runtime/appSession";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";

/** A session in a closed menu on the main page, debug off, the player in "room-a", and idle tools; `overrides` replace whole fields. */
export function createTestAppSession(overrides: Partial<AppSessionState> = {}): AppSession {
  return createAppSession({
    menuState: createRuntimeMenuState({ selectedWorldId: "test" }),
    appConfig: defaultAppConfig,
    debugSettings: { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
    showCellPathRendersInstances: false,
    vrComfortOptions: defaultVrComfortOptions,
    playerPose: createDefaultPlayerPose("room-a"),
    cannonToolState: {},
    carry: undefined,
    protractorToolState: {},
    objectIdSerials: initialObjectIdSerials,
    ...overrides,
  });
}
