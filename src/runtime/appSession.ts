/**
 * The shell-side session: the one record that holds the mutable state of a running world, and the cell that owns it.
 * State is a plain immutable record that is replaced by a new value through update(fn); there are no events, no subscriptions and no framework.
 * The reducer applyRuntimeCommand (applyRuntimeCommand.ts) is the only code that changes menu state; the rendering shell reads the record on demand.
 * Every field of AppSessionState carries a one-line comment saying whether it is real state, cheap derived or expensive derived (design 012, P7 commitment 3).
 */
import type { AppConfig } from "../glue/appConfig";
import type { RuntimeMenuState } from "./runtimeMenuState";

/**
 * Mutable state of one running world, as one plain record. Replace it, never edit it in place.
 */
export interface AppSessionState {
  /** Real state: menu page, selected tool, debug toggles and sign/help payloads; the debug fields are the source of the shell's debug settings. */
  readonly menuState: RuntimeMenuState;
  /** Real state, fixed for the run: which menu sections and tools the app configuration enables; commands for a disabled section are ignored. */
  readonly appConfig: AppConfig;
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
