/**
 * The client session: the one record that holds how one person is interacting with a running world (menu, selected tool, tool picks, debug and comfort settings), and the cell that owns it.
 * World state is not here: the player's body, the object ids and the world's objects belong to the world engine (src/engine, design 013 section 4). The session is never replayed or sent anywhere.
 * State is a plain immutable record that is replaced by a new value through update(fn); there are no events, no subscriptions and no framework.
 * The reducer applyRuntimeCommand (applyRuntimeCommand.ts) is the only code that changes it; the rendering shell and its factories read the record on demand.
 * Every field of ClientSessionState carries a one-line comment saying whether it is real state, cheap derived or expensive derived (design 012, P7 commitment 3).
 */
import type { AppConfig } from "../glue/appConfig";
import type { DebugSettings } from "../glue/debugSettings";
import type { RuntimeToolId } from "../glue/toolIds";
import type { VrComfortOptions } from "../glue/vrComfortOptions";
import type { GeodesicCannonToolState } from "../world-objects/geodesic/cannonToolState";
import type { ProtractorToolState } from "../world-objects/protractorTool";
import type { RuntimeMenuState } from "./runtimeMenuState";

/**
 * Who is being carried, and whether the object has reached the hand yet. Where the hand holds the object is derived each frame from the
 * carrier's aim. One record means one carrier; the carry contract (world-objects/carry.ts) itself keeps no such table. It moves to the world as an attachment in job 50.
 */
export interface CarryRecord {
  readonly objectId: string;
  /** False while the object still glides to the hand after the pickup (the hand's loose leash applies); true from the first frame it is at the hand (the tight leash applies). */
  readonly arrived: boolean;
}

/**
 * A request to switch to a tool that the world has not answered yet (design 013 section 8.1): the old tool stays active until `world/requestTool` is accepted.
 */
export interface PendingToolRequest {
  readonly toolId: RuntimeToolId;
  /** The engine ticket of the `world/requestTool` command. */
  readonly ticket: number;
}

/**
 * Mutable state of one client of a running world, as one plain record. Replace it, never edit it in place.
 */
export interface ClientSessionState {
  /** Real state: menu page, selected tool, debug toggles and sign/help payloads. */
  readonly menuState: RuntimeMenuState;
  /** Real state, fixed for the run: which menu sections and tools the app configuration enables; commands for a disabled section are ignored. */
  readonly appConfig: AppConfig;
  /** Real state: the debug settings in force; follows the menu's debug fields (cheap derived) except when the host sets them from outside. */
  readonly debugSettings: DebugSettings;
  /** Real state: the portal-path overlay's instance switch; set from the debug options whenever they change, and flipped by the portal debug helper. */
  readonly showCellPathRendersInstances: boolean;
  /** Real state: the VR comfort options in force; the anti-nausea flag follows the menu. */
  readonly vrComfortOptions: VrComfortOptions;
  /** Real state: which cannon and geodesic the emitter tools work on and the tie-and-detach picks; empty when idle. */
  readonly cannonToolState: GeodesicCannonToolState;
  /** Real state: the object the carry tool holds, or undefined; it exists only while the carry tool is the selected tool. */
  readonly carry: CarryRecord | undefined;
  /** Real state: the protractor tool's picks; empty when idle. */
  readonly protractorToolState: ProtractorToolState;
  /** Real state: the client tool state of each module's tools, by module id; absent while that module's tool is idle. */
  readonly moduleToolState: Readonly<Record<string, unknown>>;
  /** Real state: the tool the person asked for that the world has not confirmed yet, or undefined. */
  readonly pendingToolRequest: PendingToolRequest | undefined;
}

/**
 * Owner of the current ClientSessionState.
 */
export interface ClientSession {
  /** Returns the current state record; the same object until the next update. */
  get(): ClientSessionState;
  /** Replaces the state by fn(current). A function returning its argument leaves the record (and its identity) unchanged. */
  update(fn: (state: ClientSessionState) => ClientSessionState): void;
}

/**
 * Creates a session holding `initial`.
 */
export function createClientSession(initial: ClientSessionState): ClientSession {
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
