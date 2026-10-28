# 33 - Repository issue and risk audit, 2026-08-03

Status: open as of 2026-08-03T14:24:10-05:00.

Priority: P1 repository governance.

## Goal

Reconcile every file in `docs/issues` with the implementation at commit
`09dafe7`, archive completed or superseded work, revise genuinely active work,
and record important repository risks that were not represented in the issue
set.

## Snapshot

The audit found 16 active issue files:

- 10 implementation-complete or superseded issues were closed and moved to
  `_closed` on 2026-08-03;
- issues 17, 20, 21, and 29 may need fresh manual/end-to-end evidence before
  they can join the closed archive;
- issues 31 and 32 remain active P1 domain-correctness work;
- issue 30 has only P3 compatibility cleanup remaining;
- six previously untracked operational or maintainability subjects are now
  recorded in issues 34 through 39.

The repository contained 86 `*.test.ts` files, approximately 544 statically
discoverable test cases, 13,818 test lines, 148 TypeScript source files, and 607
tracked files during the audit. The checkout was clean. Tests, typecheck, and a
fresh build could not be executed because Node/npm were unavailable on the
audit environment's `PATH`; current HEAD must not be called verified green until
those commands run in CI or a Node-enabled environment.

## Existing issue disposition

| Issue | Audit disposition |
| --- | --- |
| 15 | Closed as duplicate of 17 on 2026-08-03. |
| 16 | Closed as implemented on 2026-08-03; explicit world-id debug detail remains optional P3. |
| 17 | Update obsolete stereo criterion, record headset smoke result, archive. |
| 18 | Closed on 2026-08-03; deployment footprint continues in 34. |
| 19 | Closed as superseded by 27 on 2026-08-03. |
| 20 | Record headset interaction result and archive. |
| 21 | Record headset stereo/performance result and archive. |
| 22 | Closed as implemented on 2026-08-03. |
| 23 | Closed as implemented on 2026-08-03. |
| 26 | Closed as implemented on 2026-08-03; current identity model remains in 31. |
| 27 | Closed on 2026-08-03; residual cleanup continues in 38. |
| 28 | Closed as implemented and superseded by 31 on 2026-08-03. |
| 29 | Replace obsolete current-state prose, verify, and archive. |
| 30 | Closed as feature-complete on 2026-08-03; P3 cleanup remains in 38. |
| 31 | Keep open at P1 and rewrite around actual Phase F/legacy state. |
| 32 | Keep open at P1 with checked test-slice progress. |

## New risk issues

- [34 - Reduce deployment and repository asset footprint](34_reduce_deployment_and_repository_asset_footprint.md), P0.
- [35 - Remove the committed shared TLS private key](35_remove_committed_shared_tls_private_key.md), P1 security.
- [36 - Add pre-merge CI and browser smoke coverage](36_add_premerge_ci_and_browser_smoke_coverage.md), P1.
- [37 - Make Pages deployment repository-name agnostic](37_align_pages_and_deployment_configuration.md), P2.
- [38 - Decompose runtime monoliths and retire legacy paths](38_decompose_runtime_monoliths_and_retire_legacy_paths.md), P1/P3 staged cleanup.
- [39 - Document project and third-party asset provenance](_closed/39_document_project_and_asset_provenance.md), completed 2026-08-03.

## Important evidence

### Deployment and repository weight

`public` measured 964.3 MiB and the existing ignored `dist` measured 966.15
MiB. Only about 43.4 MiB of tracked public assets looked runtime-oriented;
approximately 920.9 MiB consisted of other public files including raw JPG, EXR,
PNG, Blend, and ZIP sources. The Git object pack measured 1.32 GiB. Because
Vite copies `public`, runtime KTX2 optimization did not solve artifact size.

### TLS key material

`wwwserver/server-certificate.pfx` is tracked and its password is committed in
`wwwserver/RebexTinyWebServer.exe.config`. Certificate inspection with that
password succeeded and confirmed usable private-key material valid through
2032. It must not be shared or trusted on classroom devices.

### Verification gaps

Vitest is configured for the Node environment. There is no browser smoke test
that starts the built app, catches asset/base-path failures, exercises pointer
lock and basic menu behavior, or verifies WebGL startup. The only workflow runs
on pushes/manual dispatch and gates jobs to the default branch, so pull requests
have no required pre-merge validation path.

### Architecture concentration

`src/render/three/createThreeApp.ts` measured 6,648 lines and
`src/world-objects/geodesicCannon.ts` measured 4,533 lines. Both mix multiple
state machines and compatibility paths. This contradicts the Stage 12 cleanup
criterion and makes the highest-risk behavior expensive to review.

## Completion criteria

This audit issue is complete when:

- verification-gated issues 17, 20, 21, and 29 have closing evidence and move
  to `docs/issues/_closed`;
- issues 31 and 32 contain current checked progress instead of contradictory
  pre-implementation status text;
- issues 34 through 39 have been accepted, reprioritized, or explicitly
  rejected with rationale;
- typecheck, tests, and a Pages build have been run on current HEAD;
- manual headset verification has been recorded for the VR archive candidates.
