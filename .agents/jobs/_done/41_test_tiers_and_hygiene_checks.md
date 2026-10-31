# Job 41 - Test tiers, hygiene checks, baseline and indicators

Status: done, needs review on 2026-10-31.
Resolves: nothing by itself (test infrastructure for jobs 42–45).

## Goal

Make the test policy machine-checked: tiers declared by file suffix with one command per tier, a guard that keeps
`unit` tests in process, deterministic fast-check runs, the hygiene checks H1–H10 of `_docs/tests_hygiene.md` §6 with a
baseline of today's violations, and a command that prints the suite's indicators. No test is rewritten in this job.

## Depends on

Nothing.

## Before you start

Read, in this order:

| File | What to look at |
| --- | --- |
| `_docs/tests.md` | all; §5 (tiers) and §8 (this project) are what you implement |
| `_docs/tests_hygiene.md` | §5 (baseline), §6 (checks H1–H10), §8 (this project) |
| `.agents/jobs/_reports/test_audit_2026_10_31.md` | §1 (numbers) |
| `vite.config.ts` | the `test` block |
| `package.json` | `scripts` |
| `.githooks/pre-push` | the order of the checks |
| `scripts/docs/checks.mjs`, `tests/docs/documentation.test.ts` | the pattern to copy: checks in a script, run by one test |
| `scripts/docs/layering-baseline.json` and `newLayerViolations` in `scripts/docs/lib.mjs` | the ratchet pattern |
| `.agents/knowledge/test-and-smoke-timing.md` | `npm test` takes over a minute |

Baseline: `npm run typecheck` and `npm test` (expect 160 files and 1,071 tests passing, about 75 s summed over files).

## Decisions

1. **Projects.** Add `vitest.workspace.ts` with four projects, each extending `vite.config.ts`:
   - `unit`: `tests/**/*.test.ts`, excluding `**/*.process.test.ts`, `**/*.release.test.ts` and `**/*.report.test.ts`;
     `setupFiles: ["tests/support/unitSetup.ts"]`;
   - `process`: `tests/**/*.process.test.ts`;
   - `release`: `tests/**/*.release.test.ts`, with `passWithNoTests`;
   - `report`: `tests/_temp/**/*.report.test.ts`, run only by path.
   If Vitest 1.6 cannot express this, use the closest equivalent and record it under `### Deviations`.
2. **Scripts** in `package.json`:
   - `test:unit`: `vitest run --project unit`;
   - `test`: `vitest run --project unit --project process`;
   - `test:watch`: `vitest --project unit`;
   - `test:release`: `npm run build && vitest run --project release`;
   - `test:report`: `node scripts/tests/cli.mjs report`.
   Keep `test:coverage` working on the `unit` project.
3. **Temporary report modules** end in `.report.test.ts`, and their command is `npx vitest run --project report tests/_temp/<ref>/<file>`.
   Write this command into `_docs/tests_hygiene.md` §8 ("Report runs").
4. **Unit setup file** (`tests/support/unitSetup.ts`):
   - **fast-check seed:**
     - default: `fc.configureGlobal({ seed: 20261031 })`;
     - `FC_SEED=<integer>`: use that seed;
     - `FC_SEED=random`: set no seed.
   - **Timer guard:** wrap `globalThis.setTimeout` and `setInterval`. A call with a delay above 0 throws
     `unit tier: real timers are not allowed (delay <n> ms); inject the clock or use vi.useFakeTimers() (_docs/tests.md §5)`,
     unless `vi.isFakeTimers()` is true.
     - If an existing unit file hits the guard, list that file in `tests/support/unitTimerExemptions.ts` with a comment
       naming its baseline line, and add the matching `H2` line to the baseline.
     - Do not rewrite the test in this job.
5. **Static checks** live in `scripts/tests/hygiene.mjs`. It exports `runHygieneChecks()`, which returns
   `{ results: Record<rule, string[]> }`, and `collectIndicators()`. The checks parse test files as text, with regular
   expressions, like `scripts/docs/checks.mjs`.
   - **H1:** the tier is the suffix. Every `*.test.ts` file under `tests/` has a tier by construction. The check flags
     test files outside `tests/`, and any file under `tests/` named `*.spec.ts` or `*.test.js`.
   - **H2:** a unit-tier file imports none of `node:child_process`, `child_process`, `node:net`, `node:http`,
     `node:https`, `ws`, or a module under `scripts/server/` or `scripts/smoke/staticServer.mjs`, and calls neither
     `fetch(` nor `new WebSocket(`.
   - **H3:** imports that resolve into `tests/` must resolve into `tests/support/`, `tests/fixtures/` or
     `tests/world-objects/geodesic/fixtures.ts`. Job 42 moves that file into fixtures. No import from `tests/_temp/` is
     allowed outside the same folder.
   - **H4:** flag any of the following:
     - `vi.mock(` or `vi.doMock(` whose path resolves under `src/`;
     - an import of a name declared in `src/` with JSDoc containing "for tests" or "for debugging", or a name ending in
       `ForDebug` or `ForTests`.
     `vi.spyOn` is left to review: it cannot be resolved statically.
   - **H5:** a name in `it(`, `test(`, `describe(` or a test file's comment that matches any of:
     - `/\b(issue|job|stage|batch)\s*#?\d+/i`;
     - a plan id at the start, `/^[A-Z]\d{1,2}[a-z]?[:.]\s/`;
     - a numbered prefix, `/^\d+[a-z]?[.)]\s/`.
     Files under `tests/_temp/` are exempt.
   - **H6:** two checks, outside `_temp/`:
     - every test file starts, before its imports, with a `/** ... */` comment of at least 30 characters;
     - every literal name in `it(`, `test(` or `describe(` is at most 90 characters.
   - **H7, H8:** READMEs as specified in `_docs/tests_hygiene.md`.
     - A job ref (`jobNN`) is open when a file `.agents/jobs/NN_*.md` exists outside `_done/`.
     - An issue ref (`issueNN`) is open when `_issues/NN_*.md` exists outside `_closed/`.
   - **H9:** outside `_temp/`, none of `.skip(`, `.skipIf(`, `.todo(`, `.only(`, `describe.skip`, `it.skip`, or
     `process.env` in a test file.
   - **H10:** the baseline. Each violation is one line, `<rule>\t<file>\t<test name or ->`. A violation listed in
     `tests/hygiene-baseline.txt` passes. A new one fails. A baseline line with no matching violation fails with
     "remove this line from the baseline" (the ratchet).
6. **The test that runs the checks** is `tests/project/testHygiene.test.ts`.
   - It is a `unit` test: it reads repository files read-only, which the unit tier allows.
   - It reports the first 15 problems of every failing rule, like `tests/docs/documentation.test.ts`.
   - The `tests/project/` folder is created now. Job 42 moves the other project tests into it.
7. **Indicators** (`node scripts/tests/cli.mjs report`) print:
   - lines of `tests/` compared with lines of `src/`;
   - the number of test files and of tests per tier (count `it(`/`test(` occurrences);
   - the baseline size per rule;
   - the number of `_temp` and `_conditional` folders;
   - the number of `## M` entries in `tests/manual_smoke.md` (0 if absent);
   - the serial time of the `unit` tier and its 10 slowest files, from
     `vitest run --project unit --no-file-parallelism --reporter=json --outputFile=<os temp file>`.
8. **Classify the existing files.** Rename with `git mv`, keeping their folders (job 42 moves them):
   - `tests/server/channel.test.ts` becomes `channel.process.test.ts`;
   - `tests/server/localServer.test.ts` becomes `localServer.process.test.ts`;
   - `tests/smoke/staticServer.test.ts` becomes `staticServer.process.test.ts`.
   Every other file stays `unit`.
9. **Pre-push:** keep the hook's order. `npm test` now runs `unit` and `process`. After the build and before the smoke
   step, add `npx vitest run --project release` (it passes with no tests). Do not change the smoke retry.
10. **Delete** `tests/scratch/`, which is empty.
11. **Documentation:** in `_docs/tests.md` §8.2 and `_docs/tests_hygiene.md` §8, replace the "Status (2026-10-31)"
    sentences about job 41 with what now exists. Add one line to `.agents/knowledge/index.md` only if something took real
    effort to find (for example, a Vitest workspace limitation).

## Steps

1. Run the baseline and record the numbers.
2. Add `vitest.workspace.ts` and the scripts (decisions 1–3). Check:
   - `npm run test:unit` runs 157 files;
   - `npm test` runs 160 files;
   - `npm run test:release` builds and passes with no tests.
3. Do the renames (decision 8). Run `npm test`.
4. Add `tests/support/unitSetup.ts` (decision 4). Run `npm run test:unit` and handle guard hits as decision 4 says.
5. Write `scripts/tests/hygiene.mjs`, `scripts/tests/cli.mjs` and `tests/project/testHygiene.test.ts`. Run the checks
   once with the baseline empty, and write every violation to `tests/hygiene-baseline.txt`, sorted. Run again: it must
   pass.
6. Prove the checks work. Break one rule per check in a scratch file under `tests/_temp/job41/`, with a README
   (`kind: guard`), and see the matching failure. Then delete the scratch file and the folder.
7. Update the pre-push hook, delete `tests/scratch/`, and update the documentation (decisions 9–11).
8. Run `npm run test:report` and paste its output into the report.

## Tests and checks

`npm run typecheck`, `npm run test:unit`, `npm test`, `npm run test:release`, `npm run test:report`, `npm run docs:check`.

## Do not

- Rewrite, rename or delete any test beyond decisions 8 and 10. That is jobs 42 and 43.
- Add a line to the baseline after step 5.
- Make any check depend on test run time.

## Done when

- The four projects and the commands exist, and `npm test` and the pre-push hook pass.
- `tests/hygiene-baseline.txt` lists today's violations, and a new violation fails `npm test` with the rule and the fix.
- `npm run test:report` prints the indicators.
- The report contains the indicators and, for each check, the proof run of step 6.

## Report

Commit: `653a8a2` ("Job 41: test tiers, hygiene checks, baseline and indicators"), on `design/012-engine-api`,
one commit for the whole job.

### Done

- **Baseline (step 1).** Before any change, commit `2378b1f`: `npm run typecheck` passed; `npm test` (the old,
  undivided `vitest run`) reported **146 files passed + 2 skipped (148) and 1,069 tests passed + 2 skipped
  (1,071)**, wall time 61.48 s. The job's own "Before you start" note ("expect 160 files and 1,071 tests") does
  not match the repository on disk (148 `*.test.ts` files exist under `tests/`, confirmed by `git ls-files tests
  | grep '\.test\.ts$' | wc -l`); the **test count (1,071) matches**, only the file count does not. Recorded
  under `### Uncertain`; proceeded with the real baseline (148 files / 1,071 tests). This mismatch was
  independently flagged by the stray `_reports/batch_41_44.md` already in the tree before this job started
  (not authored by this run).
- **Tiers (decisions 1-3; steps 2-3).** Added `vitest.workspace.ts` with four projects (`unit`, `process`,
  `release`, `report`) each extending `vite.config.ts`. Added `tsconfig.json`'s `vitest.workspace.ts` to
  `include`. Updated `package.json` scripts: `test:unit`, `test`, `test:watch`, `test:release`, `test:report`;
  kept `test:coverage` on the `unit` project (verified: it still prints per-file coverage for `src/math`,
  `src/cell-complex`, `src/movement`).
- **Renames (decision 8; step 3).** `git mv`:
  - `tests/server/channel.test.ts` -> `tests/server/channel.process.test.ts`
  - `tests/server/localServer.test.ts` -> `tests/server/localServer.process.test.ts`
  - `tests/smoke/staticServer.test.ts` -> `tests/smoke/staticServer.process.test.ts`

  Checked first that no other `*.test.ts` file imports `node:child_process`/`node:net`/`node:http(s)`/`ws`,
  `scripts/server/`, `scripts/smoke/staticServer.mjs`, `fetch(` or `new WebSocket(` (none do), so no other file
  needed to move.
- **Unit setup (decision 4; step 4).** `tests/support/unitSetup.ts`: fast-check seed (`fc.configureGlobal`,
  default `20261031`, `FC_SEED=<n>`, `FC_SEED=random`), and a guard wrapping `globalThis.setTimeout`/
  `setInterval` that throws the specified message for a delay above 0 unless `vi.isFakeTimers()`.
  `tests/support/unitTimerExemptions.ts` created, **empty**: a repo-wide search found no unit-tier file calling
  a real timer with a delay above 0 (the only `setTimeout`/`setInterval` call sites outside the three renamed
  process files use delay 0, or are behind an injectable `setTimer`/build-client seam already faked by their
  tests). `npm run test:unit` passed unchanged after adding the setup file.
- **Hygiene checks (decision 5; step 5).** `scripts/tests/hygiene.mjs` exports `runHygieneChecks()` and
  `collectIndicators()`, implementing H1-H10 exactly as decision 5 specifies (regex/text-based, resolving
  relative imports the same way `scripts/docs/lib.mjs` does, using `git ls-files` for "every tracked file").
  `scripts/tests/cli.mjs` adds `check`, `report` and `baseline` commands (the `baseline` command mirrors
  `scripts/docs/cli.mjs`'s and is for one-off/manual regeneration, not a package.json script).
  `tests/project/testHygiene.test.ts` is a `unit` test calling `runHygieneChecks()` only (never
  `collectIndicators()`, which shells out to Vitest and is for the CLI alone).
  Baseline written once, with an empty baseline file, via `node scripts/tests/cli.mjs baseline`: **257
  violations** (`H1:0, H2:0, H3:0, H4:3, H5:59, H6:193, H7:0, H8:0, H9:2`), sorted, in
  `tests/hygiene-baseline.txt`. Re-running the checks against that baseline passes (see `### Checks`).
- **Proof (step 6).** See `### Checks` — "Step 6 proof" for the full output of breaking one rule per check and
  seeing the matching failure, then both ratchet directions for H10, then cleanup.
- **Pre-push (decision 9; step 7).** Added `npx vitest run --project release --passWithNoTests` right after the
  build and before the smoke step; left the smoke retry logic untouched. `sh -n .githooks/pre-push` confirms the
  script still parses.
- **Deleted `tests/scratch/`** (decision 10; step 7): it was empty and untracked, so no git change was needed
  beyond removing the directory from disk.
- **Documentation (decision 11; step 7).** Updated the "Status (2026-10-31)" paragraphs in `_docs/tests.md` §8.2
  and `_docs/tests_hygiene.md` §8 to describe what now exists (the tiers, commands, checks and baseline size per
  rule). Added one `.agents/knowledge/` note,
  [vitest-workspace-and-hygiene-proofs.md](../knowledge/vitest-workspace-and-hygiene-proofs.md): Vitest 1.6
  rejects `passWithNoTests` inside a workspace project's `ProjectConfig` (it is root-only), and `git add -N` lets
  a `git ls-files`-based check see an uncommitted scratch file without staging its content — both took real
  investigation during this job and will save time for jobs 42-44.
- **Report run (step 8).** See `### Checks` — "Final `npm run test:report`".

### Deviations

- **`passWithNoTests` could not be set inside the `release` project of `vitest.workspace.ts`.** Vitest 1.6's
  `ProjectConfig` type (`node_modules/vitest/dist/reporters-*.d.ts`) explicitly omits `passWithNoTests` from the
  per-project config (it is root-only), so decision 1's "with `passWithNoTests`" is implemented instead as
  `--passWithNoTests` on every command line that runs the `release` project (`test:release` in `package.json`,
  and the pre-push hook). Noted in a comment in `vitest.workspace.ts` and in the new knowledge-base note.
- **H4's "name ending in `ForDebug`/`ForTests`" sub-rule is checked as any matching identifier anywhere in the
  test file's text, not only inside an `import { ... }` clause.** The one real occurrence
  (`runtime.leaderForDebug()` in `tests/world-objects/simpleGeoCreature.test.ts`) is a property access on a
  returned runtime object, never a named import, so a strictly import-scoped check would silently miss the
  exact case decision 5 and the audit (`test_audit_2026_10_31.md` §2) call out. The JSDoc sub-rule (an imported
  name whose declaration's own doc says "for tests"/"for debugging") is still import-scoped, as written.
- **The baseline writer dedupes violation keys before writing.** H9 originally wrote two literal, identical
  lines for each of the two env-gated benchmark files (one `.skipIf(` violation and one `process.env`
  violation, both keyed `H9\t<file>\t-` since neither names a test). Two identical lines are redundant (the
  loader already treats the baseline as a set), so `allViolationKeys()` dedupes; the written baseline has 257
  lines, not 259. Verified this does not weaken the ratchet: fixing only one of the two underlying issues in a
  file still leaves the other violation suppressed by the single remaining baseline line, and fixing both
  removes the need for the line entirely (proven in the H10 step-6 proof below).
- **Review fix (coordinator, after the fresh-context review):** the review found that `gitTrackedFiles()` in
  `scripts/tests/hygiene.mjs` shelled out to `git ls-files` via `execSync`, so `tests/project/testHygiene.test.ts`
  spawned a real child process on every run despite being a `unit`-tier test — violating the tier rule the test
  itself checks for others (`_docs/tests.md` §5), and making its module comment's "reads repository files
  read-only" claim false. Fixed by replacing `gitTrackedFiles()` with a pure recursive filesystem walk
  (`listAllFiles()`) that skips the directories git ignores wholesale (`.git`, `node_modules`, `dist`, `.vite`,
  `coverage`, `assets-src`); none of H1-H10 needs `git`'s finer-grained ignores (textures, key files). Verified:
  `npm run typecheck`, `npm test` (147 files/2 skipped, 1070/2 skipped, unchanged), `npm run docs:check` and
  `npm run test:report` (same 257-line baseline, same H1-H10 "ok") all still pass; re-ran the H9 scratch-file proof
  (add a `.skip(` test outside `_temp/`, see it fail named H9, delete it, see it pass again) to confirm the new
  file-discovery mechanism still feeds the checks correctly. The module comment is corrected to say so.

### Uncertain

- The job's stated baseline ("expect 160 files and 1,071 tests") does not match the repository: there are 148
  `*.test.ts` files, not 160; the test count (1,071) does match. All of this job's own counts and "Done when"
  checks use the real, measured numbers (148 before the renames; 145 unit + 3 process = 148 after; 149 after
  adding `tests/project/testHygiene.test.ts`). Confirming which number the job intended (and why the audit
  report also says 160) is a question for the maintainer; it does not change anything this job built, since
  every check here is computed from the live repository, not from a hard-coded count.
- H4's `PreparedKtx2Loader` interface (`src/render/three/preloadWorldAssets.ts`) is flagged because its own
  JSDoc literally contains the phrase "injectable for tests". Read in context, this looks like the *correct*
  design (a public seam for injecting a fake loader, `tests.md` §6.3), not a back door — but decision 5 asks
  for a literal text match, so it is flagged and baselined like the other two (real) H4 violations. A future
  job could resolve this either by rewording the JSDoc (removing it from the baseline with no test change) or
  by confirming the maintainer wants the literal-text check to stay this blunt.

### Not done

Nothing in scope was skipped. (Jobs 42-45 - cleaning the test areas, sharing render fakes, adding scenarios and
API functions - are out of scope for this job and untouched, as "Do not" requires.)

### Checks

**Baseline, before any change** (commit `2378b1f`):

```
npm run typecheck   -> pass
npm test            -> Test Files  146 passed | 2 skipped (148)
                        Tests  1069 passed | 2 skipped (1071)
                        Duration  61.48s
```

**After the job, in order:**

```
npm run typecheck    -> pass (no output)
npm run docs:check    -> ok   module headers
                         ok   exported JSDoc
                         ok   layering
                         ok   module import rules
                         ok   generated documents
                         ok   document references
npm run test:unit     -> Test Files  144 passed | 2 skipped (146)
                         Tests  1053 passed | 2 skipped (1055)
                         Duration  51.21s
npm test              -> Test Files  147 passed | 2 skipped (149)
                         Tests  1070 passed | 2 skipped (1072)
                         Duration  49.66s
npm run test:release  -> builds (tsc --noEmit && vite build, ~3.7s), then
                         [release] include: tests/**/*.release.test.ts
                         No test files found, exiting with code 0
npm run test:report   -> ok H1 .. ok H10 (all ten), then:
  Indicators (_docs/tests.md §2.3):
    test lines / src lines: 25498 / 48974
    unit: 145 file(s), 941 test(s)
    process: 3 file(s), 18 test(s)
    release: 0 file(s), 0 test(s)
    report: 0 file(s), 0 test(s)
    hygiene baseline: 257 total (H1:0, H2:0, H3:0, H4:3, H5:59, H6:193, H7:0, H8:0, H9:2)
    tests/_temp folders: 0; tests/_conditional folders: 0
    manual_smoke.md entries: 0
    unit tier serial time: 60.74s
    slowest unit files:
      51.86s  tests/cell-complex/portalPaths.test.ts
      1.76s   tests/docs/moduleImportRules.test.ts
      1.40s   tests/render-contract/visiblePortalPaths.property.test.ts
      1.03s   tests/docs/documentation.test.ts
      0.77s   tests/cell-complex/segmentWalk.property.test.ts
      0.39s   tests/movement/portalCrossing.property.test.ts
      0.34s   tests/project/testHygiene.test.ts
      0.32s   tests/cell-complex/staticPortalPathCull.test.ts
      0.32s   tests/cell-complex/staticPortalPathCull.property.test.ts
      0.24s   tests/render-contract/portalClipPlanes.test.ts
```

**Step 6 proof** (one broken rule per check, in scratch files tracked with `git add -N` so the `git
ls-files`-based checks could see them, then deleted and unstaged with `git reset`; `tests/_temp/job41/` held the
H1-H4, H7 and H8 proofs — the rules that still apply inside `_temp/` — and a sibling `tests/zz_job41_proof/`
held the H5/H6/H9 proofs, since those three rules are explicitly exempt "outside `_temp/`" and would not fire
inside it):

```
FAIL H1 (1)
     tests/_temp/job41/h1_wrongSuffix.spec.ts: wrong suffix for a tier; use .test.ts, .process.test.ts,
     .release.test.ts or .report.test.ts (tests.md §8.2).
FAIL H2 (1)
     tests/_temp/job41/h2_processBoundary.test.ts: unit tier: imports `node:net`, a process or network
     boundary (tests.md §5).
FAIL H3 (1)
     tests/_temp/job41/h3_badImport.test.ts: imports tests/cell-complex/compileCellComplex.test.ts, which is
     not tests/support/, tests/fixtures/ or tests/world-objects/geodesic/fixtures.ts (tests.md §3).
FAIL H4 (1)
     tests/_temp/job41/h4_mockSrc.test.ts: mocks `src/math/vec2.ts`, a module of the product's own code
     (tests.md §4.5).
FAIL H5 (4)
     tests/zz_job41_proof/h5_history.test.ts ["stops at the wall (issue 999)"]: the name carries history (an
     issue/job/stage/batch reference); name the behaviour instead (tests.md §4.1).
     tests/zz_job41_proof/h5_history.test.ts: a comment carries history (...); move it to the commit message
     (tests.md §4.2).
     tests/zz_job41_proof/h6_noHeader.test.ts ["is deleted at the end of job 41 step 6"]: the name carries
     history (...); name the behaviour instead (tests.md §4.1).
     tests/zz_job41_proof/h9_skip.test.ts: a comment carries history (...); move it to the commit message
     (tests.md §4.2).
FAIL H6 (2)
     tests/zz_job41_proof/h6_noHeader.test.ts: missing a leading module doc comment of at least 30 characters,
     before its imports (tests.md §4.2).
     tests/zz_job41_proof/h6_noHeader.test.ts ["has a name that is deliberately far longer..."]: the name is
     106 characters, over the 90-character limit (tests.md §4.1).
FAIL H7 (1)
     tests/_conditional/job41proof/README.md: missing README.md with until:, expires: and purpose:
     (tests_hygiene.md §2.1).
FAIL H8 (2)
     tests/_temp/job999/README.md: README.md is missing fate: (tests_hygiene.md §3.2).
     tests/_temp/job999/README.md: ref job999 is closed; finish the exit review and delete tests/_temp/job999/
     (tests_hygiene.md §3.3).
FAIL H9 (1)
     tests/zz_job41_proof/h9_skip.test.ts: uses .skip(/.skipIf(/.todo(/.only( outside tests/_temp/
     (tests.md §3, §4.7).
ok   H10
```

Note that the proof files inside `tests/_temp/job41/` had test names containing the literal text "job 41" (for
example "is deleted at the end of job 41 step 6") but **did not** trigger H5, confirming the `_temp/` exemption
works; the structurally identical name in `tests/zz_job41_proof/h6_noHeader.test.ts` (outside `_temp/`) did
trigger it.

**H10, both ratchet directions**, proven by editing `tests/hygiene-baseline.txt` directly (restored to the
clean, generated 257-line file afterwards):

- *Removing* one real, non-duplicated baseline line (`H6	tests/world-objects/worldObjectOwner.test.ts	-`)
  brought that violation back, failing under its own rule, not H10:
  `FAIL H6 ... tests/world-objects/worldObjectOwner.test.ts: missing a leading module doc comment ...`
- *Adding* one bogus line with no matching violation (`H9	tests/does/not/exist.test.ts	-`) failed under H10:
  `FAIL H10 (1)  tests/does/not/exist.test.ts: remove this line from the baseline (H9); no current violation
  matches it.`

After the proof, every scratch path was deleted, unstaged with `git reset`, and the baseline was regenerated
clean via `node scripts/tests/cli.mjs baseline` (257 violations, matching the pre-proof count); `git status
--short` showed no leftover proof files and `node scripts/tests/cli.mjs check` passed with all ten rules `ok`.
