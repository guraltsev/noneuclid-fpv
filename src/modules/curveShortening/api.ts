/**
 * The curve shortening module's public face (design 013 section 13.2, amended by design 014 sections 2.1 and 9): the token of its read-only answers and the plain-data shapes of its events.
 * Other modules and clients import this file and nothing else of the module's directory. The module has no commands, no tool and no object kind.
 */
import { defineModuleToken } from "../../engine/moduleTypes";
import type { EngineEventBase } from "../../engine/moduleTypes";

/** What the module answers: reads only. */
export interface CurveDynamicsApi {
  /** True when every tied vertex is quiet: a taut closed loop, or a vertex the flow could not act on. O(1). */
  isAtRest(): boolean;
}

/** The token a dynamics module provides (so that a module that sticks curves at corners can replace the flow). */
export const curveDynamicsToken = defineModuleToken<CurveDynamicsApi, CurveDynamicsApi>("curveDynamics");

/** A loop around a cone point shrank below the minimum length and was deleted. The message is for people. */
export interface CurveShorteningFreeLoopCollapsedEvent extends EngineEventBase {
  readonly kind: "curveShortening/freeLoopCollapsed";
  readonly arcId: string;
  readonly message: string;
}

/** A tied curve shrank to a point and was deleted. */
export interface CurveShorteningCollapsedEvent extends EngineEventBase {
  readonly kind: "curveShortening/collapsed";
  readonly arcIds: readonly string[];
  readonly message: string;
}

/** The vertex `vertexId` could be neither moved nor merged away, for `reason`, and its whole curve was removed. The message is for people. */
export interface CurveShorteningDestroyedEvent extends EngineEventBase {
  readonly kind: "curveShortening/destroyed";
  readonly vertexId: string;
  readonly reason: string;
  readonly arcIds: readonly string[];
  readonly message: string;
}

/** Every event of the module. */
export type CurveShorteningEvent =
  | CurveShorteningFreeLoopCollapsedEvent
  | CurveShorteningCollapsedEvent
  | CurveShorteningDestroyedEvent;

/** How far a vertex may move in one step, before the line search caps it. */
export type SpeedLawName = "constant";

/** Options of the module. */
export interface CurveShorteningOptions {
  readonly speedLaw: SpeedLawName;
}
