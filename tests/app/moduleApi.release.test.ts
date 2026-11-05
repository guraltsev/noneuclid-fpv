/**
 * `tests/app/moduleApi.release.test.ts` — release tier.
 *
 * Emitter scenes in the built app, built through the modules' public functions (`api.geodesicEmitters`, `api.geodesicModel`, `api.curveShortening`, design 013 section 9.1). The flow runs in the app's own frames. What these functions do not offer, the scenario does as a person does: `debug.setPlayerPose` puts the player next to an emitter, the G key picks it up and puts it down, and the W key walks, so the hand that carries is the app's own aim ray and the carry goes through the real tool, slot and tick.
 * Covers: a tie on a torus until the flow is at rest; the world's refusal when the configuration disables the emitters; a carry through a portal; a tied curve around a corner destroyed with its notice; a whole session under the `derived-verify` debug option; and the namespaces' lifetime across a world change.
 * Coordinates: a cube face and the torus are 15 m squares centred on the origin, the `front` face's `x = 7.5` side leads to the `x = -7.5` side of `right`, whose frame is that of `front` moved by 15 m along x. A yaw of `debug.setPlayerPose` is in degrees from +y; a yaw of a command is in radians from +x.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

interface GeodesicDump {
  readonly selectedTool: string;
  readonly intervals: readonly {
    readonly id: string;
    readonly start: { readonly anchorObjectId: string; readonly anchorCellId?: string };
    readonly end: { readonly anchorObjectId: string; readonly anchorCellId?: string };
    readonly connected: boolean;
    readonly portalWordText: string;
    readonly totalSegmentLengthMeters: number;
    readonly segmentCells: readonly string[];
  }[];
  readonly anchors: readonly { readonly id: string; readonly kind: string; readonly cellId: string }[];
}

type Point = { readonly x: number; readonly y: number };

const dumpOf = (api: ScenarioApi) => api.debug.dumpAllGeodesics() as Promise<GeodesicDump>;

/** The value of a command that must succeed. */
async function accepted<T>(call: Promise<unknown>): Promise<T> {
  const result = (await call) as { ok: boolean; value?: T; refusal?: { code: string } };
  if (!result.ok) throw new Error(`the world refused: ${result.refusal?.code}`);
  return result.value as T;
}

async function placeEmitter(api: ScenarioApi, cellId: string, point: Point): Promise<string> {
  const { emitterId } = await accepted<{ emitterId: string }>(api.geodesicEmitters.place(cellId, { ...point, z: 0 }, 0));
  return emitterId;
}

/** Shoots from the emitter along the vector `toward`, a little further than it, and returns the arc, which must have reached an emitter. */
async function shootTo(api: ScenarioApi, emitterId: string, toward: Point): Promise<string> {
  const { arcId } = await accepted<{ arcId: string }>(api.geodesicEmitters.shoot(emitterId, Math.atan2(toward.y, toward.x), Math.hypot(toward.x, toward.y) + 2));
  const arc = (await dumpOf(api)).intervals.find((interval) => interval.id === arcId);
  expect(arc?.connected).toBe(true);
  return arcId;
}

async function tieAt(api: ScenarioApi, emitterId: string, arcEndingThere: string, arcLeavingThere: string): Promise<string> {
  const first = { geodesicId: arcEndingThere, role: "end", anchorObjectId: emitterId };
  const second = { geodesicId: arcLeavingThere, role: "start", anchorObjectId: emitterId };
  const { vertexId } = await accepted<{ vertexId: string }>(api.geodesicModel.tieAndDetach(emitterId, first, second));
  return vertexId;
}

async function untilAtRest(app: ScenarioApp): Promise<void> {
  await app.waitFor(() => app.api.curveShortening.isAtRest() as Promise<boolean>, (atRest) => atRest, { frames: 1500 });
}

/** G on the emitter the player looks at: the tool asks the world twice, and the carry has begun when it is selected. */
async function pickUp(app: ScenarioApp): Promise<void> {
  await app.pressKey("KeyG");
  await app.waitFor(() => dumpOf(app.api), (dump) => dump.selectedTool === "geodesicEmitters/carry");
}

/** G again: the world detaches, and the tool ends on its answer. */
async function putDown(app: ScenarioApp): Promise<void> {
  await app.pressKey("KeyG");
  await app.waitFor(() => dumpOf(app.api), (dump) => dump.selectedTool === "none");
}

/** Holds W until `reached` says so. */
async function walkUntil(app: ScenarioApp, reached: (dump: GeodesicDump) => boolean): Promise<void> {
  await app.keyDown("KeyW");
  try {
    await app.waitFor(() => dumpOf(app.api), reached);
  } finally {
    await app.keyUp("KeyW");
  }
}

describe("emitter scenes through the modules' public functions", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("ties two geodesics on a torus; the flow rests on the closed geodesic of their class", async () => {
    app = await openApp({ world: "torus-moduli" });
    const { api } = app;
    const kept = await placeEmitter(api, "torus-room", { x: 0, y: -5 });
    const tiedAt = await placeEmitter(api, "torus-room", { x: 5, y: -3 });
    const direct = await shootTo(api, kept, { x: 5, y: 2 });
    const aroundTheTorus = await shootTo(api, tiedAt, { x: 10, y: -2 });
    expect(await api.curveShortening.isAtRest()).toBe(true);

    const vertexId = await tieAt(api, tiedAt, direct, aroundTheTorus);

    expect([...((await api.geodesicModel.arcsOfCurve(vertexId)) as string[])].sort()).toEqual([direct, aroundTheTorus].sort());
    expect(await api.curveShortening.isAtRest()).toBe(false);

    await untilAtRest(app);

    expect(await api.geodesicModel.arcsOfCurve(vertexId)).toEqual([]);
    const { intervals, anchors } = await dumpOf(api);
    expect(anchors.map((anchor) => anchor.kind)).toEqual(["geodesicEmitters/emitter", "geodesicEmitters/emitter"]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ start: { anchorObjectId: kept }, end: { anchorObjectId: kept } });
    // Once around a 15 m torus, from where it was two arcs of 5.39 m and 10.2 m.
    expect(intervals[0]!.totalSegmentLengthMeters).toBeCloseTo(15, 2);
  });

  it("refuses the emitter commands with the world's sentence when the emitters are off", async () => {
    app = await openApp({ world: "cube", config: "emitters-off" });
    const { api } = app;
    const refusal = { code: "world/capabilityMissing", message: "This tool is not available in this world." };

    expect(await api.geodesicEmitters.place("front", { x: 1, y: 1, z: 0 }, 0)).toEqual({ ok: false, refusal });
    const end = { geodesicId: "arc", role: "end", anchorObjectId: "emitter" };
    expect(await api.geodesicModel.tieAndDetach("emitter", end, { ...end, role: "start" })).toEqual({ ok: false, refusal });
    expect(await api.world.submit({ kind: "world/requestTool", toolId: "geodesicEmitters/emitter" })).toMatchObject({ ok: false, refusal: { code: "world/toolDisabled", message: refusal.message } });
    expect((await dumpOf(api)).anchors).toEqual([]);
  });

  it("carries an emitter through a portal by walking; its connected geodesic follows", async () => {
    app = await openApp({ world: "cube" });
    const { api } = app;
    const carried = await placeEmitter(api, "front", { x: 4.2, y: 0 });
    const fixed = await placeEmitter(api, "front", { x: 0, y: -3 });
    const arcId = await shootTo(api, fixed, { x: 4.2, y: 3 });
    await api.debug.setPlayerPose("front", 3, 0, -90, -50);

    await pickUp(app);
    await walkUntil(app, (dump) => dump.anchors.find((anchor) => anchor.id === carried)?.cellId === "right");
    await putDown(app);

    const { intervals, anchors } = await dumpOf(api);
    expect(anchors.find((anchor) => anchor.id === carried)?.cellId).toBe("right");
    expect(anchors.find((anchor) => anchor.id === fixed)?.cellId).toBe("front");
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      id: arcId,
      connected: true,
      portalWordText: "front:side-1->right:side-3",
      start: { anchorObjectId: fixed },
      end: { anchorObjectId: carried },
      segmentCells: ["front", "right"],
    });
    const participants = (await api.world.participants()) as { attachments: unknown[] }[];
    expect(participants[0]!.attachments).toEqual([]);
  });

  it("destroys a curve tied around a corner of the cube, with its notice", async () => {
    app = await openApp({ world: "cube" });
    const { api } = app;
    // Around the corner (7.5, 7.5) of `front`, shared with `right` and `top`, 3 m from it. A cube corner has 270 degrees, and the two ends are 210 degrees apart through `right`: the taut curve of this class would run through the corner.
    const onFront = await placeEmitter(api, "front", { x: 4.9, y: 6 });
    const onRight = await placeEmitter(api, "right", { x: -5.38, y: 5.38 });
    const onTop = await placeEmitter(api, "top", { x: 4.9, y: -6 });
    const toRight = await shootTo(api, onFront, { x: 4.72, y: -0.62 });
    const toTop = await shootTo(api, onRight, { x: -0.62, y: 4.72 });

    const vertexId = await tieAt(api, onRight, toRight, toTop);
    expect(await api.curveShortening.isAtRest()).toBe(false);
    await untilAtRest(app);

    expect(await api.geodesicModel.arcsOfCurve(vertexId)).toEqual([]);
    const { intervals, anchors } = await dumpOf(api);
    expect(intervals).toEqual([]);
    expect(anchors.map((anchor) => anchor.id).sort()).toEqual([onFront, onRight, onTop].sort());
    const notices = await app.waitFor(
      async () => app!.consoleLines().filter((line) => line.startsWith("[noneuclid] The tied geodesic could not shorten any further and was removed")),
      (lines) => lines.length > 0,
    );
    expect(notices).toHaveLength(1);
  });

  it("runs carry, shoot, tie and flow with every cache verified: no read differs from compute", async () => {
    app = await openApp({ world: "torus-moduli", debugLevel: "basic", debugOptions: "derived-verify,module-write-guard" });
    const { api } = app;
    const verifications = async (): Promise<number> => ((await api.debug.derivedStats()) as { verifies: number }[]).reduce((sum, stats) => sum + stats.verifies, 0);

    const carried = await placeEmitter(api, "torus-room", { x: 0, y: -5 });
    const tiedAt = await placeEmitter(api, "torus-room", { x: 5, y: -3 });
    const direct = await shootTo(api, carried, { x: 5, y: 2 });
    const aroundTheTorus = await shootTo(api, tiedAt, { x: 10, y: -2 });

    await api.debug.setPlayerPose("torus-room", -1.2, -5, -90, -50);
    await pickUp(app);
    await walkUntil(app, (dump) => dump.intervals.find((interval) => interval.id === direct)!.totalSegmentLengthMeters < 4.5);
    await putDown(app);

    await accepted(api.geodesicEmitters.shoot(tiedAt, Math.PI / 2, 2));
    await tieAt(api, tiedAt, direct, aroundTheTorus);
    await untilAtRest(app);

    const { intervals } = await dumpOf(api);
    expect(intervals.filter((interval) => interval.start.anchorObjectId === carried && interval.end.anchorObjectId === carried)).toHaveLength(1);
    expect(await verifications()).toBeGreaterThan(0);
    expect(app.consoleLines().filter((line) => line.includes("differs from compute"))).toEqual([]);
  });

  it("gives a world change its own namespaces and a fresh world", async () => {
    app = await openApp({ world: "cube" });
    const { api } = app;
    expect(await placeEmitter(api, "front", { x: 1, y: 1 })).toBe("geodesicEmitters/emitter:0");
    expect(await placeEmitter(api, "front", { x: 2, y: 2 })).toBe("geodesicEmitters/emitter:1");

    await api.app.changeWorld("torus-moduli");
    await app.waitFor(
      // `api.world` is gone while the new app loads.
      async () => (await api.world.participants().catch(() => [])) as { body: { cellId: string } }[],
      (participants) => participants[0]?.body.cellId === "torus-room",
    );

    expect(await placeEmitter(api, "torus-room", { x: 1, y: 1 })).toBe("geodesicEmitters/emitter:0");
    expect((await dumpOf(api)).anchors).toHaveLength(1);
  });
});
