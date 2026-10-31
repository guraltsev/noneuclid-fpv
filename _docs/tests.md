# Test policy

What a good test is, how test quality is measured, where a test goes, which tier runs it, and how checks done by hand
become tests that drive the program through its public API. How the suite stays healthy over time (temporary tests,
retiring tests, automatic checks) is in [tests_hygiene.md](tests_hygiene.md).

Sections 1–7 are general and meant to work for any project. Section 8 binds them to this project: its areas, tiers,
commands, its API and its manual checks.

## 1. Purpose

A test suite exists to tell you, quickly and truthfully, when a change breaks something a user or caller relies on. Every
test costs something every time it runs, and again every time someone (a person or an agent) has to read it, keep it
consistent or change it. So a test must earn its place, and **fewer, better tests beat many narrow ones**. Coverage, the
test count and how long a test is are not goals.

A check that a person repeats by hand is a test that costs a person every time. It is replaced by an automated test
wherever a machine can observe the behaviour (§6); what remains for a person is only what needs a person.

## 2. Measuring the quality of a test

### 2.1 The test of a test

A test is accepted only if every **must** below holds. Reviewers check each test against this list, and a failed **must**
is a blocking defect.

| #   | Question                                                                                                                                         | Level  |
| --- | :----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q1  | **Behaviour.** Can you say in one sentence, in words a user or caller would understand, what is broken when this test fails?                     | must   |
| Q2  | **Proven.** Did the test fail on code without the behaviour it protects, and pass with it? Both runs were seen (§4.8).                            | must   |
| Q3  | **Owner.** Is this the layer that decides the rule? If not, is it the *one* case that shows the rule is wired in here?                           | must   |
| Q4  | **Unique.** Is it the only test that fails for exactly this reason?                                                                              | must   |
| Q5  | **Robust.** Would it still pass after a refactor that keeps the behaviour? (It uses public entry points and fakes only real boundaries.)         | must   |
| Q6  | **Deterministic.** Does it give the same result on every run, on every machine, in any order? (No real network, no real clock, no timing races, no unseeded randomness.) | must   |
| Q7  | **Cheap.** Does it run in the lowest tier that can prove the behaviour (§5), and do no more work than the behaviour needs (§4.7)?                | should |
| Q8  | **Current.** Does it describe what the product does now, not what an old version did or which issue added it?                                    | should |
| Q9  | **Documented.** Does the name state the behaviour? Does its doc comment explain it in the product's terms, assert everything it claims, and agree with the official documentation (§4.2)? | should |
| Q10 | **Readable.** Is the body short enough to check at a glance, with the action and the assertion visible?                                         | should |

A **should** that fails is debt. It is recorded (see [tests_hygiene.md](tests_hygiene.md) §5) and not added to.

### 2.2 Common failures, and what to do instead

| Smell                                                                                                | Why it is bad                                                      | Instead                                                                      |
| :--------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| The same rule tested at the validator, the compiler, the runtime, the renderer and the UI            | Five tests to update for one change; none of them is "the" test    | Test thoroughly at the owner layer, and once elsewhere to show wiring (Q3)   |
| "X stays removed" tests (old commands, old keys, old file names)                                     | They test history, and they grow with every removal                | One test of the general rule: an unknown command, key or option is refused   |
| One case per instance of the same mistake (30 near-miss inputs, every example world for a rule that does not depend on the world) | The cases add run time and text and protect nothing more | One case per *class* of input (§4.4)                                         |
| Calling private functions, counting calls, spying on the project's own functions, reading the source text | They break on refactors and pass on real bugs                 | Drive the public entry point and observe the outcome                         |
| Asserting internal counters, caches or the identity of objects to prove an optimisation             | That is the implementation, not the behaviour                     | Assert the result; measure cost in a benchmark, not in a test (§4.7)          |
| Asserting the layout of a library's objects (child counts, object names, shader text)               | Breaks on every refactor of the drawing code                       | Assert the contract a consumer relies on (the data handed over, what is released) |
| "Removing any single guard fails a test"                                                             | That is a mutation-testing goal, not a behaviour                   | Test each user-visible limit through the public entry point                  |
| One test file per issue, job, or plan step                                                           | The next agent cannot find the existing test, so it writes another | One home per feature (§3)                                                    |
| Test names or comments with plan ids, issue or job numbers ("A1:", "issue 61", "job 05")            | History, and meaningless once the plan is closed                   | Name the behaviour; history belongs in the commit message                    |
| Doc comments that restate the code, tell history, or claim checks the test does not make             | They explain nothing, and they mislead about what is protected     | A comment that states the behaviour contract, every claim asserted, in agreement with the documentation (§4.2) |
| Tests that pass whatever happens (an assertion that cannot fail, `toBeDefined()` right after building the value) | False confidence                                       | Make the test fail first (Q2)                                                |
| Tests built on a frozen copy of another repository's data                                            | They fail when the copy is refreshed, not when the code breaks     | Small fixtures written for the test; the other repository tests its own data |
| A real `sleep`, a real retry delay, or a wall-clock time limit inside a test                         | Minutes of waiting for nothing, and failures on slow machines       | Inject the clock or the sleep; time limits are not assertions                |
| A benchmark or a report, gated by an environment variable, living among the tests                    | It asserts nothing and is never run                                 | A benchmark is a script, not a test (§4.7)                                   |
| A manual check written in a job report "to be done in a browser" and never repeated                  | The behaviour is protected once, by luck                           | A scenario through the public API (§6); a manual entry only if a person is needed |

### 2.3 Measuring a whole suite

Watch these numbers over time. Every job that changes tests reports them before and after.

| Indicator | Healthy direction |
| --- | --- |
| Size of the test code compared with the source | Flat or falling. The test code rarely needs to be bigger than the code it tests |
| Wall time of the fast tier, run serially | Under 30 s |
| Number of hygiene violations ([tests_hygiene.md](tests_hygiene.md) §5) | Only ever falls |
| Temporary tests: how many, and whether each is linked to an open issue or job | Few, and every one linked |
| Behaviours tested more than once at the same layer (from reviews) | Falls |
| Dangerous workflows with no test (from reviews) | Falls. This matters more than any count |
| Disagreements between test doc comments and the official documentation (from reviews) | Zero. Each one found is resolved (§4.2) |
| Manual checks, and how many of them a machine could do (§6.4) | Falls. Every manual entry needs a person or is a gap |

A falling test count is not a goal either. A suite can lose half its tests and gain protection.

## 3. Where tests live

```text
tests/
  support/               helpers shared by several areas (builders, boundary fakes, the scenario runner); never tests
  fixtures/<area>/       data and builders, small and written for the tests
  <area>/                one folder per real boundary of the code (a package, a layer, or a program)
    <feature>.test.*     one file per feature of that area
  _conditional/<name>/   tests that last while a stated condition holds, each folder with a condition and a date (tests_hygiene.md §2.1)
  _temp/<ref>/           temporary tests, each folder linked to an open issue or job (tests_hygiene.md §3)
  manual_smoke.md        checks that only a person on a real device can do (§6.4)
```

Rules:

- **An area is one real boundary of the code:** a package, a layer, or a program, that has its own responsibility.
  - Areas mirror those boundaries, so the tests of a piece of code are found where the code is, and a change to one
    package touches one test area.
  - **Tests follow the code.** When code moves to another layer, its tests move with it in the same change, not before.
  - A boundary that exists only in the tests (a "kind" of test such as contract, regression, or hardening) is not an
    area. Keep the areas few.
  - If no area fits some code, that says something about the code's structure. Raise it; do not invent an area.
- **A feature file is one behaviour of its area**, usually one module. Name it after what a user or caller sees, or after
  the module it tests.
- **Never name an area or a file after history:** an issue, a task, a review round, or a kind of hardening (`*Cases`,
  `*Security`, `*Hardening`, `*Issue42`).
- **A new test goes into the existing file of its feature.** A new file needs a reason: no existing file fits. A new area
  needs the owner's agreement.
- **Test modules never import from each other.** Shared code goes into `support/` or `fixtures/<area>/`.
- **Support code is not tested for its own sake.** A precondition of a generator or builder is an assertion inside it,
  not a test file beside it.
- **Fixture data belongs to the repository that owns it.** Never copy another repository's real data into this one's
  tests. If the two must agree, that check runs in the other repository, or in the release tier against a real checkout
  of it.
- **Tests that need a person go into `manual_smoke.md`** as numbered entries, not into skipped tests, and not into job
  reports.

## 4. Writing a test

### 4.1 Names

A test name is a statement of behaviour, in the present tense: `keeps the previous version until the new one works`. The
enclosing group names the subject, so the full name reads as a sentence. Aim for under 70 characters, and do not go over
90. It names no issue, task, plan step or version.

### 4.2 Doc comments: the tests document the behaviour

Test doc comments are a specification of the product that a machine checks. Read together, the comments and names of a
feature file should be enough to rebuild the user documentation of that feature: what it does, its rules, its limits,
its edge cases and how it fails.

- **A module doc comment**, at the top of every test file, describes the feature as its user or caller sees it:
  - what the feature is for;
  - the rules it follows and the guarantees it gives;
  - what happens at the edges and on failure;
  - where the official documentation describes it (a link to the section);
  - in a last short paragraph, what the tests replace with fakes, if that is not obvious.
- **A test's name is its one-sentence summary.** A comment above the test follows when the behaviour needs it: the
  situation, what the user sees, and why it matters. It explains the behaviour in the product's terms, not the test's
  steps.
- **Every claim is asserted.**
  - A test's name and comment claim nothing its test does not check.
  - A module comment claims nothing its file's tests do not check.
  - A rule that is documented but not tested is a gap: write the test, or move the sentence to the documentation.
- **A comment agrees with the official documentation.** When they disagree, one of them is outdated. Find out which
  from the product's actual behaviour:
  - the product does what the test says: fix the documentation;
  - the product does what the documentation says: fix the test;
  - the product does neither: it is a bug, so report it.

  Never leave a disagreement in place. Drift between the two is the signal this rule exists for.
- **What a comment never contains:**
  - how the code works internally;
  - a line-by-line restatement of the assertions;
  - history: the issue, decision, task or review that added the test, or what an old version did. Those belong in the
    commit message.

Detail is welcome when it explains behaviour. Length that only restates the code or tells history is the bloat this
policy removes.

### 4.3 Fixtures and helpers

- One fixture for one kind of world, defined once (in `fixtures/<area>/` or `support/`). Do not copy it into each file.
- A helper may hide setup, but never the behaviour under test: the action and the assertion stay visible in the test.
- Setup that every test needs (a seed, a guard of the tier) is installed once, by the runner's setup file. Nothing else
  repeats it.

### 4.4 Parametrisation

- Parametrise over **classes** of input, not over instances of one class. Ten spellings of the same mistake are one
  case. A long list of hostile inputs is allowed only where each entry is a distinct attack, and then each one says
  which.
- Every case has a readable name in its title.
- If a parametrised test needs an `if` on its parameter, it is two tests.
- Running a rule over every bundled example is a test of the examples, not of the rule. Do it once, in the examples'
  own test, and give the rule one small case per class.

### 4.5 Fakes and mocking

- Fake only real boundaries: the network, processes, the clock, the operating system, external services, and devices
  the test machine does not have (a GPU, a headset, a controller).
- Do not mock, patch or spy on the project's own functions. If a test can only observe something through a private
  function, the behaviour is either not observable (then document it, do not test it) or the design needs a seam: an
  injected dependency, or a public query (§6.3).
- An injected callback recorded by the test is not a mock of the project: it is the test standing in for the caller.
- Prefer one fake of a boundary, shared by every test, to a fake per test. Test the fake against the real thing once
  (a contract test), so the two cannot drift.

### 4.6 Assertions

- Assert the outcome that a user or caller sees: the returned value, the state a query reports, the output, the files on
  disk, the exit code, the error message a person reads.
- A user-visible message is asserted by its essential words, not byte for byte, unless the exact text is the contract
  (a machine-readable format, a documented message).
- Numbers are compared with the tolerance the product itself documents, never with one invented for the test.
- Every assertion must be able to fail. Read it again after the test has failed once.

### 4.7 Cost

Cost is designed into a test when it is written and judged in review. It is not checked when the suite runs: a time
limit at run time would make results depend on the machine.

- **Do the least work that proves the behaviour.** Use the smallest fixture that shows the rule: two rooms, not every
  world; depth 3, not depth 10, unless depth is the behaviour. Build only what the test reads.
- **Never wait for real time.** Inject the clock and the sleep. A retry delay or a timeout under test is a parameter set
  to zero.
- **Start a process only where the process is the behaviour.** Many cases that only need the logic go through one
  process, or none.
- **Share expensive setup that is read-only** (a compiled world, a parsed document) at file scope. Share it only when no
  test changes it and no test depends on another's order.
- **Performance is not asserted in a test.** A benchmark that measures time, allocations or work counts is a script
  with its own command, run on purpose and read by a person. A budget that must hold is checked in the release tier or
  by a person on the target device, never by a wall-clock assertion in the fast tier.
- **The reviewer asks for each slow test:** what does it spend its time on, and does the behaviour need that?

### 4.8 Proof, and regression tests

- A new test fails first: write it before the change, or run it against the code with the change reverted.
- A test that is rewritten or promoted (during a clean-up) is proven by breaking the behaviour it protects on purpose
  (a temporary edit of the code under test), seeing it fail with a message that names the behaviour, and restoring the
  code. Record the edit in the work's report.
- A bug fix comes with a test that failed before the fix. But first look for the **existing test of that behaviour**.
  Usually it should gain a case or an assertion, not a sibling. The test describes the behaviour, not the bug: name it
  after what must hold, not after what went wrong or who found it.

### 4.9 Mathematical behaviour and property tests

Where the behaviour is mathematics, the test states it as mathematics.

- **State the property, not an example of it.** "Crossing a portal and crossing back is the identity", "composition of
  rigid transforms is associative", "the cull never removes a path a ray can see". A property checked over generated
  inputs replaces many hand-picked examples; keep an example only when it shows something the property does not (a
  documented edge case, a known hard configuration).
- **The comment names the property** in the product's mathematical terms and links the section of the mathematical
  documentation that states it.
- **Generators state their domain.** A property that fails on a degenerate set (collinear points, a zero vector) excludes
  that set in the generator, and the comment says why it is excluded.
- **Properties are deterministic in the suite** (Q6): they run with a fixed seed. Exploration with random seeds is done
  on purpose, outside the suite; a counterexample it finds becomes an example case or a fixed input of the property.
- **The number of runs is chosen for cost** (§4.7): enough to cover the classes the generator produces, not as many as
  the time allows.

## 5. Tiers

A tier is defined by **what a test touches**, never by how long it happens to take. So a test's tier can be checked by a
machine, and a test cannot drift into the wrong tier unnoticed.

| Tier | What a test in it may touch | Runs |
| --- | --- | --- |
| `unit` | Only the process itself: fakes of every boundary, small temporary files, read-only files of the repository. No child process, real sleep, network, or system-wide state | After every edit |
| `process` | Real child processes, real operating-system objects, loopback servers and sockets, real timers | Before saying a change is done |
| `release` | Builds, serves or runs the shipped product (including in a real browser), or runs another repository's checks against this one | Before a commit to the main branch, a merge, a push or a release; after changing the build |
| manual | A person on a real device | Before a release, as `manual_smoke.md` lists |

Rules:

- **Every test module declares its tier.** A module without a tier is an error.
- **In the `unit` tier, starting a process, sleeping or opening a socket fails the test** with a message naming the tier.
- **Speed is a design concern, not a run-time check** (§4.7).
  - No test fails for being slow.
  - Each tier's serial wall time and its slowest tests are reported (§2.3), so that slow tests are found and redesigned.
- **Report which tiers ran and their counts.** "Tests pass" without the tier names means nothing.
- **Parallel runs are allowed, as a convenience.** They are never the reason a tier is fast: its time is measured
  serially.

## 6. Tests through the public API

A program with a public API (commands that change state, queries that read it) can be tested the way a user uses it,
without its user interface and without a person. This section says how, and how checks done by hand become such tests.

### 6.1 Scenarios

A **scenario** is a test that sets up a state, acts, and asserts, **only through the public API**:

1. *Arrange* with commands: load a world, place objects, put a participant at a pose.
2. *Act* with commands: move, fire, tie, carry, deform, advance time.
3. *Assert* with queries: where the participant is, what an object's state is, what the last action returned.

Rules:

- **Only the public API.** No internal module, no global debug object, no selector in the page, no reading of on-screen
  text. If a scenario needs something the API does not offer, see §6.3.
- **Written against the API, not the transport.** A scenario receives the API as an argument and awaits every call. The
  same scenario then runs wherever the API is reachable: in process, in a browser driven by a test runner, or on a
  remote device. The transport is chosen by the runner, never by the scenario.
- **Time is advanced explicitly.** A scenario advances simulated time with a step command, never by waiting for wall
  time. Where no step command exists yet, it waits for a condition expressed as a query, bounded by a number of frames,
  and its assertions tolerate the step sizes it cannot control. A fixed sleep is never allowed.
- **Assertions are on state, not on pixels**, unless the pixels are the behaviour (§6.2).
- **A scenario is the one wiring case** (Q3). The rule itself is tested thoroughly at its owner layer; the scenario
  shows that the rule is reached through the API, end to end. It does not repeat the owner's cases.
- **Scenarios are held to every rule of this document**: name, module comment, proof, determinism.

### 6.2 Pixels

Some behaviours are visual: a view through a doorway has no gaps, an object does not disappear.

- Assert a **robust measure** of the image (the count of pixels of a sentinel colour in a region, whether a marker is
  visible at all), never a byte comparison with a stored image: rasterisers differ between machines and versions.
- Put the camera at a pose set by a command, so the image does not depend on input timing.
- A comparison with a stored image, or with the image of an older build, is a report (tests_hygiene.md §3.1) read by a
  person, not a test.

### 6.3 When the API lacks a command or a query

The API is the product's, not the tests'. A missing call is a gap in the product's API, so:

- **Add a real public function**, documented like every other, that takes and returns plain data and makes sense to
  every client (a script, an agent, the user interface), not a hook named after a test.
- **Never add a test-only back door** (a flag that skips validation, a function exported "for tests"). Code marked as
  existing for tests is a hygiene violation.
- **A query that only exists behind a debug option is not public enough** for a scenario: either it is part of the API
  in every build, or the behaviour it reads is not part of the API's contract.
- Where the API's design is decided elsewhere (a design document), a new function follows that process; until it is
  agreed, the check stays where it is (manual, or a weaker scenario), recorded as a gap.

### 6.4 Converting a manual check

Every check done by hand is classified, and moved down this ladder as far as it goes:

| Rung | The check becomes | When |
| --- | --- | --- |
| 1 | A test at the owner layer, in the `unit` tier | The behaviour is decided by code that runs without the user interface |
| 2 | A scenario in process, in the `unit` tier | The behaviour needs the whole program, and the program runs without its user interface |
| 3 | A scenario against the shipped product in a real browser, in the `release` tier | The behaviour needs the real user interface or renderer, but no person |
| 4 | A scenario run on the real device, with a person only to start it (for example, to enter a mode that needs a user gesture) | The device is the behaviour, but the outcome is readable through queries |
| 5 | A `manual_smoke.md` entry | Only a person can judge it: perception, comfort, stereo, real input hardware, performance on the target device |

Rules:

- **Convert at the lowest rung that proves the behaviour** (Q7). Usually rung 1 covers the rule and one higher rung
  covers the wiring.
- **A manual entry is as small as possible.** It starts from a state that a script sets up, and says exactly what the
  person judges and what counts as a failure. Everything readable is asserted by the script, not by the person.
- **Converting removes the manual check in the same change**, from every list it appears in (checklists, job reports).
  One behaviour has one home.
- **A check that waits on a missing API function is recorded as a gap** with the function it needs, not dropped.
- **A stale check** (its behaviour no longer exists) is deleted, not converted.

## 7. Testing work done by agents

Agents add tests easily and almost never remove them. They test whatever they just touched, at whatever layer they
touched it. These rules counter that:

- **Search before adding.** Find the existing test of the behaviour (by feature file, then by searching for the user-visible
  words). Extend it, or say why it cannot be extended.
- **Start from the behaviour contract, not the implementation.** Do not invent expected behaviour. Do not write tests to
  raise coverage. Do not preserve accidental behaviour.
- **Do not record manual checks in reports.** A check the work needs is a scenario (§6), or a `manual_smoke.md` entry
  that the work adds.
- **Report what you added and what you removed,** with the tier and the count.
- **A finding from a review round is a case for the owner test,** not a new test named after the round.
- **Removing code removes its tests** (and their fixtures and helpers) in the same change.

## 8. This project (noneuclid-fpv)

TypeScript, Vitest and fast-check. The mathematics is in [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md); the engine and
its API are designed in [design/012-engine-api.md](design/012-engine-api.md).

### 8.1 Areas

One per real boundary. A new area needs the maintainer's agreement. When job 32 moves code into new layers (the planned
interaction and visibility folders under `src/`) or the engine gets its own folder, an area of the same name is created
and the tests move with the code (§3).

| Area | Code it covers |
| --- | --- |
| `math` | `src/math/` |
| `cell-complex` | `src/cell-complex/` (compilation, portal transforms, segment walk, portal paths, static cull) |
| `movement` | `src/movement/` |
| `authoring` | `src/authoring/` and the bundled example worlds |
| `runtime` | `src/runtime/` (geometry session and deformations, commands, menu state, the API dispatch) |
| `glue` | `src/glue/` (launch options, settings, the page side of the server channel) |
| `ui` | `src/ui/` (palette, help and input definitions; no three.js) |
| `world-objects` | `src/world-objects/`, with `geodesic/` mirroring `src/world-objects/geodesic/` |
| `render` | `src/render/` (renderer contracts: clip data, instance buffers, mesh building, disposal) |
| `app` | The whole program through `window.noneuclid.api` and the built site (scenarios, §8.5) |
| `project` | What is not in `src/`: `scripts/` (server, smoke, docs tooling, dist size), the `public/` asset policy, the documentation rules |

Renderer tests (`render`) assert what the consumers of the drawing code rely on: the data handed to the GPU (clip
planes, instance transforms), which objects are released on dispose, what a frame reads from the snapshot. They do not
assert the layout of three.js objects (names, child counts, shader text), the identity of meshes, or pass counts unless
these are a documented debug contract. What a user sees is checked by `app` scenarios.

`tests/typecheck/` holds compile-time-only assertions, checked by `npm run typecheck` (`tsconfig.json` includes
`tests`); it is not an area and holds no runtime tests.

### 8.2 Tiers and commands

A test file's tier is declared by its suffix:

| Suffix | Tier |
| --- | --- |
| `<feature>.test.ts` | `unit` |
| `<feature>.process.test.ts` | `process` |
| `<feature>.release.test.ts` | `release` (needs a built `dist/` and a Chromium-based browser) |

A property-test file keeps the suffix of its tier (`<feature>.property.test.ts` is `unit`); prefer one feature file
holding both its examples and its properties.

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | `unit` |
| `npm test` | `unit` and `process`; what an agent runs before saying a change is done |
| `npm run test:release` | `release`: builds, then the `release` files and the browser smoke |
| `npm run test:report` | the indicators of §2.3 and the hygiene check ([tests_hygiene.md](tests_hygiene.md) §6) |

Status (2026-10-31): job 41 built the suffixes, the `vitest.workspace.ts` projects and the commands above.
`npm run test:release` builds and passes with no tests (no `*.release.test.ts` file exists yet; job 44 adds the first
scenarios). The browser smoke still runs separately as `npm run smoke` (flags in [DEVELOPMENT.md](DEVELOPMENT.md));
job 44 is expected to fold it into the `release` tier.

`git push` runs typecheck, `npm test`, the build, `npx vitest run --project release` and the browser smoke through the
pre-push hook (`.githooks/`). Before
closing a piece of work, run:

```sh
npm run typecheck
npm test
npm run build
```

If a command cannot be run, record that explicitly in the closing note or the job report.

### 8.3 Boundaries and their fakes

The boundaries of this program, each with one shared fake in `tests/support/`:

| Boundary | Fake |
| --- | --- |
| WebGL renderer (`THREE.WebGLRenderer`, GPU state, `renderer.info`) | a renderer fake; contract-checked against the real renderer in the `release` tier |
| WebXR (`navigator.xr`, sessions, input sources, gamepads) | an XR fake |
| Loaded assets (`PreparedWorldAssets`, texture and model loaders) | a prepared-assets builder |
| Canvas 2D | a canvas fake |
| The clock (`Date.now`, `performance.now`, `requestAnimationFrame`) | injected time, or Vitest fake timers |
| WebSocket and the network | an injected socket fake (as in `tests/glue/serverChannel.test.ts`) |
| The geometry worker | an injected build client (as in `tests/runtime/worldGeometrySession.test.ts`) |

Three.js maths and scene objects (`Vector3`, `Object3D`, `Group`) are pure and are used directly, never faked.

Status (2026-10-31): only the socket fake and the build client exist, inside their test files; every other fake is
rebuilt per file. Jobs 42 and 43 extract them.

### 8.4 Mathematics in tests

- Tolerances come from `src/math/tolerances.ts` or from the function's documented contract.
- Gluing maps, portal words and homotopy follow [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md); a property test names
  the statement it checks and links its section.
- fast-check runs with a fixed global seed, set once in the unit setup file. Set `FC_SEED=<n>` to reproduce a run, or
  `FC_SEED=random` to explore; a counterexample found that way becomes an example case or an `examples` input of the
  property.
- Shared generators and the example-world list live in `tests/support/arbitraries.ts`; generators assert their own
  preconditions (counter-clockwise convex polygons, unit vectors, orthonormal rotations).

### 8.5 The API and scenarios

The public API is `window.noneuclid.api` (`src/runtime/publicApi.ts`; dispatch, path rules and plain-data conversion in
`src/runtime/apiCall.ts`). Its namespaces are listed by `npm run cdp -- help`; `_docs/generated/API_REFERENCE.md`
documents the functions. It is the first slice of the engine API of 012 (section 6, S1): its calls are calls on the
app's state, and the network is only one way to reach them.

Transports a scenario can run over (the runner picks one):

| Transport | Reaches | Used by |
| --- | --- | --- |
| In process | the API object of an engine running in Node | `unit` scenarios, once the engine runs without the renderer (012, Phase 0) |
| DevTools Protocol | the built site in headless Edge (the mechanism of `scripts/smoke/browser-smoke.mjs` and `scripts/debug/cdp.mjs`) | `release` scenarios |
| Server channel | any device that opened a page served by `npm run server` | rung 4 runs on a headset ([interactive-browser-debugging.md](interactive-browser-debugging.md) §3a) |

Scenarios live in `tests/app/<feature>.release.test.ts` and are functions of an `api` argument. The runner, the shared
DevTools client and the wait-for-condition helper live in `tests/support/scenario/`.

What the API does not offer yet, and what scenarios therefore cannot do (checked 2026-10-31):

- **No step command.** The frame loop advances with wall-clock `dt` capped at 0.1 s; there is no pause, step or frame
  counter (012 P8 agrees host-chosen steps). Until then, scenarios wait for conditions bounded by frames and assert with
  tolerance.
- **No read of the player's pose in every build.** `portal.dumpCameraPose` exists only with the `portal-path-debug`
  option; the last movement result is not readable at all.
- **No commands to move or place the player, select a tool, fire, tie, carry, pick, create objects, or reset.**
  `debug.placeObjectAt` only moves existing owned objects.
- **`app.changeWorld` does not report when the world has loaded.**
- **Ids come from `Date.now()`**, so they differ between runs; scenarios must not assert ids.

These functions belong to the engine API and are agreed in [012](design/012-engine-api.md) before they are added
(§6.3). Job 45 lists them as a proposal; until each is agreed, the checks that need it stay manual and are counted as
gaps.

Old global objects (`window.noneuclidDebug`, `window.noneuclidPortalDebug`, `window.noneuclidGeometry`), the debug
overlay's text and `window.__noneuclidDiagnostics` are not the API; scenarios never read them. The browser smoke still
pokes the old globals; job 44 moves it onto the API.

### 8.6 Manual checks

- Manual checks live in `tests/manual_smoke.md`, numbered `M<n>`, each with: the setup script or URL, what the person
  does, what they judge, what counts as a failure, and a log of runs (`<date>, <device and browser>, <commit>,
  <result>`).
- What stays manual here: stereo correctness in a headset (both eyes, straddling portals, recursion depth per eye),
  comfort and stutter, real controllers and hand input, the shader driver on the Quest, frame time on the Quest, the
  look of textures and models, and the asset provenance review before publishing.
- Status (2026-10-31): `tests/manual_smoke.md` does not exist. Manual checks are scattered over
  [acceptance-checklists.md](acceptance-checklists.md) (the headset smoke checklist, never run), the job reports in
  `.agents/jobs/_reports/`, and the "Checks" sections of jobs in `.agents/jobs/_done/`; several open issues
  (56, 57, 58, 59, 71, 73, 75) wait only on them. The inventory and classification of these checks is in
  `.agents/jobs/_reports/test_audit_2026_10_31.md`; jobs 44 and 45 convert them.

### 8.7 Known costs

- `tests/cell-complex/portalPaths.test.ts` takes about 60 of the suite's 75 s (measured 2026-10-31), almost all of it in
  one case that builds the cube's path tables to depth 10. Depth-10 cases in `staticPortalPathCull` and
  `torusSkewDeformation` are of the same kind (§4.7).
- Benchmarks are scripts under `scripts/bench/`, run with `npm run bench -- <name>`; they are not tests. Status
  (2026-10-31): the two benchmarks are still env-gated test files (`FUNNEL_CULL_BENCH`, `STATIC_CULL_BENCH`); job 42
  moves them.
