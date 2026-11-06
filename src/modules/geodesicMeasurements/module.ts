/**
 * The geodesic measurements module (design 013 section 6.4, design 014 D9): the length labels and protractor angles, made and removed by its commands and kept current by two derive ticks that read the change ring.
 * Both kinds are materialized records: they stay in the registry because clients draw them. Their choices (a length's geodesic, an angle's centre and sides) are real, so both are declared `saved`; their values are refreshed after a load, when every record has no memo yet.
 *
 * With the option `trackReads` (the default), both ticks keep, for each record, a module-private memo of what its last refresh read (`world-objects/trackedReads.ts`: the ids it fetched, the kinds it scanned, the geodesics whose segments it listed), and refresh a record only when a write in the ring range hit that read set; a record with no memo is refreshed once. No list of "relevant" kinds or fields is written by hand: what a refresh reads is what it depends on. Tracking costs a little per record and pays when many records are not touched by a change; without it, every record is refreshed on each wake.
 * Tick `lengths` subscribes to `lengthReadKinds` and also wakes when the local participant's cell or position changed (a length label faces the player and sits on the segment nearest to them; then every label is refreshed), refreshes with the pure refresher of `world-objects/measureLengthTool.ts`, and deletes a length whose geodesic is gone.
 * Tick `angles` subscribes to `angleReadKinds` (the kinds a protractor refresh can read). It refreshes the angles whose read set was hit, writing an angle only when it differs from the one in the registry; an angle that can no longer be resolved is deleted.
 * An angle whose crossing vanished is hidden, not deleted (design 013 section 17, item 6): the refresh gives it `vanishedSecondsLeft`, and takes it away when the crossing returns. Tick `vanishedAngles`, in `simulate`, is the world time: while nobody holds an emitter of either geodesic it counts that value down by the length of each step, and at 0 deletes the angle. While someone does, it puts the value back to full. So the 3 s run from the end of the last edit or carry, or, with none, from the moment the crossing vanished, and no moment is stored: holding is read from the participants' attachments, which are real, and what is left is the one thing that cannot be recomputed. In a frame with no tick nothing advances. The set of waiting angles is a memo: the `angles` tick fills it from the records, so after a load the wait goes on from what the record says.
 * The ticks run after the geodesic model's (it requires its token), so a pass sees the crossings the same pass wrote.
 */
import { localParticipantId } from "../../engine/participants";
import type { CommandContext, CommandHandlers, CommandResult, ModuleDefinition, ModuleTick, PlainData, StepContext } from "../../engine/moduleTypes";
import { deepEqual } from "../../world-objects/derived";
import { createMeasuredGeodesicLengthObject, geodesicDisplayName, refreshMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  protractorSelectionsUseDifferentGeodesics,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorSides,
  vanishedAngleSeconds,
} from "../../world-objects/protractorTool";
import type { RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import type { ProtractorDirectedGeodesic } from "../../world-objects/toolObjects";
import { createReadRecorder, ReadDigest, type ReadRecorder, type ReadSet } from "../../world-objects/trackedReads";
import { geodesicModelToken, type GeodesicModelApi } from "../geodesicModel/api";
import {
  geodesicLengthToolId,
  geodesicMeasurementsRefusals,
  geodesicProtractorToolId,
  type GeodesicMeasurementsCommand,
  type GeodesicMeasurementsCreateAngleCommand,
  type GeodesicMeasurementsCreateLengthCommand,
  type GeodesicMeasurementsRemoveAngleCommand,
  type GeodesicMeasurementsRemoveLengthCommand,
  type GeodesicMeasurementsResult,
} from "./api";

/** The module as the engine's list takes it. */
export type GeodesicMeasurementsModuleDefinition = ModuleDefinition<undefined, GeodesicMeasurementsCommand, never>;

/** How the module is configured. */
export interface GeodesicMeasurementsOptions {
  /** Refresh only the records whose last reads were written (default true); false refreshes every record on each wake. */
  readonly trackReads?: boolean;
}

const lengthKind = "geodesicMeasurements/length";
const angleKind = "geodesicMeasurements/angle";

/** The kinds a length label can read: the segments of its geodesic. The `lengths` tick subscribes to exactly these; the oracle test checks every read set against them. */
export const lengthReadKinds: readonly string[] = ["geodesicModel/segment"];

/** The kinds an angle can read: its centre (a cannon or a crossing marker), the segments of its legs, and the arc index (arcs and vertices). The `angles` tick subscribes to these; the oracle test checks every read set against them. */
export const angleReadKinds: readonly string[] = ["geodesicEmitters/emitter", "geodesicModel/arc", "geodesicModel/crossing", "geodesicModel/segment", "geodesicModel/vertex"];

/** The local player's cell and position as the last `lengths` run saw them (NaN: never run). */
interface LengthInputs {
  cellId: string;
  x: number;
  y: number;
  z: number;
}

function localPlayerMoved(ctx: StepContext, seen: LengthInputs): boolean {
  const body = ctx.participant(localParticipantId)?.body;
  if (body === undefined) return false;
  return body.cellId !== seen.cellId || body.position.x !== seen.x || body.position.y !== seen.y || body.position.z !== seen.z;
}

/** A tick's recording reader, made on first use and again if the registry it wraps changes (the engine hands a tick the same registry every step). */
interface RecorderCache {
  registry?: RuntimeObjectRegistry;
  recorder?: ReadRecorder;
}

function recorderFor(cache: RecorderCache, registry: RuntimeObjectRegistry): ReadRecorder {
  if (cache.recorder === undefined || cache.registry !== registry) {
    cache.registry = registry;
    cache.recorder = createReadRecorder(registry);
  }
  return cache.recorder;
}

/** The last read set plus the record's own id: a change of the record itself (its geodesic, its selections) is an input too. */
function readsWithOwnId(recorder: ReadRecorder, id: string): ReadSet {
  const reads = recorder.lastReads();
  (reads.ids as Set<string>).add(id);
  return reads;
}

/** Forgets the memos of records that are no longer in the registry (a record removed by someone else). */
function pruneMemos(memos: Map<string, ReadSet>, registry: RuntimeObjectRegistry, kind: typeof lengthKind | typeof angleKind): void {
  if (memos.size <= registry.countOfKind(kind)) return;
  for (const id of memos.keys()) {
    if (registry.get(id)?.kind !== kind) memos.delete(id);
  }
}

function lengthsTick(trackReads: boolean): ModuleTick {
  const seen: LengthInputs = { cellId: "", x: Number.NaN, y: Number.NaN, z: Number.NaN };
  // The reads of each length at its last refresh (design 014 D1: a memo of the tick, not a field of the object).
  const memos = new Map<string, ReadSet>();
  const digest = new ReadDigest();
  const recorderCache: RecorderCache = {};
  return {
    id: "geodesicMeasurements/lengths",
    phase: "derive",
    writes: [lengthKind],
    subscribes: lengthReadKinds,
    wants: (ctx) => localPlayerMoved(ctx, seen),
    run(ctx) {
      const body = ctx.participant(localParticipantId)?.body;
      if (body === undefined) return;
      // The player's cell and position are inputs that are not in the ring: when they moved, every label is refreshed.
      const moved = localPlayerMoved(ctx, seen);
      seen.cellId = body.cellId;
      seen.x = body.position.x;
      seen.y = body.position.y;
      seen.z = body.position.z;
      if (trackReads) digest.load(ctx.objects.changes.ring, ctx.changesFrom, ctx.changesTo);
      const recorder = recorderFor(recorderCache, ctx.objects);
      for (const length of ctx.objects.getObjectsOfKind(lengthKind)) {
        const memo = memos.get(length.id);
        if (trackReads && !moved && memo !== undefined && !digest.touches(memo)) continue;
        const refresh = (reader: RuntimeObjectRegistry) =>
          refreshMeasuredGeodesicLengthObject({ registry: reader, world: ctx.world, measurement: length, playerCellId: body.cellId, playerPoint: body.position });
        const refreshed = trackReads ? recorder.run(refresh, memo) : refresh(ctx.objects);
        if (refreshed === undefined) {
          memos.delete(length.id);
          ctx.objects.remove(length.id);
          continue;
        }
        if (trackReads) memos.set(length.id, readsWithOwnId(recorder, length.id));
        if (!deepEqual(refreshed, length)) ctx.objects.update(refreshed);
      }
      pruneMemos(memos, ctx.objects, lengthKind);
    },
  };
}

function anglesTick(trackReads: boolean, waiting: Set<string>): ModuleTick {
  const memos = new Map<string, ReadSet>();
  const digest = new ReadDigest();
  const recorderCache: RecorderCache = {};
  return {
    id: "geodesicMeasurements/angles",
    phase: "derive",
    writes: [angleKind],
    subscribes: angleReadKinds,
    run(ctx) {
      if (trackReads) digest.load(ctx.objects.changes.ring, ctx.changesFrom, ctx.changesTo);
      const recorder = recorderFor(recorderCache, ctx.objects);
      for (const angle of ctx.objects.getObjectsOfKind(angleKind)) {
        const memo = memos.get(angle.id);
        // A record with no memo is refreshed once; after that only a write to something its last refresh read wakes it.
        if (trackReads && memo !== undefined && !digest.touches(memo)) continue;
        const refresh = (reader: RuntimeObjectRegistry) => refreshProtractorAngleObject({ registry: reader, angle });
        const refreshed = trackReads ? recorder.run(refresh, memo) : refresh(ctx.objects);
        if (refreshed === undefined) {
          memos.delete(angle.id);
          waiting.delete(angle.id);
          ctx.objects.remove(angle.id);
          continue;
        }
        if (trackReads) memos.set(angle.id, readsWithOwnId(recorder, angle.id));
        if (refreshed.vanishedSecondsLeft === undefined) waiting.delete(angle.id);
        else waiting.add(angle.id);
        if (!deepEqual(refreshed, angle)) ctx.objects.update(refreshed);
      }
      pruneMemos(memos, ctx.objects, angleKind);
    },
  };
}

/** Someone holds an emitter of this geodesic, or of the curve it is an arc of: an edit or a carry is an attachment whose object is the emitter. */
function emitterIsHeld(ctx: StepContext, model: GeodesicModelApi, held: ReadonlySet<string>, geodesicId: string): boolean {
  for (const arcId of model.curveOfArc(geodesicId)) {
    const arc = ctx.objects.get(arcId);
    if (arc?.kind === "geodesicModel/arc" && (held.has(arc.start.anchorObjectId) || held.has(arc.end.anchorObjectId))) return true;
  }
  return false;
}

/** The world time of the angles that wait for their crossing; see the module comment. Idle, at no cost, with none waiting. */
function vanishedAnglesTick(model: GeodesicModelApi, waiting: Set<string>): ModuleTick {
  const held = new Set<string>();
  return {
    id: "geodesicMeasurements/vanishedAngles",
    phase: "simulate",
    writes: [angleKind],
    isIdle: () => waiting.size === 0,
    run(ctx) {
      held.clear();
      ctx.forEachParticipant((participant) => {
        for (const attachment of participant.attachments) held.add(attachment.objectId);
      });
      for (const id of waiting) {
        const angle = ctx.objects.get(id);
        if (angle?.kind !== angleKind || angle.vanishedSecondsLeft === undefined) {
          waiting.delete(id);
          continue;
        }
        const aiming = held.size > 0 && (emitterIsHeld(ctx, model, held, angle.first.geodesicId) || emitterIsHeld(ctx, model, held, angle.second.geodesicId));
        const vanishedSecondsLeft = aiming ? vanishedAngleSeconds : angle.vanishedSecondsLeft - ctx.deltaSeconds;
        if (vanishedSecondsLeft <= 0) {
          waiting.delete(id);
          ctx.objects.remove(id);
        } else if (vanishedSecondsLeft !== angle.vanishedSecondsLeft) {
          ctx.objects.update({ ...angle, vanishedSecondsLeft });
        }
      }
    },
  };
}

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

function answer(value: GeodesicMeasurementsResult): CommandResult {
  return { ok: true, value: value as unknown as PlainData };
}

function createLength(command: GeodesicMeasurementsCreateLengthCommand, ctx: CommandContext): CommandResult {
  const { arcId } = command;
  const participant = ctx.participant(ctx.participantId);
  if (participant === undefined) return refuse("world/unknownParticipant", `There is no participant "${ctx.participantId}".`);
  const [fallbackSegment] = ctx.objects.get(arcId)?.kind === "geodesicModel/arc" ? ctx.objects.getSegmentsOfGeodesic(arcId) : [];
  if (fallbackSegment === undefined) return refuse(geodesicMeasurementsRefusals.notAnArc, "That is not a geodesic.");

  const existing = ctx.objects.getObjectsOfKind(lengthKind).find((length) => length.geodesicId === arcId);
  const measurement = createMeasuredGeodesicLengthObject({
    id: existing?.id ?? ctx.ids.next("length"),
    registry: ctx.objects,
    world: ctx.world,
    geodesicId: arcId,
    playerCellId: participant.body.cellId,
    playerPoint: participant.body.position,
    label: geodesicDisplayName(ctx.objects, arcId),
    fallbackSegment,
  })!;
  if (existing === undefined) ctx.objects.add(measurement);
  else ctx.objects.update(measurement);
  return answer({ outcome: "lengthCreated", id: measurement.id });
}

function removeLength(command: GeodesicMeasurementsRemoveLengthCommand, ctx: CommandContext): CommandResult {
  if (ctx.objects.get(command.lengthId)?.kind !== lengthKind) return refuse(geodesicMeasurementsRefusals.notALength, "That is not a length.");
  ctx.objects.remove(command.lengthId);
  return answer({ outcome: "lengthRemoved", id: command.lengthId });
}

/** A side as a script may send it: only what a refresh reads is checked here; the rest is the world's to find. */
function isSide(value: ProtractorDirectedGeodesic | undefined): value is ProtractorDirectedGeodesic {
  return typeof value === "object" && value !== null && typeof value.geodesicId === "string" && typeof value.segmentId === "string" && typeof value.yawRadians === "number";
}

function createAngle(command: GeodesicMeasurementsCreateAngleCommand, ctx: CommandContext): CommandResult {
  const centerObject = ctx.objects.get(command.center);
  if (centerObject?.kind !== "geodesicEmitters/emitter" && centerObject?.kind !== "geodesicModel/crossing") {
    return refuse(geodesicMeasurementsRefusals.notACenter, "That is not a vertex.");
  }
  if (!isSide(command.first) || !isSide(command.second)) return refuse(geodesicMeasurementsRefusals.notASide, "That is not a side of this vertex.");
  const center = resolveProtractorCenterSelection(ctx.objects, centerObject);
  const sides = resolveProtractorSides(ctx.objects, center, command.first, command.second);
  if (sides === undefined) return refuse(geodesicMeasurementsRefusals.notASide, "That is not a side of this vertex.");
  if (!protractorSelectionsUseDifferentGeodesics(sides.first, sides.second)) return refuse(geodesicMeasurementsRefusals.sameSide, "Those are the same side.");

  const angle = createProtractorAngleObject({ id: ctx.ids.next("angle"), center, ...sides });
  ctx.objects.add(angle);
  return answer({ outcome: "angleCreated", id: angle.id });
}

function removeAngle(command: GeodesicMeasurementsRemoveAngleCommand, ctx: CommandContext): CommandResult {
  if (ctx.objects.get(command.angleId)?.kind !== angleKind) return refuse(geodesicMeasurementsRefusals.notAnAngle, "That is not an angle.");
  ctx.objects.remove(command.angleId);
  return answer({ outcome: "angleRemoved", id: command.angleId });
}

/**
 * Creates the geodesic measurements module.
 * It requires the geodesic model, whose arcs, segments and crossings its commands and ticks read.
 */
export function geodesicMeasurementsModule(options: GeodesicMeasurementsOptions = {}): GeodesicMeasurementsModuleDefinition {
  const trackReads = options.trackReads ?? true;
  return {
    id: "geodesicMeasurements",
    requires: [geodesicModelToken],
    objectKinds: [
      { kind: lengthKind, label: "cheap-derived", persistence: "saved" },
      { kind: angleKind, label: "cheap-derived", persistence: "saved" },
    ],
    toolIds: [geodesicLengthToolId, geodesicProtractorToolId],
    create: (context) => {
      const model = context.require(geodesicModelToken);
      const waiting = new Set<string>();
      const commands: CommandHandlers<GeodesicMeasurementsCommand> = {
        "geodesicMeasurements/createLength": { run: createLength, requiresTool: geodesicLengthToolId },
        "geodesicMeasurements/removeLength": { run: removeLength, requiresTool: geodesicLengthToolId },
        "geodesicMeasurements/createAngle": { run: createAngle, requiresTool: geodesicProtractorToolId },
        "geodesicMeasurements/removeAngle": { run: removeAngle, requiresTool: geodesicProtractorToolId },
      };
      return { api: undefined, queries: undefined, commands, ticks: [vanishedAnglesTick(model, waiting), lengthsTick(trackReads), anglesTick(trackReads, waiting)] };
    },
  };
}
