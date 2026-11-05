/**
 * The shell's side of its conversation with the world engine (design 013 sections 5.3, 5.5 and 8.1): the tool-switch protocol (also for tools started from an object's menu page), the generic event sink and the `api.world` namespace.
 * Selecting a tool does not switch it: `requestTool` submits `world/requestTool` and records the request as pending in the client session; after the engine's step, `afterStep` switches to the tool when the world accepted it, or shows the world's message and stays on the old tool when it refused. A `world/toolRevoked` event for the selected tool ends that tool.
 * The module keeps one list of API callers waiting for a command result; it owns no world or client state of its own.
 */
import type { RuntimeToolId } from "../../glue/toolIds";
import { localParticipantId, type WorldEngine } from "../../engine/worldEngine";
import type { CommandResult, EngineCommandBase, EngineEventBase, WorldRequestToolCommand, WorldToolRevokedEvent } from "../../engine/moduleTypes";
import type { ApiObject } from "../../runtime/apiCall";
import type { ClientSession } from "../../runtime/clientSession";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";

/** What the world client needs from the shell. */
export interface WorldClientDeps {
  readonly engine: WorldEngine;
  readonly session: ClientSession;
  /** The shell's one command path. */
  dispatch(command: RuntimeCommand): void;
  /** Called after the world accepted a tool request and the tool was selected; `objectId` is the object the tool was started from. */
  toolStarted(toolId: RuntimeToolId, objectId: string | undefined): void;
  /** Shows a sentence from the world to the person; `detail` is plain data for diagnostics. There is no on-screen message system yet, so the shell logs it. */
  showMessage(message: string, detail: EngineEventBase | { readonly code: string }): void;
}

/** Handle returned by {@link createWorldClient}. */
export interface WorldClient {
  /** Asks the world whether the local player may switch to `toolId`; the switch happens in `afterStep` on acceptance. `objectId` is the object the tool is started from, handed to `toolStarted`. */
  requestTool(toolId: RuntimeToolId, objectId?: string): void;
  /** Call after every `engine.step`: settles the pending tool request, runs the event sink and answers waiting API callers. */
  afterStep(): void;
  /** The `world` namespace of the public API: `submit(command)` and `participants()`. */
  readonly api: ApiObject;
  /** Resolves every waiting API caller with a refusal; call on teardown. */
  dispose(): void;
}

/** Creates the world client over the shell's engine, session and command path. */
export function createWorldClient(deps: WorldClientDeps): WorldClient {
  const { engine, session } = deps;
  const waiters: { readonly ticket: number; readonly resolve: (result: CommandResult) => void }[] = [];

  function settleToolRequest(): void {
    const pending = session.get().pendingToolRequest;
    if (pending === undefined) return;
    const result = engine.resultOf(pending.ticket);
    if (result === undefined) return;
    deps.dispatch({ kind: "set-pending-tool-request", request: undefined });
    if (result.ok) {
      deps.dispatch({ kind: "select-tool", toolId: pending.toolId });
      deps.toolStarted(pending.toolId, pending.objectId);
    } else {
      deps.showMessage(result.refusal.message, { code: result.refusal.code });
    }
  }

  function handleEvent(event: EngineEventBase): void {
    if (event.message !== undefined) deps.showMessage(event.message, event);
    if (event.kind !== "world/toolRevoked") return;
    const revoked = event as WorldToolRevokedEvent;
    if (revoked.participantId === localParticipantId && session.get().menuState.selectedTool === revoked.toolId) {
      deps.dispatch({ kind: "clear-selected-tool" });
    }
  }

  function answerWaiters(): void {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const result = engine.resultOf(waiters[i]!.ticket);
      if (result === undefined) continue;
      waiters[i]!.resolve(result);
      waiters.splice(i, 1);
    }
  }

  return {
    requestTool(toolId, objectId) {
      const command: WorldRequestToolCommand = { kind: "world/requestTool", toolId };
      deps.dispatch({ kind: "set-pending-tool-request", request: { toolId, ticket: engine.submit(localParticipantId, command), objectId } });
    },
    afterStep() {
      settleToolRequest();
      engine.forEachEvent(handleEvent);
      if (waiters.length > 0) answerWaiters();
    },
    api: {
      /** Submits a command for the local player; resolves with its result after the next step. */
      submit(command: unknown): Promise<CommandResult> {
        if (typeof command !== "object" || command === null || typeof (command as EngineCommandBase).kind !== "string") {
          throw new Error("submit needs a command object with a string kind");
        }
        const ticket = engine.submit(localParticipantId, command as EngineCommandBase);
        return new Promise((resolve) => void waiters.push({ ticket, resolve }));
      },
      /** The participants of the world: id, kind, owner and body. */
      participants() {
        return engine.read.participants();
      },
    },
    dispose() {
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ ok: false, refusal: { code: "world/disposed", message: "The world was closed." } });
      }
    },
  };
}
