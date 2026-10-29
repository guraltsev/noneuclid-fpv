# Batch report: jobs 01-10

Coordinator: Claude Sonnet 5.5. Started 2026-10-29 at commit b90380f; finished <date> at commit <hash>.

## Start state
Tree clean. typecheck ok; docs:check ok; tests 625 passed / 9 skipped (86 files). The very first `npm test` run
reported "No test suite found" for all 86 files (0 tests); an immediate rerun passed. Treated as a transient
environment flake (possibly a cold transform cache); not investigated.

## Jobs
| Job | Result | Commits | Tests (passed/skipped) | Issues closed |
| --- | --- | --- | --- | --- |
| 01 | done (before this batch) | e094b82 | 625/9 | 74 |
| 02 | done | 6a3772b | 635/9 | 40 |
| 03 | done, needs review | e06768c | 650/9 | - |
| 04 | done, needs review | 690f358 | 660/9 | - |
| 05 | done | a9b0516 | 667/9 | 68 |
| 06 | done | 92d0858 | 672/9 | 66 |
| 07 | done | e768cd2, b18497e | 677/8 | none (issues 53, 64 get status notes) |

## For review

### Job 03 (done, needs review)
Uncertain:
- Workflow: not run on a real deploy, so the new `Pages base:` step was not observed. If the first deploy serves broken asset URLs, revert the `base="/"` fallback in `.github/workflows/deploy-pages.yml`.
- HTTPS recipe: the generated PFX was not loaded into the Rebex server.
- Stale links: `_issues/_closed/33_*` and `_issues/_closed/35_*` still link to the old job path (left as historical records; docs:check passes).
Coordinator note: pushing job 03 may itself trigger the Pages workflow; check the first run.

### Job 04 (done, needs review)
Deviations:
- For the missing-asset test, renamed `dist/assets/baloon/Balloon.glb` instead of `rover.glb` (first .glb found, also a used model); restored afterwards.
Uncertain:
- The menu check only proves that opening and closing the palette throws nothing; palette state is not observable from the page.
- When a model is missing, the page reports `loading error: Starting world` (the loading text) plus the 404 line; the 404 line is the useful signal.
Not done:
- `renderer.info.memory` check: the create/dispose/create baseline needs a hook in `src/`, so not added.
- XR persistent-failure check: listed as "not covered" in the headset checklist.
- Headset checklist not run (no headset).

### Job 05 (clean pass; deviations noted)
- Also fixed a link to issue 68 in `_issues/_closed/41_documentation_audit_findings.md`.
- Issue 68's Closing evidence says "the job 05 commit" rather than a hash.

### Job 07 (clean pass; deviation noted)
- Two commits instead of one (code, then bookkeeping), because the issue notes need the code commit's hash.
- Skipped tests went 9 -> 8: the marmot heading test was un-skipped, as the job directs.

## Cross-job problems
- The batch report was swept into the job 04 commit (it was untracked, and the job 04 sub-agent's commit included it). Harmless; it is tracked from 690f358 on.

## Final checks
