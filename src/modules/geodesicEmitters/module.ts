/**
 * The geodesic emitters module (design 013 section 16): an emitter and what a person does to create or remove it and its geodesics, as commands. It is the world part over `src/world-objects/geodesic/cannon.ts`, which stays in place.
 *
 * It declares the emitter kind and handles `place`, `shoot`, `extend`, `deleteGeodesic` and `remove`, each requiring the emitter tool, which it defines. Every command is atomic: a refusal changes nothing. Results carry the new ids.
 * The module has no tick: crossings, lengths and angles follow from the change ring in the derive pass of the same step.
 * Reads of arcs go through the geodesic model's queries; removing arcs and naming a new one are the model's commands, because the arcs are the model's.
 */
import type { CommandContext, CommandHandlers, CommandResult, ModuleDefinition, PlainData } from "../../engine/moduleTypes";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { extendGeodesic, placeGeodesicEmitterAtPoint, shootGeodesic } from "../../world-objects/geodesic/cannon";
import { minGeodesicSegmentLengthMeters, type GeodesicEmitterObject } from "../../world-objects/geodesic/objects";
import type { RuntimeObjectReader } from "../../world-objects/runtimeObjectRegistry";
import { geodesicModelToken, type GeodesicModelQueries, type GeodesicRemoveCurveCommand, type GeodesicReserveArcIdCommand } from "../geodesicModel/api";
import {
  geodesicEmitterKind,
  geodesicEmittersRefusals,
  geodesicEmitterToolId,
  type GeodesicEmitterDeleteGeodesicCommand,
  type GeodesicEmitterExtendCommand,
  type GeodesicEmitterPlaceCommand,
  type GeodesicEmitterRemoveCommand,
  type GeodesicEmittersCommand,
  type GeodesicEmittersResult,
  type GeodesicEmitterShootCommand,
} from "./api";

/** The module as the engine's list takes it. */
export type GeodesicEmittersModuleDefinition = ModuleDefinition<undefined, GeodesicEmittersCommand, never, Record<string, never>>;

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

function answer(value: GeodesicEmittersResult): CommandResult {
  return { ok: true, value: value as PlainData };
}

const notAnEmitter = refuse(geodesicEmittersRefusals.notAnEmitter, "That is not an emitter.");
const tooShort = refuse(geodesicEmittersRefusals.tooShort, "That is too short for a geodesic.");

function emitterAt(objects: RuntimeObjectReader, id: string): GeodesicEmitterObject | undefined {
  const object = objects.get(id);
  return object?.kind === geodesicEmitterKind ? object : undefined;
}

function isLongEnough(lengthMeters: number): boolean {
  return Number.isFinite(lengthMeters) && lengthMeters >= minGeodesicSegmentLengthMeters;
}

/** An arc id comes from the model, whose family it is. */
function reserveArcId(ctx: CommandContext): string {
  const reserve: GeodesicReserveArcIdCommand = { kind: "geodesicModel/reserveArcId" };
  const result = ctx.dispatch(reserve);
  if (!result.ok) throw new Error(result.refusal.message);
  return (result.value as { readonly arcId: string }).arcId;
}

function createPlace(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterPlaceCommand, ctx: CommandContext): CommandResult => {
    const { x, y, z } = command.point;
    if (![x, y, z, command.yawRadians].every(Number.isFinite)) return refuse(geodesicEmittersRefusals.blocked, "That is not a place.");
    const placed = placeGeodesicEmitterAtPoint({
      world: ctx.world,
      registry: ctx.objects,
      cellId: command.cellId,
      point: command.point,
      aimYawRadians: command.yawRadians,
      createId: () => ctx.ids.next("emitter"),
      createContinuationGeodesicId: () => reserveArcId(ctx),
    });
    if (!placed.placed || placed.object === undefined) {
      return placed.reason === "too-short"
        ? refuse(geodesicEmittersRefusals.tooShort, "That is too near the start of the geodesic.")
        : refuse(geodesicEmittersRefusals.blocked, "An emitter cannot stand there.");
    }
    return answer({ outcome: "placed", emitterId: placed.object.id, arcIds: model.arcsOnEmitter(placed.object.id) });
  };
}

function shoot(command: GeodesicEmitterShootCommand, ctx: CommandContext): CommandResult {
  const emitter = emitterAt(ctx.objects, command.emitterId);
  if (emitter === undefined) return notAnEmitter;
  if (!Number.isFinite(command.yawRadians)) return refuse(geodesicEmittersRefusals.blocked, "That is not a direction.");
  if (!isLongEnough(command.lengthMeters)) return tooShort;
  const arcId = reserveArcId(ctx);
  shootGeodesic({
    world: ctx.world,
    registry: ctx.objects,
    cannon: { ...emitter, aimYawRadians: command.yawRadians, localPose: yawRigidTransform3(command.yawRadians, emitter.localPose.translation) },
    geodesicId: arcId,
    maxLengthMeters: command.lengthMeters,
  });
  return answer({ outcome: "shot", emitterId: emitter.id, arcId });
}

function createExtend(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterExtendCommand, ctx: CommandContext): CommandResult => {
    const emitterId = model.emitterOfArc(command.arcId);
    if (emitterId === undefined) return refuse(geodesicEmittersRefusals.notAttached, "That geodesic has no emitter.");
    if (!isLongEnough(command.lengthMeters)) return tooShort;
    // `extendGeodesic` writes only once it knows the geodesic can go on.
    const extended = extendGeodesic({ world: ctx.world, registry: ctx.objects, geodesicId: command.arcId, maxLengthMeters: command.lengthMeters });
    if (extended === undefined) return refuse(geodesicEmittersRefusals.blocked, "That geodesic cannot go any further.");
    return answer({ outcome: "extended", emitterId, arcId: command.arcId });
  };
}

function createDeleteGeodesic(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterDeleteGeodesicCommand, ctx: CommandContext): CommandResult => {
    if (emitterAt(ctx.objects, command.emitterId) === undefined) return notAnEmitter;
    if (!model.arcsOnEmitter(command.emitterId).includes(command.arcId)) {
      return refuse(geodesicEmittersRefusals.notAttached, "That geodesic is not on this emitter.");
    }
    const removal: GeodesicRemoveCurveCommand = { kind: "geodesicModel/removeCurve", arcIds: [command.arcId] };
    ctx.dispatch(removal);
    return answer({ outcome: "geodesicDeleted", emitterId: command.emitterId, arcId: command.arcId });
  };
}

function createRemove(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterRemoveCommand, ctx: CommandContext): CommandResult => {
    if (emitterAt(ctx.objects, command.emitterId) === undefined) return notAnEmitter;
    const arcIds = [...new Set(model.arcsOnEmitter(command.emitterId).flatMap((arcId) => (model.isTied(arcId) ? model.curveOfArc(arcId) : [arcId])))];
    const removal: GeodesicRemoveCurveCommand = { kind: "geodesicModel/removeCurve", arcIds };
    ctx.dispatch(removal);
    ctx.objects.remove(command.emitterId);
    return answer({ outcome: "removed", emitterId: command.emitterId, arcIds });
  };
}

/** Creates the geodesic emitters module. It requires the geodesic model, whose arcs leave from the emitters. */
export function geodesicEmittersModule(): GeodesicEmittersModuleDefinition {
  return {
    id: "geodesicEmitters",
    requires: [geodesicModelToken],
    objectKinds: [{ kind: geodesicEmitterKind, label: "real", persistence: "saved" }],
    // Shooting and extending realize arcs through `world-objects/geodesic/cannon.ts` in this module's frame, until that code moves behind the model (design 013 section 16).
    writesCoreKinds: ["geodesicModel/arc", "geodesicModel/vertex", "geodesicModel/segment", "geodesicModel/crossing"],
    toolIds: [geodesicEmitterToolId],
    create: (context) => {
      const model = context.require(geodesicModelToken);
      const commands: CommandHandlers<GeodesicEmittersCommand> = {
        "geodesicEmitters/place": { run: createPlace(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/shoot": { run: shoot, requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/extend": { run: createExtend(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/deleteGeodesic": { run: createDeleteGeodesic(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/remove": { run: createRemove(model), requiresTool: geodesicEmitterToolId },
      };
      return { api: undefined, queries: {}, commands, ticks: [] };
    },
  };
}
