/**
 * `tests/render/toolHost.test.ts` - unit tier.
 *
 * The shell's tool host (design 013 section 8.3): the one lookup of tools and the dispatch of the primary action through it. These tests use a fake client part with one tool that starts from an object's page, and spies for the shell's own tools:
 * the primary action goes to the selected tool's descriptor (every frame for the tools that update from the input, otherwise only on a primary action with no menu open), and to the focused object with no tool; a command a tool submits gets its result handed back to that tool after the step;
 * an ended tool takes its marks off and loses its tool state; an object action asks the world for its tool only when the tool is available.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { CommandResult, ModuleClient, ToolDescriptor } from "../../src/engine/moduleTypes";
import type { RuntimeToolId } from "../../src/glue/toolIds";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { createToolHost, type CoreToolActions } from "../../src/render/three/toolHost";
import { threeDirectionToWorld } from "../../src/render/three/worldAxes";
import type { RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import { createSegment } from "../fixtures/world-objects/geodesic";
import { createTestClientSession } from "../support/clientSession";
import { createTestEngine } from "../support/engine";

const probeId = "probe/tool" as RuntimeToolId;

function setup(options: { readonly available?: boolean } = {}) {
  const engine = createTestEngine();
  const session = createTestClientSession();
  const log = { primary: 0, ended: 0, results: [] as CommandResult[], started: [] as (string | undefined)[], requested: [] as string[], palette: 0, focused: 0 };
  const probe: ToolDescriptor = {
    id: probeId,
    ownerModuleId: "probe",
    label: "Probe",
    helpTitle: "Probe",
    helpBody: "A probe.",
    helpRows: [],
    indicatorColor: "#000000",
    iconId: "ray",
    showsAimCross: true,
    entry: {
      kind: "object-action",
      objectKind: "thing",
      action: { actionId: "probe", label: "Probe", iconId: "ray", tooltip: "Probe it" },
      isAvailable: () => options.available ?? true,
    },
    prompt: (tool) => `state ${String(tool.getToolState<number>("probe"))}`,
    onPrimaryAction: (tool) => {
      log.primary += 1;
      tool.setToolState("probe", 1);
      tool.submit({ kind: "world/requestTool", toolId: "aim" } as never);
      return true;
    },
    onStart: (_tool, objectId) => void log.started.push(objectId),
    onResult: (_tool, result) => void log.results.push(result),
    onEnd: () => void (log.ended += 1),
  };
  const client: ModuleClient = { tools: [probe] };
  const core: CoreToolActions = {
    placeFlag: vi.fn(),
    measureLength: vi.fn(),
    protractor: vi.fn(),
    protractorPrompt: () => "select: vertex",
    carry: vi.fn(() => false),
    rotate: vi.fn(() => false),
    aim: vi.fn(() => false),
  };
  const host = createToolHost({
    engine,
    session,
    dispatch: (command) => void applyRuntimeCommand(session, command),
    clients: [client],
    core,
    resolveCurrentAimTargets: () => [],
    resolveCurrentAimTarget: () => undefined,
    targetIsWithinInteractionRange: () => true,
    useFocusedObject: () => (log.focused += 1, true),
    requestTool: (toolId, objectId) => void log.requested.push(`${toolId}:${objectId}`),
    showMessage: () => undefined,
    syncDesktopPalette: () => void (log.palette += 1),
    selectObject: () => undefined,
    showObjectPage: () => undefined,
  });
  const select = (toolId: RuntimeToolId): void => void applyRuntimeCommand(session, { kind: "select-tool", toolId });
  return { host, engine, session, core, log, select };
}

describe("the tool host dispatch", () => {
  it("gives the primary action to the selected tool's descriptor when no menu is open", () => {
    const { host, select, core, log } = setup();

    select("place-flag");
    expect(host.dispatchPrimaryAction(false, false)).toBe(false);
    expect(core.placeFlag).not.toHaveBeenCalled();
    expect(host.dispatchPrimaryAction(true, false)).toBe(true);
    expect(core.placeFlag).toHaveBeenCalledTimes(1);

    select(probeId);
    expect(host.dispatchPrimaryAction(true, false)).toBe(true);
    expect(log.primary).toBe(1);
  });

  it("runs the tools that update from the input every frame, with or without a primary action", () => {
    const { host, select, core } = setup();

    select("geodesicEmitters/rotate");
    host.setFrame({ ray: undefined, yawDeltaRadians: 0.25, primaryActionRequested: false });
    expect(host.dispatchPrimaryAction(false, false)).toBe(false);

    expect(core.rotate).toHaveBeenCalledTimes(1);
  });

  it("acts on the focused object when no tool is selected, unless the input was already consumed", () => {
    const { host, log } = setup();

    expect(host.dispatchPrimaryAction(true, false)).toBe(true);
    expect(host.dispatchPrimaryAction(true, true)).toBe(true);
    expect(host.dispatchPrimaryAction(false, false)).toBe(false);

    expect(log.focused).toBe(1);
  });

  it("keeps an earlier handler's consumption when the tool does not consume", () => {
    const { host, select } = setup();

    select("geodesicEmitters/aim");

    expect(host.dispatchPrimaryAction(true, true)).toBe(true);
  });
});

describe("the tool host and a tool's commands", () => {
  it("hands the result of a submitted command back to the tool that submitted it after the step", () => {
    const { host, engine, select, log } = setup();

    select(probeId);
    host.dispatchPrimaryAction(true, false);
    expect(log.results).toEqual([]);
    const paletteBefore = log.palette;
    engine.step(0);
    host.afterStep();

    expect(log.results).toHaveLength(1);
    expect(log.results[0]).toMatchObject({ ok: true });
    expect(log.palette).toBeGreaterThan(paletteBefore);
  });

  it("takes the marks off and drops the tool state when the tool ends", () => {
    const { host, session, select, log } = setup();

    select(probeId);
    host.dispatchPrimaryAction(true, false);
    expect(session.get().moduleToolState).toEqual({ probe: 1 });
    host.toolEnded(probeId);

    expect(log.ended).toBe(1);
    expect(session.get().moduleToolState).toEqual({});
  });

  it("reads the prompt from the tool's state and redraws the indicator when the state changes", () => {
    const { host, select, log } = setup();

    select(probeId);
    host.dispatchPrimaryAction(true, false);
    expect(log.palette).toBe(1);

    expect(host.promptOf(probeId)).toBe("state 1");
    expect(host.promptOf("place-flag")).toBeUndefined();
  });

  it("starts the tool with the object it was started from", () => {
    const { host, log } = setup();

    host.toolStarted(probeId, "thing-1");

    expect(log.started).toEqual(["thing-1"]);
  });
});

describe("object actions", () => {
  it("lists the actions the tools contribute to an object kind", () => {
    const { host } = setup();

    expect(host.objectActionsFor("thing", "thing-1")).toEqual([{ actionId: "probe", label: "Probe", iconId: "ray", tooltip: "Probe it", enabled: true }]);
    expect(host.objectActionsFor("other", "thing-1")).toEqual([]);
  });

  it("asks the world for the tool of an available action", () => {
    const { host, log } = setup();

    host.startObjectAction("thing", "thing-1", "probe");

    expect(log.requested).toEqual([`${probeId}:thing-1`]);
  });

  it("asks for nothing and redraws the palette when the action is unavailable", () => {
    const { host, log } = setup({ available: false });

    host.startObjectAction("thing", "thing-1", "probe");

    expect(log.requested).toEqual([]);
    expect(log.palette).toBe(1);
  });

  it("ignores an action no tool contributes", () => {
    const { host, log } = setup();

    host.startObjectAction("thing", "thing-1", "nothing");

    expect(log.requested).toEqual([]);
  });
});

describe("the tool lookup", () => {
  it("holds the shell's and the modules' tools in one map and refuses a tool twice", () => {
    const { host } = setup();

    expect([...host.toolsById.keys()].sort()).toEqual([
      "geodesicEmitters/aim",
      "geodesicEmitters/carry",
      "geodesicEmitters/rotate",
      "measure-length",
      "place-flag",
      probeId,
      "protractor",
    ]);
    const twice: ModuleClient = { tools: [host.toolsById.get("place-flag") as ToolDescriptor] };
    expect(() => createToolHost({ ...dummyDeps(), clients: [twice] })).toThrow("the tool place-flag is described twice");
  });
});

describe("what the host tells a tool about the aim", () => {
  function hostAiming(target: AimTarget, direction = new THREE.Vector3(1, 0, 0)) {
    const host = createToolHost({ ...dummyDeps(), resolveCurrentAimTargets: () => [target], resolveCurrentAimTarget: () => target });
    host.setFrame({ ray: { origin: new THREE.Vector3(), direction, quaternion: new THREE.Quaternion() }, yawDeltaRadians: 0, primaryActionRequested: false });
    return host.contextOf("place-flag");
  }
  const aimed = { kind: "object", cellId: "image-cell", localPoint: { x: 9, y: 9, z: 9 } } as AimTarget;

  it("says where a segment is hit in the segment's own cell, on the segment", () => {
    const segment = createSegment({ cellId: "a", start: { x: 1, y: 1, z: 1.2 }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 2 });

    const pick = hostAiming({ ...aimed, object: segment, geodesicSegmentDistanceMeters: 0.5 }).currentPick();

    expect(pick).toMatchObject({ cellId: "a", point: { x: 1.5, y: 1, z: 1.2 } });
  });

  it("says where a crossing is from the crossing's own point", () => {
    const crossing = { kind: "geodesicModel/crossing", id: "x", cellId: "a", aimStickyTarget: { localPoint: { x: 2, y: 3, z: 1 } } } as unknown as RuntimeWorldObject;

    expect(hostAiming({ ...aimed, object: crossing }).currentPick()).toMatchObject({ cellId: "a", point: { x: 2, y: 3, z: 1 } });
  });

  it("leaves the floor at the aim point of the hit cell", () => {
    const { object: _none, ...floor } = { ...aimed, kind: "floor" as const, object: undefined };

    expect(hostAiming(floor as AimTarget).currentPick()).toMatchObject({ objectKind: "floor", cellId: "image-cell", point: { x: 9, y: 9, z: 9 } });
  });

  it("gives the horizontal direction of the ray, and none for a vertical ray", () => {
    const direction = new THREE.Vector3(1, 0, -1).normalize();
    const forward = threeDirectionToWorld(direction);

    expect(hostAiming(aimed, direction).aimYawRadians()).toBeCloseTo(Math.atan2(forward.y, forward.x), 12);
    expect(hostAiming(aimed, new THREE.Vector3(0, -1, 0)).aimYawRadians()).toBeUndefined();
  });
});

function dummyDeps(): Parameters<typeof createToolHost>[0] {
  const engine = createTestEngine();
  const session = createTestClientSession();
  const noop = () => undefined;
  return {
    engine,
    session,
    dispatch: noop,
    clients: [],
    core: { placeFlag: noop, measureLength: noop, protractor: noop, protractorPrompt: () => "", carry: () => false, rotate: () => false, aim: () => false },
    resolveCurrentAimTargets: () => [],
    resolveCurrentAimTarget: () => undefined,
    targetIsWithinInteractionRange: () => true,
    useFocusedObject: () => false,
    requestTool: noop,
    showMessage: noop,
    syncDesktopPalette: noop,
    selectObject: noop,
    showObjectPage: noop,
  };
}
