# Job 41 - Test tiers, hygiene checks, baseline and indicators

Status: queued.
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
