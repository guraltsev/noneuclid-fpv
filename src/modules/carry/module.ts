/**
 * The carry module (design 013 section 7): who carries what is world state.
 * `carry/attach` and `carry/detach` are commands; the hand sets the `carry/offset` slot each frame; in `applyControls`, once per frame, the carried emitter moves toward the hand by the carry contract (`world-objects/carry.ts`: displacement steps, re-homing, wall and zone stops) and the geodesics it anchors are rebuilt (the emitter's rule, `world-objects/geodesic/carryEnd.ts`), so the flow of the frame's steps sees them rebuilt.
 * The hand's leash policy stays `src/interaction/handCarry.ts`; the module applies it with the loose leash the carrier sends in the slot, and ends the carry itself, in the tick and with no command, when the policy says release (`carry/dropped`).
 * The module holds no state of its own: the relation is an attachment of the participant, the hand is a control slot. It writes no object: the emitter moves through the emitters' `api`, not by a command, because carrying uses the fast channel (design 013 section 5.4).
 */
import { decideHandCarry, handCarryArrived, handCarryLeashSlackMeters } from "../../interaction/handCarry";
import type { CommandContext, CommandHandlers, CommandResult, ModuleDefinition, ModuleTick, ParticipantAttachment, ParticipantRecord, PlainData, StepContext } from "../../engine/moduleTypes";
import { participantAttachment } from "../../engine/moduleTypes";
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { canBeCarried, carryMaxSpeedMetersPerSecond, carryTowardTarget, locateCarrierTarget, remainingToTarget } from "../../world-objects/carry";
import type { GeodesicEmitterObject } from "../../world-objects/geodesic/objects";
import { getRuntimeObjectInteractionRangeMeters } from "../../world-objects/interactionRange";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import {
  geodesicEmitterEditAttachmentKind,
  geodesicEmittersRefusals,
  geodesicEmittersToken,
  type GeodesicEmitterLiftCommand,
  type GeodesicEmittersApi,
} from "../geodesicEmitters/api";
import {
  carryAttachmentKind,
  carryOffsetSlot,
  carryRefusals,
  type CarryAttachCommand,
  type CarryCommand,
  type CarryDropReason,
  type CarryDroppedEvent,
  type CarryEvent,
  type CarryMovedEvent,
  type CarryOffset,
} from "./api";

/** The module as the engine's list takes it. */
export type CarryModuleDefinition = ModuleDefinition<undefined, CarryCommand, CarryEvent>;

type Cannon = GeodesicEmitterObject;

/** The tool the carry's commands name for the gates. */
const carryToolId = "geodesicEmitters/carry" as const;

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

/** The slot value as an offset, or undefined while the carrier has set none (or something that is not one). */
function readOffset(value: PlainData | undefined): CarryOffset | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { x, y, leashMeters } = value as { readonly [key: string]: PlainData };
  if (typeof x !== "number" || typeof y !== "number" || typeof leashMeters !== "number") return undefined;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(leashMeters) ? { x, y, leashMeters } : undefined;
}

function withoutCarry(participant: ParticipantRecord): readonly ParticipantAttachment[] {
  return participant.attachments.filter((attachment) => attachment.kind !== carryAttachmentKind);
}

function withCarry(participant: ParticipantRecord, carry: ParticipantAttachment): readonly ParticipantAttachment[] {
  return [...withoutCarry(participant), carry];
}

function asCannon(object: RuntimeWorldObject | undefined): Cannon | undefined {
  return object?.kind === "geodesicEmitters/emitter" ? object : undefined;
}

/** Ends the carry of `participant`: the emitter's final rebuild (without the safety net of the carry in progress), and the attachment and the slot go. */
function endCarry(ctx: Pick<StepContext, "setAttachments" | "closeControl">, emitters: GeodesicEmittersApi, participant: ParticipantRecord, carry: ParticipantAttachment): void {
  emitters.settleGeodesics(carry.objectId, carry.activeGeodesicId);
  ctx.setAttachments(participant.id, withoutCarry(participant));
  ctx.closeControl(participant.id, carryOffsetSlot);
}

/** The carry rules end the carry themselves, in the tick. */
function dropCarry(ctx: StepContext, emitters: GeodesicEmittersApi, participant: ParticipantRecord, carry: ParticipantAttachment, reason: CarryDropReason): void {
  const dropped: CarryDroppedEvent = { kind: "carry/dropped", participantId: participant.id, objectId: carry.objectId, reason };
  ctx.emit(dropped);
  endCarry(ctx, emitters, participant, carry);
}

function attach(command: CarryAttachCommand, ctx: CommandContext): CommandResult {
  const participant = ctx.participant(ctx.participantId);
  if (participant === undefined) return refuse("world/unknownParticipant", `There is no participant "${ctx.participantId}".`);
  const held = participantAttachment(participant, carryAttachmentKind);
  if (held !== undefined) {
    // The same pickup twice changes nothing; picking up a second object while holding one is refused (a hand holds one thing).
    return held.objectId === command.objectId ? { ok: true } : refuse(carryRefusals.alreadyCarried, "You are already carrying something.");
  }

  const cannon = asCannon(ctx.objects.get(command.objectId));
  if (cannon === undefined || !canBeCarried(cannon)) return refuse(carryRefusals.notCarriable, "That cannot be carried.");

  // First come, first served, between carriers and with whoever edits the emitter.
  let carrier: string | undefined;
  let editor: string | undefined;
  ctx.forEachParticipant((other) => {
    if (carrier === undefined && participantAttachment(other, carryAttachmentKind)?.objectId === cannon.id) carrier = other.id;
    if (editor === undefined && participantAttachment(other, geodesicEmitterEditAttachmentKind)?.objectId === cannon.id) editor = other.id;
  });
  if (carrier !== undefined) return refuse(carryRefusals.alreadyCarried, `Already carried by ${carrier}.`);
  if (editor !== undefined) return refuse(geodesicEmittersRefusals.alreadyEdited, `Being edited by ${editor}.`);

  // In reach: along the straight development from the body to the object, within the pickup range (plus the lag the hand's leash allows).
  const body = participant.body;
  const remaining = remainingToTarget(
    ctx.world,
    { cellId: cannon.cellId, position: cannon.localPose.translation, yawRadians: cannon.aimYawRadians },
    { cellId: body.cellId, point: { x: body.position.x, y: body.position.y, z: 0 } },
  );
  if (remaining === "unreachable" || remaining > getRuntimeObjectInteractionRangeMeters(cannon) + handCarryLeashSlackMeters) {
    return refuse(carryRefusals.outOfReach, "That is too far away to pick up.");
  }

  // Accepted: the emitter leaves the floor. The active geodesic may be one of those that stay on it.
  const lifting: GeodesicEmitterLiftCommand = { kind: "geodesicEmitters/lift", emitterId: cannon.id };
  ctx.dispatch(lifting);
  const activeGeodesicId = command.activeGeodesicId !== undefined && ctx.objects.get(command.activeGeodesicId) !== undefined ? command.activeGeodesicId : undefined;
  const carry: ParticipantAttachment = {
    kind: carryAttachmentKind,
    objectId: cannon.id,
    arrived: false,
    ...(activeGeodesicId === undefined ? {} : { activeGeodesicId }),
  };
  ctx.setAttachments(participant.id, withCarry(participant, carry));
  ctx.openControl(participant.id, carryOffsetSlot);
  return { ok: true };
}

function createDetach(emitters: GeodesicEmittersApi) {
  return (_command: unknown, ctx: CommandContext): CommandResult => {
    const participant = ctx.participant(ctx.participantId);
    const carry = participantAttachment(participant, carryAttachmentKind);
    if (participant !== undefined && carry !== undefined) endCarry(ctx, emitters, participant, carry);
    return { ok: true };
  };
}


/** Once per frame: the emitter a participant carries moves toward the participant's hand. */
function followCarrier(ctx: StepContext, emitters: GeodesicEmittersApi, participant: ParticipantRecord): void {
  const carry = participantAttachment(participant, carryAttachmentKind);
  if (carry === undefined) return;
  const cannon = asCannon(ctx.objects.get(carry.objectId));
  if (cannon === undefined) {
    dropCarry(ctx, emitters, participant, carry, "missing");
    return;
  }
  const offset = readOffset(ctx.control(participant.id, carryOffsetSlot));
  if (offset === undefined) return;

  // The hand may be on another face than the body or behind a wall; where it is comes from the carry contract, and the emitter then glides
  // toward it in displacement steps, the contract deciding how it reacts.
  const hand = locateCarrierTarget(ctx.world, participant.body, offset);
  if (hand === undefined) return;
  const emitterBody = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(cannon));
  const advance = carryTowardTarget({
    world: ctx.world,
    object: { cellId: cannon.cellId, position: cannon.localPose.translation, yawRadians: cannon.aimYawRadians, radiusMeters: emitterBody?.radius },
    target: { cellId: hand.cellId, point: { x: hand.point.x, y: hand.point.y, z: 0 } },
    maxTravelMeters: carryMaxSpeedMetersPerSecond * ctx.deltaSeconds,
    commit: (move) => {
      const placedCellId = move.placement.cellId;
      const moved = emitters.moveAlong({
        emitterId: cannon.id,
        cellId: placedCellId,
        localPose: yawRigidTransform3(move.placement.yawRadians, move.placement.position),
        route: move.route,
      });
      if (!moved.moved) {
        // The move cannot be reconciled with the portal words of the emitter's geodesics, so the emitter stays where it was.
        console.warn(`Carried emitter "${cannon.id}" stays: no route to "${placedCellId}" fits the portal word of ${moved.brokenGeodesicIds.join(", ")}.`);
      }
      return moved.moved;
    },
  });

  let current = carry;
  if (advance.steps > 0) {
    const rebuild = emitters.rebuildGeodesics(cannon.id, carry.activeGeodesicId);
    if (rebuild.regrownActiveGeodesicId !== undefined) current = { ...current, activeGeodesicId: rebuild.regrownActiveGeodesicId };
    const moved: CarryMovedEvent = {
      kind: "carry/moved",
      participantId: participant.id,
      objectId: cannon.id,
      ...(rebuild.regrownActiveGeodesicId === undefined ? {} : { regrownActiveGeodesicId: rebuild.regrownActiveGeodesicId }),
    };
    ctx.emit(moved);
  }
  // Whether the hand goes on holding the emitter is the hand's policy (a wall or a zone never ends a carry): the leash is loose while the
  // emitter still glides to the hand and tight once it has been at the hand (the first frame it is, the attachment is told).
  const arrived = carry.arrived || handCarryArrived(advance.remaining);
  if (arrived && !carry.arrived) current = { ...current, arrived: true };
  if (current !== carry) ctx.setAttachments(participant.id, withCarry(participant, current));
  if (decideHandCarry(advance.remaining, arrived ? "held" : "gliding", offset.leashMeters) === "release") {
    dropCarry(ctx, emitters, participant, current, "leash");
  }
}

/** Creates the carry module. It requires the emitters, the only things that can be carried. */
export function carryModule(): CarryModuleDefinition {
  return {
    id: "carry",
    requires: [geodesicEmittersToken],
    objectKinds: [],
    create: (context) => {
      const emitters = context.require(geodesicEmittersToken);
      // The step context for the callback below: set around one pass, so the callback is created once and a step allocates nothing for it.
      let stepContext: StepContext | undefined;
      const follow = (participant: ParticipantRecord): void => followCarrier(stepContext!, emitters, participant);
      const ticks: ModuleTick[] = [
        {
          id: "carry/follow",
          phase: "bodies",
          writes: [],
          run(ctx) {
            stepContext = ctx;
            try {
              ctx.forEachParticipant(follow);
            } finally {
              stepContext = undefined;
            }
          },
        },
      ];
      const commands: CommandHandlers<CarryCommand> = {
        "carry/attach": { run: attach, requiresTool: carryToolId },
        "carry/detach": { run: createDetach(emitters), requiresTool: carryToolId },

      };
      return { api: undefined, queries: {}, commands, ticks };
    },
  };
}
