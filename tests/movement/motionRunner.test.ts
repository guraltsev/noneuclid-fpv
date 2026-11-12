/**
 * `tests/movement/motionRunner.test.ts` — unit tier.
 *
 * Motion scripts (`src/movement/motionScript.ts`) and their runner (`src/movement/motionRunner.ts`) drive a walker
 * through the same trial move the game uses (`movePlayer`), in fixed ticks. These tests check the normalized format
 * (shorthands, defaults, errors that name the field), and the runner's behaviour: walking and turning at the same
 * time, walking to a point in another cell through a portal, looking at an object, walking round an obstacle, the
 * stuck / unreachable / lost / timeout policies, and that the end pose does not depend on the frame rate.
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { identityMat3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { createDynamicObjectMotionMove, dynamicObjectFromMotionPose } from "../../src/movement/dynamicObjectMotion";
import { playerPoseFromDynamicObject } from "../../src/movement/playerPose";
import { createMotionRunner, locateMotionTarget, type MotionEnvironment, type MotionObjectLocation } from "../../src/movement/motionRunner";
import { MOTION_DEFAULTS, normalizeMotionScript } from "../../src/movement/motionScript";
import { movePlayer, type MoveResult } from "../../src/movement/movePlayer";
import type { PlayerPose } from "../../src/movement/playerPose";

const square = (half: number) => [
  { x: -half, y: -half },
  { x: half, y: -half },
  { x: half, y: half },
  { x: -half, y: half },
];

/** Two 8 m rooms, room-a's east side glued to room-b's west side. */
function twoRooms(): CompiledCellComplex {
  return compileCellComplex({
    cells: [
      { id: "room-a", heightMeters: 3, baseVertices: square(4), portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }] },
      { id: "room-b", heightMeters: 3, baseVertices: square(4), portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }] },
    ],
  });
}

interface TestObject extends MotionObjectLocation {
  readonly id: string;
  readonly blocks: boolean;
}

function environment(world: CompiledCellComplex, objects: TestObject[] = []): MotionEnvironment<MoveResult> {
  return {
    world: () => world,
    move: (pose, request) =>
      movePlayer({
        world,
        pose,
        ...request,
        coordinateFrame: "global",
        bodiesInCell: (cellId) =>
          objects
            .filter((object) => object.blocks && object.cellId === cellId)
            .map((object) => ({
              id: object.id,
              cellId,
              localPose: { rotation: identityMat3, translation: object.position },
              collision: simpleCollisionCylinder(object.radiusMeters ?? 0.5, object.heightMeters ?? 2, { x: 0, y: 0, z: (object.heightMeters ?? 2) / 2 }),
            })),
      }),
    locateObject: (id) => objects.find((object) => object.id === id),
    walkerRadiusMeters: 0.25,
    eyeHeightMeters: 1.45,
  };
}

const start = (x = 0, y = 0, yawDegrees = 0, cellId = "room-a"): PlayerPose => ({
  cellId,
  position: { x, y, z: 0 },
  yawRadians: (yawDegrees * Math.PI) / 180,
  pitchRadians: 0,
});

/** Runs the script to the end at `fps` frames per second; returns the final pose and the report. */
function run(input: unknown, env: MotionEnvironment<MoveResult>, pose: PlayerPose, fps = 60, maxSeconds = 120) {
  const runner = createMotionRunner(normalizeMotionScript(input), env);
  let current = pose;
  for (let t = 0; t < maxSeconds && !runner.finished; t += 1 / fps) {
    current = runner.advance(current, 1 / fps).pose;
  }
  return { pose: current, report: runner.report() };
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

describe("normalizeMotionScript", () => {
  it("accepts a bare step, a list and a full script, filling defaults", () => {
    const bare = normalizeMotionScript({ walk: 2 });
    expect(bare.repeat).toBe(1);
    expect(bare.steps[0]).toMatchObject({ move: { kind: "walk", forward: 2, right: 0, frame: "body" }, speedMetersPerSecond: MOTION_DEFAULTS.speedMetersPerSecond });

    const list = normalizeMotionScript([{ turn: { right: 90 } }, { lookAt: "tree" }]);
    expect(list.steps[0].heading).toEqual({ kind: "turn", degrees: -90 });
    expect(list.steps[1].heading).toEqual({ kind: "lookAt", target: { kind: "object", objectId: "tree" } });

    const full = normalizeMotionScript({ steps: [{ to: { forward: 3 } }], defaults: { speed: 1, onStuck: "skip" }, repeat: "forever" });
    expect(full.repeat).toBe(Infinity);
    expect(full.steps[0]).toMatchObject({ speedMetersPerSecond: 1, heading: { kind: "faceMotion" } });
    expect(full.steps[0].onStuck).toMatchObject({ strategy: "none", then: "skip" });
  });

  it("names the offending field", () => {
    expect(() => normalizeMotionScript([{ walk: 1 }, { wlak: 2 }])).toThrow(/^steps\[1\]\.wlak: unknown key/);
    expect(() => normalizeMotionScript({ walk: 1, to: "x" })).toThrow(/one translation/);
    expect(() => normalizeMotionScript({ turn: 90, lookAt: "x" })).toThrow(/one heading channel/);
    expect(() => normalizeMotionScript({ wait: 1, walk: 1 })).toThrow(/steps\[0\]\.wait/);
    expect(() => normalizeMotionScript({ steps: [{ walk: 1 }], defaults: { speed: -1 } })).toThrow(/^defaults\.speed/);
    expect(() => normalizeMotionScript({ walk: 1, onStuck: { strategy: "fly" } })).toThrow(/onStuck\.strategy/);
    expect(() => normalizeMotionScript({ pitch: 95 })).toThrow(/pitch/);
    expect(() => normalizeMotionScript({})).toThrow(/does nothing/);
  });
});

describe("motion runner", () => {
  it("walks a distance and turns, each to the exact amount", () => {
    const env = environment(twoRooms());
    const { pose, report } = run([{ walk: 2 }, { turn: 90 }, { walk: 1 }], env, start(-1, -3));
    expect(report.status).toBe("done");
    // Turned left (counterclockwise), so forward is -x for the last metre.
    expect(pose.position.x).toBeCloseTo(-2, 6);
    expect(pose.position.y).toBeCloseTo(-1, 6);
    expect(degrees(pose.yawRadians)).toBeCloseTo(90, 6);
  });

  it("walks and turns at the same time: an arc that ends where a quarter circle does", () => {
    const env = environment(twoRooms());
    // A quarter circle of radius r has length pi r / 2; walking that while turning 90 degrees left ends at (-r, r).
    const r = 2;
    const { pose, report } = run({ walk: (Math.PI * r) / 2, turn: 90, duration: 3 }, env, start(1, -2));
    expect(report.status).toBe("done");
    expect(report.steps[0].seconds).toBeCloseTo(3, 1);
    expect(pose.position.x).toBeCloseTo(1 - r, 1);
    expect(pose.position.y).toBeCloseTo(-2 + r, 1);
    expect(degrees(pose.yawRadians)).toBeCloseTo(90, 4);
  });

  it("walks to a point in another cell through the portal and faces the way it walked", () => {
    const env = environment(twoRooms());
    const { pose, report } = run({ to: { cell: "room-b", x: 1, y: 0 } }, env, start(-2, 0, 180));
    expect(report.status).toBe("done");
    expect(pose.cellId).toBe("room-b");
    expect(pose.position.x).toBeCloseTo(1, 1);
    expect(pose.position.y).toBeCloseTo(0, 1);
    expect(report.steps[0].portals).toEqual(["east"]);
    // Facing +x (east) is yaw -90 degrees.
    expect(degrees(pose.yawRadians)).toBeCloseTo(-90, 0);
  });

  it("looks at an object in another cell, pitching up to its middle", () => {
    const tower = { id: "tower", cellId: "room-b", position: { x: 0, y: 0, z: 0 }, radiusMeters: 0.5, heightMeters: 8, blocks: true };
    const env = environment(twoRooms(), [tower]);
    const { pose, report } = run({ lookAt: "tower" }, env, start(0, 0, 0));
    expect(report.status).toBe("done");
    const seen = locateMotionTarget(env, pose, { kind: "object", objectId: "tower" }, 4);
    if (typeof seen === "string") throw new Error(seen);
    expect(seen.portalIds).toEqual(["east"]);
    expect(Math.abs(degrees(seen.bearingRadians))).toBeLessThan(1);
    expect(degrees(pose.pitchRadians)).toBeCloseTo(degrees(Math.atan2(4 - 1.45, 8)), 0);
  });

  it("walks round a pillar in the way (detour) and still arrives", () => {
    const pillar = { id: "pillar", cellId: "room-a", position: { x: 0, y: 0, z: 0 }, radiusMeters: 0.8, blocks: true };
    const env = environment(twoRooms(), [pillar]);
    const { pose, report } = run({ to: { cell: "room-a", x: 0, y: 3 } }, env, start(0, -3));
    expect(report.status).toBe("done");
    expect(report.steps[0].detours).toBeGreaterThan(0);
    expect(report.steps[0].blockedBy).toBe("object pillar");
    expect(Math.hypot(pose.position.x, pose.position.y - 3)).toBeLessThan(0.1);
  });

  it("applies the stuck policy: retries, then skips or fails with the reason", () => {
    const env = environment(twoRooms());
    // Walking 10 m north from the middle of a closed side: the wall at y = 4 stops it.
    const skipped = run([{ walk: 10, onStuck: { strategy: "retry", attempts: 2, then: "skip" } }, { turn: 180 }], env, start(0, 0));
    expect(skipped.report.status).toBe("done");
    expect(skipped.report.steps[0]).toMatchObject({ status: "skipped", retries: 2, blockedBy: "wall" });
    expect(Math.cos(skipped.pose.yawRadians)).toBeCloseTo(-1, 9); // facing back: 180 or -180 degrees

    const failed = run([{ walk: 10, onStuck: "fail" }, { turn: 180 }], env, start(0, 0));
    expect(failed.report.status).toBe("failed");
    expect(failed.report.reason).toMatch(/^step 0: stuck \(blocked by wall\)/);
    expect(failed.report.steps).toHaveLength(1);
  });

  it("slides along a wall at a shallow angle without calling it stuck", () => {
    const env = environment(twoRooms());
    // Into the north wall (y = 4) at 80 degrees from it: blocked every tick near the wall, but sliding west makes progress.
    const { report } = run({ walk: { forward: 0.4, left: 3 } }, env, start(0, 3.6));
    expect(report.status).toBe("done");
    expect(report.steps[0].stuckEvents).toBe(0);
  });

  it("reports an unreachable target, a lost object and a timeout by their policies", () => {
    const env = environment(twoRooms());
    const far = run({ to: { cell: "room-b", x: 0, y: 0 }, maxHops: 0 }, env, start());
    expect(far.report).toMatchObject({ status: "failed" });
    expect(far.report.reason).toMatch(/unreachable/);

    const lost = run([{ lookAt: "nobody", onTargetLost: "skip" }, { walk: 1 }], env, start());
    expect(lost.report.status).toBe("done");
    expect(lost.report.steps[0]).toMatchObject({ status: "skipped" });
    expect(lost.report.steps[0].reason).toMatch(/nobody/);

    const slow = run({ walk: 3, speed: 0.5, timeout: 1, onTimeout: "stop" }, env, start());
    expect(slow.report.status).toBe("stopped");
    expect(slow.report.reason).toMatch(/timeout/);
  });

  it("follows the last known place of an object that disappears, with onTargetLost lastKnown", () => {
    const objects: TestObject[] = [{ id: "ball", cellId: "room-a", position: { x: 0, y: 3, z: 0 }, blocks: false }];
    const env = environment(twoRooms(), objects);
    const runner = createMotionRunner(normalizeMotionScript({ to: "ball", stopAt: 0.1, onTargetLost: "lastKnown" }), env);
    let pose = start(0, -3);
    pose = runner.advance(pose, 0.5).pose;
    objects.length = 0;
    for (let i = 0; i < 600 && !runner.finished; i += 1) pose = runner.advance(pose, 1 / 60).pose;
    expect(runner.report().status).toBe("done");
    expect(pose.position.y).toBeCloseTo(2.9, 1);
  });

  it("ends in the same pose at 30, 60 and 144 frames per second", () => {
    const env = environment(twoRooms());
    const script = [{ walk: 1.5, turn: 45 }, { to: { cell: "room-b", x: -2, y: 1 } }, { yaw: 0 }];
    const poses = [30, 60, 144].map((fps) => run(script, env, start(-1, -1), fps).pose);
    for (const pose of poses.slice(1)) {
      expect(pose.cellId).toBe(poses[0].cellId);
      expect(pose.position.x).toBeCloseTo(poses[0].position.x, 9);
      expect(pose.position.y).toBeCloseTo(poses[0].position.y, 9);
      expect(pose.yawRadians).toBeCloseTo(poses[0].yawRadians, 9);
    }
  });

  it("repeats a patrol and can be cancelled", () => {
    const env = environment(twoRooms());
    const runner = createMotionRunner(normalizeMotionScript({ steps: [{ walk: 1 }, { turn: 180 }], repeat: "forever" }), env);
    let pose = start();
    for (let i = 0; i < 60 * 10; i += 1) pose = runner.advance(pose, 1 / 60).pose;
    expect(runner.finished).toBe(false);
    expect(runner.report().repetition).toBeGreaterThan(2);
    runner.cancel("test over", pose);
    expect(runner.report()).toMatchObject({ status: "cancelled", reason: "test over" });
  });

  it("drives an NPC (moveDynamicObject) with the same script, through the portal and back", () => {
    const world = twoRooms();
    const collision = simpleCollisionCylinder(0.3, 0.5, { x: 0, y: 0, z: 0.25 });
    const env: MotionEnvironment = {
      world: () => world,
      move: createDynamicObjectMotionMove({ world: () => world, collision }),
      locateObject: () => undefined,
      selfObjectId: "marmot",
      walkerRadiusMeters: 0.3,
      eyeHeightMeters: 0.3,
    };
    const runner = createMotionRunner(normalizeMotionScript({ steps: [{ to: { cell: "room-b", x: 0, y: 0 } }, { to: { cell: "room-a", x: 0, y: 0 } }], repeat: 2 }), env);
    let state = dynamicObjectFromMotionPose(start(0, 0), collision);
    for (let i = 0; i < 60 * 60 && !runner.finished; i += 1) {
      state = dynamicObjectFromMotionPose(runner.advance(playerPoseFromDynamicObject(state, 0), 1 / 60).pose, collision);
    }
    const report = runner.report();
    expect(report.status).toBe("done");
    expect(report.steps.filter((step) => step.portals.length === 1)).toHaveLength(4);
    expect(state.cellId).toBe("room-a");
    expect(Math.hypot(state.localPose.translation.x, state.localPose.translation.y)).toBeLessThan(0.02);
  });
});
