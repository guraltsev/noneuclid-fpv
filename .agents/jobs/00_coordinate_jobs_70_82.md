# Job 00 - Coordinate jobs 70-82 (discoverable UI and sandbox level design): order, gates, batch report

Status: queued.
Resolves: nothing filed; carries out design note [017](../../_docs/design/017-discoverable-ui-and-level-design.md).

## Goal

Run jobs 70 to 82 in order. They implement design 017: one vocabulary, toasts, tools that stay in hand, a guarded
reset, a pause card, the tool belt and input verbs on desktop, the hint strip and better targeting, VR hand roles and
one-controller support, self-explaining menus, help that teaches, the shape machine, and the sandbox level design
(spawn, tool stand, demo, discoveries).

## Depends on

Job 69 (it changes the VR palette scale that jobs 77 and 78 draw on). Work on branch `dev`, never `main`.

## Before you start

- Read design 017 in full once. Every job quotes the sections it implements; the design is the reference when a job is
  silent.
- Read [README.md](README.md), especially "Rules for the implementing model".
- Project-knowledge notes that apply to the whole batch:
  - K-20261112-1784: run vitest from PowerShell, not Git Bash, on this machine.
  - K-20261104-f80b: the layer order is a DAG and `docs:check` enforces it; `three` only in `render`.
  - K-20261112-0eb0: R (and the VR stick press) wipes the world, and tools deselect after one use (jobs 72, 73).
  - K-20261112-6c0e: how to drive the app from a script with synthetic `mousemove` events (the appendix of design 017).

## Order and gates

Run the jobs in this order: 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82. Each job lists its own dependencies;
they all point backwards in this list.

After each job:

1. `npm run typecheck`, `npm test`, `npm run docs:check` must be green (or show only failures already in the baseline
   that the job's report names).
2. The job's own "Done when" holds, and its report is appended.
3. Commit (one or more commits per job) and push to `github dev`.

If a job cannot reach its "Done when", record it as `done, needs review`, and carry on with the next job only if that
job does not depend on the missing part. Jobs 75 and 77 are the ones the rest lean on; if either fails, stop the batch
and write the report.

## Report

Write `_reports/jobs_70_82.md` with one section per job: status, commits, deviations, the uncertain items, and the
checks. End with a list of what needs the maintainer: a headset session for job 77, the student terms of job 70, and
anything else the jobs marked uncertain. Update the queue table in the README for every job.

## Done when

Every job of the batch is done or done-needs-review, the batch report exists, and the README queue matches.
