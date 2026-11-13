/**
 * The geodesic emitters module (design 013 section 16): an emitter and what a person does to create or remove it and its geodesics, as commands. It is the world part over `src/world-objects/geodesic/cannon.ts`, which stays in place.
 *
 * It declares the emitter kind and handles `place`, `shoot`, `extend`, `deleteGeodesic` and `remove`, each requiring the emitter tool, which it defines, then `beginEdit` and `endEdit`, and the module-only `lift` and `land`. Every command is atomic: a refusal changes nothing. Results carry the new ids.
 * Its one tick, `edit`, runs in `bodies`, on the fast channel: each frame an edited emitter takes the yaw of its slot and its free geodesic is re-traced, so aiming keeps up in frames with no tick too. Crossings, lengths and angles follow from the change ring in the derive pass of the next step.
 * The module writes the emitter and nothing else. Reads of arcs go through the geodesic model's queries; every write of an arc is the model's, by its commands, or by its `api` on the fast channel, where a command would not do (design 013 section 5.4). Its own `api` is what a carrier calls.
 */
import type { CommandContext, CommandHandlers, CommandResult, ModuleCreateContext, ModuleDefinition, ModuleTick, ParticipantRecord, PlainData, StepContext } from "../../engine/moduleTypes";
import { participantAttachment } from "../../engine/moduleTypes";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { moveEmitterAlongRoute, placeGeodesicEmitterAtPoint, resolveCannonForGeodesic, resolveCannonSnappedToEmitter, type GeodesicEmitterCuts } from "../../world-objects/geodesic/cannon";
import { minGeodesicSegmentLengthMeters, sanitizeYaw, type GeodesicEmitterObject } from "../../world-objects/geodesic/objects";
import type { RuntimeObjectReader, RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import {
  geodesicModelToken,
  type GeodesicCutAtSegmentCommand,
  type GeodesicCutAtEmitterCommand,
  type GeodesicCutAtVertexCommand,
  type GeodesicExtendArcCommand,
  type GeodesicModelApi,
  type GeodesicModelQueries,
  type GeodesicRemoveCurveCommand,
  type GeodesicRemovePlainArcsCommand,
  type GeodesicShootArcCommand,
} from "../geodesicModel/api";
import {
  geodesicEmitterEditAttachmentKind,
  geodesicEmitterKind,
  geodesicEmittersRefusals,
  geodesicEmittersToken,
  geodesicEmitterToolId,
  geodesicEmitterYawSlot,
  type GeodesicEmitterBeginEditCommand,
  type GeodesicEmitterDeleteGeodesicCommand,
  type GeodesicEmitterExtendCommand,
  type GeodesicEmitterLandCommand,
  type GeodesicEmitterLiftCommand,
  type GeodesicEmitterPlaceCommand,
  type GeodesicEmitterRemoveCommand,
  type GeodesicEmittersApi,
  type GeodesicEmittersCommand,
  type GeodesicEmittersPublicApi,
  type GeodesicEmittersResult,
  type GeodesicEmitterShootCommand,
} from "./api";

/** The tool `beginEdit` and `endEdit` name for the gates. Rotate and aim are one relation, and the configuration enables or disables the emitter's modes together. */
const editToolId = "geodesicEmitters/rotate" as const;

/** The module as the engine's list takes it. */
export type GeodesicEmittersModuleDefinition = ModuleDefinition<GeodesicEmittersApi, GeodesicEmittersCommand, never, Record<string, never>>;

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

function answer(value: GeodesicEmittersResult): CommandResult {
  return { ok: true, value: value as PlainData };
}

// Functions, not constants: a result reaches an in-page caller by reference, and an edit there must not reach the next caller.
const notAnEmitter = (): CommandResult => refuse(geodesicEmittersRefusals.notAnEmitter, "That is not a laser.");
const tooShort = (): CommandResult => refuse(geodesicEmittersRefusals.tooShort, "That is too short for a beam.");

function emitterAt(objects: RuntimeObjectReader, id: string): GeodesicEmitterObject | undefined {
  const object = objects.get(id);
  return object?.kind === geodesicEmitterKind ? object : undefined;
}

function isLongEnough(lengthMeters: number): boolean {
  return Number.isFinite(lengthMeters) && lengthMeters >= minGeodesicSegmentLengthMeters;
}

/** The emitter facing `yawRadians`. */
function facing(emitter: GeodesicEmitterObject, yawRadians: number): GeodesicEmitterObject {
  return { ...emitter, aimYawRadians: yawRadians, localPose: yawRigidTransform3(yawRadians, emitter.localPose.translation) };
}

/** A cut is the model's: the emitter stands there first, and the arcs are cut at it. */
function cutsOf(ctx: CommandContext): GeodesicEmitterCuts {
  return {
    cutAtSegment(cut) {
      const command: GeodesicCutAtSegmentCommand = { kind: "geodesicModel/cutAtSegment", ...cut };
      ctx.dispatch(command);
    },
    cutAtVertex(cut) {
      const command: GeodesicCutAtVertexCommand = { kind: "geodesicModel/cutAtVertex", ...cut };
      const result = ctx.dispatch(command);
      return result.ok ? (result.value as { readonly yawRadians: number } | undefined)?.yawRadians : undefined;
    },
  };
}

function createPlace(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterPlaceCommand, ctx: CommandContext): CommandResult => {
    if (typeof command.point !== "object" || command.point === null) return refuse(geodesicEmittersRefusals.blocked, "That is not a place.");
    const { x, y, z } = command.point;
    if (![x, y, z, command.yawRadians].every(Number.isFinite)) return refuse(geodesicEmittersRefusals.blocked, "That is not a place.");
    const placed = placeGeodesicEmitterAtPoint({
      world: ctx.world,
      registry: ctx.objects,
      cellId: command.cellId,
      point: command.point,
      aimYawRadians: command.yawRadians,
      createId: () => ctx.ids.next("emitter"),
      cuts: cutsOf(ctx),
    });
    if (!placed.placed || placed.object === undefined) {
      return placed.reason === "too-short"
        ? refuse(geodesicEmittersRefusals.tooShort, "That is too near the start of the beam.")
        : refuse(geodesicEmittersRefusals.blocked, "A laser cannot stand there.");
    }
    return answer({ outcome: "placed", emitterId: placed.object.id, arcIds: model.arcsOnEmitter(placed.object.id) });
  };
}

function shoot(command: GeodesicEmitterShootCommand, ctx: CommandContext): CommandResult {
  const emitter = emitterAt(ctx.objects, command.emitterId);
  if (emitter === undefined) return notAnEmitter();
  if (!Number.isFinite(command.yawRadians)) return refuse(geodesicEmittersRefusals.blocked, "That is not a direction.");
  if (!isLongEnough(command.lengthMeters)) return tooShort();
  ctx.objects.update(facing(emitter, command.yawRadians));
  const shot: GeodesicShootArcCommand = { kind: "geodesicModel/shootArc", emitterId: emitter.id, lengthMeters: command.lengthMeters };
  const result = ctx.dispatch(shot);
  if (!result.ok) return notAnEmitter();
  return answer({ outcome: "shot", emitterId: emitter.id, arcId: (result.value as { readonly arcId: string }).arcId });
}

function createExtend(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterExtendCommand, ctx: CommandContext): CommandResult => {
    const emitterId = model.emitterOfArc(command.arcId);
    if (emitterId === undefined) return refuse(geodesicEmittersRefusals.notAttached, "That beam has no laser.");
    if (!isLongEnough(command.lengthMeters)) return tooShort();
    const extension: GeodesicExtendArcCommand = { kind: "geodesicModel/extendArc", arcId: command.arcId, lengthMeters: command.lengthMeters };
    const extended = ctx.dispatch(extension);
    if (!extended.ok) return refuse(geodesicEmittersRefusals.blocked, extended.refusal.message);
    return answer({ outcome: "extended", emitterId, arcId: command.arcId });
  };
}

function createDeleteGeodesic(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterDeleteGeodesicCommand, ctx: CommandContext): CommandResult => {
    if (emitterAt(ctx.objects, command.emitterId) === undefined) return notAnEmitter();
    if (!model.arcsOnEmitter(command.emitterId).includes(command.arcId)) {
      return refuse(geodesicEmittersRefusals.notAttached, "That beam is not on this laser.");
    }
    const removal: GeodesicRemoveCurveCommand = { kind: "geodesicModel/removeCurve", arcIds: [command.arcId] };
    ctx.dispatch(removal);
    return answer({ outcome: "geodesicDeleted", emitterId: command.emitterId, arcId: command.arcId });
  };
}

function createRemove(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterRemoveCommand, ctx: CommandContext): CommandResult => {
    if (emitterAt(ctx.objects, command.emitterId) === undefined) return notAnEmitter();
    const arcIds = [...new Set(model.arcsOnEmitter(command.emitterId).flatMap((arcId) => (model.isTied(arcId) ? model.curveOfArc(arcId) : [arcId])))];
    const removal: GeodesicRemoveCurveCommand = { kind: "geodesicModel/removeCurve", arcIds };
    ctx.dispatch(removal);
    ctx.objects.remove(command.emitterId);
    return answer({ outcome: "removed", emitterId: command.emitterId, arcIds });
  };
}

function land(command: GeodesicEmitterLandCommand, ctx: CommandContext): CommandResult {
  const cut: GeodesicCutAtEmitterCommand = { kind: "geodesicModel/cutAtEmitter", emitterId: command.emitterId };
  return ctx.dispatch(cut);
}

function withoutEdit(participant: ParticipantRecord) {
  return participant.attachments.filter((attachment) => attachment.kind !== geodesicEmitterEditAttachmentKind);
}

function endEdit(ctx: Pick<StepContext, "setAttachments" | "closeControl">, participant: ParticipantRecord): void {
  ctx.setAttachments(participant.id, withoutEdit(participant));
  ctx.closeControl(participant.id, geodesicEmitterYawSlot);
}

function createBeginEdit(model: GeodesicModelQueries) {
  return (command: GeodesicEmitterBeginEditCommand, ctx: CommandContext): CommandResult => {
    const participant = ctx.participant(ctx.participantId);
    if (participant === undefined) return refuse("world/unknownParticipant", `There is no participant "${ctx.participantId}".`);
    if (emitterAt(ctx.objects, command.emitterId) === undefined) return notAnEmitter();
    const held = participantAttachment(participant, geodesicEmitterEditAttachmentKind);
    if (held !== undefined && held.objectId !== command.emitterId) return refuse(geodesicEmittersRefusals.alreadyEdited, "You are already turning a laser.");

    // First come, first served: a carry and an edit are the same kind of hold on the emitter. Only this participant's own edit may go on.
    let holder: string | undefined;
    ctx.forEachParticipant((other) => {
      for (const attachment of other.attachments) {
        const ownEdit = other.id === participant.id && attachment.kind === geodesicEmitterEditAttachmentKind;
        if (holder === undefined && attachment.objectId === command.emitterId && !ownEdit) holder = other.id;
      }
    });
    if (holder !== undefined) return refuse(geodesicEmittersRefusals.alreadyEdited, `Already held by ${holder}.`);

    const { arcId } = command;
    if (arcId !== undefined) {
      if (!model.arcsOnEmitter(command.emitterId).includes(arcId)) return refuse(geodesicEmittersRefusals.notAttached, "That beam is not on this laser.");
      if (model.connectsEmitters(arcId) || model.isTied(arcId)) return refuse(geodesicEmittersRefusals.blocked, "That beam cannot be turned.");
    }

    ctx.setAttachments(participant.id, [
      ...withoutEdit(participant),
      { kind: geodesicEmitterEditAttachmentKind, objectId: command.emitterId, ...(arcId === undefined ? {} : { activeGeodesicId: arcId }) },
    ]);
    ctx.openControl(participant.id, geodesicEmitterYawSlot);
    return { ok: true };
  };
}

function createEndEdit(model: GeodesicModelApi) {
  return (_command: unknown, ctx: CommandContext): CommandResult => {
    const participant = ctx.participant(ctx.participantId);
    const edit = participantAttachment(participant, geodesicEmitterEditAttachmentKind);
    if (participant === undefined || edit === undefined) return { ok: true };
    // The relation goes first: whatever the last trace does, the edit has ended.
    endEdit(ctx, participant);
    const emitter = emitterAt(ctx.objects, edit.objectId);
    const arcId = edit.activeGeodesicId;
    const arc = arcId === undefined ? undefined : ctx.objects.get(arcId);
    if (emitter !== undefined && arcId !== undefined && arc?.kind === "geodesicModel/arc") {
      const snapped = resolveCannonSnappedToEmitter({ world: ctx.world, registry: ctx.objects, cannon: emitter, geodesicId: arcId, totalLengthMeters: arc.intendedLengthMeters }) ?? emitter;
      if (snapped !== emitter) ctx.objects.update(snapped);
      model.retraceArc({ emitter: snapped, arcId, connectEmitters: true });
    }
    return { ok: true };
  };
}

function lift(command: GeodesicEmitterLiftCommand, ctx: CommandContext): CommandResult {
  const removal: GeodesicRemovePlainArcsCommand = { kind: "geodesicModel/removePlainArcs", emitterId: command.emitterId };
  return ctx.dispatch(removal);
}

/**
 * Once per frame: an edited emitter takes the yaw of the slot, and its free geodesic follows. A yaw it already has costs one comparison. An emitter that is gone ends the edit.
 * A failed re-trace stays in this frame: the geodesic keeps its last path, and the fast channel and the frame's steps go on.
 */
function followEdit(ctx: StepContext, model: GeodesicModelApi, participant: ParticipantRecord): void {
  const edit = participantAttachment(participant, geodesicEmitterEditAttachmentKind);
  if (edit === undefined) return;
  const emitter = emitterAt(ctx.objects, edit.objectId);
  if (emitter === undefined) {
    endEdit(ctx, participant);
    return;
  }
  const yaw = ctx.control(participant.id, geodesicEmitterYawSlot);
  if (typeof yaw !== "number" || !Number.isFinite(yaw)) return;
  const yawRadians = sanitizeYaw(yaw);
  if (emitter.aimYawRadians === yawRadians) return;
  const turned = facing(emitter, yawRadians);
  ctx.objects.update(turned);
  if (edit.activeGeodesicId === undefined) return;
  try {
    model.retraceArc({ emitter: turned, arcId: edit.activeGeodesicId, connectEmitters: false });
  } catch (error) {
    console.warn(`Geodesic "${edit.activeGeodesicId}" keeps its path: ${String(error)}`);
  }
}

function createApi(objects: RuntimeObjectRegistry, model: GeodesicModelApi): GeodesicEmittersApi {
  const rebuild = (emitterId: string, activeArcId: string | undefined, keepOnFailure: boolean) => {
    const rebuilt = model.rebuildArcsOfEmitter({ emitterId, activeArcId, keepOnFailure });
    const emitter = emitterAt(objects, emitterId);
    if (rebuilt.launchYawRadians !== undefined && emitter !== undefined) {
      const aimed = resolveCannonForGeodesic(emitter, rebuilt.launchYawRadians);
      if (aimed !== emitter) objects.update(aimed);
    }
    return rebuilt;
  };
  return {
    moveAlong: ({ emitterId, cellId, localPose, route }) =>
      moveEmitterAlongRoute({ registry: objects, emitterId, cellId, localPose, route, followRoute: (followed) => model.followAnchorRoute(emitterId, followed) }),
    rebuildGeodesics: (emitterId, activeArcId) => rebuild(emitterId, activeArcId, true),
    settleGeodesics: (emitterId, activeArcId) => void rebuild(emitterId, activeArcId, false),
  };
}

/** `api.geodesicEmitters`: the module's commands as functions of plain data; each resolves with the command's result. */
function createPublicApi(submit: ModuleCreateContext["submitPublicCommand"]): GeodesicEmittersPublicApi {
  const send = (command: GeodesicEmittersCommand) => submit(command);
  return {
    place: (cellId, point, yawRadians) => send({ kind: "geodesicEmitters/place", cellId, point, yawRadians }),
    shoot: (emitterId, yawRadians, lengthMeters) => send({ kind: "geodesicEmitters/shoot", emitterId, yawRadians, lengthMeters }),
    extend: (arcId, lengthMeters) => send({ kind: "geodesicEmitters/extend", arcId, lengthMeters }),
    deleteGeodesic: (emitterId, arcId) => send({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId }),
    remove: (emitterId) => send({ kind: "geodesicEmitters/remove", emitterId }),
  };
}

/** Creates the geodesic emitters module. It requires the geodesic model, whose arcs leave from the emitters. */
export function geodesicEmittersModule(): GeodesicEmittersModuleDefinition {
  return {
    id: "geodesicEmitters",
    provides: geodesicEmittersToken,
    requires: [geodesicModelToken],
    objectKinds: [{ kind: geodesicEmitterKind, label: "real", persistence: "saved" }],
    toolIds: [geodesicEmitterToolId],
    create: (context) => {
      const model = context.require(geodesicModelToken);
      // The step context for the callback below: set around one pass, so the callback is created once and a frame allocates nothing for it.
      let stepContext: StepContext | undefined;
      const follow = (participant: ParticipantRecord): void => followEdit(stepContext!, model, participant);
      const edit: ModuleTick = {
        id: "geodesicEmitters/edit",
        phase: "bodies",
        writes: [geodesicEmitterKind],
        run(ctx) {
          stepContext = ctx;
          try {
            ctx.forEachParticipant(follow);
          } finally {
            stepContext = undefined;
          }
        },
      };
      const commands: CommandHandlers<GeodesicEmittersCommand> = {
        "geodesicEmitters/place": { run: createPlace(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/shoot": { run: shoot, requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/extend": { run: createExtend(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/deleteGeodesic": { run: createDeleteGeodesic(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/remove": { run: createRemove(model), requiresTool: geodesicEmitterToolId },
        "geodesicEmitters/beginEdit": { run: createBeginEdit(model), requiresTool: editToolId },
        "geodesicEmitters/endEdit": { run: createEndEdit(model), requiresTool: editToolId },
        "geodesicEmitters/lift": { run: lift, moduleOnly: true },
        "geodesicEmitters/land": { run: land, moduleOnly: true },
      };
      return { api: createApi(context.objects, model), queries: {}, commands, ticks: [edit], publicApi: createPublicApi(context.submitPublicCommand) };
    },
  };
}
