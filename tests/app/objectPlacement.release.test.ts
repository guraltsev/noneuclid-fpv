/**
 * `tests/app/objectPlacement.release.test.ts` — release tier.
 *
 * `window.noneuclid.api`'s `debug.placeObjectAt(id, cellId, x, y, yawDegrees)` (`src/world-objects/worldObjectOwner.ts`'s
 * `ObjectHost.placeAt`) relocates any object that has a registered owner (every authored static asset and creature
 * of the active world) and reports whether one exists for `id`; it does nothing (no throw, no collision push-out)
 * for an id no owner is registered under. No query yet reads an object's pose (`_docs/tests.md` §8.5), so this
 * scenario asserts only the reported boolean. Covers the audit's check #43 (partly: the wiring, not the pose).
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

// The cube world's front_mouse creature (src/examples/cube.world.js), authored on the "front" face.
const ownedObjectId = "front-runner";
const ownedObjectCellId = "front";

/** `debug.placeObjectAt` reports true for an id the world owns and false for one it does not. */
async function reportsWhetherTheObjectIsOwned(api: ScenarioApi): Promise<void> {
  const placedOwned = await api.debug.placeObjectAt(ownedObjectId, ownedObjectCellId, 0, 0, 0);
  expect(placedOwned).toBe(true);

  const placedUnknown = await api.debug.placeObjectAt("no-such-object-id", ownedObjectCellId, 0, 0, 0);
  expect(placedUnknown).toBe(false);
}

describe("debug.placeObjectAt reports object ownership", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns true for an owned object and false for an unknown id", async () => {
    app = await openApp({ world: "cube" });
    await reportsWhetherTheObjectIsOwned(app.api);
  });
});
