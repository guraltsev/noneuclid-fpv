/**
 * The geodesic emitters' public face (design 013 sections 12.1 and 16): the emitter tool's id, the plain-data shapes of the module's commands and their results, and the stable refusal codes.
 *
 * An emitter is an object on the floor that geodesics leave from. Everything a person does to create or remove an emitter or its geodesics is one of these commands, so a script can do it too. A command carries cell-local data, never a ray: the client resolves its aim first.
 */
import type { EngineCommandBase } from "../../engine/moduleTypes";

declare module "../../glue/toolIds" {
  interface ModuleToolIds {
    /** The emitter tool: places emitters and starts geodesics. */
    geodesicEmittersEmitter: "geodesicEmitters/emitter";
  }
}

/** The id of the emitter tool. */
export const geodesicEmitterToolId = "geodesicEmitters/emitter" as const;

/** The object kind of an emitter. */
export const geodesicEmitterKind = "geodesicEmitters/emitter" as const;

/**
 * Places an emitter at `point` of the cell `cellId` (cell-local meters, the height is ignored), facing `yawRadians`. On a crossing it cuts every geodesic passing there; on a segment of a free geodesic it cuts that geodesic; anywhere else it stands on the floor with no geodesic.
 * Refusals: `geodesicEmitters/blocked`, `geodesicEmitters/tooShort` (a cut too near the start of a segment).
 */
export interface GeodesicEmitterPlaceCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/place";
  readonly cellId: string;
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly yawRadians: number;
}

/** Starts a new geodesic of `lengthMeters` from an emitter along `yawRadians`; the emitter then faces that way. Refusals: `geodesicEmitters/notAnEmitter`, `/blocked` (a yaw that is not a number), `/tooShort`. */
export interface GeodesicEmitterShootCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/shoot";
  readonly emitterId: string;
  readonly yawRadians: number;
  readonly lengthMeters: number;
}

/** Lengthens a free geodesic by `lengthMeters` along its tangent at the emitter. Refusals: `geodesicEmitters/notAttached` (not an arc on an emitter), `/blocked` (it connects emitters, is tied, or ended at a wall, a zone or an emitter), `/tooShort`. */
export interface GeodesicEmitterExtendCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/extend";
  readonly arcId: string;
  readonly lengthMeters: number;
}

/** Deletes one geodesic of an emitter. Refusals: `geodesicEmitters/notAnEmitter`, `/notAttached`. */
export interface GeodesicEmitterDeleteGeodesicCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/deleteGeodesic";
  readonly emitterId: string;
  readonly arcId: string;
}

/** Removes an emitter and every geodesic on it; a tied arc takes its whole curve. Refusal: `geodesicEmitters/notAnEmitter`. */
export interface GeodesicEmitterRemoveCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/remove";
  readonly emitterId: string;
}

/** Every command of the module. */
export type GeodesicEmittersCommand =
  | GeodesicEmitterPlaceCommand
  | GeodesicEmitterShootCommand
  | GeodesicEmitterExtendCommand
  | GeodesicEmitterDeleteGeodesicCommand
  | GeodesicEmitterRemoveCommand;

/** What a command that succeeded answers with: `outcome` names the command, the ids are what it created or touched. `arcIds` of `placed` are the arcs on the new emitter, the arc that was cut first. */
export type GeodesicEmittersResult =
  | { readonly outcome: "placed" | "removed"; readonly emitterId: string; readonly arcIds: readonly string[] }
  | { readonly outcome: "shot" | "extended" | "geodesicDeleted"; readonly emitterId: string; readonly arcId: string };

/** The refusal codes of the module's commands. */
export const geodesicEmittersRefusals = {
  notAnEmitter: "geodesicEmitters/notAnEmitter",
  notAttached: "geodesicEmitters/notAttached",
  blocked: "geodesicEmitters/blocked",
  tooShort: "geodesicEmitters/tooShort",
} as const;
