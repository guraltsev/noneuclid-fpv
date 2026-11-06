/**
 * The geodesic measurements' client part (design 013 sections 8.3 and 9.1): the length tool and the protractor, and the removal a click on a label asks for.
 * All of it changes the world only by `ToolContext.submit` and reads through `ToolContext.read`. The protractor's picks are its client tool state, `moduleToolState.geodesicMeasurements`: the vertex, then the first side. The third pick asks the world.
 * While a command of a tool is in flight, a press does nothing, so a double click measures once. An accepted measurement ends the tool; a refusal is shown, the tool stays, and the protractor starts its picks again.
 */
import type { CommandResult, ModuleClient, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import { protractorSelectionsUseDifferentGeodesics, resolveProtractorCenterSelection, resolveProtractorSideAt, type ProtractorToolState } from "../../world-objects/protractorTool";
import {
  geodesicLengthToolId,
  geodesicMeasurementsModuleId,
  geodesicProtractorToolId,
  type GeodesicMeasurementsCreateAngleCommand,
  type GeodesicMeasurementsCreateLengthCommand,
  type GeodesicMeasurementsRemoveAngleCommand,
  type GeodesicMeasurementsRemoveLengthCommand,
  type GeodesicMeasurementsResult,
} from "./api";

function measureLength(tool: ToolContext): boolean {
  if (tool.commandInFlight()) return true;
  const pick = tool.currentPick();
  if (pick === undefined || !pick.withinRange || pick.objectId === undefined) return true;
  const segment = tool.read.objects.get(pick.objectId);
  if (segment?.kind !== "geodesicModel/segment") return true;
  const command: GeodesicMeasurementsCreateLengthCommand = { kind: "geodesicMeasurements/createLength", arcId: segment.geodesicId };
  tool.submit(command);
  return true;
}

function pickWithProtractor(tool: ToolContext): boolean {
  if (tool.commandInFlight()) return true;
  const pick = tool.currentPick();
  if (pick === undefined || !pick.withinRange) return true;

  const { center, first } = tool.getToolState<ProtractorToolState>(geodesicMeasurementsModuleId) ?? {};
  if (center === undefined) {
    const object = pick.objectId === undefined ? undefined : tool.read.objects.get(pick.objectId);
    if (object?.kind === "geodesicEmitters/emitter" || object?.kind === "geodesicModel/crossing") {
      tool.setToolState(geodesicMeasurementsModuleId, { center: resolveProtractorCenterSelection(tool.read.objects, object) } satisfies ProtractorToolState);
    }
    return true;
  }

  const side = resolveProtractorSideAt(tool.read.objects, center, pick);
  if (side === undefined) return true;
  if (first === undefined) {
    tool.setToolState(geodesicMeasurementsModuleId, { center, first: side } satisfies ProtractorToolState);
    return true;
  }
  if (!protractorSelectionsUseDifferentGeodesics(first, side)) return true;
  const command: GeodesicMeasurementsCreateAngleCommand = { kind: "geodesicMeasurements/createAngle", center: center.objectId, first, second: side };
  tool.submit(command);
  return true;
}

function protractorPrompt(tool: ToolContext): string {
  const { center, first } = tool.getToolState<ProtractorToolState>(geodesicMeasurementsModuleId) ?? {};
  if (center === undefined) return "select: vertex";
  return first === undefined ? "select: side1" : "select: side2";
}

function onResult(tool: ToolContext, result: CommandResult): void {
  if (!result.ok) {
    tool.showMessage(result.refusal.message);
    tool.setToolState(geodesicMeasurementsModuleId, undefined);
    return;
  }
  const { outcome } = result.value as unknown as GeodesicMeasurementsResult;
  if (outcome === "lengthCreated" || outcome === "angleCreated") {
    tool.setToolState(geodesicMeasurementsModuleId, undefined);
    tool.endTool();
  }
}

/** A click on a length label asks to remove it. `tool` is the context of the length tool. */
export function requestLengthRemoval(tool: ToolContext, lengthId: string): void {
  if (tool.commandInFlight()) return;
  const command: GeodesicMeasurementsRemoveLengthCommand = { kind: "geodesicMeasurements/removeLength", lengthId };
  tool.submit(command);
}

/** A click on an angle label asks to remove it. `tool` is the context of the protractor. */
export function requestAngleRemoval(tool: ToolContext, angleId: string): void {
  if (tool.commandInFlight()) return;
  const command: GeodesicMeasurementsRemoveAngleCommand = { kind: "geodesicMeasurements/removeAngle", angleId };
  tool.submit(command);
}

function createLengthToolDescriptor(): ToolDescriptor {
  return {
    id: geodesicLengthToolId,
    ownerModuleId: geodesicMeasurementsModuleId,
    label: "Length",
    helpTitle: "Length tool",
    helpBody: "Measures total length along a selected geodesic.",
    helpRows: [{ input: "primary", label: "choose geodesic" }, { input: "context-menu", label: "open choices" }],
    indicatorColor: "#22c55e",
    iconId: "length",
    showsAimCross: true,
    entry: { kind: "main-tool" },
    prompt: () => "select: geodesic",
    onPrimaryAction: measureLength,
    onResult,
  };
}

function createProtractorDescriptor(): ToolDescriptor {
  return {
    id: geodesicProtractorToolId,
    ownerModuleId: geodesicMeasurementsModuleId,
    label: "Protractor",
    helpTitle: "Protractor tool",
    helpBody: "Measures the angle between two geodesic sides at a vertex.",
    helpRows: [{ input: "primary", label: "select vertex or side" }, { input: "context-menu", label: "open choices" }],
    indicatorColor: "#fb7185",
    iconId: "protractor",
    showsAimCross: true,
    entry: { kind: "main-tool" },
    prompt: protractorPrompt,
    onPrimaryAction: pickWithProtractor,
    onResult,
  };
}

/** Creates the client part. */
export function geodesicMeasurementsClient(): ModuleClient {
  return { tools: [createLengthToolDescriptor(), createProtractorDescriptor()] };
}
