/**
 * The placed flags' client part (design 013 sections 8.3 and 9.1): the sign tool, and the requests the sign's menu page makes.
 * All of it changes the world only by `ToolContext.submit`. A click on the floor asks for a flag; while that is in flight a press does nothing, and an accepted flag ends the tool. A refusal is shown and the tool stays.
 * Typing is not a press: the page holds the text, each key sends the whole message, and the world takes them in order, so no key waits for the one before it.
 */
import type { CommandResult, ModuleClient, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import { toolNames } from "../../world-objects/vocabulary";
import { placedFlagToolId, type PlacedFlagsPlaceCommand, type PlacedFlagsRemoveCommand, type PlacedFlagsResult, type PlacedFlagsSetMessageCommand } from "./api";

function primaryAction(tool: ToolContext): boolean {
  if (tool.commandInFlight()) return true;
  const pick = tool.currentPick();
  if (pick?.objectKind !== "floor") return true;
  const place: PlacedFlagsPlaceCommand = { kind: "placedFlags/place", cellId: pick.cellId, point: pick.point, eyePoint: pick.eyePoint, flagType: tool.chosenFlagType() };
  tool.submit(place);
  return true;
}

function onResult(tool: ToolContext, result: CommandResult): void {
  if (!result.ok) {
    tool.showMessage(result.refusal.message);
    return;
  }
  if ((result.value as unknown as PlacedFlagsResult).outcome === "placed") tool.endTool();
}

/** The sign's menu page changed the message. `tool` is the context of the sign tool. */
export function requestFlagMessage(tool: ToolContext, flagId: string, message: string): void {
  const command: PlacedFlagsSetMessageCommand = { kind: "placedFlags/setMessage", flagId, message };
  tool.submit(command);
}

/** The sign's menu page asks to delete the sign; the page closes with it, so there is no second press. */
export function requestFlagRemoval(tool: ToolContext, flagId: string): void {
  const command: PlacedFlagsRemoveCommand = { kind: "placedFlags/remove", flagId };
  tool.submit(command);
}

function createSignToolDescriptor(): ToolDescriptor {
  return {
    id: placedFlagToolId,
    ownerModuleId: "placedFlags",
    label: toolNames[placedFlagToolId].name,
    badgeLabel: toolNames[placedFlagToolId].name,
    helpTitle: toolNames[placedFlagToolId].name,
    helpBody: `${toolNames[placedFlagToolId].subtitle}: it stands on the floor where you aim.`,
    helpRows: [{ input: "primary", label: "place a sign" }, { input: "context-menu", label: "open the menu of what you aim at" }],
    indicatorColor: "#22c55e",
    iconId: "sign",
    showsAimCross: true,
    entry: { kind: "main-tool" },
    onPrimaryAction: primaryAction,
    onResult,
  };
}

/** Creates the client part. */
export function placedFlagsClient(): ModuleClient {
  return { tools: [createSignToolDescriptor()] };
}
