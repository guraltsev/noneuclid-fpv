/**
 * Shared test fake: a client session with quiet defaults, so a test that exercises one factory sets only the fields that factory reads.
 */
import { defaultAppConfig } from "../../src/glue/appConfig";
import { defaultVrComfortOptions } from "../../src/glue/vrComfortOptions";
import { createClientSession, type ClientSession, type ClientSessionState } from "../../src/runtime/clientSession";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";

/** A session in a closed menu on the main page, debug off, and idle tools; `overrides` replace whole fields. */
export function createTestClientSession(overrides: Partial<ClientSessionState> = {}): ClientSession {
  return createClientSession({
    menuState: createRuntimeMenuState({ selectedWorldId: "test" }),
    appConfig: defaultAppConfig,
    debugSettings: { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
    showCellPathRendersInstances: false,
    vrComfortOptions: defaultVrComfortOptions,
    cannonToolState: {},
    protractorToolState: {},
    moduleToolState: {},
    pendingToolRequest: undefined,
    ...overrides,
  });
}
