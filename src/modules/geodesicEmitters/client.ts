/**
 * The geodesic emitters' client part (design 013 sections 8.3 and 9.1): the emitter tool, and the requests the emitter's menu page and a click on a geodesic make.
 * All of it changes the world only by `ToolContext.submit` and reads through `ToolContext.read` and `query`. The tool resolves its aim first and sends cell-local data; a click on the floor places an emitter and, once the world has answered, shoots its first geodesic.
 * While a command of the tool is in flight, a press does nothing: a floor click is two commands, and the second press of a double click must not start anything. So at most one answer is awaited, and the client tool state, `moduleToolState.geodesicEmitters`, says whether a menu page waits for it.
 * A refusal is shown: the tool stays, and a waiting page is shown again as the world now has it.
 */
import type { CommandResult, ToolContext, ToolDescriptor, ModuleClient } from "../../engine/moduleTypes";
import { defaultTraceLengthMeters } from "../../world-objects/geodesic/objects";
import { toolNames } from "../../world-objects/vocabulary";
import { geodesicModelToken } from "../geodesicModel/api";
import {
  geodesicEmitterKind,
  geodesicEmitterToolId,
  type GeodesicEmitterDeleteGeodesicCommand,
  type GeodesicEmitterExtendCommand,
  type GeodesicEmitterPlaceCommand,
  type GeodesicEmittersResult,
  type GeodesicEmitterShootCommand,
} from "./api";

const moduleId = "geodesicEmitters";

/** The client tool state: the emitter whose menu page shows the result of the command in flight. */
interface EmitterToolState {
  readonly pageEmitterId: string;
}

function shootFrom(tool: ToolContext, emitterId: string, yawRadians: number): void {
  const shoot: GeodesicEmitterShootCommand = { kind: "geodesicEmitters/shoot", emitterId, yawRadians, lengthMeters: defaultTraceLengthMeters };
  tool.submit(shoot);
}

/** A new geodesic leaves in a random direction in \([-\pi, \pi)\). */
function randomYawRadians(): number {
  return Math.random() * Math.PI * 2 - Math.PI;
}

function primaryAction(tool: ToolContext): boolean {
  if (tool.commandInFlight()) return true;
  const pick = tool.currentPick();
  if (pick === undefined) return true;
  if (pick.objectKind === geodesicEmitterKind) {
    if (pick.withinRange && pick.objectId !== undefined) shootFrom(tool, pick.objectId, randomYawRadians());
    return true;
  }
  if (pick.objectKind !== "floor" && pick.objectKind !== "geodesicModel/crossing" && pick.objectKind !== "geodesicModel/segment") return true;
  // A (near-)vertical aim has no horizontal direction: the click does nothing.
  const yawRadians = tool.aimYawRadians();
  if (yawRadians === undefined) return true;
  const place: GeodesicEmitterPlaceCommand = { kind: "geodesicEmitters/place", cellId: pick.cellId, point: pick.point, yawRadians };
  tool.submit(place);
  return true;
}

function onResult(tool: ToolContext, result: CommandResult): void {
  const pageEmitterId = tool.getToolState<EmitterToolState>(moduleId)?.pageEmitterId;
  if (pageEmitterId !== undefined) tool.setToolState(moduleId, undefined);
  if (!result.ok) {
    tool.showMessage(result.refusal.message);
    if (pageEmitterId !== undefined) tool.showObjectPage(pageEmitterId);
    return;
  }

  const value = result.value as GeodesicEmittersResult;
  switch (value.outcome) {
    case "placed": {
      const firstArcId = value.arcIds[0];
      if (firstArcId !== undefined) {
        tool.selectObject(value.emitterId, firstArcId);
        return;
      }
      // On the floor: the emitter fires its first geodesic the way it faces. The tool ends with that answer.
      const emitter = tool.read.objects.get(value.emitterId);
      if (emitter?.kind === geodesicEmitterKind) shootFrom(tool, emitter.id, emitter.aimYawRadians);
      return;
    }
    case "shot":
      tool.selectObject(value.emitterId, value.arcId);
      // The laser tool stays in hand (design 017 section 8.3); only the emitter's page returns to its menu.
      if (pageEmitterId !== undefined) tool.showObjectPage(pageEmitterId);
      return;
    case "extended":
      tool.selectObject(value.emitterId, value.arcId);
      return;
    case "geodesicDeleted":
      if (pageEmitterId !== undefined) tool.showObjectPage(pageEmitterId);
      return;
  }
}

/** The emitter's menu page asks for a new geodesic; the page shows it when the world has answered. */
export function requestNewGeodesic(tool: ToolContext, emitterId: string): void {
  if (tool.commandInFlight()) return;
  tool.setToolState(moduleId, { pageEmitterId: emitterId } satisfies EmitterToolState);
  shootFrom(tool, emitterId, randomYawRadians());
}

/** The emitter's menu page asks to delete a geodesic; the page shows the emitter without it when the world has answered. */
export function requestGeodesicDeletion(tool: ToolContext, emitterId: string, arcId: string): void {
  if (tool.commandInFlight()) return;
  tool.setToolState(moduleId, { pageEmitterId: emitterId } satisfies EmitterToolState);
  const deletion: GeodesicEmitterDeleteGeodesicCommand = { kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId };
  tool.submit(deletion);
}

/** A click on a free geodesic asks to lengthen it. False, asking nothing, for a geodesic that connects emitters or is tied: a click on one means nothing. */
export function requestGeodesicExtension(tool: ToolContext, arcId: string): boolean {
  const model = tool.query(geodesicModelToken);
  if (model.connectsEmitters(arcId) || model.isTied(arcId)) return false;
  if (tool.commandInFlight()) return true;
  const extension: GeodesicEmitterExtendCommand = { kind: "geodesicEmitters/extend", arcId, lengthMeters: defaultTraceLengthMeters };
  tool.submit(extension);
  return true;
}

function createEmitterToolDescriptor(): ToolDescriptor {
  return {
    id: geodesicEmitterToolId,
    ownerModuleId: moduleId,
    label: toolNames[geodesicEmitterToolId].name,
    badgeLabel: toolNames[geodesicEmitterToolId].name,
    helpTitle: toolNames[geodesicEmitterToolId].name,
    helpBody: `${toolNames[geodesicEmitterToolId].subtitle}. Aim at the floor and Use to place a laser; Use on a laser fires a new beam, and Use on a free beam makes it longer.`,
    helpRows: [{ input: "primary", label: "place a laser or make a beam longer" }, { input: "context-menu", label: "open the menu of what you aim at" }],
    indicatorColor: "#facc15",
    iconId: "ray",
    showsAimCross: true,
    entry: { kind: "main-tool" },
    onPrimaryAction: primaryAction,
    onResult,
  };
}

/** Creates the client part. */
export function geodesicEmittersClient(): ModuleClient {
  return { tools: [createEmitterToolDescriptor()] };
}
