/**
 * The geodesic emitters' public face (design 013 sections 12.1 and 16): the emitter tool's id, the plain-data shapes of the module's commands and their results, and the stable refusal codes.
 *
 * An emitter is an object on the floor that geodesics leave from. Everything a person does to create or remove an emitter or its geodesics is one of these commands, so a script can do it too. A command carries cell-local data, never a ray: the client resolves its aim first.
 * Turning an emitter is a relation, "this participant is editing this emitter" (design 013 section 7): `beginEdit` holds it and opens the slot `geodesicEmitters/yaw`, `endEdit` ends it. What moves an emitter from another module's `bodies` tick is the `api`.
 */
import { defineModuleToken } from "../../engine/moduleTypes";
import type { CommandResult, EngineCommandBase } from "../../engine/moduleTypes";
import type { RigidTransform3 } from "../../math/rigidTransform3";
import type { GeodesicPortalTraversal } from "../../world-objects/geodesic/objects";

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

/** The kind of the attachment an edit holds on a participant: the emitter is `objectId`, the geodesic it turns is `activeGeodesicId`. */
export const geodesicEmitterEditAttachmentKind = "geodesicEmitters/edit";

/** The control slot of an edit: the absolute yaw of the emitter, in radians in the frame of its cell. The client computes it from its aim or its turn input; rays never reach the world. Opened by `beginEdit`, closed by `endEdit`. */
export const geodesicEmitterYawSlot = "geodesicEmitters/yaw";

/** For dependents only: what moves an emitter on the fast channel (design 013 section 5.4). The emitter is the emitters' to write and its arcs the model's, so a carrier writes neither. */
export interface GeodesicEmittersApi {
  /** Moves the emitter one step along a route, all or nothing: the arcs that follow it keep their portal words, and a move a word cannot follow changes nothing and lists those arcs. */
  moveAlong(input: {
    readonly emitterId: string;
    /** Cell the emitter is in after the move. */
    readonly cellId: string;
    /** Pose of the emitter in that cell's frame. */
    readonly localPose: RigidTransform3;
    /** Portals crossed, in order, from its current cell to `cellId`; empty when it stayed in its cell. */
    readonly route: readonly GeodesicPortalTraversal[];
  }): { readonly moved: boolean; readonly brokenGeodesicIds: readonly string[] };
  /** The emitter has moved: its arcs are rebuilt, keeping an arc whose rebuild failed (the safety net of a carry in progress). `regrownActiveGeodesicId` names a plain arc that was regrown from it. */
  rebuildGeodesics(emitterId: string, activeArcId: string | undefined): { readonly regrownActiveGeodesicId?: string };
  /** The emitter has been put down: its arcs are rebuilt one last time, without the safety net. */
  settleGeodesics(emitterId: string, activeArcId: string | undefined): void;
}

/** The emitters' token: `provides` of the module, `requires` of what moves an emitter. */
export const geodesicEmittersToken = defineModuleToken<GeodesicEmittersApi>("geodesicEmitters");

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

/**
 * The issuing participant begins to edit an emitter: the attachment is held and the slot `geodesicEmitters/yaw` opens. `arcId` is the free geodesic that turns with the emitter; without it only the emitter turns. Asked again for the same emitter it takes the new `arcId`.
 * Refusals: `geodesicEmitters/notAnEmitter`, `/alreadyEdited` (someone else edits or carries it, or this participant holds another emitter), `/notAttached` (the arc is not on the emitter), `/blocked` (it connects emitters or is tied).
 */
export interface GeodesicEmitterBeginEditCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/beginEdit";
  readonly emitterId: string;
  readonly arcId?: string;
}

/** Ends the issuing participant's edit: the attachment and the slot go, and the geodesic is traced once more and connects to an emitter it reaches, snapping onto one that lies almost on its ray. Does nothing with no edit. An edit also ends by itself when its emitter is gone. */
export interface GeodesicEmitterEndEditCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/endEdit";
}

/** Module-only. The emitter leaves the floor: its plain shot geodesics are deleted (agreed 2026-11-03). The result is `{ arcIds }`, those deleted. */
export interface GeodesicEmitterLiftCommand extends EngineCommandBase {
  readonly kind: "geodesicEmitters/lift";
  readonly emitterId: string;
}

/** Every command of the module. */
export type GeodesicEmittersCommand =
  | GeodesicEmitterPlaceCommand
  | GeodesicEmitterShootCommand
  | GeodesicEmitterExtendCommand
  | GeodesicEmitterDeleteGeodesicCommand
  | GeodesicEmitterRemoveCommand
  | GeodesicEmitterBeginEditCommand
  | GeodesicEmitterEndEditCommand
  | GeodesicEmitterLiftCommand;

/** What a command that succeeded answers with: `outcome` names the command, the ids are what it created or touched. `arcIds` of `placed` are the arcs on the new emitter, the arc that was cut first. */
export type GeodesicEmittersResult =
  | { readonly outcome: "placed" | "removed"; readonly emitterId: string; readonly arcIds: readonly string[] }
  | { readonly outcome: "shot" | "extended" | "geodesicDeleted"; readonly emitterId: string; readonly arcId: string };

/** `api.geodesicEmitters`, for scripts: each function submits the command of its name as the local player and resolves with its result, a {@link GeodesicEmittersResult} in `value` or a refusal. */
export type GeodesicEmittersPublicApi = {
  place(cellId: string, point: GeodesicEmitterPlaceCommand["point"], yawRadians: number): Promise<CommandResult>;
  shoot(emitterId: string, yawRadians: number, lengthMeters: number): Promise<CommandResult>;
  extend(arcId: string, lengthMeters: number): Promise<CommandResult>;
  deleteGeodesic(emitterId: string, arcId: string): Promise<CommandResult>;
  remove(emitterId: string): Promise<CommandResult>;
};

/** The refusal codes of the module's commands. */
export const geodesicEmittersRefusals = {
  notAnEmitter: "geodesicEmitters/notAnEmitter",
  notAttached: "geodesicEmitters/notAttached",
  blocked: "geodesicEmitters/blocked",
  tooShort: "geodesicEmitters/tooShort",
  alreadyEdited: "geodesicEmitters/alreadyEdited",
} as const;
