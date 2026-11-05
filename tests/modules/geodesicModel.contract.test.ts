/**
 * `tests/modules/geodesicModel.contract.test.ts` — unit tier.
 *
 * The geodesic model module (design 013 section 13.1) driven through the world engine: its token, its queries, the operations only a dependent holds
 * (`previewVertexMove`, `commitVertexMove`, `previewVertexRemoval`, reached here through a probe module that requires the token) and its commands.
 * Checked: moving a vertex keeps each arc's class (the word changes exactly by the portals crossed) and its length matches the preview; a failed preview
 * changes nothing (the registry version stays); tie then removal round-trips the geometry; a taut loop keeps its vertex; a collapsed merge deletes the curve
 * and its vertex; every query leaves the registry version unchanged; `removeVertex` on a blocked vertex is refused and changes nothing; both previews refuse an
 * emitter id; the module-only commands are refused to clients. The geometry itself is tested in `tests/world-objects/geodesic/`.
 */
import { describe, expect, it } from "vitest";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { AnyModuleDefinition, CommandContext, CommandResult, EngineCommandBase, EngineEventBase, ModuleCreateContext } from "../../src/engine/moduleTypes";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { geodesicModelToken, type ArcEnd, type GeodesicModelApi, type GeodesicModelCommand } from "../../src/modules/geodesicModel/api";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { carryModule } from "../../src/modules/carry";
import { carryOffsetSlot } from "../../src/modules/carry/api";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../src/world-objects/geodesic/cannon";
import { rebuildDerivedGeodesicSegments } from "../../src/world-objects/geodesic/intervals";
import {
  createGeodesicArcObject,
  createGeodesicCannonObject,
  createGeodesicVertexObject,
  geodesicRayBeamHeightMeters,
} from "../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord } from "../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import {
  compileLargeWorld,
  compileTorusLoopWorld,
  createCarryPortalTraversal,
  totalGeodesicLength,
} from "../fixtures/world-objects/geodesic";
import { createTestEngine } from "../support/engine";
import { expectSegmentsAreRealizedFromArcs } from "../support/segmentOracle";

type ProbeCommand = EngineCommandBase & { readonly kind: "probe/run"; readonly inner: GeodesicModelCommand };

/** A module that requires the token (so it holds the `api` and may dispatch the model's module-only commands) and runs one dispatch on request. */
function probeModule(held: { api?: GeodesicModelApi; dispatched?: CommandResult }): AnyModuleDefinition {
  return {
    id: "probe",
    requires: [geodesicModelToken],
    objectKinds: [],
    create: (context: ModuleCreateContext) => {
      held.api = context.require(geodesicModelToken);
      return {
        api: undefined,
        queries: {},
        commands: {
          "probe/run": {
            run: (command: ProbeCommand, ctx: CommandContext) => {
              held.dispatched = ctx.dispatch(command.inner);
              return { ok: true };
            },
          },
        },
        ticks: [],
      };
    },
  } as unknown as AnyModuleDefinition;
}

function setup(world: CompiledCellComplex, registry: RuntimeObjectRegistry) {
  const held: { api?: GeodesicModelApi; dispatched?: CommandResult } = {};
  const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), probeModule(held)] });
  const events: EngineEventBase[] = [];
  /** Submits as the local player, steps once and returns the result. */
  function submit(command: GeodesicModelCommand | ProbeCommand): CommandResult | undefined {
    const ticket = engine.submit("local", command as EngineCommandBase);
    engine.step(0);
    const result = engine.resultOf(ticket);
    engine.forEachEvent((event) => events.push(event));
    engine.endFrame();
    return result;
  }
  /** Dispatches a command of the model as a module (the probe), returning the dispatched result. */
  function dispatch(inner: GeodesicModelCommand): CommandResult | undefined {
    held.dispatched = undefined;
    submit({ kind: "probe/run", inner });
    return held.dispatched;
  }
  const api = (): GeodesicModelApi => held.api!;
  return { engine, registry, events, submit, dispatch, api, queries: engine.query(geodesicModelToken) };
}

const beamZ = geodesicRayBeamHeightMeters;

// Two emitters on the 15 m torus, a straight arc e1 -> e2 and an arc e2 -> e1 wrapping once to the right, both locked.
function torusLockedPair() {
  const world = compileTorusLoopWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -3, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 3, y: 2, z: 0 }) }));
  registry.add(createGeodesicArcObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "torus-room" }));
  registry.add(createGeodesicArcObject({
    id: "g2",
    startAnchorObjectId: "e2",
    endAnchorObjectId: "e1",
    startCellId: "torus-room",
    portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
  }));
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g1" });
  rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g2" });
  return { world, registry };
}

// The same pair, tied at e2 through the command; returns the new vertex id.
function tiedTorusPair() {
  const { world, registry } = torusLockedPair();
  const model = setup(world, registry);
  const tied = model.submit({
    kind: "geodesicModel/tieAndDetach",
    emitterId: "e2",
    first: { geodesicId: "g1", role: "end", anchorObjectId: "e2" },
    second: { geodesicId: "g2", role: "start", anchorObjectId: "e2" },
  });
  if (tied?.ok !== true) throw new Error(`The tie was refused: ${JSON.stringify(tied)}`);
  return { world, registry, model, vertexId: (tied.value as { vertexId: string }).vertexId };
}

// Emitters at (-halfWidth, 0) and (halfWidth, 0) of the 6 m cell with a vertex at (0, height), arcs e1 -> v -> e2.
function symmetricPair(halfWidth: number, height: number) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: -halfWidth, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "a", localPose: yawRigidTransform3(0, { x: halfWidth, y: 0, z: 0 }) }));
  registry.add(createGeodesicVertexObject({ id: "v", cellId: "a", point: { x: 0, y: height, z: beamZ } }));
  registry.add(createGeodesicArcObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "v", startCellId: "a" }));
  registry.add(createGeodesicArcObject({ id: "g2", startAnchorObjectId: "v", endAnchorObjectId: "e2", startCellId: "a" }));
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" });
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" });
  return { world, registry };
}

describe("geodesicModel: the model's identity", () => {
  it("composes with a dependent and answers its queries through the engine", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    expect(model.queries.isTied("g1")).toBe(true);
    expect(model.queries.connectsEmitters("g1")).toBe(false);
  });
});

describe("geodesicModel: tying", () => {
  it("ties through the command, emits vertexTied and leaves the geometry unchanged", () => {
    const { world, registry } = torusLockedPair();
    const lengthBefore = totalGeodesicLength(registry, "g1") + totalGeodesicLength(registry, "g2");
    const model = setup(world, registry);
    const result = model.submit({
      kind: "geodesicModel/tieAndDetach",
      emitterId: "e2",
      first: { geodesicId: "g1", role: "end", anchorObjectId: "e2" },
      second: { geodesicId: "g2", role: "start", anchorObjectId: "e2" },
    });

    expect(result).toMatchObject({ ok: true });
    const vertexId = (result as unknown as { value: { vertexId: string } }).value.vertexId;
    expect(vertexId.startsWith("geodesicModel/vertex:")).toBe(true);
    expect(model.events).toContainEqual({ kind: "geodesicModel/vertexTied", vertexId, arcIds: ["g1", "g2"] });
    expect(totalGeodesicLength(registry, "g1") + totalGeodesicLength(registry, "g2")).toBeCloseTo(lengthBefore, 9);
    expect(model.queries.isTied("g1")).toBe(true);
    expect(model.queries.tiedVertexCount()).toBe(1);
    expectSegmentsAreRealizedFromArcs(world, registry);
  });

  it("refuses with the documented codes and changes nothing", () => {
    const { world, registry } = torusLockedPair();
    const model = setup(world, registry);
    const version = registry.getVersion();
    const end = { geodesicId: "g1", role: "end" as const, anchorObjectId: "e2" };

    expect(model.submit({ kind: "geodesicModel/tieAndDetach", emitterId: "e2", first: end, second: end })).toMatchObject({ ok: false, refusal: { code: "geodesicModel/sameEndpoint" } });
    expect(model.submit({ kind: "geodesicModel/tieAndDetach", emitterId: "nobody", first: end, second: { ...end, geodesicId: "g2", role: "start" } })).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notAnEmitter" } });
    expect(model.submit({ kind: "geodesicModel/tieAndDetach", emitterId: "e1", first: end, second: { ...end, geodesicId: "g2", role: "start" } })).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notAttached" } });
    expect(registry.getVersion()).toBe(version);
  });

  it("refuses a second tie of arcs that no longer connect emitters with notConnected", () => {
    const { model, registry } = tiedTorusPair();
    const version = registry.getVersion();
    const result = model.submit({
      kind: "geodesicModel/tieAndDetach",
      emitterId: "e1",
      first: { geodesicId: "g1", role: "start", anchorObjectId: "e1" },
      second: { geodesicId: "g2", role: "end", anchorObjectId: "e1" },
    });
    expect(result).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notConnected" } });
    expect(registry.getVersion()).toBe(version);
  });
});

describe("geodesicModel: moving a vertex", () => {
  it("keeps each arc's class, changing its word by the portals crossed", () => {
    const { world, registry, model, vertexId } = tiedTorusPair();
    const arcs = model.queries.arcsAtVertex(vertexId);
    expect(arcs).toEqual([{ arcId: "g1", role: "end" }, { arcId: "g2", role: "start" }]);
    const rightLeft = createCarryPortalTraversal(world, "torus-room", "right-left");
    const wordsBefore = { g1: collectGeodesicPortalWord(registry, "g1"), g2: collectGeodesicPortalWord(registry, "g2") };
    expect(wordsBefore).toEqual({ g1: [], g2: [rightLeft] });

    // From x = 3 the vertex walks 5 m to the right, across the right portal (x = 7.5), and arrives at x = 3 + 5 - 15 = -7 in the same cell.
    const preview = model.api().previewVertexMove({ vertexId, arcs, direction: { x: 1, y: 0 }, lengthMeters: 5 });
    expect(preview).toBeDefined();
    const version = registry.getVersion();
    model.api().commitVertexMove(preview!);

    expect(registry.getVersion()).toBeGreaterThan(version);
    // g1 ends at the vertex: its word gains the crossing; g2 starts at it: its word gains the inverse, which cancels the wrap it had.
    expect(collectGeodesicPortalWord(registry, "g1")).toEqual([rightLeft]);
    expect(collectGeodesicPortalWord(registry, "g2")).toEqual([]);
    expect(model.queries.lengthOfArcs(arcs)).toBeCloseTo(preview!.lengthAfterMeters, 9);
    expect(registry.get(vertexId)).toMatchObject({ cellId: "torus-room" });
    const vertex = registry.get(vertexId);
    expect(vertex?.localPose.translation.x).toBeCloseTo(-7, 9);
  });

  it("changes nothing when the preview fails", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const version = registry.getVersion();
    const arcs = model.queries.arcsAtVertex("v");

    // The walls of the 6 m cell stop a 10 m walk.
    expect(model.api().previewVertexMove({ vertexId: "v", arcs, direction: { x: 0, y: 1 }, lengthMeters: 10 })).toBeUndefined();
    expect(registry.getVersion()).toBe(version);
  });

  it("refuses an emitter id and an id that is not a vertex", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const version = registry.getVersion();
    const arcs: readonly ArcEnd[] = [{ arcId: "g1", role: "start" }];

    expect(model.api().previewVertexMove({ vertexId: "e1", arcs, direction: { x: 1, y: 0 }, lengthMeters: 0.1 })).toBeUndefined();
    expect(model.api().previewVertexRemoval({ vertexId: "e1", arcs })).toEqual({ kind: "blocked", reason: "anchor" });
    expect(model.api().previewVertexMove({ vertexId: "g1", arcs, direction: { x: 1, y: 0 }, lengthMeters: 0.1 })).toBeUndefined();
    expect(model.api().previewVertexRemoval({ vertexId: "missing", arcs })).toEqual({ kind: "blocked", reason: "anchor" });
    expect(registry.getVersion()).toBe(version);
  });
});

describe("geodesicModel: removing a vertex", () => {
  it("round-trips the geometry: tie, then removal merges the arcs into one geodesic", () => {
    const { registry, model, vertexId } = tiedTorusPair();
    const arcs = model.queries.arcsAtVertex(vertexId);
    const preview = model.api().previewVertexRemoval({ vertexId, arcs });
    expect(preview).toMatchObject({ kind: "merge", mergedArcId: "g1", removedArcId: "g2" });

    const result = model.dispatch({ kind: "geodesicModel/removeVertex", vertexId, arcs });

    expect(result).toEqual({ ok: true, value: { arcIds: ["g1", "g2"] } });
    expect(registry.get(vertexId)).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    // The two arcs met at e2 in a corner; the merged arc is the straight loop of their class, one wrap of 15 m.
    expect(registry.get("g1")).toMatchObject({ start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e1" } });
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(15, 6);
    expect(model.queries.isTied("g1")).toBe(false);
  });

  it("keeps the vertex of a taut loop (preview loopTaut)", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicVertexObject({ id: "free-loop", cellId: "torus-room", point: { x: 1, y: 2.3, z: beamZ } }));
    registry.add(createGeodesicArcObject({
      id: "g-loop",
      startAnchorObjectId: "free-loop",
      endAnchorObjectId: "free-loop",
      startCellId: "torus-room",
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" });
    const model = setup(world, registry);
    const arcs = model.queries.arcsAtVertex("free-loop");

    expect(model.api().previewVertexRemoval({ vertexId: "free-loop", arcs })).toEqual({ kind: "loopTaut", arcId: "g-loop" });
    const version = registry.getVersion();
    expect(model.dispatch({ kind: "geodesicModel/removeVertex", vertexId: "free-loop", arcs })).toEqual({ ok: true, value: { arcIds: ["g-loop"] } });
    expect(registry.getVersion()).toBe(version);
    expect(registry.get("free-loop")?.kind).toBe("geodesicModel/vertex");
  });

  it("deletes the curve and its vertex when the merged chord has collapsed", () => {
    const { world, registry } = symmetricPair(0.05, 2);
    const model = setup(world, registry);
    const arcs = model.queries.arcsAtVertex("v");

    expect(model.api().previewVertexRemoval({ vertexId: "v", arcs })).toEqual({ kind: "collapsed", arcIds: ["g1", "g2"], loop: false });
    expect(model.dispatch({ kind: "geodesicModel/removeVertex", vertexId: "v", arcs })).toEqual({ ok: true, value: { arcIds: ["g1", "g2"] } });
    expect(registry.get("g1")).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    expect(registry.get("v")).toBeUndefined();
  });

  it("refuses a blocked vertex with vertexBlocked and changes nothing", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const version = registry.getVersion();

    const result = model.dispatch({ kind: "geodesicModel/removeVertex", vertexId: "e1", arcs: [{ arcId: "g1", role: "start" }, { arcId: "g1", role: "end" }] });

    expect(result).toMatchObject({ ok: false, refusal: { code: "geodesicModel/vertexBlocked" } });
    expect(registry.getVersion()).toBe(version);
  });
});

describe("geodesicModel: removing a curve and the module-only commands", () => {
  it("removes the arcs, their segments and the vertices left with no arc", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);

    expect(model.dispatch({ kind: "geodesicModel/removeCurve", arcIds: ["g1", "g2"] })).toEqual({ ok: true, value: { arcIds: ["g1", "g2"] } });
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/segment")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
  });

  it("refuses removeCurve with an unknown arc and changes nothing", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const version = registry.getVersion();

    expect(model.dispatch({ kind: "geodesicModel/removeCurve", arcIds: ["g1", "nope"] })).toMatchObject({ ok: false, refusal: { code: "geodesicModel/unknownArc" } });
    expect(registry.getVersion()).toBe(version);
  });

  it("refuses the module-only commands to a client", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const version = registry.getVersion();

    expect(model.submit({ kind: "geodesicModel/removeCurve", arcIds: ["g1"] })).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
    expect(model.submit({ kind: "geodesicModel/removeVertex", vertexId: "v", arcs: [] })).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
    expect(registry.getVersion()).toBe(version);
  });

  it("highlights the half of a geodesic an endpoint names and clears it again", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    const selection = { geodesicId: "g1", role: "start" as const, anchorObjectId: "e1" };

    expect(model.submit({ kind: "geodesicModel/highlightEndpoint", selection, on: true })).toEqual({ ok: true });
    const highlighted = registry.getObjectsOfKind("geodesicModel/segment").filter((segment) => segment.highlightState === "tie-detach-selected");
    expect(highlighted.length).toBeGreaterThan(0);
    expect(highlighted.every((segment) => segment.geodesicId === "g1" && segment.halfRole === "start")).toBe(true);

    expect(model.submit({ kind: "geodesicModel/highlightEndpoint", selection, on: false })).toEqual({ ok: true });
    expect(registry.getObjectsOfKind("geodesicModel/segment").every((segment) => segment.highlightState === undefined)).toBe(true);
  });
});

describe("geodesicModel: queries", () => {
  it("leave the registry version unchanged", () => {
    const { registry, model, vertexId } = tiedTorusPair();
    const version = registry.getVersion();
    const arcs = model.queries.arcsAtVertex(vertexId);
    const seen: string[] = [];

    expect(arcs).toHaveLength(2);
    expect(model.queries.arcTangentsAtVertex(vertexId, arcs)).toHaveLength(2);
    expect(model.queries.arcTangentsAtVertex(vertexId, arcs, { x: 3.5, y: 2 })).toHaveLength(2);
    expect(model.queries.lengthOfArcs(arcs)).toBeGreaterThan(0);
    expect(model.queries.connectsEmitters("g1")).toBe(false);
    expect(model.queries.isTied("g2")).toBe(true);
    expect(model.queries.tiedVertexCount()).toBe(1);
    model.queries.forEachTiedVertex((id) => seen.push(id));
    expect(seen).toEqual([vertexId]);
    expect(model.queries.arcsOfCurve(vertexId)).toEqual(["g1", "g2"]);
    expect(model.queries.isStale("g1")).toBe(false);

    expect(registry.getVersion()).toBe(version);
  });

  it("walk a curve over its shared vertices, including a closed loop that is not tied", () => {
    const { world, registry } = symmetricPair(2, 2);
    const model = setup(world, registry);
    expect(model.queries.arcsOfCurve("v")).toEqual(["g1", "g2"]);
    expect(model.queries.arcsOfCurve("e1")).toEqual([]);

    registry.add(createGeodesicVertexObject({ id: "w", cellId: "a", point: { x: 1, y: 1, z: beamZ } }));
    registry.add(createGeodesicArcObject({ id: "loop", startAnchorObjectId: "w", endAnchorObjectId: "w", startCellId: "a" }));
    expect(model.queries.isTied("loop")).toBe(false);
    expect(model.queries.tiedVertexCount()).toBe(2);
  });
});

describe("geodesicModel: with the carry module", () => {
  it("keeps a tied curve when its emitter is carried and drags the end node", () => {
    const { world, registry } = symmetricPair(2, 2);
    const engine = createTestEngine({
      registry,
      getWorld: () => world,
      modules: [geodesicModelModule(), carryModule()],
      playerPose: { ...createDefaultPlayerPose("a"), position: { x: -1.5, y: 0, z: 0 } },
    });
    const vertexBefore = registry.get("v");
    const submit = (command: object) => {
      const ticket = engine.submit("local", command as EngineCommandBase);
      engine.step(0);
      const result = engine.resultOf(ticket);
      engine.endFrame();
      return result;
    };

    expect(submit({ kind: "carry/attach", objectId: "e1" })).toEqual({ ok: true });
    engine.setControl("local", carryOffsetSlot, { x: -2.5, y: 1, leashMeters: 5 });
    engine.step(1);
    engine.endFrame();
    expect(submit({ kind: "carry/detach" })).toEqual({ ok: true });

    const e1 = registry.get("e1");
    expect(e1?.localPose.translation.y).toBeGreaterThan(0.5);
    expect(registry.get("g1")?.kind).toBe("geodesicModel/arc");
    expect(registry.get("g2")?.kind).toBe("geodesicModel/arc");
    expect(registry.get("v")).toBe(vertexBefore);
    expect(engine.query(geodesicModelToken).isTied("g1")).toBe(true);
    expect(engine.query(geodesicModelToken).isStale("g1")).toBe(false);
  });
});
