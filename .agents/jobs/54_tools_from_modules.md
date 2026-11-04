# Job 54 - Build tools from module descriptors

Status: skipped on 2026-11-03: needs job 53.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 1, 6).

## Goal

A tool is a descriptor a module contributes, and the shell has one lookup, not a chain naming each tool. The tie tool moves
into the geodesic model, and it gets the tool-level test job 33 lacked.

## Depends on

Job 53.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job54 -b job-54 <branch with job 53>`).
- Read design 013: sections 8.3, 9.1, 13.1 (the tie tool), and job 54 in section 15.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

The frame dispatch at `createThreeApp.ts:1184-1221` (line numbers will have moved) names each tool. Tool ids are one union
in `glue/toolIds.ts`. The emitter page has a hard-coded tie button and `canTieAndDetach`. Two live bugs in job 33's manual
test slipped through because no test drove the tool-level tie sequence.

## Decisions

- Core tools get descriptors registered by the shell. Module tools come from the experience's client parts.
- The tool-id union is core ids plus module ids by interface merging (`ModuleToolIds`).
- The tie tool id is `geodesicModel/tie`.
- A tool changes the world only by `ToolContext.submit`. `ToolContext.query` returns `queries` only.
- The tie highlight goes through the `geodesicModel/highlightEndpoint` command and stays on the segments until a client
  overlay exists.
- The emitter page's action list becomes the object-action contributions for that kind:
  `{ actionId, label, iconId, enabled }`.
- The tie tool is available when the emitter has at least two attachments on arcs that connect emitters.
- `onResult`: success ends the tool; a refusal shows the message and keeps the tool with no picks.
- `geodesicModel({ tieTool: false })`: no tool, no action, no tool id; `requiresTool` is dropped from the command, which stays
  for scripts.
- Carry, rotate and aim keep their per-frame updates in the shell (section 16).

## Steps

1. `ToolDescriptor`, `ToolContext`, `AimPick`, `ModuleClient` (8.3, 9.1); tool ids by interface merging.
2. One descriptor per existing tool. Every place listed in 8.3 reads `toolsById`. Rename the tie tool id.
3. Move the tie tool to `src/modules/geodesicModel/tieTool.ts`. Its picks move from `cannonToolState` to
   `moduleToolState.geodesicModel`. Delete `tieAndDetachEndpointSelections`.
4. Remove the files this empties from `legacyWorldWriters`.

## Tests and checks

- `tests/modules/geodesicModel/tieTool.test.ts`, with a fake `ToolContext` whose `pickTargets` returns scripted picks on a
  real engine: two picks of roles on connecting arcs tie, and the curve then shortens; a duplicate pick is ignored; another
  emitter's geodesic is refused; an out-of-range pick is refused; a world refusal is shown and keeps the tool; success ends
  the tool and clears its state; ending after one pick clears the highlight.
- An experience with `geodesicModel({ tieTool: false })` has no tie tool and no emitter-page action, while
  `api.geodesicModel.tieAndDetach` still works.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not give a tool a write path other than `submit`.
- Do not move carry, rotate or aim into modules.

## Done when

- `grep -rn "geodesic-cannon-tie-detach" src tests` is empty, and the frame dispatch chain is one lookup.
- The tie tool works on desktop and in VR, and all checks are green.
