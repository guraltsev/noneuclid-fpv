/**
 * `tests/app/creatures.release.test.ts` — release tier.
 *
 * The `cube` world's `front-runner` geodesic creature (a `geo_mouse`, `src/examples/cube.world.js`, authored via
 * `src/world-objects/simpleGeoCreature.ts`) walks its geodesic every frame. `window.noneuclid.api`'s
 * `debug.dumpGeodesicCreatures()` (`src/render/three/geodesicCreatureDebug.ts`) keeps reporting it by id, with a
 * `localPosition` that moves, for as long as the app runs. Covers the audit's check #16.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GeodesicCreatureDebugDump } from "../../src/render/three/geodesicCreatureDebug";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

const creatureId = "front-runner";
const minimumMovedDistanceMeters = 0.05;
const movementFrameBudget = 300;

async function findCreatureRecord(
  api: ScenarioApi,
  id: string,
): Promise<GeodesicCreatureDebugDump["records"][number] | undefined> {
  const dump = (await api.debug.dumpGeodesicCreatures()) as GeodesicCreatureDebugDump;
  return dump.records.find((record) => record.id === id);
}

/** The creature keeps being reported and its position keeps changing within a bounded number of frames. */
async function keepsExistingAndMoves(api: ScenarioApi): Promise<void> {
  const initial = await findCreatureRecord(api, creatureId);
  expect(initial).toBeDefined();
  const initialPosition = initial?.localPosition;
  expect(initialPosition).toBeDefined();

  const moved = await api.waitFor(
    async () => {
      const record = await findCreatureRecord(api, creatureId);
      if (!record?.localPosition || !initialPosition) {
        return { exists: false, distanceMeters: 0 };
      }
      const dx = record.localPosition.x - initialPosition.x;
      const dy = record.localPosition.y - initialPosition.y;
      return { exists: true, distanceMeters: Math.hypot(dx, dy) };
    },
    (value) => value.exists && value.distanceMeters > minimumMovedDistanceMeters,
    { frames: movementFrameBudget },
  );

  expect(moved.exists).toBe(true);
  expect(moved.distanceMeters).toBeGreaterThan(minimumMovedDistanceMeters);
}

describe("a bundled world's geodesic creature", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("keeps existing and moves along its geodesic", async () => {
    app = await openApp({ world: "cube" });
    await keepsExistingAndMoves(app.api);
  });
});
