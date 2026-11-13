/**
 * The tie tool, the client part of `geodesicModel/tie` (design 013 sections 8.3 and 13.1): started from an emitter's menu page, it takes two endpoint roles of the emitter's geodesics that connect emitters, then asks the world to tie them at a new vertex.
 * The tool changes the world only by `ToolContext.submit` (the `tieAndDetach` command and the `highlightEndpoint` command that marks a picked end). Its picks are its client tool state, `moduleToolState.geodesicModel`: the emitter and the roles picked so far.
 * A refusal from the world is shown and the tool stays with no picks; success ends the tool; ending the tool, however it ends, takes the highlight off the picked ends.
 */
import type { CommandResult, ToolContext, ToolDescriptor } from "../../engine/moduleTypes";
import {
  geodesicModelToken,
  geodesicTieToolId,
  type GeodesicEndpointRef,
  type GeodesicHighlightEndpointCommand,
  type GeodesicTieAndDetachCommand,
} from "./api";
import { disabledReasons, objectActions, objectNouns, objectSubtitles, toolNames } from "../../world-objects/vocabulary";

/** The client tool state of the tie tool (stored under the module id). */
interface TieToolState {
  readonly emitterId: string;
  /** The ends picked so far; two means the tie has been asked for and the answer is awaited. */
  readonly picks: readonly GeodesicEndpointRef[];
}

const moduleId = "geodesicModel";

function sameEnd(first: GeodesicEndpointRef, second: GeodesicEndpointRef): boolean {
  return first.geodesicId === second.geodesicId && first.role === second.role;
}

function highlight(tool: ToolContext, selection: GeodesicEndpointRef, on: boolean): void {
  const command: GeodesicHighlightEndpointCommand = { kind: "geodesicModel/highlightEndpoint", selection, on };
  tool.submit(command);
}

function primaryAction(tool: ToolContext): boolean {
  const state = tool.getToolState<TieToolState>(moduleId);
  if (state === undefined) return false;
  const ends = tool.query(geodesicModelToken).tieableEnds(state.emitterId);
  let picked: GeodesicEndpointRef | undefined;
  for (const pick of tool.pickTargets()) {
    const end = pick.geodesicEndpoint;
    if (pick.withinRange && end !== undefined && ends.some((candidate) => sameEnd(candidate, end))) {
      picked = end;
      break;
    }
  }
  if (picked === undefined) return false;
  // A duplicate pick is ignored; so is any pick while the tie waits for the world's answer.
  if (state.picks.length >= 2 || state.picks.some((earlier) => sameEnd(earlier, picked))) return true;

  const picks = [...state.picks, picked];
  tool.setToolState(moduleId, { ...state, picks });
  if (picks.length < 2) {
    highlight(tool, picked, true);
    return true;
  }
  highlight(tool, picks[0]!, false);
  const tie: GeodesicTieAndDetachCommand = { kind: "geodesicModel/tieAndDetach", emitterId: state.emitterId, first: picks[0]!, second: picked };
  tool.submit(tie);
  return true;
}

function onResult(tool: ToolContext, result: CommandResult): void {
  const state = tool.getToolState<TieToolState>(moduleId);
  if (state === undefined) return;
  if (!result.ok) {
    tool.showMessage(result.refusal.message);
    tool.setToolState(moduleId, { ...state, picks: [] });
    return;
  }
  // The tie's result carries the new vertex; the highlight commands answer with no value.
  if (typeof result.value === "object" && result.value !== null && "vertexId" in result.value) {
    tool.setToolState(moduleId, undefined);
    tool.endTool();
  }
}

function onEnd(tool: ToolContext): void {
  const state = tool.getToolState<TieToolState>(moduleId);
  if (state === undefined) return;
  for (const end of state.picks) highlight(tool, end, false);
}

/** The descriptor of the tie tool. */
export function createTieToolDescriptor(): ToolDescriptor {
  return {
    id: geodesicTieToolId,
    ownerModuleId: moduleId,
    label: toolNames[geodesicTieToolId].name,
    helpTitle: toolNames[geodesicTieToolId].name,
    helpBody: `${objectActions.join} two linked beams at a laser into one ${objectNouns.string.singular}. ${objectSubtitles.string}.`,
    helpRows: [{ input: "primary", label: "select a linked beam near the laser" }],
    indicatorColor: "#f59e0b",
    iconId: "ray",
    showsAimCross: true,
    entry: {
      kind: "object-action",
      objectKind: "geodesicEmitters/emitter",
      action: {
        actionId: "tie-and-detach",
        label: objectActions.join,
        iconId: "tie-and-detach",
        tooltip: "Join two linked beams at this laser into a string that pulls itself tight",
      },
      isAvailable: (emitterId, tool) => tool.query(geodesicModelToken).tieableEnds(emitterId).length >= 2,
      unavailableReason: () => disabledReasons.joinNeedsTwoLinkedBeams,
    },
    prompt: (tool) => ((tool.getToolState<TieToolState>(moduleId)?.picks.length ?? 0) === 0 ? "select: first beam" : "select: second beam"),
    onPrimaryAction: primaryAction,
    onStart: (tool, objectId) => {
      if (objectId !== undefined) tool.setToolState(moduleId, { emitterId: objectId, picks: [] } satisfies TieToolState);
    },
    onResult,
    onEnd,
  };
}
