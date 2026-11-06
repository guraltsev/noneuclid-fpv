/**
 * Shared test fake: drives the emitter's modes the way the shell does, one world step per call, through a real tool host.
 * In the app the tool submits during the frame's input phase and the shell steps the world later in the same frame; a test calls the tool and wants the world to have answered, so each call here is followed by a step, the tool host's `afterStep`, the tool's `afterWorldStep` and `endFrame`. A start takes two such frames: the gate, then the relation.
 */
import type { WorldEngine } from "../../src/engine/moduleTypes";
import type { GeodesicCannonToolsDeps } from "../../src/render/three/geodesicCannonTools";
import { createGeodesicCannonTools } from "../../src/render/three/geodesicCannonTools";
import { createToolHost, type ToolHost } from "../../src/render/three/toolHost";
import type { ClientSession } from "../../src/runtime/clientSession";
import type { EmitterModeToolId } from "../../src/runtime/coreTools";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { runFrame } from "./engine";

/** The duration of the step behind an update that names no time: long enough that the glide is limited by the carry contract's step budget only. */
export const unlimitedStepSeconds = 1000;

type Tools = ReturnType<typeof createGeodesicCannonTools>;

/** `Tools`, whose carry update also says how long the step behind it lasts. */
type DrivenTools = Omit<Tools, "updateCarriedGeodesicCannonPose"> & {
  updateCarriedGeodesicCannonPose(...args: [...Parameters<Tools["updateCarriedGeodesicCannonPose"]>, deltaSeconds?: number]): void;
};

/** A real tool host with inert tools, whose emitter modes answer to `settle`. */
export function createModeToolHost(input: {
  readonly engine: WorldEngine;
  readonly session: ClientSession;
  dispatch(command: RuntimeCommand): void;
  settle: Tools["settleEmitterMode"];
  readonly messages?: string[];
}): ToolHost {
  const nothing = (): void => {};
  return createToolHost({
    engine: input.engine,
    session: input.session,
    dispatch: input.dispatch,
    clients: [],
    core: {
      carry: () => false,
      rotate: () => false,
      aim: () => false,
      emitterModeResult: (toolId: EmitterModeToolId, result) => input.settle(toolId, result),
    },
    resolveCurrentAimTargets: () => [],
    resolveCurrentAimTarget: () => undefined,
    targetIsWithinInteractionRange: () => true,
    useFocusedObject: () => false,
    requestTool: nothing,
    showMessage: (message) => void input.messages?.push(message),
    syncDesktopPalette: nothing,
    selectObject: nothing,
    showObjectPage: nothing,
  });
}

/** The end of a frame, with or without a tick behind it: the answers, the events, `endFrame`. */
export function afterFrame(tools: Pick<Tools, "afterWorldStep">, engine: WorldEngine, host: ToolHost): void {
  host.afterStep();
  tools.afterWorldStep();
  engine.endFrame();
}

/** `tools` with the carry operations followed by a world step; `engine` and `host` are the ones the tools were built with. */
export function driveCarryTools(tools: Tools, engine: WorldEngine, host: ToolHost): DrivenTools {
  const settle = (seconds: number): void => {
    runFrame(engine, seconds);
    afterFrame(tools, engine, host);
  };
  return {
    ...tools,
    startGeodesicCannonCarry(...args: Parameters<Tools["startGeodesicCannonCarry"]>) {
      tools.startGeodesicCannonCarry(...args);
      settle(0);
      settle(0);
    },
    startGeodesicCannonAim(...args: Parameters<Tools["startGeodesicCannonAim"]>) {
      tools.startGeodesicCannonAim(...args);
      settle(0);
      settle(0);
    },
    updateActiveGeodesicCannonAim(...args: Parameters<Tools["updateActiveGeodesicCannonAim"]>) {
      tools.updateActiveGeodesicCannonAim(...args);
      settle(0);
    },
    updateCarriedGeodesicCannonPose(xrActive, ray, deltaSeconds) {
      tools.updateCarriedGeodesicCannonPose(xrActive, ray);
      settle(deltaSeconds ?? unlimitedStepSeconds);
    },
    finishGeodesicCannonCarry() {
      const finished = tools.finishGeodesicCannonCarry();
      settle(0);
      return finished;
    },
  };
}

export type { GeodesicCannonToolsDeps };
