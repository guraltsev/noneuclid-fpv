/**
 * `tests/modules/geodesicMeasurementsOracle.test.ts` — unit tier.
 *
 * The oracle fuzz of the measurement ticks (design 014 D8 for the materialized records): a world with several cannons, locked geodesics and a tied vertex, protractor angles and measured lengths on it, and a seeded random sequence of writes
 * (carry any cannon, also toward and across a portal, detach, flow steps of the curve shortening module, removing a geodesic). After EVERY step each stored angle and length must equal a fresh `refresh...Object`, and a record that was removed must not be resolvable any more.
 * The read tracker decides when a record is refreshed, so a read it fails to record shows up here as a stale record. The test also checks that every kind a refresh reads is among the kinds the tick subscribes to.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { WorldEngine } from "../../src/engine/moduleTypes";
import { carryModule } from "../../src/modules/carry";
import { carryOffsetSlot } from "../../src/modules/carry/api";
import { curveShorteningModule } from "../../src/modules/curveShortening";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { angleReadKinds, lengthReadKinds } from "../../src/modules/geodesicMeasurements/module";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { removeGeodesic } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createMeasuredGeodesicLengthObject, refreshMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createReadRecorder } from "../../src/world-objects/trackedReads";
import { compileLargePortalWorld, createTorusTiedPairScenario } from "../fixtures/world-objects/geodesic";
import { createTestEngine, runFrame } from "../support/engine";

interface Scene {
  readonly registry: RuntimeObjectRegistry;
  readonly world: CompiledCellComplex;
  readonly engine: WorldEngine;
  readonly cellId: string;
  readonly playerPoint: { x: number; y: number; z: number };
  readonly cannons: readonly string[];
  /** The geodesics a step may remove. */
  readonly removable: readonly string[];
  /** Where the hand may go: [min, max] in both axes. */
  readonly reach: readonly [number, number];
  readonly flows: boolean;
  /** Whether a plain write of a cannon (moved or turned with no rebuild of its geodesics) is among the actions. */
  readonly nudges: boolean;
}

function cannonOf(registry: RuntimeObjectRegistry, id: string) {
  const cannon = registry.get(id);
  if (cannon?.kind !== "geodesic-cannon") throw new Error(`cannon ${id} missing`);
  return cannon;
}

function addAngle(registry: RuntimeObjectRegistry, id: string, cannonId: string, geodesicIds: readonly [string, string]): void {
  const cannon = cannonOf(registry, cannonId);
  const center = resolveProtractorCenterSelection(registry, cannon);
  const first = resolveProtractorEmitterGeodesicSelection({ center, emitter: cannon, registry, geodesicId: geodesicIds[0] });
  const second = resolveProtractorEmitterGeodesicSelection({ center, emitter: cannon, registry, geodesicId: geodesicIds[1] });
  if (!first || !second) throw new Error("angle selections missing");
  registry.add(createProtractorAngleObject({ id, center, first, second }));
}

function addLength(scene: Pick<Scene, "registry" | "world" | "cellId" | "playerPoint">, id: string, geodesicId: string): void {
  const length = createMeasuredGeodesicLengthObject({ id, registry: scene.registry, world: scene.world, geodesicId, playerCellId: scene.cellId, playerPoint: scene.playerPoint });
  if (!length) throw new Error("no length");
  scene.registry.add(length);
}

/** Three cannons in one cell, P with locked geodesics to Q and to R, Q with one to R, a portal on the east side. */
function lockedScene(): Scene {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  for (const [id, x, y] of [["P", 3, 2.5], ["Q", 4.2, 2.5], ["R", 3, 4]] as const) {
    registry.add(createGeodesicCannonObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
  }
  const aim = (id: string, yaw: number, geodesicId: string, length: number) => {
    const cannon = cannonOf(registry, id);
    const turned = { ...cannon, aimYawRadians: yaw, localPose: yawRigidTransform3(yaw, cannon.localPose.translation) };
    registry.update(turned);
    shootGeodesic({ world, registry, cannon: turned, geodesicId, maxLengthMeters: length });
  };
  aim("P", 0, "g-pq", 1.2);
  aim("P", Math.PI / 2, "g-pr", 1.5);
  const playerPoint = { x: 2.5, y: 1.5, z: 0 };
  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [geodesicModelModule(), geodesicMeasurementsModule(), carryModule()],
    playerPose: { ...createDefaultPlayerPose("a"), position: playerPoint },
  });
  engine.step(0);
  const scene = { registry, world, engine, cellId: "a", playerPoint, cannons: ["P", "Q", "R"], removable: ["g-pr"], reach: [0.5, 6.5] as const, flows: false, nudges: true };
  addAngle(registry, "angle-p", "P", ["g-pq", "g-pr"]);
  addLength(scene, "length-pq", "g-pq");
  addLength(scene, "length-pr", "g-pr");
  engine.step(0);
  return scene;
}

/** The torus pair of two locked arcs tied at a vertex, flowing under the curve shortening module; an angle at the cannon e1 and a length per arc. */
function flowScene(): Scene {
  const { world, registry } = createTorusTiedPairScenario();
  const playerPoint = { x: -2, y: 0, z: 0 };
  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [geodesicModelModule(), geodesicMeasurementsModule(), carryModule(), curveShorteningModule({})],
    playerPose: { ...createDefaultPlayerPose("torus-room"), position: playerPoint },
  });
  engine.step(0);
  const scene = { registry, world, engine, cellId: "torus-room", playerPoint, cannons: ["e1"], removable: ["g2"], reach: [-5, 5] as const, flows: true, nudges: false };
  addAngle(registry, "angle-e1", "e1", ["g1", "g2"]);
  addLength(scene, "length-g1", "g1");
  addLength(scene, "length-g2", "g2");
  engine.step(0);
  return scene;
}

/** Remembers every record as it last stood, so that a record that vanished can be checked against a fresh refresh of its last state. */
function expectRecordsMatchFresh(scene: Scene, lastSeen: Map<string, unknown>, label: string): void {
  const { registry, world, cellId, playerPoint } = scene;
  for (const id of [...lastSeen.keys()]) {
    const stored = registry.get(id);
    if (stored === undefined) {
      const previous = lastSeen.get(id);
      const fresh = (previous as { kind: string }).kind === "geodesicMeasurements/angle"
        ? refreshProtractorAngleObject({ registry, angle: previous as never })
        : refreshMeasuredGeodesicLengthObject({ registry, world, measurement: previous as never, playerCellId: cellId, playerPoint });
      expect(fresh, `${label}: ${id} was removed but still resolves`).toBeUndefined();
      lastSeen.delete(id);
      continue;
    }
    if (stored.kind === "geodesicMeasurements/angle") {
      expect(stored, `${label}: angle ${id}`).toEqual(refreshProtractorAngleObject({ registry, angle: stored }));
      expectReadsWithin(registry, (reader) => refreshProtractorAngleObject({ registry: reader, angle: stored }), angleReadKinds, label);
    } else if (stored.kind === "geodesicMeasurements/length") {
      expect(stored, `${label}: length ${id}`).toEqual(refreshMeasuredGeodesicLengthObject({ registry, world, measurement: stored, playerCellId: cellId, playerPoint }));
      expectReadsWithin(
        registry,
        (reader) => refreshMeasuredGeodesicLengthObject({ registry: reader, world, measurement: stored, playerCellId: cellId, playerPoint }),
        lengthReadKinds,
        label,
      );
    }
    lastSeen.set(id, stored);
  }
}

/** Every kind a refresh scans or fetches is a kind the tick subscribes to: otherwise a write of it would never wake the tick. */
function expectReadsWithin(registry: RuntimeObjectRegistry, fn: (reader: RuntimeObjectRegistry) => unknown, subscribed: readonly string[], label: string): void {
  const recorder = createReadRecorder(registry);
  recorder.run(fn);
  const reads = recorder.lastReads();
  expect(reads.all, `${label}: a whole-registry query cannot be subscribed`).toBe(false);
  for (const kind of [...reads.kinds, ...reads.fetchedKinds]) expect(subscribed, `${label}: read kind ${kind}`).toContain(kind);
  if (reads.segmentGeodesics.size > 0) expect(subscribed).toContain("geodesicModel/segment");
}

interface Action {
  readonly kind: string;
  readonly cannon: number;
  readonly x: number;
  readonly y: number;
}

const action: fc.Arbitrary<Action> = fc.record({
  kind: fc.constantFrom("attach", "detach", "hand", "hand", "hand", "step", "step", "remove", "nudge", "turn"),
  cannon: fc.nat(8),
  x: fc.double({ min: 0, max: 1, noNaN: true }),
  y: fc.double({ min: 0, max: 1, noNaN: true }),
});

function runSequence(scene: Scene, actions: readonly Action[]): void {
  const { engine, registry } = scene;
  const lastSeen = new Map<string, unknown>();
  for (const record of [...registry.getObjectsOfKind("geodesicMeasurements/angle"), ...registry.getObjectsOfKind("geodesicMeasurements/length")]) lastSeen.set(record.id, record);
  let hand = { x: scene.playerPoint.x, y: scene.playerPoint.y };
  const dt = scene.flows ? 0.05 : 1 / 60;
  actions.forEach((step, index) => {
    if (step.kind === "attach") {
      engine.submit("local", { kind: "carry/attach", objectId: scene.cannons[step.cannon % scene.cannons.length]! } as never);
    } else if (step.kind === "detach") {
      engine.submit("local", { kind: "carry/detach" } as never);
    } else if (step.kind === "hand") {
      const [low, high] = scene.reach;
      hand = { x: low + step.x * (high - low), y: low + step.y * (high - low) };
    } else if ((step.kind === "nudge" || step.kind === "turn") && scene.nudges) {
      // A plain write of the cannon: its geodesics, arcs and segments are not rewritten.
      const cannon = cannonOf(registry, scene.cannons[step.cannon % scene.cannons.length]!);
      const yaw = cannon.aimYawRadians + (step.kind === "turn" ? 0.3 + step.x : 0);
      const at = cannon.localPose.translation;
      const shift = step.kind === "nudge" ? { x: (step.x - 0.5) * 0.4, y: (step.y - 0.5) * 0.4 } : { x: 0, y: 0 };
      registry.update({ ...cannon, aimYawRadians: yaw, localPose: yawRigidTransform3(yaw, { x: at.x + shift.x, y: at.y + shift.y, z: at.z }) });
    } else if (step.kind === "remove") {
      const geodesicId = scene.removable[step.cannon % scene.removable.length]!;
      if (registry.get(geodesicId) !== undefined) removeGeodesic(registry, geodesicId);
    }
    engine.setControl("local", carryOffsetSlot, { x: hand.x, y: hand.y, leashMeters: 8 });
    runFrame(engine, dt);
    engine.endFrame();
    expectRecordsMatchFresh(scene, lastSeen, `step ${index} (${step.kind})`);
  });
}

describe("the measurement ticks against fresh refreshes", () => {
  it("match fresh refreshes for locked geodesics through carries of any cannon", () => {
    fc.assert(fc.property(fc.array(action, { minLength: 4, maxLength: 24 }), (actions) => runSequence(lockedScene(), actions)), { seed: 20261104, numRuns: 40 });
  });

  it("match fresh refreshes when a carry collapses a measured locked geodesic", () => {
    const action = (kind: Action["kind"], cannon: number): Action => ({ kind, cannon, x: 0, y: 0 });
    runSequence(lockedScene(), [action("attach", 2), action("nudge", 0), action("attach", 0), action("attach", 0), action("attach", 0), action("attach", 0)]);
  });

  it("match fresh refreshes for a tied, flowing pair through carries and flow steps", () => {
    fc.assert(fc.property(fc.array(action, { minLength: 4, maxLength: 20 }), (actions) => runSequence(flowScene(), actions)), { seed: 20261105, numRuns: 25 });
  });
});
