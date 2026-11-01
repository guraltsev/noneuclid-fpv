/**
 * The shell-side session: the one record that holds the mutable state of a running world, and the cell that owns it.
 * State is a plain immutable record that is replaced by a new value through update(fn); there are no events, no subscriptions and no framework.
 * The reducer applyRuntimeCommand (applyRuntimeCommand.ts) is the only code that changes it; the rendering shell and its factories read the record on demand.
 * Every field of AppSessionState carries a one-line comment saying whether it is real state, cheap derived or expensive derived (design 012, P7 commitment 3).
 */
import type { AppConfig } from "../glue/appConfig";
import type { DebugSettings } from "../glue/debugSettings";
import type { VrComfortOptions } from "../glue/vrComfortOptions";
import type { PlayerPose } from "../movement/playerPose";
import type { GeodesicCannonToolState } from "../world-objects/geodesic/cannonToolState";
import type { ProtractorToolState } from "../world-objects/protractorTool";
import type { RuntimeMenuState } from "./runtimeMenuState";

/** Families of runtime objects whose ids carry a serial number from the session. */
export type ObjectIdFamily = "placed-flag" | "measured-geodesic-length" | "protractor-angle" | "geodesic-cannon" | "geodesic";

/**
 * Mutable state of one running world, as one plain record. Replace it, never edit it in place.
 */
export interface AppSessionState {
  /** Real state: menu page, selected tool, debug toggles and sign/help payloads. */
  readonly menuState: RuntimeMenuState;
  /** Real state, fixed for the run: which menu sections and tools the app configuration enables; commands for a disabled section are ignored. */
  readonly appConfig: AppConfig;
  /** Real state: the debug settings in force; follows the menu's debug fields (cheap derived) except when the host sets them from outside. */
  readonly debugSettings: DebugSettings;
  /** Real state: the VR comfort options in force; the anti-nausea flag follows the menu. */
  readonly vrComfortOptions: VrComfortOptions;
  /** Real state: the player's cell and cell-local pose. */
  readonly playerPose: PlayerPose;
  /** Real state: which cannon and geodesic the emitter tools work on and the tie-and-detach picks; empty when idle. */
  readonly cannonToolState: GeodesicCannonToolState;
  /** Real state: the protractor tool's picks; empty when idle. */
  readonly protractorToolState: ProtractorToolState;
  /** Real state: next serial number per object id family; only ever increases. */
  readonly objectIdSerials: Readonly<Record<ObjectIdFamily, number>>;
}

/**
 * Owner of the current AppSessionState.
 */
export interface AppSession {
  /** Returns the current state record; the same object until the next update. */
  get(): AppSessionState;
  /** Replaces the state by fn(current). A function returning its argument leaves the record (and its identity) unchanged. */
  update(fn: (state: AppSessionState) => AppSessionState): void;
}

/**
 * Creates a session holding `initial`.
 */
export function createAppSession(initial: AppSessionState): AppSession {
  let state = initial;

  return {
    get() {
      return state;
    },
    update(fn) {
      state = fn(state);
    },
  };
}

/** Serial numbers all start at zero. */
export const initialObjectIdSerials: Readonly<Record<ObjectIdFamily, number>> = {
  "placed-flag": 0,
  "measured-geodesic-length": 0,
  "protractor-angle": 0,
  "geodesic-cannon": 0,
  geodesic: 0,
};

/**
 * Returns the next unused serial number of an object id family and advances the counter; the caller formats the id.
 */
export function takeObjectIdSerial(session: AppSession, family: ObjectIdFamily): number {
  const serial = session.get().objectIdSerials[family];
  session.update((state) => ({
    ...state,
    objectIdSerials: { ...state.objectIdSerials, [family]: serial + 1 },
  }));
  return serial;
}
