# Job 53 - Move curve shortening into a module with no lifecycle

Status: queued.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 1, 3, 6).

## Goal

The flow is a module the shell does not name. A curve has no lifecycle: nothing starts, finishes or locks. The flow applies
one rule to every tied vertex each step, and it stops because nothing is left to act on.

## Depends on

Job 52.

## Before you start

- Read design 013: sections 5.7, 13.1, 13.2, and job 53 in section 15. Read `_docs/MATHEMATICAL_MODEL.md` section 7. Read design 014 sections 2.1 and
  9, which amend 13.2.
- Read the project note "Curve shortening is a flow" (`.agents/knowledge.d/notes/K-20261104-5d8e.md`). To watch the flow in
  a hidden debug window, sample inside one attached CDP session with focus emulation.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Facts of today's flow, which stay true:

- Each vertex moves along `u1 + u2`, the sum of the unit tangents of its two arcs pointing away from it, by
  `min(speed * dt, line-search minimum)`. Speed is 1.5 m/s, `dt` is clamped to 0.1 s. The line search is what stopped the
  job 06 stall; keep it.
- A vertex is taut when `|u1 + u2| < curveShorteningTautTurnRadians` (5e-3).
- A rejected step is halved up to eight times. The length never grows.
- The vertex count never grows in this algorithm. A curve that would need a wrap at a forbidden-zone disk ends `unresolved`.
- A free loop (one arc, both ends on one vertex) cannot merge. With translation holonomy it is taut at once. With rotation
  holonomy it shrinks toward the cone point and is deleted below `loopCollapseLengthMeters` (0.6 m) with a notice.

## Decisions

- **The rule, per tied vertex, in `forEachTiedVertex` order:** skip if an incident arc is stale; if at rest, always merge
  (dispatch `geodesicModel/removeVertex`); otherwise move (`previewVertexMove`, `commitVertexMove`); if it cannot move, try the
  merge as today; if that is refused, apply `onBlocked`.
- A taut closed loop keeps its vertex (preview `loopTaut`) and goes quiet.
- `quiet` is a private `Map<vertexId, reason>` of vertices with nothing to do: taut closed loops and blocked vertices. It is a **memo**, not a
  cache (014 2.1): whether a vertex can move depends on the step length, so it is not a function of state.
- The derive tick `curveShortening/wake` (`subscribes: ["geodesicModel/arc"]`) reads the ring from `ctx.changesFrom` to `ctx.changesTo`. For each
  arc entry it deletes from `quiet` both anchors of `objectAt(seq)` and of `beforeAt(seq)`. Reading `beforeAt` matters: an arc moved off a vertex
  must wake that vertex.
- **There are no `reset` or `transformGeometry` hooks**: `ModuleInstance` has neither, and none is built. None is needed: a geometry commit deletes
  every arc that does not connect emitters, the `wake` tick sees those removals, and a load makes a new engine.
- `isIdle` is `tiedVertexCount() === quiet.size`. Both are O(1) with no allocation, because `tiedVertexCount` reads the arc index (job 59). It may
  lag `wake` by one step; that is harmless.
- The tick visits `forEachTiedVertex`, a frozen snapshot. A merge during the visit removes vertices from the world: a visit first checks
  that its vertex still exists, and skips it if not.
- The tick has `writes: []`; the model writes.
- Options: `{ onBlocked: "unresolve"; speedLaw: "constant" }`. `SpeedLaw` is a function in `policies.ts`. Build only
  `"constant"`, which returns today's step budget.
- No object kind, no `started` or `finished` events. `unresolved` fires once, when the vertex goes quiet, with `vertexId`.
- The first flow step is in the step that applied the tie. This timing change is accepted.
- Merging loses a bend. That is accepted for this simplest algorithm: a later job inserts vertices (section 16). Do not build
  `insertVertex`, `refinement` or a tension law now, but do not assume one vertex per curve either.

## Steps

1. `src/modules/curveShortening/` (`api.ts`, `index.ts`, `module.ts`, `flow.ts`, `policies.ts`). Move the flow; delete
   `world-objects/geodesic/curveShortening.ts`. Its test moves to `tests/modules/curveShortening/` and drives the engine.
   Notices become events with the same messages.
2. **Assertions on motion, lengths, merging and notices do not change.** Assertions on the pair object become assertions on
   the curve (`isAtRest`, `blockedVertices`, the vertices left). Record each one under `### Deviations`.
3. Delete `curve-shortening-pair`, `CurveShorteningPairObject`, its `state` and `vertexIds`.
4. The rule, `quiet`, the `wake` tick, `speedLaw: "constant"`.
5. The model's command `tieAndDetach` and event `vertexTied`. Delete the shell's "curve shortening" phase.
   `geodesicCannonTools.ts` submits `geodesicModel/tieAndDetach`.
6. Move the bench's **flow** scenes, and `manyArcs`, onto the engine, stepped until `isAtRest` or 600 steps; the loop condition reads `isAtRest`,
   not a kind. `steps` must stay equal to the recorded value, or the flow's behaviour changed, except that the first flow step now comes in the
   step that applied the tie, which may change it by one: name that under `### Deviations`. Run `--record-counters`: this job may raise only what
   the engine's pass adds, and must drop the `curve-shortening-pair` scans.
7. Update `_docs/MATHEMATICAL_MODEL.md` section 7: no pair, no stable state, the rule above.

## Tests and checks

- Each tie refusal returns its code and changes nothing.
- The flow alone against a scripted fake of `GeodesicModelApi` and `dispatch`: a vertex at rest merges; a blocked one goes
  quiet and `unresolved` fires once; a stale arc is skipped for that step, not blocked.
- A taut closed loop goes quiet and `isIdle` is true; dragging its arc wakes it.
- A blocked vertex wakes when an arc is moved off it (`beforeAt`), and a vertex merged away during the tick's visit is skipped.
- `isIdle` allocates nothing and scans no kind: on a quiet scene, `getKindScanCounts()` is unchanged over 100 steps.
- `expectSegmentsAreRealizedFromArcs` holds after a flow run (job 60).
- Over many flow steps with no carry, every emitter's pose and cell are unchanged.
- Carrying an emitter while its curve flows moves the end node, and the curve still merges.
- A curve with five vertices flows (the existing test).
- An experience **without** the flow keeps a tied curve as tied over many steps.
- Release tier: `api.geodesicModel.tieAndDetach(...)` on a torus world, then `api.waitFor` until
  `api.curveShortening.isAtRest()`.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not change speed, tolerances, halving or the line search.
- Do not add `reset`, `transformGeometry` or any other hook to `ModuleInstance` for `quiet`.
- Do not make `quiet` a `defineDerived` cache: it is a memo.
- Do not add a stored "moving", "stable" or "locked" field anywhere.
- Do not let the flow read carry state: it knows only `isStale`.

## Done when

- `grep -rn "curve-shortening-pair\|CurveShorteningPairObject\|advanceCurveShorteningPairs" src tests` is empty.
- `createThreeApp.ts` does not name the flow, and all checks are green.
