/**
 * The policies of the curve shortening flow (design 013 section 13.2): how far a vertex may move in one step. The line search caps every step, so a law only
 * says how fast the vertex would like to go. Only the constant law is built; a tension law is a new `SpeedLaw` and nothing else changes.
 */
import type { SpeedLawName } from "./api";

/** Metres this vertex may move this step, before the line search caps it. */
export type SpeedLaw = (input: { readonly tangentSum: { readonly x: number; readonly y: number }; readonly deltaSeconds: number }) => number;

/** Speed (meters per second) at which a vertex moves along its descent direction; the exact line search never overshoots the minimum. */
export const curveShorteningSpeedMetersPerSecond = 1.5;

/** Longest frame time (seconds) one step of the flow integrates; a stalled tab does not teleport a vertex. */
export const maxCurveShorteningDeltaSeconds = 0.1;

/** Today's step budget: the speed times the frame time, clamped to 0.1 s. */
const constantSpeedLaw: SpeedLaw = ({ deltaSeconds }) => curveShorteningSpeedMetersPerSecond * Math.min(deltaSeconds, maxCurveShorteningDeltaSeconds);

/** The speed law an option names. */
export function speedLawNamed(name: SpeedLawName): SpeedLaw {
  switch (name) {
    case "constant":
      return constantSpeedLaw;
  }
}
