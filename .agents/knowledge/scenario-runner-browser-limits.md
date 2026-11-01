# The release-tier scenario runner and this machine's headless Edge

- **Running `release` test files in parallel wrecks them.** `fileParallelism` set inside a `vitest.workspace.ts`
  project's `test` block is silently ignored (it is a root-only option in Vitest 1.6, like `passWithNoTests`); the
  real control is the `--no-file-parallelism` CLI flag (`npm run test:release` and the pre-push hook pass it).
  Without it, every scenario file opens pages on the *one* shared, software-rendered (SwiftShader) browser
  `tests/support/scenario/globalSetup.ts` launches, and they starve it of CPU: a page's own `Runtime.evaluate`
  calls stop getting answered at all (not just slowly — genuinely never, confirmed with a 150 s per-test timeout),
  and closing one file's page while another's is still loading can throw "Execution context was destroyed" on a
  page that never touched it.
- **A page's DevTools agent can stop answering `Runtime.evaluate` for a while after restarting the running app
  (`app.changeWorld`/`app.changeConfig`/`app.reload`, each a full dispose of the current Three.js app and
  renderer, then creating a new one), even running one scenario file alone with files fully serialized.**
  Diagnosed at length while writing job 44's scenario runner, in `tests/app/appCommands.release.test.ts`, the one
  scenario file that restarts the app more than once in the same page: a real CDP-level timeout (not a slow
  response — `scripts/lib/cdpClient.mjs`'s own `send()` deadline is what surfaces it as a clean error instead of
  an indefinite hang), on roughly one restart in several, with no fixed test or call it always lands on (seen on
  `changeWorld` three runs running, then on `changeConfig` on a fourth) — a genuine low-frequency flake, not a
  deterministic one. Not fixed by: halving the round trips per poll (folding the animation-frame wait into the
  same `Runtime.evaluate` call as the api call — reverted, since it did not help and the extra round trip is cheap
  next to the flake's rate); reconnecting a fresh WebSocket to the same page target on repeated failures
  (`SessionBox.reconnect`, kept as cheap insurance against a dead *connection*, though it cannot fix a wedged
  renderer process); switching the destination world; or dropping the extra `debug`-namespace check from the
  poll. A plain Node script driving the same calls directly (no Vitest) did not reproduce it in several tries, so
  something about running under Vitest specifically plays a part, not confirmed what. This is the same class of
  flake as the pre-existing, already-documented one in `npm run smoke` over several worlds
  (`test-and-smoke-timing.md`), so it is likely a property of this machine's headless Chromium-based browser under
  SwiftShader (software) rendering under repeated heavy page work, not a bug introduced by the scenario runner.
  Chasing a product-level fix was out of scope for job 44 (test infrastructure); recorded here, and in job 44's
  Report, so the next person does not have to re-run this whole diagnosis.
- **A page that times out on its own `openApp()` (never returns to the test) keeps rendering until something
  closes it**, slowing every scenario that runs afterward. `openApp.ts` tracks every page it opened in a
  module-level map; `tests/support/scenario/releaseSetup.ts`'s `afterEach` closes anything left in it, so one
  abandoned page cannot keep draining the shared browser's CPU for the rest of the run.
- Dynamic `import()` of a plain `.mjs` script works with a relative path inside an ordinary test module (it
  resolves against that module's own file), but **not** inside Vitest's `globalSetup` entry, which needs an
  absolute `file://` URL built with `pathToFileURL` instead (see `globalSetup.ts`).
