/**
 * The world map's client part (design 013 sections 8.3 and 9.1): the map tool. The map shows while the tool is selected (`render/three/worldMapRenderer.ts` reads the selection), so the tool itself only has to end: the primary action dismisses it, and choosing another tool ends it as it ends any tool.
 */
import type { ModuleClient, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import { toolNames } from "../../world-objects/vocabulary";
import { worldMapToolId } from "./api";

function primaryAction(tool: ToolContext): boolean {
  tool.endTool();
  return true;
}

function createMapToolDescriptor(): ToolDescriptor {
  return {
    id: worldMapToolId,
    ownerModuleId: "worldMap",
    label: toolNames[worldMapToolId].name,
    badgeLabel: toolNames[worldMapToolId].name,
    helpTitle: toolNames[worldMapToolId].name,
    helpBody: `${toolNames[worldMapToolId].subtitle}: a small solid with the objects on it, and you.`,
    helpRows: [{ input: "primary", label: "close the map" }, { input: "context-menu", label: "open the menu of what you aim at" }],
    indicatorColor: "#38bdf8",
    iconId: "map",
    showsAimCross: false,
    entry: { kind: "main-tool" },
    onPrimaryAction: primaryAction,
  };
}

/** Creates the client part. */
export function worldMapClient(): ModuleClient {
  return { tools: [createMapToolDescriptor()] };
}
