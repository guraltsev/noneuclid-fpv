/**
 * The curve shortening module (design 013 section 13.2, design 014 sections 2.1 and 9): the flow that straightens the curves whose vertices the geodesic model has tied. A curve has no lifecycle: nothing starts, finishes
 * or locks. The module has no command, no tool and no object kind; one simulate tick applies the rule of `flow.ts` to every tied vertex, and the flow stops because nothing is left to act on.
 *
 * `quiet` is a private memo of the vertices with nothing to do (taut closed loops, and blocked vertices whose curve could not be removed), not world state and not a cache: whether a vertex can move depends on the step length, so it is not a function of state.
 * The derive tick `curveShortening/wake` empties it where it can be wrong: it reads the change ring for arc writes and forgets both anchors of every arc as it was before and after the write, so a dragged loop, a vertex no longer blocked, a vertex whose
 * arc moved off it and a vertex merged away all leave the memo. There is no `reset`: a geometry commit deletes every arc that does not connect emitters, the tick sees those removals, and a load makes a new engine.
 * The tick `curveShortening/step` writes nothing itself (`writes: []`): the geodesic model writes, through its operations and the dispatched `geodesicModel/removeVertex` and `geodesicModel/removeCurve`. It is idle when every tied vertex is quiet.
 */
import type { ModuleDefinition, ModuleTick } from "../../engine/moduleTypes";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { geodesicModelToken } from "../geodesicModel/api";
import { curveDynamicsToken, type CurveDynamicsApi, type CurveShorteningEvent, type CurveShorteningOptions } from "./api";
import { flowStep } from "./flow";
import { speedLawNamed } from "./policies";

/** The module as the engine's list takes it. */
export type CurveShorteningModuleDefinition = ModuleDefinition<CurveDynamicsApi, never, CurveShorteningEvent, CurveDynamicsApi>;

const defaultOptions: CurveShorteningOptions = { speedLaw: "constant" };

/**
 * Creates the curve shortening module.
 * It requires the geodesic model and provides `curveDynamicsToken`.
 */
export function curveShorteningModule(options: Partial<CurveShorteningOptions> = {}): CurveShorteningModuleDefinition {
  const { speedLaw } = { ...defaultOptions, ...options };
  return {
    id: "curveShortening",
    provides: curveDynamicsToken,
    requires: [geodesicModelToken],
    objectKinds: [],
    create: (context) => {
      const model = context.require(geodesicModelToken);
      const { objects } = context;
      const quiet = new Set<string>();

      const queries: CurveDynamicsApi = {
        isAtRest: () => model.tiedVertexCount() === quiet.size,
      };

      const stepTick: ModuleTick = {
        id: "curveShortening/step",
        phase: "simulate",
        writes: [],
        isIdle: () => queries.isAtRest(),
        run(ctx) {
          if (!(ctx.deltaSeconds > 0)) return;
          flowStep(
            {
              model,
              speedLaw: speedLawNamed(speedLaw),
              quiet,
              vertexPoint(vertexId) {
                const vertex = objects.get(vertexId);
                return vertex?.kind === "geodesicModel/vertex" ? vertex.localPose.translation : undefined;
              },
              dispatch: (command) => ctx.dispatch(command),
              emit: (event) => ctx.emit(event),
            },
            ctx.deltaSeconds,
          );
        },
      };

      const wakeTick: ModuleTick = {
        id: "curveShortening/wake",
        phase: "derive",
        writes: [],
        subscribes: ["geodesicModel/arc"],
        run(ctx) {
          const ring = ctx.objects.changes.ring;
          for (let seq = ctx.changesFrom; seq < ctx.changesTo; seq += 1) {
            if (ring.kindAt(seq) !== "geodesicModel/arc") continue;
            wakeAnchorsOf(ring.objectAt(seq));
            const before = ring.beforeAt(seq);
            if (before !== undefined) wakeAnchorsOf(before);
          }
        },
      };

      function wakeAnchorsOf(record: RuntimeWorldObject): void {
        if (record.kind !== "geodesicModel/arc") return;
        quiet.delete(record.start.anchorObjectId);
        quiet.delete(record.end.anchorObjectId);
      }

      return { api: queries, queries, commands: {}, ticks: [stepTick, wakeTick] };
    },
  };
}
