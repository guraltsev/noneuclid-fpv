/**
 * The shell's one lookup of tools (design 013 section 8.3): `toolsById` maps a tool id to its descriptor, built once from the shell's own descriptors (coreTools.ts) and the descriptors the experience's client parts contribute.
 * Every place that used to switch on tool ids (the frame dispatch, the indicators, the help lens, the aim cross, the object menu pages) reads this map. The functions here are pure.
 */
import type { ModuleClient, ObjectActionEntry, ToolContext, ToolDescriptor } from "../engine/moduleTypes";
import type { RuntimeToolId } from "../glue/toolIds";
import { disabledReasons } from "../world-objects/vocabulary";

/** The descriptors by tool id. */
export type ToolsById = ReadonlyMap<RuntimeToolId, ToolDescriptor>;

/** Builds the lookup; throws on a tool id described twice, because two descriptors for one tool would make the dispatch depend on list order. */
export function createToolsById(core: readonly ToolDescriptor[], clients: readonly ModuleClient[]): ToolsById {
  const byId = new Map<RuntimeToolId, ToolDescriptor>();
  for (const descriptor of [...core, ...clients.flatMap((client) => client.tools)]) {
    if (byId.has(descriptor.id)) throw new Error(`the tool ${descriptor.id} is described twice`);
    byId.set(descriptor.id, descriptor);
  }
  return byId;
}

/** The descriptor started by an action of an object of this kind, or undefined. */
export function findObjectActionTool(toolsById: ToolsById, objectKind: string, actionId: string): ToolDescriptor | undefined {
  for (const descriptor of toolsById.values()) {
    if (descriptor.entry.kind === "object-action" && descriptor.entry.objectKind === objectKind && descriptor.entry.action.actionId === actionId) return descriptor;
  }
  return undefined;
}

/** The actions the tools contribute to the menu page of one object, in registration order, each with its current availability. */
export function objectActionsFor(
  toolsById: ToolsById,
  objectKind: string,
  objectId: string,
  contextFor: (toolId: RuntimeToolId) => ToolContext,
): readonly ObjectActionEntry[] {
  const entries: ObjectActionEntry[] = [];
  for (const descriptor of toolsById.values()) {
    const entry = descriptor.entry;
    if (entry.kind !== "object-action" || entry.objectKind !== objectKind) continue;
    const context = contextFor(descriptor.id);
    const enabled = entry.isAvailable(objectId, context);
    entries.push(enabled
      ? { ...entry.action, enabled }
      : { ...entry.action, enabled, disabledReason: entry.unavailableReason?.(objectId, context) ?? disabledReasons.notAvailable });
  }
  return entries;
}
