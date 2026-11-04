# Job 51 - Create the geodesic model module, with its renames and end nodes

Status: in progress.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 2, 5, 6).

## Goal

Piecewise geodesics become the `geodesicModel` module, with names from the mathematical model. A curve loses its stored
motion state. Carrying an emitter drags the end node of a tied curve instead of deleting the curve.

## Depends on

Job 50.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job51 -b job-51 <branch with job 50>`).
- Read design 013: sections 5.7, 9, 10, 13.1, and job 51 in section 15.
- Read the project notes "Carrying an emitter of a locked geodesic" and "Curve shortening is a flow"
  (`.agents/knowledge.d/notes/K-20261104-bb27.md`, `K-20261104-5d8e.md`).
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Invariant: an arc's portal word must chain from its start anchor's cell to its end anchor's cell. `isGeodesicLocked` is
derived from the ends: both on emitters. `motionState` is stored. A tied curve's arcs run from an emitter to a shared free
vertex, so they are not locked, and today lifting that emitter deletes them.

## Decisions

- Terms: a curve's **end nodes** are arc ends on an emitter; its **interior vertices** are `geodesicModel/vertex` objects
  shared by two or more arc ends. The emitter drags end nodes. The flow never acts on one.
- An arc **follows its emitter** when it has an end on that emitter and connects emitters, or its other end is a shared
  vertex. New predicate `arcFollowsEmitter` in `lifecycle.ts`.
- The four places of the table in 13.1 change to `arcFollowsEmitter`. Tying, aim, rotate and the deformation policy keep
  `arcConnectsEmitters`: a curve still shortening at a geometry commit is deleted, as today.
- A plain shot geodesic (unshared free end) is still deleted on lift.
- Chord into a forbidden zone while dragging: a connecting arc is deleted, as today; a tied arc takes its **whole curve**
  (`arcsOfCurve`).
- Any other failed rebuild during the carry: the arc keeps its old path and gets the transient field `stale: true`; the
  next successful rebuild clears it. At release, a failed rebuild of a tied arc removes the whole curve.
- `previewVertexMove` and `previewVertexRemoval` refuse an id that is not a `geodesicModel/vertex` (undefined and `blocked`).
- The refusal code is `geodesicModel/notConnected`.
- Operations reach dependents as in 13.1: the `api` holds only the previews and `commitVertexMove`. `highlightEndpoint`,
  `removeVertex` and `removeCurve` are commands, the last two `moduleOnly`.
- `previewVertexRemoval` and `removeVertex` take no `remainingDriven`.
- "The vertex count never grows" must not appear in `geodesicModel/api.ts`.
- A kinked closed loop now shows as open, not moving. This is accepted.
- The implementation stays in `src/world-objects/geodesic/` in this wave; the module is a facade (12.1).

## Steps

1. **First commit, renames only** (section 10): the four kinds, their types, constructors and guards, id families,
   `_docs/MATHEMATICAL_MODEL.md`, the header of `objects.ts`. Done when
   `grep -rn "geodesic-interval\|free-geodesic-end\|\"geodesic-segment\"\|geodesic-intersection" src tests` is empty.
2. `world-objects/geodesic/vertices.ts` (13.1), moved out of `curveShortening.ts`; `curveShortening.ts` rewritten on it.
   Behaviour identical; the curve-shortening tests stay green unchanged.
3. Delete `motionState`. `isTied` replaces it for display (`segments.ts:301`); `isAimableFreeGeodesic` drops its check.
   Rename `isGeodesicLocked` to `arcConnectsEmitters` and `collectLockedIncidentGeodesicIdsForEmitter` to match. In
   `findEquivalentStableInterval`, "stable" becomes "connects emitters". The legacy flow keeps working until job 53: where
   it read `motionState`, it reads its pair's `vertexIds`. Test assertions on `motionState` change here, and each change is
   recorded under `### Deviations`. Done when `grep -rn "motionState\|isGeodesicLocked" src tests` is empty.
4. End nodes: `arcFollowsEmitter`, the four places, whole-curve removal, `stale` and `isStale`. This also fixes
   `carryEnd.ts:45-88`, which can regrow a tied arc.
5. `src/modules/geodesicModel/` (`api.ts`, `module.ts`, `index.ts`) over world-objects, in the experience, with the
   `GeodesicModelQueries` and `GeodesicModelApi` split of 13.1. Add the naming check of section 10 to `docs:check`.

## Tests and checks

- On a tied curve: lifting its emitter keeps it; carrying moves the end node and keeps each arc's class, through a portal
  too; a chord into a forbidden zone removes the whole curve. A plain shot geodesic is still deleted on lift.
- `tests/modules/geodesicModel.contract.test.ts`: moving a vertex keeps each arc's class (the word changes exactly by the
  crossings); length after equals `lengthAfterMeters`; a failed preview changes nothing (registry version unchanged); tie
  then removal round-trips the geometry within tolerance; a taut loop keeps its vertex (preview `loopTaut`); a collapsed
  merge deletes the curve and its vertex; every `queries` function leaves the registry version unchanged; `removeVertex` on a
  blocked vertex is refused and changes nothing; both previews refuse an emitter id.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not mix behaviour changes into the rename commit.
- Do not move the flow here; job 53 does that.
- Do not widen tying, aim, rotate or the deformation policy.

## Done when

- The greps above are empty, a tied curve survives a carry in the app, and all checks are green.
