/**
 * Routes renderer-neutral RuntimeCommand values (from the desktop menu and the VR palette alike) to the host callbacks that actually reload, change world, go home or toggle the debug overlay.
 * It owns no state: the dispatcher is a thin switch over the command's kind, so adding a command means extending RuntimeCommand and the switch here.
 * The callbacks are supplied by the application shell (createThreeApp), which is why command producers never import renderer code.
 */
import type { RuntimeCommand } from "./runtimeCommands";

/** Sink that executes a RuntimeCommand by calling the matching host callback. */
export interface AppCommandDispatcher {
  /**
   * Executes one command synchronously; every RuntimeCommand kind is handled and the dispatcher itself never throws.
   */
  dispatch(command: RuntimeCommand): void;
}

/** Host callbacks that implement each RuntimeCommand kind. */
export interface CreateAppCommandDispatcherOptions {
  /** Restarts the currently selected world from its initial state (command "reload-world"). */
  readonly reloadWorld: () => void;
  /** Returns the player to the world's starting place (command "go-home"). */
  readonly goHome: () => void;
  /** Switches to the world with the given catalog id (command "change-world"). */
  readonly changeWorld: (worldId: string) => void;
  /** Shows or hides the on-screen debug overlay (command "set-debug-overlay"). */
  readonly setDebugOverlayEnabled: (enabled: boolean) => void;
}

/**
 * Builds an AppCommandDispatcher whose dispatch forwards each command to dispatchRuntimeCommand with the given callbacks.
 */
export function createAppCommandDispatcher(options: CreateAppCommandDispatcherOptions): AppCommandDispatcher {
  return {
    dispatch(command) {
      dispatchRuntimeCommand(command, options);
    },
  };
}

/**
 * Invokes exactly one of the option callbacks, selected by command.kind, passing along the command payload (worldId or enabled).
 */
export function dispatchRuntimeCommand(
  command: RuntimeCommand,
  options: CreateAppCommandDispatcherOptions,
): void {
  switch (command.kind) {
    case "reload-world":
      options.reloadWorld();
      return;
    case "go-home":
      options.goHome();
      return;
    case "change-world":
      options.changeWorld(command.worldId);
      return;
    case "set-debug-overlay":
      options.setDebugOverlayEnabled(command.enabled);
      return;
  }
}
