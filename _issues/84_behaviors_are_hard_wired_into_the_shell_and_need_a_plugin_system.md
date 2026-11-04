# 84 - Behaviors are hard-wired into the shell; the engine needs a designed plugin system for them

Status: open. Design drafted in [013](../_docs/design/013-world-engine-clients-and-modules.md) (2026-11-03); job files
written. The module system is designed together with the split between world state and client
state (maintainer, 2026-11-03).

Priority: P2 (blocks every planned variation of geodesic behavior; no user-visible defect today).

Jobs: [48 to 55](../.agents/jobs/README.md), specified in design 013, section 15.

Correction (2026-11-03): `free-geodesic-end` and the interval `motionState` are not owned by the flow; every shot
geodesic uses a free end. In design 013 a curve has no lifecycle, so `curve-shortening-pair` and `motionState` are deleted
(section 13.2).

## Problem

A behavior is a rule that acts on the world over time or on a command: tying and untying geodesics, the curve shortening flow,
carrying an emitter, a creature's movement, a tool's effect. Today each behavior is wired into the engine by hand, in three
places at once:

- **The frame loop names it.** `createThreeApp.ts` calls `advanceCurveShorteningPairs` directly and then hand-codes what must
  follow a change (`refreshProtractorAnglesForGeodesic`, `refreshMeasuredGeodesicLengthsForGeodesic`, pruning of intersection
  objects, hitbox sync), keyed on the ids that one function returned.
- **The tool names it.** `geodesicCannonTools.ts` calls `tieAndDetachGeodesicEndpoints` directly.
- **The core owns its objects.** `curve-shortening-pair`, `free-geodesic-end` and the interval `motionState` are core object
  kinds in `world-objects/geodesic/objects.ts`, although only one behavior uses them.

So a different behavior cannot replace this one without editing the shell, the tool and the core object model. Planned
variations all hit this:

- When a flow touches a forbidden-zone singularity, the geodesic is destroyed (decided 2026-11-02). Later the maintainer may want
  the curve to stick at the corner, create a vertex there, and let only the part past the corner keep flowing.
- Instant straightening, frozen curves, or an experience with no tie/untie at all (the tool should then not exist).
- Any future module that adds a rule on top of geodesics (a dynamic that dependent objects build on).

`_docs/design/012-engine-api.md` P17 already gives the direction: an experience is a static list of modules; each module exports
its command, query and event types, its state, its per-tick systems and a client-side view; the experience's command type is the
union of its modules' types; no runtime plugin loading; a module uses only the public module interface. P17 does not settle the
points below, and nothing implements it yet.

## Requirements

1. **Behaviors are modules, not shell code.** A behavior registers its commands, per-tick systems, object kinds and events. The
   shell runs a generic list of systems and knows no behavior by name. Removing a module removes its tools and objects from the
   experience.
2. **Plugins provide an API for later, dependent objects.** A module can export queries, commands, object kinds and events that
   other modules build on (for example, a module for measuring or annotating a geodesic depends on the geodesic dynamics module's
   curve queries, not on its internals). Dependencies are declared and checked: a missing or cyclic dependency fails at
   composition time, and a dependent module sees only the provider's exported interface.
3. **Performance must not degrade.** The frame loop today runs the systems directly with no dispatch cost; the plugin system
   must keep that:
   - composition is static (P17): the system list is built once at start, not looked up per frame;
   - no per-frame allocation from the plugin layer (change sets and event buffers are reused; cf. issue 75);
   - systems skip work when nothing they read changed (as the static cull and the frame-skip guard already do);
   - a before/after measurement is part of acceptance: frame time and allocation on the existing benchmark scenes, with a stated
     tolerance.
4. **Change propagation is generic.** A system reports what it changed (ids and kinds); derived state (protractor angles,
   measured lengths, intersections, hitboxes) subscribes to the change set. The shell stops carrying a hand-written follow-up
   list for each behavior.
5. **The boundary is the public interface.** A module uses only the exported core interface (no reaching into registry
   internals). Where the geodesic flow needs an internal today (`replaceDerivedSegmentsFromTraces`,
   `withDeferredGeodesicIntersections`, `requestGeodesicIntersectionUpdate`), decide whether the primitive becomes public or the
   flow is shaped differently. `docs:check` enforces it (layer DAG and import rules).
6. **Typed and testable.** The experience's command type is the union of its modules' commands (exhaustive dispatch). A behavior
   is testable alone against fakes of its dependencies, and a contract test covers each module's exported interface.

## What the design must settle

- The module interface: shape of `commands`, `systems`, `queries`, `events`, `objectKinds`, `views`, and how a module declares
  dependencies.
- How a behavior is a *swappable policy* inside a module (for example the block handling of the flow), versus a whole module
  replaced by another with the same exported interface.
- Ordering of systems within a tick and between modules (explicit phases, or declared reads/writes).
- Where module state lives (session, registry, module-private) without a second source of truth.
- Persistence: which module-owned object kinds are saved, and how an unknown kind is handled when a module is absent.
- Interaction with the engine API of design 012 (commands and queries over a plain-data boundary) and with the XR/desktop
  client views.
- The performance budget and how it is measured in CI.

## First consumer

Move tie/untie and the curve shortening flow (pair, free end, tool, system, notices) into one `geodesicDynamics` module as the
first module on the new interface. It exercises requirements 1, 2, 4 and 5 and has an obvious second implementation (the stick-at-
corner flow). Its present behavior is described in `_docs/MATHEMATICAL_MODEL.md`.

## Evidence

- `src/render/three/createThreeApp.ts`, the `"curve shortening"` phase of the frame loop and the follow-ups after it.
- `src/render/three/geodesicCannonTools.ts`, the call to `tieAndDetachGeodesicEndpoints`.
- Two live bugs in job 33's manual test slipped through because no test drove the tool-level tie-and-detach sequence: the
  behavior was reachable only through the shell, so it could not be tested as a unit.

## Impact

Every new or alternative geodesic behavior needs edits in the shell, the tool layer and the core object model, so changes cannot
be made or tested in isolation. Without a designed system, ad-hoc hooks will accumulate and can cost frame time.
