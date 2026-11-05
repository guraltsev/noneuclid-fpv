/**
 * The geodesic measurements module (design 013 section 6.4, design 014 D9): the length labels and protractor angles the player's tools place, kept current by two derive ticks that read the change ring.
 * Both kinds are materialized records: they stay in the registry because clients draw them. The user creates them (the tools still do, until the tools come from modules); this module only keeps them true.
 *
 * Tick `lengths` subscribes to arcs and segments and also wakes when the local participant's cell or position changed (a length label faces the player and sits on the segment nearest to them), refreshes every length with the pure refresher of `world-objects/measureLengthTool.ts`, and deletes a length whose geodesic is gone.
 * Tick `angles` subscribes to arcs and crossings. It removes the angles whose centre marker was removed, then refreshes the angles that stand on a geodesic or at a centre that changed, writing an angle only when it differs from the one in the registry; an angle that can no longer be resolved is deleted.
 * The module has no commands and no API: the ticks run after the geodesic model's (it requires its token), so a pass sees the crossings the same pass wrote.
 */
import { localParticipantId } from "../../engine/participants";
import type { ModuleDefinition, ModuleTick, StepContext } from "../../engine/moduleTypes";
import { deepEqual } from "../../world-objects/derived";
import { ChangeOp } from "../../world-objects/runtimeObjectChangeJournal";
import { refreshMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import { refreshProtractorAngleObject } from "../../world-objects/protractorTool";
import { geodesicModelToken } from "../geodesicModel/api";

/** The module as the engine's list takes it. */
export type GeodesicMeasurementsModuleDefinition = ModuleDefinition<undefined, never, never>;

const lengthKind = "geodesicMeasurements/length";
const angleKind = "geodesicMeasurements/angle";

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

function lengthsTick(): ModuleTick {
  const seen: LengthInputs = { cellId: "", x: Number.NaN, y: Number.NaN, z: Number.NaN };
  return {
    id: "geodesicMeasurements/lengths",
    phase: "derive",
    writes: [lengthKind],
    subscribes: ["geodesicModel/arc", "geodesicModel/segment"],
    wants: (ctx) => localPlayerMoved(ctx, seen),
    run(ctx) {
      const body = ctx.participant(localParticipantId)?.body;
      if (body === undefined) return;
      seen.cellId = body.cellId;
      seen.x = body.position.x;
      seen.y = body.position.y;
      seen.z = body.position.z;
      for (const length of ctx.objects.getObjectsOfKind(lengthKind)) {
        const refreshed = refreshMeasuredGeodesicLengthObject({
          registry: ctx.objects,
          world: ctx.world,
          measurement: length,
          playerCellId: body.cellId,
          playerPoint: body.position,
        });
        if (refreshed === undefined) {
          ctx.objects.remove(length.id);
        } else if (!deepEqual(refreshed, length)) {
          ctx.objects.update(refreshed);
        }
      }
    },
  };
}

function anglesTick(): ModuleTick {
  return {
    id: "geodesicMeasurements/angles",
    phase: "derive",
    writes: [angleKind],
    subscribes: ["geodesicModel/arc", "geodesicModel/crossing"],
    run(ctx) {
      const ring = ctx.objects.changes.ring;
      const changedIds = new Set<string>();
      let gone: Set<string> | undefined;
      for (let seq = ctx.changesFrom; seq < ctx.changesTo; seq += 1) {
        const kind = ring.kindAt(seq);
        if (kind !== "geodesicModel/arc" && kind !== "geodesicModel/crossing") continue;
        const id = ring.idAt(seq);
        changedIds.add(id);
        // A centre marker that was removed and not put back is gone: its angles go with it.
        if (kind === "geodesicModel/crossing" && ring.opAt(seq) === ChangeOp.Removed && ctx.objects.get(id)?.kind !== "geodesicModel/crossing") {
          (gone ??= new Set()).add(id);
        }
      }
      for (const angle of ctx.objects.getObjectsOfKind(angleKind)) {
        if (gone?.has(angle.centerObjectId)) {
          ctx.objects.remove(angle.id);
          continue;
        }
        if (!changedIds.has(angle.first.geodesicId) && !changedIds.has(angle.second.geodesicId) && !changedIds.has(angle.centerObjectId)) continue;
        const refreshed = refreshProtractorAngleObject({ registry: ctx.objects, angle });
        if (refreshed === undefined) {
          ctx.objects.remove(angle.id);
        } else if (!deepEqual(refreshed, angle)) {
          ctx.objects.update(refreshed);
        }
      }
    },
  };
}

/**
 * Creates the geodesic measurements module.
 * It requires the geodesic model, whose arcs, segments and crossings its ticks read.
 */
export function geodesicMeasurementsModule(): GeodesicMeasurementsModuleDefinition {
  return {
    id: "geodesicMeasurements",
    requires: [geodesicModelToken],
    objectKinds: [
      { kind: lengthKind, label: "cheap-derived", persistence: "transient" },
      { kind: angleKind, label: "cheap-derived", persistence: "transient" },
    ],
    create: () => ({ api: undefined, queries: undefined, commands: {}, ticks: [lengthsTick(), anglesTick()] }),
  };
}
