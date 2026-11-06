# 89 - Rotate, aim and carry bypass the tool gates

Status: open.

Priority: P2 (design rule broken; no visible defect while no gate refuses these tools). Found 2026-11-05.

Jobs: [64](../.agents/jobs/64_emitter_edits_and_length.md).

## Problem

Design 013 section 8.1: the client asks the world before switching tool. `geodesicCannonTools.ts` switches rotate, aim and carry
with the client command `enter-tool-mode`, which `applyRuntimeCommand` applies at once and which never reaches
`world/requestTool`. So the configuration gate and any module gate are not asked for these three, and an experience with
the emitters disabled, or a later gate such as a role, cannot refuse them.

`requiresTool` is also missing from `carry/attach`, so the enforcing check of section 8.1, step 4, does not cover it either. Only
`geodesicModel/tieAndDetach` declares it.

## Done when

- `enter-tool-mode` is gone; rotate, aim and carry start through `world/requestTool`.
- Commands that need these tools declare `requiresTool`.
- A test: with the emitters disabled by configuration, each of the three is refused with its message, and the tool does not change.

- Job 64 (2026-11-05): done, needs review; see the Report in [the job](../.agents/jobs/_done/64_emitter_edits_and_length.md). Manual checks are not done, so this stays open.
