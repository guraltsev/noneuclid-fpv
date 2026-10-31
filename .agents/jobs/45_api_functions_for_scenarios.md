# Job 45 - API functions that scenarios need, and the checks they convert

Status: blocked on the maintainer: the functions below are a proposal, and the engine API's design is agreed in
`_docs/design/012-engine-api.md` (see `.agents/knowledge/design-012-process.md`). Do not start until 012 records which of
them are agreed, and in what form.
Resolves: nothing fully. It converts class-B manual checks into scenarios.

## Goal

Add to `window.noneuclid.api` the queries and commands that the class-B checks of the audit need, as real public
functions of the engine API (`_docs/tests.md` §6.3), and convert those checks into `release` scenarios with the runner of
job 44.

## Depends on

- Job 44 (scenario runner).
- The maintainer's agreement in 012 on the functions, their names and their data shapes.

## Proposal to discuss with the maintainer

The audit (`.agents/jobs/_reports/test_audit_2026_10_31.md` §4, §5) found about 20 checks blocked only by missing API
functions. Grouped by what they would unlock:

| Function (proposed) | Kind | Unlocks (audit §4 numbers) | Relation to 012 |
| --- | --- | --- | --- |
| `player.getPose()`, in every build | query | 5, 8, 9, 10, 11, 25 | P2: poses as intrinsic data (cell plus pose); P14 rule 3 says poses are opaque to clients |
| `player.setPose(cellId, pose)` | command | 8, 9, 10, 11, 25, 33, 37, 38 | P2: commands carry intrinsic geometric data |
| `player.lastMoveResult()` | query | 8, 10 | P1: discrete results |
| `sim.pause()`, `sim.step(n, dt)`, `sim.frame()` | command, query | 8–11, 36, 65 (determinism) | P8: host-chosen steps; tests step as they like |
| `app.changeWorld` resolving when loaded | command | all scenarios (replaces a polling heuristic) | P9: long work as jobs with completion |
| `world.reset()` | command | 13 | — |
| `tool.select`, `geodesic.fire`, `geodesic.tie`, `carry.pickUp`, `carry.drop` | commands | 17–23 | P2 semantic commands; P4 tool sessions; carry as attachment |
| `aim.pick(ray)` | query | 25 | P2: picking is a query |
| `objects.spawn(kind, cellId, pose)` | command | 57, 58 | P6: engine-allocated ids (today `Date.now()`) |
| `ui.paletteState()` | query | 26–28 | P3: menu state is client-local, so this is a client query, not an engine one |
| `view.rendererInfo()` | query | 61, 62; the fake renderer's contract (job 44) | client-side, beside `view.screenshot` |
| `debug.injectFrameError(n)` | command | 63 | test seam or legitimate debug command: to decide |
| a debug option forcing the fragment-clip fallback | option | 40 | an optional-feature switch (`.agents/knowledge/optional-features-localized.md`) |

Questions for the maintainer:
1. Which of these are engine API (they survive the engine split), and which are client or debug calls?
2. Should `sim.step` exist on today's app, before the engine split? That means a paused frame loop that only advances
   when stepped.
3. Is a pose given as `{ cellId, position, yawRadians }` acceptable now, given P14 rule 3 (opaque poses) and the
   handedness requirement of non-orientable worlds?
4. Does `debug.injectFrameError` count as a test back door, which `_docs/tests.md` §6.3 forbids, or as a debug command?

## Decisions

To be written once 012 records the agreement: names, argument and result shapes, which namespace each belongs to, and
which build exposes it.

## Steps (after agreement)

1. For each agreed function:
   - implement it on the API object, with JSDoc (`_docs/documentation_style.md`), taking and returning plain data;
   - add a `unit` test at its owner layer where the logic lives outside the renderer;
   - add one `release` scenario showing the wiring.
2. Convert the class-B checks it unlocks:
   - write their scenarios in `tests/app/`;
   - remove the checks from `tests/manual_smoke.md` and every living list (`_docs/tests.md` §6.4);
   - add a line to each issue whose check is now automated.
3. Update `_docs/tests.md` §8.5 ("What the API does not offer yet") so that it lists only what remains missing.

## Do not

- Start before the agreement is recorded in 012.
- Add a function named after a test, or a flag that skips validation.

## Done when

Every agreed function exists with JSDoc and a scenario, every class-B check it unlocks is a scenario or is recorded as
still blocked, and `_docs/tests.md` §8.5 is current.
