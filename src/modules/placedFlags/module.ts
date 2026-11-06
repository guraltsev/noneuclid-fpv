/**
 * The placed flags module (design 013 section 16): a flag and what a person does to it, as commands over `src/world-objects/placedFlags.ts`. A flag is real: nothing about it is derived, so the module needs no ticks.
 * It declares the flag kind and handles `place`, `setMessage` and `remove`, each requiring the sign tool, which it defines. Every command is atomic: a refusal changes nothing in the world. Results carry the flag's id.
 * A deformation of the world still moves flags from `render/three/geometryCommit.ts`, until the deformation job gives modules `transformGeometry` (design 013 section 9.1).
 */
import type { CommandContext, CommandHandlers, CommandResult, ModuleDefinition, PlainData } from "../../engine/moduleTypes";
import { placeFlagAtFloorPoint, updatePlacedFlagMessage } from "../../world-objects/placedFlags";
import { placedFlagTypes } from "../../world-objects/toolObjects";
import {
  placedFlagKind,
  placedFlagsRefusals,
  placedFlagToolId,
  type PlacedFlagsCommand,
  type PlacedFlagsPlaceCommand,
  type PlacedFlagsRemoveCommand,
  type PlacedFlagsResult,
  type PlacedFlagsSetMessageCommand,
} from "./api";

/** The module as the engine's list takes it. */
export type PlacedFlagsModuleDefinition = ModuleDefinition<undefined, PlacedFlagsCommand, never>;

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

function answer(value: PlacedFlagsResult): CommandResult {
  return { ok: true, value: value as unknown as PlainData };
}

function isPoint(value: PlacedFlagsPlaceCommand["point"] | undefined): boolean {
  return typeof value === "object" && value !== null && [value.x, value.y, value.z].every(Number.isFinite);
}

function place(command: PlacedFlagsPlaceCommand, ctx: CommandContext): CommandResult {
  if (!isPoint(command.point) || !isPoint(command.eyePoint)) return refuse(placedFlagsRefusals.blocked, "That is not a place.");
  if (!placedFlagTypes.includes(command.flagType)) return refuse(placedFlagsRefusals.unknownType, "There is no such sign.");
  const placed = placeFlagAtFloorPoint({
    world: ctx.world,
    registry: ctx.objects,
    cellId: command.cellId,
    eyePosition: command.eyePoint,
    floorPoint: command.point,
    flagType: command.flagType,
    id: ctx.ids.next("flag"),
  });
  if (!placed.placed || placed.object === undefined) return refuse(placedFlagsRefusals.blocked, "A sign cannot stand there.");
  return answer({ outcome: "placed", flagId: placed.object.id });
}

function setMessage(command: PlacedFlagsSetMessageCommand, ctx: CommandContext): CommandResult {
  const flag = ctx.objects.get(command.flagId);
  if (flag?.kind !== placedFlagKind) return refuse(placedFlagsRefusals.notAFlag, "That is not a sign.");
  if (typeof command.message !== "string") return refuse(placedFlagsRefusals.notAMessage, "That is not a message.");
  const next = updatePlacedFlagMessage(flag, command.message);
  if (next.message !== flag.message) ctx.objects.update(next);
  return answer({ outcome: "messageSet", flagId: flag.id });
}

function remove(command: PlacedFlagsRemoveCommand, ctx: CommandContext): CommandResult {
  if (ctx.objects.get(command.flagId)?.kind !== placedFlagKind) return refuse(placedFlagsRefusals.notAFlag, "That is not a sign.");
  ctx.objects.remove(command.flagId);
  return answer({ outcome: "removed", flagId: command.flagId });
}

/** Creates the placed flags module. It requires nothing. */
export function placedFlagsModule(): PlacedFlagsModuleDefinition {
  return {
    id: "placedFlags",
    requires: [],
    objectKinds: [{ kind: placedFlagKind, label: "real", persistence: "saved" }],
    toolIds: [placedFlagToolId],
    create: () => {
      const commands: CommandHandlers<PlacedFlagsCommand> = {
        "placedFlags/place": { run: place, requiresTool: placedFlagToolId },
        "placedFlags/setMessage": { run: setMessage, requiresTool: placedFlagToolId },
        "placedFlags/remove": { run: remove, requiresTool: placedFlagToolId },
      };
      return { api: undefined, queries: undefined, commands, ticks: [] };
    },
  };
}
