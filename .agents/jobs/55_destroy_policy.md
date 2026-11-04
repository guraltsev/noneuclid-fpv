# Job 55 - Add the "destroy" policy for blocked curves

Status: queued.
Resolves: issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md), with jobs 48 to 54; issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md), with jobs 51 and 56 to 60.

## Goal

When a flow touches a forbidden-zone singularity, the geodesic is destroyed (maintainer, 2026-11-02). It is the first
variation built as a policy, with no change to the shell, the tools or the model.

## Depends on

Job 54.

## Before you start

- Read design 013: sections 9.5, 13.2, and job 55 in section 15.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

A vertex that cannot move and cannot merge reaches the `onBlocked` policy (job 53). `"unresolve"` puts it in `quiet`, reports
it in `blockedVertices` and emits `curveShortening/unresolved`.

## Decisions

- `onBlocked: "destroy"` calls `arcsOfCurve(vertexId)`, dispatches `geodesicModel/removeCurve`, and emits
  `curveShortening/destroyed { arcIds, message }`.
- It removes the whole curve, never one arc.
- It becomes the default experience's setting. `"unresolve"` stays available.
- A stale arc is not blocked: the skip of job 53 runs first.

## Steps

1. Add `"destroy"` to `policies.ts` and the event to `CurveShorteningEvent`.
2. Set it in the default experience.
3. Update `_docs/MATHEMATICAL_MODEL.md` section 7, and mark the 2026-11-02 row of 013 section 1 as implemented.
4. Close issues 84 and 86 as the jobs README describes.

## Tests and checks

- The same blocked scenario under both policies.
- Under `"destroy"`, a curve of several arcs is removed whole, and no vertex is left.
- Manual check in the app: tie two geodesics around a corner; the geodesic vanishes; the notice appears in the console.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not edit the shell, the tools or `geodesicModel` for this policy. If you seem to need to, record it under
  `### Uncertain`: it would mean the module boundary is wrong.

## Done when

- The default experience destroys a blocked curve, `"unresolve"` still works, and all checks are green.
