/**
 * Shared test fake: drives the carry tool the way the shell does, one world step per call.
 * In the app the tool submits during the frame's input phase and the shell steps the world later in the same frame; a test calls the tool and wants the world to have answered, so each call here is followed by a step, the tool's `afterWorldStep` and `endFrame`.
 */
import type { WorldEngine } from "../../src/engine/moduleTypes";
import type { GeodesicCannonToolsDeps } from "../../src/render/three/geodesicCannonTools";
import { createGeodesicCannonTools } from "../../src/render/three/geodesicCannonTools";

/** The duration of the step behind an update that names no time: long enough that the glide is limited by the carry contract's step budget only. */
export const unlimitedStepSeconds = 1000;

type Tools = ReturnType<typeof createGeodesicCannonTools>;

/** `Tools`, whose carry update also says how long the step behind it lasts. */
type DrivenTools = Omit<Tools, "updateCarriedGeodesicCannonPose"> & {
  updateCarriedGeodesicCannonPose(...args: [...Parameters<Tools["updateCarriedGeodesicCannonPose"]>, deltaSeconds?: number]): void;
};

/** `tools` with the carry operations followed by a world step; `engine` is the one the tools were built with. */
export function driveCarryTools(tools: Tools, engine: WorldEngine): DrivenTools {
  const settle = (seconds: number): void => {
    engine.step(seconds);
    tools.afterWorldStep();
    engine.endFrame();
  };
  return {
    ...tools,
    startGeodesicCannonCarry(...args: Parameters<Tools["startGeodesicCannonCarry"]>) {
      tools.startGeodesicCannonCarry(...args);
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
