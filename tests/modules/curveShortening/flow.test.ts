/**
 * `tests/modules/curveShortening/flow.test.ts` - unit tier.
 *
 * The flow of the curve shortening module (`flowStep`, design 013 section 13.2) alone, against a scripted fake of `GeodesicModelApi` and of `dispatch`, with no engine and no world: a vertex at rest merges
 * (the removal command is dispatched and the vertex does not move); a vertex that cannot move or merge goes quiet and `unresolved` fires once; a vertex with a stale arc is skipped for the step, not blocked; a taut closed loop goes
 * quiet with no command; a vertex merged away earlier in the same step is skipped; and a quiet vertex is not visited.
 */
import { describe, expect, it, vi } from "vitest";
import type { CommandResult, EngineCommandBase } from "../../../src/engine/moduleTypes";
import type { ArcEnd, ArcTangent, GeodesicModelApi, VertexRemovalPreview } from "../../../src/modules/geodesicModel/api";
import type { CurveShorteningEvent } from "../../../src/modules/curveShortening/api";
import { flowStep, tautLoopReason, type FlowDeps } from "../../../src/modules/curveShortening/flow";
import { speedLawNamed } from "../../../src/modules/curveShortening/policies";

const ends: readonly ArcEnd[] = [{ arcId: "a", role: "end" }, { arcId: "b", role: "start" }];

/** A model whose answers are scripted; every operation is a spy. */
function scriptedModel(script: {
  readonly vertices?: readonly string[];
  readonly arcsAt?: (vertexId: string) => readonly ArcEnd[];
  readonly tangents?: readonly ArcTangent[];
  readonly stale?: (arcId: string) => boolean;
  readonly removal?: VertexRemovalPreview;
}) {
  const vertices = script.vertices ?? ["v"];
  const model = {
    forEachTiedVertex: vi.fn((fn: (vertexId: string) => void) => {
      for (const vertexId of vertices) fn(vertexId);
    }),
    arcsAtVertex: vi.fn((vertexId: string) => (script.arcsAt ? script.arcsAt(vertexId) : ends)),
    isStale: vi.fn((arcId: string) => script.stale?.(arcId) ?? false),
    arcTangentsAtVertex: vi.fn((): readonly ArcTangent[] | undefined => script.tangents),
    lengthOfArcs: vi.fn(() => 2),
    previewVertexMove: vi.fn(() => undefined),
    commitVertexMove: vi.fn(),
    previewVertexRemoval: vi.fn((): VertexRemovalPreview => script.removal ?? { kind: "merge", mergedArcId: "a", removedArcId: "b", internal: undefined }),
  };
  return model as unknown as GeodesicModelApi & typeof model;
}

function setup(model: GeodesicModelApi) {
  const events: CurveShorteningEvent[] = [];
  const dispatched: EngineCommandBase[] = [];
  const quiet = new Map<string, string>();
  const deps: FlowDeps = {
    model,
    speedLaw: speedLawNamed("constant"),
    onBlocked: "unresolve",
    quiet,
    vertexPoint: () => ({ x: 0, y: 0 }),
    dispatch: (command): CommandResult => {
      dispatched.push(command);
      return { ok: true, value: { arcIds: [] } };
    },
    emit: (event) => events.push(event),
  };
  return { deps, events, dispatched, quiet };
}

// Two unit tangents pointing the same way: the arcs double back, so the vertex is far from taut and has a descent direction.
const bent: readonly ArcTangent[] = [{ x: 1, y: 0, lengthMeters: 1 }, { x: 0, y: 1, lengthMeters: 1 }];
// Opposite tangents: the two arcs are one geodesic.
const straight: readonly ArcTangent[] = [{ x: 1, y: 0, lengthMeters: 1 }, { x: -1, y: 0, lengthMeters: 1 }];

describe("curve shortening flow against a scripted model", () => {
  it("merges a vertex at rest by dispatching the removal, without moving it", () => {
    const model = scriptedModel({ tangents: straight });
    const { deps, dispatched, events, quiet } = setup(model);

    flowStep(deps, 1 / 60);

    expect(dispatched).toEqual([{ kind: "geodesicModel/removeVertex", vertexId: "v", arcs: ends }]);
    expect(model.previewVertexMove).not.toHaveBeenCalled();
    expect(model.commitVertexMove).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(quiet.size).toBe(0);
  });

  it("goes quiet when the merge is refused, and fires unresolved once", () => {
    const model = scriptedModel({ tangents: bent, removal: { kind: "blocked", reason: "mergeBlocked" } });
    const { deps, dispatched, events, quiet } = setup(model);

    flowStep(deps, 1 / 60);
    flowStep(deps, 1 / 60);
    flowStep(deps, 1 / 60);

    expect(dispatched).toEqual([]);
    expect(quiet.get("v")).toBe("merge-blocked");
    expect(events).toEqual([
      { kind: "curveShortening/unresolved", vertexId: "v", reason: "merge-blocked", message: "The tied geodesic could not be straightened (merge-blocked)." },
    ]);
    expect(model.arcsAtVertex).toHaveBeenCalledTimes(1);
  });

  it("skips a vertex with a stale arc for the step, without blocking it", () => {
    const model = scriptedModel({ tangents: bent, stale: (arcId) => arcId === "b" });
    const { deps, dispatched, events, quiet } = setup(model);

    flowStep(deps, 1 / 60);

    expect(model.arcTangentsAtVertex).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    expect(events).toEqual([]);
    expect(quiet.size).toBe(0);
  });

  it("keeps a taut closed loop quiet with no command and no notice", () => {
    const loop: readonly ArcEnd[] = [{ arcId: "a", role: "start" }, { arcId: "a", role: "end" }];
    const model = scriptedModel({ tangents: straight, arcsAt: () => loop, removal: { kind: "loopTaut", arcId: "a" } });
    const { deps, dispatched, events, quiet } = setup(model);

    flowStep(deps, 1 / 60);

    expect(dispatched).toEqual([]);
    expect(events).toEqual([]);
    expect(quiet.get("v")).toBe(tautLoopReason);
  });

  it("emits the collapse notice after the removal of a curve that shrank to a point", () => {
    const model = scriptedModel({ tangents: straight, removal: { kind: "collapsed", arcIds: ["a", "b"], loop: false } });
    const { deps, dispatched, events } = setup(model);

    flowStep(deps, 1 / 60);

    expect(dispatched).toHaveLength(1);
    expect(events).toEqual([{ kind: "curveShortening/collapsed", arcIds: ["a", "b"], message: "The tied geodesic shrank to a point and was removed." }]);
  });

  it("skips a vertex that an earlier merge of the same step removed", () => {
    let firstMerged = false;
    const model = scriptedModel({
      vertices: ["first", "second"],
      tangents: straight,
      arcsAt: (vertexId) => (vertexId === "second" && firstMerged ? [] : ends),
    });
    const { deps, dispatched, events, quiet } = setup(model);
    const dispatch = deps.dispatch;
    const merging: FlowDeps = { ...deps, dispatch: (command) => { firstMerged = true; return dispatch(command); } };

    flowStep(merging, 1 / 60);

    expect(dispatched.map((command) => (command as unknown as { vertexId: string }).vertexId)).toEqual(["first"]);
    expect(events).toEqual([]);
    expect(quiet.size).toBe(0);
  });

  it("does not visit a quiet vertex", () => {
    const model = scriptedModel({ tangents: straight });
    const { deps, dispatched, quiet } = setup(model);
    quiet.set("v", "merge-blocked");

    flowStep(deps, 1 / 60);

    expect(model.arcsAtVertex).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });
});
