/**
 * The geodesic measurements module (design 013 section 6.4, design 014 D9): the length labels and protractor angles the player's tools place, kept current by two derive ticks that read the change ring.
 * Both kinds are materialized records: they stay in the registry because clients draw them. The user creates them (the tools still do, until the tools come from modules); this module only keeps them true.
 *
 * With the option `trackReads` (the default), both ticks keep, for each record, a module-private memo of what its last refresh read (`world-objects/trackedReads.ts`: the ids it fetched, the kinds it scanned, the geodesics whose segments it listed), and refresh a record only when a write in the ring range hit that read set; a record with no memo is refreshed once. No list of "relevant" kinds or fields is written by hand: what a refresh reads is what it depends on. Tracking costs a little per record and pays when many records are not touched by a change; without it, every record is refreshed on each wake.
 * Tick `lengths` subscribes to `lengthReadKinds` and also wakes when the local participant's cell or position changed (a length label faces the player and sits on the segment nearest to them; then every label is refreshed), refreshes with the pure refresher of `world-objects/measureLengthTool.ts`, and deletes a length whose geodesic is gone.
 * Tick `angles` subscribes to `angleReadKinds` (the kinds a protractor refresh can read). It removes the angles whose centre marker was removed, then refreshes the angles whose read set was hit, writing an angle only when it differs from the one in the registry; an angle that can no longer be resolved is deleted.
 * The module has no commands and no API: the ticks run after the geodesic model's (it requires its token), so a pass sees the crossings the same pass wrote.
 */
import { localParticipantId } from "../../engine/participants";
import type { ModuleDefinition, ModuleTick, StepContext } from "../../engine/moduleTypes";
import { deepEqual } from "../../world-objects/derived";
import { ChangeOp } from "../../world-objects/runtimeObjectChangeJournal";
import { refreshMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import { refreshProtractorAngleObject } from "../../world-objects/protractorTool";
import type { RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import { createReadRecorder, ReadDigest, type ReadRecorder, type ReadSet } from "../../world-objects/trackedReads";
import { geodesicModelToken } from "../geodesicModel/api";

/** The module as the engine's list takes it. */
export type GeodesicMeasurementsModuleDefinition = ModuleDefinition<undefined, never, never>;

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
export const angleReadKinds: readonly string[] = ["geodesic-cannon", "geodesicModel/arc", "geodesicModel/crossing", "geodesicModel/segment", "geodesicModel/vertex"];

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

function anglesTick(trackReads: boolean): ModuleTick {
  const memos = new Map<string, ReadSet>();
  const digest = new ReadDigest();
  const recorderCache: RecorderCache = {};
  return {
    id: "geodesicMeasurements/angles",
    phase: "derive",
    writes: [angleKind],
    subscribes: angleReadKinds,
    run(ctx) {
      const ring = ctx.objects.changes.ring;
      if (trackReads) digest.load(ring, ctx.changesFrom, ctx.changesTo);
      let gone: Set<string> | undefined;
      for (let seq = ctx.changesFrom; seq < ctx.changesTo; seq += 1) {
        // A centre marker that was removed and not put back is gone: its angles go with it.
        if (ring.kindAt(seq) === "geodesicModel/crossing" && ring.opAt(seq) === ChangeOp.Removed) {
          const id = ring.idAt(seq);
          if (ctx.objects.get(id)?.kind !== "geodesicModel/crossing") (gone ??= new Set()).add(id);
        }
      }
      const recorder = recorderFor(recorderCache, ctx.objects);
      for (const angle of ctx.objects.getObjectsOfKind(angleKind)) {
        if (gone?.has(angle.centerObjectId)) {
          memos.delete(angle.id);
          ctx.objects.remove(angle.id);
          continue;
        }
        const memo = memos.get(angle.id);
        // A record with no memo is refreshed once; after that only a write to something its last refresh read wakes it.
        if (trackReads && memo !== undefined && !digest.touches(memo)) continue;
        const refresh = (reader: RuntimeObjectRegistry) => refreshProtractorAngleObject({ registry: reader, angle });
        const refreshed = trackReads ? recorder.run(refresh, memo) : refresh(ctx.objects);
        if (refreshed === undefined) {
          memos.delete(angle.id);
          ctx.objects.remove(angle.id);
          continue;
        }
        if (trackReads) memos.set(angle.id, readsWithOwnId(recorder, angle.id));
        if (!deepEqual(refreshed, angle)) ctx.objects.update(refreshed);
      }
      pruneMemos(memos, ctx.objects, angleKind);
    },
  };
}

/**
 * Creates the geodesic measurements module.
 * It requires the geodesic model, whose arcs, segments and crossings its ticks read.
 */
export function geodesicMeasurementsModule(options: GeodesicMeasurementsOptions = {}): GeodesicMeasurementsModuleDefinition {
  const trackReads = options.trackReads ?? true;
  return {
    id: "geodesicMeasurements",
    requires: [geodesicModelToken],
    objectKinds: [
      { kind: lengthKind, label: "cheap-derived", persistence: "transient" },
      { kind: angleKind, label: "cheap-derived", persistence: "transient" },
    ],
    create: () => ({ api: undefined, queries: undefined, commands: {}, ticks: [lengthsTick(trackReads), anglesTick(trackReads)] }),
  };
}
