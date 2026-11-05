/**
 * The shell's tool host (design 013 section 8.3): the one lookup of tools (`toolsById`, built from the shell's own tools and the experience's client parts), the `ToolContext` that tools act through, and the per-frame dispatch of the primary action.
 * Tools change the world only by `ToolContext.submit`; the host keeps the tickets of what a tool submitted and hands each result to the tool's `onResult` after the step. The tool state of a tool is a record in the client session under its owner module; the host clears it when the tool ends.
 * The host knows no tool by name: the shell's tools arrive as handlers (coreTools.ts), the modules' tools as descriptors.
 * It owns the current frame's input (the aim ray, the yaw and the primary-action flag) that the shell hands it before each dispatch. It owns no GPU or DOM resource.
 */
import type { AimPick, CommandResult, EngineCommandBase, ModuleClient, ObjectActionEntry, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import { localParticipantId, type WorldEngine } from "../../engine/worldEngine";
import type { AimTarget } from "../../interaction/aimTarget";
import type { RuntimeToolId } from "../../glue/toolIds";
import type { ClientSession } from "../../runtime/clientSession";
import { createCoreToolDescriptors } from "../../runtime/coreTools";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import { createToolsById, findObjectActionTool, objectActionsFor, type ToolsById } from "../../runtime/toolRegistry";
import type { RootAimRay } from "./rootAimRay";

/** What the shell does for each of its own tools; the aim ray and the frame's input are passed in. */
export interface CoreToolActions {
  placeFlag(ray: RootAimRay | undefined): void;
  useGeodesicCannon(ray: RootAimRay | undefined): void;
  measureLength(ray: RootAimRay | undefined): void;
  protractor(ray: RootAimRay | undefined): void;
  protractorPrompt(): string;
  /** Finishes the carry when the primary action was requested; true then. */
  carry(primaryActionRequested: boolean): boolean;
  /** Updates the rotation from the frame's yaw; true when the primary action was requested. */
  rotate(yawDeltaRadians: number, primaryActionRequested: boolean): boolean;
  /** Updates the aim from the frame's ray; true when the primary action was requested. */
  aim(primaryActionRequested: boolean, ray: RootAimRay | undefined): boolean;
}

/** One frame's input to the tools. */
export interface ToolFrameInput {
  readonly ray: RootAimRay | undefined;
  readonly yawDeltaRadians: number;
  readonly primaryActionRequested: boolean;
}

/** Dependencies of {@link createToolHost}. */
export interface ToolHostDeps {
  readonly engine: WorldEngine;
  readonly session: ClientSession;
  /** The shell's one command path. */
  dispatch(command: RuntimeCommand): void;
  readonly clients: readonly ModuleClient[];
  readonly core: CoreToolActions;
  /** All aim targets along a ray, nearest first. */
  resolveCurrentAimTargets(ray: RootAimRay): readonly AimTarget[];
  /** True when the target is close enough to interact with. */
  targetIsWithinInteractionRange(target: AimTarget | undefined): boolean;
  /** With no tool selected the primary action acts on the focused object; true when it did. */
  useFocusedObject(ray: RootAimRay | undefined): boolean;
  /** Asks the world whether the player may switch to the tool; the tool starts when it agrees. */
  requestTool(toolId: RuntimeToolId, objectId: string): void;
  /** Shows a sentence from a tool to the person. */
  showMessage(message: string): void;
  /** Redraws the tool indicator and the palette: after a refused start and after a tool changed its state (its prompt follows the state). */
  syncDesktopPalette(): void;
  /** Re-syncs what is drawn from the world's objects (portal instances, hitbox debug) after the world answered a tool's commands. */
  syncWorldObjects(): void;
}

/** Handle returned by {@link createToolHost}. */
export interface ToolHost {
  readonly toolsById: ToolsById;
  /** Hands the host this frame's input; call before `dispatchPrimaryAction`. */
  setFrame(frame: ToolFrameInput): void;
  /**
   * Runs the selected tool's primary action: every frame for a tool that updates from the input each frame, else on a primary action with no menu open. With no tool selected it acts on the focused object.
   * `consumed` is whether an earlier handler of this frame already consumed the input; returns the new value.
   */
  dispatchPrimaryAction(worldPrimaryActionRequested: boolean, consumed: boolean): boolean;
  /** The prompt of the selected tool, from its state, or undefined. */
  promptOf(toolId: RuntimeToolId): string | undefined;
  /** The actions the tools contribute to the menu page of an object, with their availability now. */
  objectActionsFor(objectKind: string, objectId: string): readonly ObjectActionEntry[];
  /** Starts the tool behind an action on an object's page: asks the world, which starts it. */
  startObjectAction(objectKind: string, objectId: string, actionId: string): void;
  /** The world agreed to a tool request: runs the tool's `onStart`. */
  toolStarted(toolId: RuntimeToolId, objectId: string | undefined): void;
  /** A tool ended, however it ended: runs its `onEnd` and clears its owner's tool state. */
  toolEnded(toolId: RuntimeToolId): void;
  /** Call once per frame, after the frame's last tick, also in a frame with no tick: hands the results of the commands tools submitted to the tools. */
  afterStep(): void;
}

/** Creates the tool host. */
export function createToolHost(deps: ToolHostDeps): ToolHost {
  const { engine, session } = deps;
  let frame: ToolFrameInput = { ray: undefined, yawDeltaRadians: 0, primaryActionRequested: false };
  const pending: { readonly ticket: number; readonly toolId: RuntimeToolId }[] = [];

  const toolsById = createToolsById(
    createCoreToolDescriptors({
      placeFlag: () => deps.core.placeFlag(frame.ray),
      useGeodesicCannon: () => deps.core.useGeodesicCannon(frame.ray),
      measureLength: () => deps.core.measureLength(frame.ray),
      protractor: () => deps.core.protractor(frame.ray),
      protractorPrompt: () => deps.core.protractorPrompt(),
      carry: () => deps.core.carry(frame.primaryActionRequested),
      rotate: () => deps.core.rotate(frame.yawDeltaRadians, frame.primaryActionRequested),
      aim: () => deps.core.aim(frame.primaryActionRequested, frame.ray),
    }),
    deps.clients,
  );

  function pickTargets(): readonly AimPick[] {
    if (frame.ray === undefined) return [];
    return deps.resolveCurrentAimTargets(frame.ray).map((target): AimPick => {
      const object = target.object;
      const pick: AimPick = {
        objectId: object?.id,
        objectKind: object?.kind ?? "floor",
        cellId: target.cellId,
        point: target.localPoint,
        withinRange: deps.targetIsWithinInteractionRange(target),
      };
      if (object?.kind !== "geodesicModel/segment" || object.halfRole === undefined) return pick;
      // A half-labelled segment stands for the endpoint role of its arc that it belongs to.
      const arc = engine.read.objects.get(object.geodesicId);
      return arc?.kind === "geodesicModel/arc" ? { ...pick, geodesicEndpoint: arc[object.halfRole] } : pick;
    });
  }

  const contexts = new Map<RuntimeToolId, ToolContext>();
  function contextFor(toolId: RuntimeToolId): ToolContext {
    let context = contexts.get(toolId);
    if (context === undefined) {
      context = {
        pickTargets,
        submit(command: EngineCommandBase) {
          pending.push({ ticket: engine.submit(localParticipantId, command), toolId });
        },
        getToolState: <T>(moduleId: string) => session.get().moduleToolState[moduleId] as T | undefined,
        setToolState(moduleId, state) {
          deps.dispatch({ kind: "set-module-tool-state", moduleId, state });
          deps.syncDesktopPalette();
        },
        endTool() {
          deps.dispatch({ kind: "close-menu" });
          deps.dispatch({ kind: "clear-selected-tool" });
        },
        read: engine.read,
        query: (token) => engine.query(token),
        showMessage: deps.showMessage,
      };
      contexts.set(toolId, context);
    }
    return context;
  }

  return {
    toolsById,
    setFrame(next) {
      frame = next;
    },
    dispatchPrimaryAction(worldPrimaryActionRequested, consumed) {
      const tool = toolsById.get(session.get().menuState.selectedTool);
      if (tool === undefined) {
        // None or aim: the primary action acts on the focused object.
        return worldPrimaryActionRequested && !consumed ? deps.useFocusedObject(frame.ray) : consumed;
      }
      if (!tool.runsEveryFrame && !worldPrimaryActionRequested) return consumed;
      return tool.onPrimaryAction(contextFor(tool.id)) || consumed;
    },
    promptOf: (toolId) => {
      const tool = toolsById.get(toolId);
      return tool?.prompt?.(contextFor(toolId));
    },
    objectActionsFor: (objectKind, objectId) => objectActionsFor(toolsById, objectKind, objectId, contextFor),
    startObjectAction(objectKind, objectId, actionId) {
      const tool = findObjectActionTool(toolsById, objectKind, actionId);
      if (tool === undefined || tool.entry.kind !== "object-action") return;
      if (!tool.entry.isAvailable(objectId, contextFor(tool.id))) {
        deps.syncDesktopPalette();
        return;
      }
      deps.requestTool(tool.id, objectId);
    },
    toolStarted(toolId, objectId) {
      const tool = toolsById.get(toolId);
      if (tool === undefined) return;
      // Starting a tool that is already running (from another object's page) first ends the old run.
      tool.onEnd?.(contextFor(toolId));
      tool.onStart?.(contextFor(toolId), objectId);
    },
    toolEnded(toolId) {
      const tool = toolsById.get(toolId);
      if (tool === undefined) return;
      tool.onEnd?.(contextFor(toolId));
      deps.dispatch({ kind: "set-module-tool-state", moduleId: tool.ownerModuleId, state: undefined });
    },
    afterStep() {
      let answered = false;
      for (let index = 0; index < pending.length; index += 1) {
        const entry = pending[index]!;
        const result: CommandResult | undefined = engine.resultOf(entry.ticket);
        if (result === undefined) continue;
        pending.splice(index, 1);
        index -= 1;
        const tool: ToolDescriptor | undefined = toolsById.get(entry.toolId);
        tool?.onResult?.(contextFor(entry.toolId), result);
        answered = true;
      }
      if (answered) deps.syncWorldObjects();
    },
  };
}
