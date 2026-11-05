/**
 * Runs the effects the session reducer lists after a command (`applyRuntimeCommand`), in the order it listed them.
 *
 * An effect is a request for something outside the session: syncing the palette or the object instances, starting a cannon or
 * geometry-computer action, applying debug or comfort state, asking the host to restart the app, editing a sign. This module only
 * routes: each case calls the handle that does the work, or dispatches a follow-up command. It owns the reload-confirmation timer.
 */
import type { RuntimeCommand, RuntimeEffect } from "../../runtime/runtimeCommands";

/** Callbacks the host passed to the app for restarts and URL copying. */
export interface RuntimeEffectHostCallbacks {
  readonly onReloadRequested?: () => void;
  readonly onWorldChangeRequested?: (worldId: string) => void;
  readonly onAppConfigChangeRequested?: (configName: string) => void;
  readonly onCopyUrlWithOptionsRequested?: () => void;
}

/** Dependencies of {@link createRuntimeEffects}. */
export interface RuntimeEffectsDeps {
  /** The one command path; follow-up commands go through it. */
  dispatch(command: RuntimeCommand): void;
  readonly host: RuntimeEffectHostCallbacks;
  syncDesktopPalette(): void;
  clearProtractorToolFeedback(): void;
  applyMenuDebugState(): void;
  applyMenuComfortState(): void;
  /** Ends an XR session if one is presenting, then runs the restart. */
  requestAppRestart(restart: () => void): void;
  teleportPlayerHome(): void;
  addGeodesicToCannon(cannonId: string): void;
  startGeodesicCannonCarry(cannonId: string): void;
  /** Asks the world to start the tool behind an action on an object's menu page. */
  startObjectAction(objectKind: string, objectId: string, actionId: string): void;
  startGeodesicCannonRotation(cannonId: string, geodesicId: string | undefined): void;
  startGeodesicCannonAim(cannonId: string, geodesicId: string | undefined): void;
  deleteGeodesicFromCannon(cannonId: string, geodesicId: string): void;
  stepGeometryComputerPendingTarget(computerId: string, axis: "a" | "b", deltaMeters: number): void;
  startGeometryComputerDeformation(computerId: string): void;
  appendEditingSignCharacter(character: string): void;
  backspaceEditingSignMessage(): void;
  deleteEditingSign(): void;
}

/** Handle to the effect runner created by {@link createRuntimeEffects}. */
export interface RuntimeEffects {
  /** Runs one effect. */
  run(effect: RuntimeEffect): void;
  /** Cancels the pending reload-confirmation timer. */
  dispose(): void;
}

/** Creates the runner of reducer effects. */
export function createRuntimeEffects(deps: RuntimeEffectsDeps): RuntimeEffects {
  const { dispatch, host } = deps;
  let reloadConfirmationTimeout: ReturnType<typeof setTimeout> | undefined;

  function run(effect: RuntimeEffect): void {
    switch (effect.kind) {
      case "sync-palette":
        deps.syncDesktopPalette();
        return;
      case "end-tool-session":
        dispatch({ kind: "set-protractor-tool-state", state: {} });
        dispatch({ kind: "set-cannon-tool-state", state: {} });
        deps.clearProtractorToolFeedback();
        return;
      case "switch-tool-session":
        if (effect.toolId !== "protractor") {
          dispatch({ kind: "set-protractor-tool-state", state: {} });
          deps.clearProtractorToolFeedback();
        }
        return;
      case "apply-debug-state":
        deps.applyMenuDebugState();
        return;
      case "apply-comfort-state":
        deps.applyMenuComfortState();
        return;
      case "reload-world":
        deps.requestAppRestart(() => host.onReloadRequested?.());
        return;
      case "go-home":
        deps.teleportPlayerHome();
        return;
      case "change-world":
        deps.requestAppRestart(() => host.onWorldChangeRequested?.(effect.worldId));
        return;
      case "change-app-config":
        deps.requestAppRestart(() => host.onAppConfigChangeRequested?.(effect.configName));
        return;
      case "copy-url-with-options":
        host.onCopyUrlWithOptionsRequested?.();
        return;
      case "arm-reload-confirmation-timer":
        if (reloadConfirmationTimeout !== undefined) {
          clearTimeout(reloadConfirmationTimeout);
        }
        reloadConfirmationTimeout = setTimeout(() => {
          dispatch({ kind: "expire-reload-confirmation", nowMs: Date.now() });
          reloadConfirmationTimeout = undefined;
        }, effect.windowMs);
        return;
      case "add-geodesic-to-cannon":
        deps.addGeodesicToCannon(effect.cannonId);
        return;
      case "start-cannon-carry":
        deps.startGeodesicCannonCarry(effect.cannonId);
        return;
      case "start-object-action":
        deps.startObjectAction(effect.objectKind, effect.objectId, effect.actionId);
        return;
      case "start-cannon-rotation":
        deps.startGeodesicCannonRotation(effect.cannonId, effect.geodesicId);
        return;
      case "start-cannon-aim":
        deps.startGeodesicCannonAim(effect.cannonId, effect.geodesicId);
        return;
      case "delete-geodesic-from-cannon":
        deps.deleteGeodesicFromCannon(effect.cannonId, effect.geodesicId);
        return;
      case "step-geometry-computer-target":
        deps.stepGeometryComputerPendingTarget(effect.computerId, effect.axis, effect.deltaMeters);
        return;
      case "start-geometry-computer-deformation":
        deps.startGeometryComputerDeformation(effect.computerId);
        return;
      case "type-sign-character":
        deps.appendEditingSignCharacter(effect.character);
        return;
      case "backspace-sign":
        deps.backspaceEditingSignMessage();
        return;
      case "delete-sign":
        deps.deleteEditingSign();
        return;
    }
  }

  function dispose(): void {
    if (reloadConfirmationTimeout !== undefined) {
      clearTimeout(reloadConfirmationTimeout);
      reloadConfirmationTimeout = undefined;
    }
  }

  return { run, dispose };
}
