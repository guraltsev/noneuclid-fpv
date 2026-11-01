/**
 * `tests/app/torusDeformation.release.test.ts` — release tier.
 *
 * In the `torus-moduli` world, `window.noneuclid.api`'s `geometry` namespace (installed whenever the active world's
 * deformation is `torus-skew`; `src/render/three/createThreeApp.ts`) steps the live torus parameters toward a
 * requested target in small background-built increments (at most 0.08 m per rebuild;
 * `src/runtime/deformations/torusSkewDeformation.ts`). `geometry.setTorusSkew` commits the requested value as the
 * session's target, reported by `geometry.state()`; `geometry.cancel()`, called right after, stops the stepping
 * and resets the target back to whatever is still current, short of a large target reached in a single step.
 * These scenarios assert only the fields `geometry.state()` documents (`src/runtime/worldGeometrySession.ts`'s
 * `LiveGeometryDebugState`). Covers the audit's checks #11 (partly) and #45 (desktop part).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { LiveGeometryDebugState } from "../../src/runtime/worldGeometrySession";
import type { WorldDeformationState } from "../../src/runtime/worldGeometryDeformations";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

function skewXMetersOf(state: WorldDeformationState): number {
  if (state.kind !== "torus-skew") {
    throw new Error(`expected a torus-skew deformation, got "${state.kind}"`);
  }
  return state.skewXMeters;
}

/** `geometry.setTorusSkew` commits the requested value as `geometry.state().target`. */
async function setsTheRequestedTarget(api: ScenarioApi, targetSkewXMeters: number): Promise<void> {
  await api.geometry.setTorusSkew(targetSkewXMeters);
  const state = (await api.geometry.state()) as LiveGeometryDebugState;
  expect(skewXMetersOf(state.target)).toBeCloseTo(targetSkewXMeters, 6);
}

/** `geometry.cancel()`, called right after requesting a large skew, leaves the previous geometry far short of it. */
async function cancellingLeavesThePreviousGeometry(api: ScenarioApi): Promise<void> {
  const before = (await api.geometry.state()) as LiveGeometryDebugState;
  const beforeSkewXMeters = skewXMetersOf(before.current);
  const farTargetSkewXMeters = beforeSkewXMeters + 10;

  await api.geometry.setTorusSkew(farTargetSkewXMeters);
  await api.geometry.cancel();

  const after = (await api.geometry.state()) as LiveGeometryDebugState;
  // A single background rebuild step moves the skew by at most 0.08 m (torusSkewDeformation.ts), so two
  // back-to-back API calls cannot have walked the full 10 m to the target before cancel() took effect.
  expect(Math.abs(skewXMetersOf(after.current) - farTargetSkewXMeters)).toBeGreaterThan(1);
  expect(skewXMetersOf(after.target)).toBe(skewXMetersOf(after.current));
}

describe("the torus-moduli world's live skew deformation", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("commits a requested skew as geometry.state().target", async () => {
    app = await openApp({ world: "torus-moduli" });
    const before = (await app.api.geometry.state()) as LiveGeometryDebugState;
    await setsTheRequestedTarget(app.api, skewXMetersOf(before.current) + 0.5);
  });

  it("cancelling during a build leaves the previous geometry", async () => {
    app = await openApp({ world: "torus-moduli" });
    await cancellingLeavesThePreviousGeometry(app.api);
  });
});
