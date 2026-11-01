/**
 * Setup for the `release` project (`_docs/tests.md` §5, §8.2): runs after every test.
 *
 * Closes any page `openApp()` opened that the test itself never got to close (its own `afterEach` never ran, or
 * it never finished `openApp()` before Vitest timed it out and abandoned it) — see
 * `tests/support/scenario/openApp.ts`'s `closeAbandonedPages`. Without this, an abandoned page goes on rendering
 * for the rest of the run, competing for the one shared, software-rendered browser's CPU with every scenario that
 * runs afterwards.
 */
import { afterEach } from "vitest";
import { closeAbandonedPages } from "./openApp";

afterEach(async () => {
  await closeAbandonedPages();
});
