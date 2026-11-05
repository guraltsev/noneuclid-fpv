/**
 * The shell's side of its conversation with the world engine (design 013 sections 5.3, 5.5 and 8.1): the tool-switch protocol (also for tools started from an object's menu page), the generic event sink and the `api.world` namespace.
 * Selecting a tool does not switch it: `requestTool` submits `world/requestTool` and records the request as pending in the client session; after the engine's step, `afterStep` switches to the tool when the world accepted it, or shows the world's message and stays on the old tool when it refused.
 * The module keeps one list of API callers waiting for a command result; it owns no world or client state of its own. A caller is always answered: with the command's result, with `world/disposed` when the app goes (a world change and a restart dispose it), or, when the world ran no step for {@link commandAnswerDeadlineMs} (a hidden page draws no frames), with `world/noAnswer`, and the command is taken back.
 */
import type { RuntimeToolId } from "../../glue/toolIds";
import { localParticipantId, type WorldEngine } from "../../engine/worldEngine";
import type { CommandResult, EngineCommandBase, EngineEventBase, WorldRequestToolCommand } from "../../engine/moduleTypes";
import type { ApiObject } from "../../runtime/apiCall";
import type { ClientSession } from "../../runtime/clientSession";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";

/** How long an API caller waits for a step. A page that draws frames, however slowly, answers within a few of them. */
export const commandAnswerDeadlineMs = 30_000;

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
  /** Call once per frame, after the frame's last tick, also in a frame with no tick: settles the pending tool request, runs the event sink and answers waiting API callers. */
  afterStep(): void;
  /** Submits a command for the local player; resolves with its result after the next step. This is what `api.world.submit` and the wrappers of a module's `publicApi` call. */
  submit(command: EngineCommandBase): Promise<CommandResult>;
  /** The `world` namespace of the public API: `submit(command)`, `participants()` and `stepIndex()`. */
  readonly api: ApiObject;
  /** Resolves every waiting API caller with a refusal, and every later one at once; call on teardown. */
  dispose(): void;
}

const closed: CommandResult = { ok: false, refusal: { code: "world/disposed", message: "The world was closed." } };
const noAnswer: CommandResult = { ok: false, refusal: { code: "world/noAnswer", message: "The world ran no step in time (a hidden page draws no frames), so the command was taken back." } };

/** Creates the world client over the shell's engine, session and command path. */
export function createWorldClient(deps: WorldClientDeps): WorldClient {
  const { engine, session } = deps;
  const waiters: { readonly ticket: number; readonly deadline: ReturnType<typeof setTimeout>; readonly resolve: (result: CommandResult) => void }[] = [];
  let disposed = false;

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
  }

  function answerWaiters(): void {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const result = engine.resultOf(waiters[i]!.ticket);
      if (result === undefined) continue;
      answer(i, result);
    }
  }

  function answer(index: number, result: CommandResult): void {
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter!.deadline);
    waiter!.resolve(result);
  }

  function submit(command: EngineCommandBase): Promise<CommandResult> {
    if (disposed) return Promise.resolve(closed);
    const ticket = engine.submit(localParticipantId, command);
    return new Promise((resolve) => {
      const deadline = setTimeout(() => {
        engine.withdraw(ticket);
        answer(waiters.findIndex((waiter) => waiter.ticket === ticket), noAnswer);
      }, commandAnswerDeadlineMs);
      waiters.push({ ticket, deadline, resolve });
    });
  }

  return {
    requestTool(toolId, objectId) {
      const command: WorldRequestToolCommand = { kind: "world/requestTool", toolId };
      deps.dispatch({ kind: "set-pending-tool-request", request: { toolId, ticket: engine.submit(localParticipantId, command), objectId } });
    },
    afterStep() {
      // First: a throw below must not cost a caller its answer, which `endFrame` clears.
      if (waiters.length > 0) answerWaiters();
      settleToolRequest();
      engine.forEachEvent(handleEvent);
    },
    submit,
    api: {
      /** Submits a command for the local player; resolves with its result after the next step. */
      submit(command: unknown): Promise<CommandResult> {
        if (typeof command !== "object" || command === null || typeof (command as EngineCommandBase).kind !== "string") {
          throw new Error("submit needs a command object with a string kind");
        }
        return submit(command as EngineCommandBase);
      },
      /** The participants of the world: id, kind, owner and body. */
      participants() {
        return engine.read.participants();
      },
      /** How many steps the engine has taken. */
      stepIndex() {
        return engine.read.stepIndex;
      },
    },
    dispose() {
      disposed = true;
      while (waiters.length > 0) answer(0, closed);
    },
  };
}
