/**
 * The world map's client part (design 013 sections 8.3 and 9.1): the map tool. The map shows while the tool is selected (`render/three/worldMapRenderer.ts` reads the selection), so the tool itself only has to end: the primary action dismisses it, and choosing another tool ends it as it ends any tool.
 */
import type { ModuleClient, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import { worldMapToolId } from "./api";

function primaryAction(tool: ToolContext): boolean {
  tool.endTool();
  return true;
}

function createMapToolDescriptor(): ToolDescriptor {
  return {
    id: worldMapToolId,
    ownerModuleId: "worldMap",
    label: "Map",
    helpTitle: "World map",
    helpBody: "Shows the whole world as a small solid, with its objects and you on it.",
    helpRows: [{ input: "primary", label: "close map" }, { input: "context-menu", label: "open tools" }],
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
