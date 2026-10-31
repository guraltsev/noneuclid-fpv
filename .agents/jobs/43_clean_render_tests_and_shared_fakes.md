# Job 43 - Clean the render tests and share the boundary fakes

Status: queued.
Resolves: nothing by itself (it pays off test debt recorded in `tests/hygiene-baseline.txt`).

## Goal

Rename `tests/render-contract/` to `tests/render/`, give the boundaries of the renderer one shared fake each, and bring
the render tests up to `_docs/tests.md`: they assert renderer contracts, never the layout of three.js objects or
internal counters.

## Depends on

Job 41. Job 42 must have added the shared fixtures in `tests/fixtures/cell-complex/` (two-room spec, square base).

## Before you start

Read:

| File | What to look at |
| --- | --- |
| `_docs/tests.md` | §2.2, §4.5 (fakes), §8.1 (the paragraph on renderer tests), §8.3 (boundaries and their fakes) |
| `.agents/jobs/_reports/test_audit_2026_10_31.md` | §3: the per-file verdicts and the list of repeated fakes |
| `.agents/jobs/32_layer_dag.md` | which modules job 32 will move; their tests stay in `render` until then |
| `_docs/design/012-engine-api.md` | the paragraph citing `funnelStaticCullBenchmark.test.ts` (section 6) |

Baseline: `npm run typecheck`, `npm test` and `npm run test:report`. Save the output.

## Decisions

1. **The rename.** `git mv tests/render-contract tests/render` in its own commit. Update every path that refers to it
   (grep for `render-contract` in `_docs/`, `.agents/` and `scripts/`). Leave `_done` jobs and `_reports` alone: they
   are history.
2. **Shared fakes** go in `tests/support/`, one file per boundary:
   - `fakeRenderer.ts`: a WebGL renderer with `info`, `setRenderTarget`, `render` and `xr`. It records the calls a test
     reads.
   - `fakeXr.ts`: the navigator `xr` object, a session and its input sources, and gamepads.
   - `fakeCanvas2d.ts`: a 2D context.
   - `preparedAssets.ts`: a builder of `PreparedWorldAssets` with defaults and overrides.
   - `cameras.ts`: one camera builder replacing the 8 local ones.

   Each file has a module comment naming the real interface it stands in for. A fake implements only what the tests
   use. The contract test of `fakeRenderer` against a real `WebGLRenderer` belongs to job 44 (`release` tier): add a
   `TODO(job44)` line to the fake's comment.
3. **The verdicts** in audit §3 are the default plan. A different choice is recorded under `### Deviations`.
4. **Benchmarks.**
   - `funnelStaticCullBenchmark.test.ts` becomes `scripts/bench/funnelStaticCull.bench.ts` (runner from job 42).
   - `frameAllocations.test.ts` becomes `scripts/bench/frameAllocations.bench.ts`: it mocks the `three` module to count
     constructors, which is a measurement, not a behaviour.
   - In `_docs/design/012-engine-api.md`, change only the sentence that cites the old path, so it names
     `npm run bench -- funnelStaticCull`. Do not edit anything else in 012 and add no decision-log line: it is a path
     fix, not a design change.
5. **What a render test may assert:**
   - data handed to the GPU (clip planes, instance matrices and counts, uniforms the shader contract names);
   - what is released on dispose;
   - what a frame reads from the snapshot;
   - which objects are visible.

   It may not assert:
   - object names, child counts or the identity of meshes or matrices;
   - GLSL substrings;
   - `userData` flags;
   - internal statistics counters;
   - a spy on `traverse`.

   Where such an assertion was the only proof of a behaviour (for example "the cache is reused"), keep the behaviour by
   asserting its outcome, or retire the case and say why in the behaviour map.
6. **Tests follow the code.** Do not move a test to a new area for code that is still in `src/render/`, even when it
   imports no three.js. Job 32 moves those tests with their code. Exception: cases that test `src/ui/paletteDefinition`
   through `scenePaletteLibraryAdapter` move to `tests/ui/`, because their owner is in `src/ui/` already.
7. **Duplicates (one owner each):**
   - joystick dead zone and strafing: `xrControls`;
   - each eye has its own root: `xrPortalEye`;
   - stereo ranking and budget: `portalClipData`;
   - ghost suppression: `runtimeObjectPortalInstances`.
8. **Names, comments, proof and behaviour map:** as in job 42, decisions 3, 11 and 12.

## Steps

1. The rename (decision 1). Run `npm test`, then commit.
2. Write the shared fakes and fixtures (decision 2), and switch the files that rebuilt them inline, one file at a time,
   running each file after its switch. Then commit.
3. Write the behaviour map for the whole area.
4. Apply the verdicts and decisions 4–7, in commits of about ten files. Do the proof runs.
5. Remove the area's lines from `tests/hygiene-baseline.txt`.
6. Run `npm run test:report` and compare it with the baseline.

## Tests and checks

After each commit: `npx vitest run tests/render` and `npm test`. At the end: `npm run typecheck`, `npm test`,
`npm run test:report`, `npm run docs:check`.

## Do not

- Change `src/`.
- Move tests for code that job 32 will move (decision 6).
- Weaken an assertion to make a test pass, or add baseline lines.

## Done when

- `tests/render-contract/` no longer exists.
- No file in `tests/render/` builds its own renderer, XR, canvas or prepared-assets fake.
- No baseline line remains for `render`.
- The report has the behaviour map and the proof lines.
- `npm test` and `npm run docs:check` pass.
