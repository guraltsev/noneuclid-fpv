# Test hygiene

How a test suite stays good over time: the life of a test, temporary tests during long work, retiring tests, paying off
old debt, and the automatic checks that hold the line. What a good test is, and where it goes, is in
[tests.md](tests.md).

Sections 1–7 are general and meant to work for any project. Section 8 binds them to this project.

## 1. Why hygiene

A suite decays one reasonable-looking addition at a time. Each change adds a test and none removes one. A rule is tested
again wherever it was touched, and fixes from review rounds become tests of their own. Removed features leave their tests
behind. Checks done by hand pile up in reports and are never repeated. Nobody is to blame for any single step, so the
decay must be stopped by **rules that a machine checks** and by **an exit step that every piece of work goes through**,
not by good intentions.

## 2. The life of a test

A test is in exactly one of four states:

| State | Lifetime | Where | Held to |
| --- | --- | --- | --- |
| **Permanent** | Until the behaviour it protects is removed | `tests/<area>/<feature>.test.*` | Every rule of [tests.md](tests.md) |
| **Conditional** | Until a stated condition ends (§2.1) | `tests/_conditional/<name>/` | Every rule of [tests.md](tests.md), plus the folder's README |
| **Temporary** | Until the exit review of one open issue or job (§3) | `tests/_temp/<ref>/` | Determinism (Q6 of [tests.md](tests.md) §2.1) and the folder's README; the other quality rules are relaxed |
| **Retired** | — | Deleted. Git history keeps it | — |

A test changes state only through these steps:

- **Writing a permanent test:** it passes the review against [tests.md](tests.md) §2.1, including proof that it failed
  first.
- **Changing behaviour:** update the owner test of that behaviour. Do not add a second test beside it.
- **Removing code:** remove its tests, fixtures and helpers in the same change. A test of code that no longer exists is
  retired, never "kept just in case".
- **Moving code:** move its tests to the area of the code's new home in the same change ([tests.md](tests.md) §3).
- **Closing temporary tests:** the exit review of §3.4.
- **Ending conditional tests:** the check of §2.1 fails the suite after the folder's date; the tests are then retired, or the
  condition is confirmed and the date moved.

A manual check (`manual_smoke.md`) has the same life: it is added when no machine can do it, converted when one can
([tests.md](tests.md) §6.4), and deleted with the behaviour it checks.

### 2.1 Conditional tests

A conditional test protects real behaviour that exists only while a stated condition holds: a compatibility path for an old
layout or format, a workaround for an outside tool, support for a version that is still in use. It is not scaffolding for a
piece of work, so it does not belong in `tests/_temp/`, and it does not last for ever, so it does not belong among the
permanent tests.

- **Held to every rule of [tests.md](tests.md):** behaviour, proof that it failed first, a comment in the product's terms,
  no issue or version number. Only its lifetime differs from a permanent test.
- **One folder per condition,** `tests/_conditional/<name>/`, named after the behaviour (`legacyLaunchUrl`), never after
  an issue.
- **Every folder has a `README.md`** with:
  - `until:` the condition that ends the tests, written so a person can check it (for example, a constant that is removed,
    a version that is no longer supported);
  - `expires:` a date, `YYYY-MM-DD`, by which the condition is checked again;
  - `purpose:` one paragraph: the behaviour the tests protect and why it is conditional.
- **The date makes the condition checked.** After `expires`, the suite fails (rule H7) until someone confirms the condition
  still holds and moves the date, or the condition has ended and the tests are retired together with the code they protect.
  A date is a reminder to decide, not a reason to delete a test that still protects something.
- **Promote when the condition goes away for good:** a conditional test whose condition turns out to be permanent moves to its
  feature file and the folder is removed.

## 3. Temporary tests

### 3.1 When they are allowed

Long work sometimes needs tests that are not yet good permanent tests:

- **Characterisation tests** that pin today's behaviour before a rewrite, so the rewrite can be checked against them;
- **Scaffolding** for a refactor that spans many tasks: tests of an intermediate seam, or of both old and new paths;
- **Reports**: procedural deep-analysis runs that print facts (counts, timings, a comparison of two implementations, a
  comparison of two builds' images). Their assertions are light sanity checks.

They are not allowed as a way around the quality rules for ordinary work. If the work fits in one change, its tests are
permanent from the start. A test that protects a behaviour which lasts beyond the work, but not for ever, is a conditional
test (§2.1), not a temporary one. A measurement that stays useful after the work is a benchmark script, not a test
([tests.md](tests.md) §4.7).

### 3.2 The rules

- **Every temporary test is linked.** Temporary tests live in `tests/_temp/<ref>/`, where `<ref>` names exactly one open
  issue or job. One folder per reference; nothing temporary lives anywhere else.
- **Every folder has a `README.md`** with:
  - `ref:` the issue or job, as a path to its file;
  - `kind:` `guard` (runs with the suite) or `report` (runs only when called explicitly);
  - `purpose:` one paragraph: what the tests protect or measure during the work;
  - `fate:` one line per test module, saying what it becomes at the exit review: `promote to <area>/<file>`, `covered by
    <test>`, or `retire`. The line may say `undecided` while the work runs, but not at the exit review.
- **Guards run in the tier their contents need,** like any other test, so the work is protected while it lasts.
  **Reports** are excluded from normal runs. Run them by their path, with output shown.
- **Temporary tests may break the "should" rules** (Q7–Q10: names and comments may mention the issue, and cases may be
  many). They may not break determinism or machine safety.
- **Nothing outside `_temp/<ref>/` imports from it.** A permanent test never depends on a temporary one.

### 3.3 Age

A temporary folder whose reference is closed is an error: the suite fails until the exit review is done. A folder older
than its work's expected length is a warning to the owner. That expected length is written in the README, or defaults to
30 days.

### 3.4 The exit review: closing the work closes its temporary tests

Closing the issue or job includes these steps, in this order:

1. **List** every test in `_temp/<ref>/` with the behaviour it protects (Q1).
2. **Decide** for each, and record the decision in the work's report:
   - **promote**: the behaviour matters permanently and no permanent test covers it. Rewrite it as a permanent test in its
     feature file, to the full policy, and prove it fails without the code it protects;
   - **covered**: a permanent test already protects it. Name that test;
   - **retire**: it only mattered during the work (a seam that is gone, a comparison with deleted code, a report).
3. **Expect most tests to be retired or covered.** Usually only a small part of a temporary suite should be promoted.
   Promoting a test means rewriting it, not moving the file.
4. **Delete** `tests/_temp/<ref>/` entirely.
5. **Close** the issue or job. The automatic check of §3.3 makes the order hard to skip.

The same exit applies to manual checks a piece of work needed: each one is converted to a test, added to
`manual_smoke.md` with its setup, or declared not needed. None is left only in the work's report.

## 4. Reviews and audits

- **Every change that touches tests** is reviewed against [tests.md](tests.md) §2.1 by someone other than its author. For
  an agent, that means a different agent with a fresh context. The review names, for each removed test, the test that
  now protects its behaviour, or says the behaviour was retired on purpose.
- **Every release, or every few closed issues,** someone audits the suite:
  - measure the indicators of [tests.md](tests.md) §2.3 and compare them with the last audit;
  - read a sample of recently added tests against §2.1;
  - list the behaviours tested more than once and the dangerous workflows with no test;
  - list the manual checks a machine could now do, because the API has gained what they needed;
  - compare the comments of a few feature files with the official documentation of those features, and resolve every
    disagreement ([tests.md](tests.md) §4.2);
  - record the result in the issue tracker. Open an issue when an indicator moved the wrong way.
- **A reviewer's finding becomes a case or an assertion in the owner test,** not a new test named after the review.

## 5. Debt from before the policy, and the ratchet

A suite that existed before this policy will break many rules at once. It cannot be fixed in one change, and new work
should not wait for it. So:

- **A baseline file lists the known violations**, one line each: rule, file, test. The automatic checks (§6) fail on
  any violation that is *not* in the baseline, so new code meets the policy from the first day.
- **The baseline only shrinks.** A change may remove lines from it, never add them. If a change cannot avoid a new
  violation, that is a question for the owner, not an edit to the baseline.
- **Clean up area by area.** Each area is cleaned in one piece of work:
  - map every behaviour its tests protected before to the test that protects it after;
  - remove duplicates, history tests and tests of internals;
  - move the files into the area folder;
  - delete the area's baseline lines.

  The map of behaviours before and after is what makes deleting safe. Without it, do not delete.

## 6. Automatic checks

These run with the suite itself, so they cannot be skipped. Each failure names the rule and the fix.

| # | Check | Rule |
| --- | --- | --- |
| H1 | Every test module declares a tier | [tests.md](tests.md) §5 |
| H2 | A `unit` test does not start a process, sleep or open a socket | [tests.md](tests.md) §5 |
| H3 | No test module imports from another test module or from `_temp/` | [tests.md](tests.md) §3; §3.2 here |
| H4 | No import of a private or test-only name from the product's own code, and no mock or spy of the product's own modules | [tests.md](tests.md) §4.5, §6.3 |
| H5 | No issue, job, plan-step or old-version reference in a permanent test's name or comment | [tests.md](tests.md) §4.1, §4.2 |
| H6 | Every permanent test module has a module comment of at least one sentence; every test name is at most 90 characters | [tests.md](tests.md) §4.1, §4.2 |
| H7 | Every `_conditional/<name>/` has a README with `until`, `expires` (a valid date) and `purpose`, and its `expires` has not passed | §2.1 here |
| H8 | Every `_temp/<ref>/` has a README with `ref`, `kind`, `purpose` and `fate`, and its `ref` is open | §3.2, §3.3 here |
| H9 | No skipped test, and no test gated by an environment variable, outside `_temp/` | [tests.md](tests.md) §3, §4.7 |
| H10 | A violation that is in the baseline passes; a new one fails | §5 here |

A tool also prints the indicators of [tests.md](tests.md) §2.3, so every job can paste a before-and-after.

## 7. Rules for agents running long work

- At the start, record the indicators (§6). At the end, report them again, with the tests added, promoted, covered and
  retired, and the manual checks added or converted.
- Put scaffolding in `tests/_temp/<ref>/` from the start, never among the permanent tests "for now".
- Fill in each temporary module's `fate:` line as soon as you know it. Do not leave all of them for the end.
- The exit review (§3.4) is a task of the job, with its own review, not a footnote.

## 8. This project (noneuclid-fpv)

- **References:** `<ref>` is `issueNN` (file `_issues/NN_*.md`; closed when it moves to `_issues/_closed/`) or `jobNN`
  (file `.agents/jobs/NN_*.md`; closed when it moves to `.agents/jobs/_done/`). Example: `tests/_temp/job24/`.
- **Report runs:** report modules are named `<name>.report.test.ts` and run only by path:
  `npx vitest run --project report tests/_temp/<ref>/<file>` (excluded from every other command).
- **Where the checks run:** the hygiene checks are a script under `scripts/tests/`, run by a `unit` test in
  `tests/project/` (the way `tests/docs/documentation.test.ts` runs `scripts/docs/checks.mjs`) and by
  `npm run test:report`, which also prints the indicators.
- **H2 here:** the unit tier's setup file makes `node:child_process`, `node:net`, `node:http(s)`, `fetch`, `WebSocket`
  and any `setTimeout` or `setInterval` with a delay above zero throw a message naming the tier; Vitest fake timers
  replace the timers and so pass.
- **H4 here:** `vi.mock`, `vi.spyOn` and `vi.doMock` of a module under `src/` are violations; mocking `three`'s loaders,
  the DOM, the XR objects or the network is allowed. So is importing a name whose JSDoc says it exists for tests or
  debugging (for example `leaderForDebug`); the fix is a public query or no test ([tests.md](tests.md) §6.3).
- **Baseline:** `tests/hygiene-baseline.txt`, written once by job 41 and then only shortened (the same ratchet as
  `scripts/docs/layering-baseline.json`).
- **Indicators** (measured 2026-10-31, before the rehaul): 25.5k lines of tests and test support for 46.7k lines of
  `src/`; 160 test files, 1,071 tests; about 75 s summed over files, of which 62 s in one file; 2 env-gated benchmark
  files; 0 temporary and 0 conditional folders; about 71 manual checks found, of which about 25 could be done now through
  the API in a browser, about 20 need a small API function, about 7 need the engine split, about 15 need a person, and 4
  are stale (`.agents/jobs/_reports/test_audit_2026_10_31.md`).
- **Status (2026-10-31):**
  - The tiers, checks, baseline and indicator tool do not exist yet; job 41 builds them.
  - `tests/scratch/` (empty) is replaced by `tests/_temp/<ref>/`.
  - The area clean-up is jobs 42 (every area except `render`) and 43 (`render`); the conversion of manual checks is
    jobs 44 (through today's API) and 45 (needs API functions agreed in
    [012](design/012-engine-api.md)).
