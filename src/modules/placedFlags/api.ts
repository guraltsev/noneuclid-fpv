/**
 * The placed flags' public face (design 013 sections 12.1 and 16): the sign tool's id, the flag kind, the plain-data shapes of the module's commands and their results, and the stable refusal codes.
 *
 * A flag is a wooden sign a person stands on the floor, with a short message. A command carries cell-local data, never a ray: the client resolves its aim first.
 */
import type { EngineCommandBase } from "../../engine/moduleTypes";
import type { PlacedFlagType } from "../../world-objects/toolObjects";

declare module "../../glue/toolIds" {
  interface ModuleToolIds {
    /** The sign tool: stands a flag on the floor. */
    placedFlagsFlag: "placedFlags/flag";
  }
}

/** The id of the sign tool. */
export const placedFlagToolId = "placedFlags/flag" as const;

/** The object kind of a flag. */
export const placedFlagKind = "placedFlags/flag" as const;

/** Stands a flag of `flagType` at `point` of the cell `cellId` (cell-local meters, the height is ignored), its front to `eyePoint` (the same frame). Its message is the next default of its type. Refusals: `placedFlags/blocked` (a wall, a zone or another object in the way, or no such place), `/unknownType`. */
export interface PlacedFlagsPlaceCommand extends EngineCommandBase {
  readonly kind: "placedFlags/place";
  readonly cellId: string;
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly eyePoint: { readonly x: number; readonly y: number; readonly z: number };
  readonly flagType: PlacedFlagType;
}

/** Replaces a flag's message; it is sanitized as every message is. Refusals: `placedFlags/notAFlag`, `/notAMessage`. */
export interface PlacedFlagsSetMessageCommand extends EngineCommandBase {
  readonly kind: "placedFlags/setMessage";
  readonly flagId: string;
  readonly message: string;
}

/** Removes a flag. Refusal: `placedFlags/notAFlag`. */
export interface PlacedFlagsRemoveCommand extends EngineCommandBase {
  readonly kind: "placedFlags/remove";
  readonly flagId: string;
}

/** Every command of the module. */
export type PlacedFlagsCommand = PlacedFlagsPlaceCommand | PlacedFlagsSetMessageCommand | PlacedFlagsRemoveCommand;

/** What a command that succeeded answers with: `outcome` names the command, `flagId` is the flag. */
export interface PlacedFlagsResult {
  readonly outcome: "placed" | "messageSet" | "removed";
  readonly flagId: string;
}

/** The refusal codes of the module's commands. */
export const placedFlagsRefusals = {
  blocked: "placedFlags/blocked",
  unknownType: "placedFlags/unknownType",
  notAFlag: "placedFlags/notAFlag",
  notAMessage: "placedFlags/notAMessage",
} as const;
