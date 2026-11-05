/**
 * Per-step cost of the curve shortening flow and its dependents (measured lengths, protractor angles), driven by the world engine
 * the way the frame loop drives it: one `step` and one `endFrame` per frame. Timed scenes: idle (a bare engine), flow, flow plus dependents, and
 * many arcs (timing printed, no limit). Counted scenes (exact, host independent): flow, flow+dependents, manyArcs. A flow runs until the curve shortening module reports `isAtRest`, or 600 steps.
 * Design 013 section 15, jobs 48 and 53; design 014 section 5, job 56. A benchmark, not a test (_docs/tests.md section 4.7).
 *
 *   npm run bench -- moduleStep                      print the tables
 *   npm run bench -- moduleStep --record             write scripts/bench/baselines/moduleStep.json (this host only; never re-record in a job)
 *   npm run bench -- moduleStep --record-counters    write scripts/bench/baselines/moduleStepCounters.json
 *   npm run bench -- moduleStep --check              exit 1 when a counter rose, 3 when only timing is over its limit, else 0
 *
 * Needs `--expose-gc`, which `scripts/bench/run.mjs` passes through NODE_OPTIONS. Arguments reach this script in the
 * BENCH_ARGS environment variable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalPlayerParticipant, createWorldEngine, type WorldEngine } from "../../src/engine/worldEngine";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { curveDynamicsToken } from "../../src/modules/curveShortening/api";
import { curveShorteningModule } from "../../src/modules/curveShortening";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { defineDerived } from "../../src/world-objects/derived";
import type { RuntimeObjectReader, RuntimeObjectRegistry, RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import { createManyArcsFlowScenario, createTorusLoopBenchmarkScene, createTorusTiedPairScenario } from "../../tests/fixtures/world-objects/geodesic";

const deltaSeconds = 1 / 90;
const maxFlowSteps = 600;
const trials = 7;
const flowRepeats = 10;
const idleTimingSteps = 2_000;
const idleAllocationSteps = 20_000;
/** The design asks for at most 16 bytes per idle step. The idle scene steps an engine with two ticks-free modules list (empty); the check holds it to its recorded baseline plus this slack. */
const allocationSlackBytesPerStep = 16;
const playerPoint = { x: 0, y: 0, z: 0 };
const manyArcsExtraArcs = 32;
/** Reads of a derived cache in the hit scene (design 014 V1), and the most a hit may allocate: a counter failure above it. */
const cacheHitReads = 200_000;
const cacheHitMaxBytesPerRead = 1;

interface Scene {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** The engine the scene steps. The idle scene has an empty module list (the cost of the bare engine, design 013 job 49). */
  readonly engine: WorldEngine;
}

interface Results {
  readonly idleMicroseconds: number;
  readonly flowMicroseconds: number;
  readonly flowDependentsMicroseconds: number;
  readonly manyArcsMicroseconds: number;
  readonly idleBytesPerStep: number;
  readonly bareEngineBytesPerStep: number;
}

const args = (process.env.BENCH_ARGS ?? "").split(/\s+/).filter(Boolean);
const baselineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "baselines");
const baselinePath = path.join(baselineDir, "moduleStep.json");
const countersPath = path.join(baselineDir, "moduleStepCounters.json");

/** What one run of a flow to its end costs in operations: steps taken, registry writes, and kind scans by kind. */
interface SceneCounters {
  readonly steps: number;
  readonly writes: number;
  readonly scans: Readonly<Record<string, number>>;
}
type CounterSet = Record<"flow" | "flow+dependents" | "manyArcs", SceneCounters>;

main();

function main(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) {
    console.error("moduleStep needs --expose-gc; run it with `npm run bench -- moduleStep`.");
    process.exit(2);
  }

  // Counters are exact: measured once, compared first, and they decide the exit code before any clock is read.
  const counters = measureAllCounters();
  printCounters(counters);
  // V1, the idle read hits: allocation is exact enough to gate like a counter.
  const cacheHitBytes = measureCacheHitBytesPerRead(gc);
  console.info(`cache hit         ${cacheHitBytes.toFixed(3)} bytes/read`);
  if (args.includes("--check") && cacheHitBytes > cacheHitMaxBytesPerRead) {
    console.error(`cache hit allocates ${cacheHitBytes.toFixed(3)} bytes/read, over ${cacheHitMaxBytesPerRead}`);
    console.error("check: FAILED (counters)");
    process.exit(1);
  }
  if (args.includes("--record-counters")) {
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(countersPath, `${JSON.stringify(counters, null, 2)}\n`);
    console.info(`recorded ${countersPath}`);
    return;
  }
  if (args.includes("--check")) {
    const counterFailures = counterBaselineFailures(counters);
    if (counterFailures.length > 0) {
      for (const failure of counterFailures) console.error(failure);
      console.error("check: FAILED (counters)");
      process.exit(1);
    }
  }

  // Machine noise is about 10%, so a recorded baseline is the slowest of three rounds and a check passes on the
  // fastest of up to three rounds: only a change that is slower in every round fails.
  const record = args.includes("--record");
  const rounds: Results[] = [];
  for (let round = 0; round < 3; round += 1) {
    rounds.push(measureRound(gc));
    if (!record && args.includes("--check") && baselineFailures(rounds[round]!).length === 0) break;
  }
  const pick = record ? Math.max : Math.min;
  const results: Results = {
    idleMicroseconds: pick(...rounds.map((r) => r.idleMicroseconds)),
    flowMicroseconds: pick(...rounds.map((r) => r.flowMicroseconds)),
    flowDependentsMicroseconds: pick(...rounds.map((r) => r.flowDependentsMicroseconds)),
    manyArcsMicroseconds: pick(...rounds.map((r) => r.manyArcsMicroseconds)),
    idleBytesPerStep: pick(...rounds.map((r) => r.idleBytesPerStep)),
    bareEngineBytesPerStep: pick(...rounds.map((r) => r.bareEngineBytesPerStep)),
  };

  console.info(`\nmodule step (host ${os.hostname()}, ${trials} trials, median)`);
  console.info(`idle              ${results.idleMicroseconds.toFixed(2)} us/step`);
  console.info(`flow              ${results.flowMicroseconds.toFixed(2)} us/step`);
  console.info(`flow+dependents   ${results.flowDependentsMicroseconds.toFixed(2)} us/step`);
  console.info(`many arcs (no limit) ${results.manyArcsMicroseconds.toFixed(2)} us/step`);
  console.info(`idle allocation   ${results.idleBytesPerStep.toFixed(1)} bytes/step`);
  console.info(`bare engine alloc ${results.bareEngineBytesPerStep.toFixed(1)} bytes/step`);

  if (record) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    const record = { host: os.hostname(), recordedOn: new Date().toISOString().slice(0, 10), ...results };
    fs.writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`);
    console.info(`recorded ${baselinePath}`);
  } else if (args.includes("--check")) {
    process.exit(checkBaseline(results));
  }
}

function readBaseline(): (Results & { host: string }) | undefined {
  return fs.existsSync(baselinePath) ? (JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Results & { host: string }) : undefined;
}

/** Names of the limits `results` breaks: idle or flow+dependents above baseline x 1.05 + 2 us, flow above baseline x 1.10, idle allocation above its baseline x 1.05 + 16 bytes. */
function baselineFailures(results: Results): string[] {
  const baseline = readBaseline();
  if (!baseline) return [];
  const failures: string[] = [];
  if (results.idleMicroseconds > baseline.idleMicroseconds * 1.05 + 2) failures.push("idle step time");
  if (results.flowDependentsMicroseconds > baseline.flowDependentsMicroseconds * 1.05 + 2) failures.push("flow+dependents step time");
  if (results.flowMicroseconds > baseline.flowMicroseconds * 1.1) failures.push("flow step time");
  if (results.idleBytesPerStep > baseline.idleBytesPerStep * 1.05 + allocationSlackBytesPerStep) failures.push("idle allocation");
  if (results.bareEngineBytesPerStep > allocationSlackBytesPerStep) failures.push("bare engine allocation");
  return failures;
}

/** Exit code: 1 when no baseline exists, 3 when a timing limit is broken on the recorded host (counters passed already); on another host a broken limit only warns. */
function checkBaseline(results: Results): number {
  const baseline = readBaseline();
  if (!baseline) {
    console.error(`no baseline at ${baselinePath}; run with --record first.`);
    return 1;
  }
  const failures = baselineFailures(results);
  if (failures.length === 0) {
    console.info("check: ok");
    return 0;
  }
  if (baseline.host !== os.hostname()) {
    console.warn(`check: would fail (${failures.join(", ")}), but the baseline is from host ${baseline.host}; not failing.`);
    return 0;
  }
  console.error(`check: FAILED (${failures.join(", ")})`);
  console.error("check: timing over limit; settle it with npm run bench:ab -- <start commit>");
  return 3;
}

/** One line per broken counter: steps must be equal, writes and each scan count at most the baseline (a scan key missing from the baseline counts as 0). */
function counterBaselineFailures(counters: CounterSet): string[] {
  if (!fs.existsSync(countersPath)) return [`no counter baseline at ${countersPath}; run with --record-counters first.`];
  const baseline = JSON.parse(fs.readFileSync(countersPath, "utf8")) as Partial<CounterSet>;
  const failures: string[] = [];
  for (const scene of Object.keys(counters) as (keyof CounterSet)[]) {
    const now = counters[scene];
    const was = baseline[scene];
    if (!was) {
      failures.push(`${scene}: no baseline`);
      continue;
    }
    if (now.steps !== was.steps) failures.push(`${scene}: steps ${now.steps} != ${was.steps}`);
    if (now.writes > was.writes) failures.push(`${scene}: writes ${now.writes} > ${was.writes}`);
    for (const [kind, count] of Object.entries(now.scans)) {
      const limit = was.scans[kind] ?? 0;
      if (count > limit) failures.push(`${scene}: ${kind} scans ${count} > ${limit}`);
    }
  }
  return failures;
}

function printCounters(counters: CounterSet): void {
  console.info("\ncounters (exact; one flow run to its end)");
  for (const [scene, c] of Object.entries(counters)) {
    const scans = Object.entries(c.scans).map(([kind, count]) => `${kind}=${count}`).join(" ");
    console.info(`  [${scene}] steps ${c.steps}, writes ${c.writes}, scans: ${scans || "none"}`);
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// ---- scenes -------------------------------------------------------------------------------------------------

function createIdleScene(): Scene {
  const { world, registry } = createTorusLoopBenchmarkScene();
  for (let j = 0; j < 4; j += 1) {
    addLength(registry, world, `length-${j}`, `loop-${j}`);
  }
  const emitter = registry.get("e") as GeodesicCannonObject;
  addAngle(registry, emitter, "angle-0", { geodesicId: "loop-0", endRole: "start" }, { geodesicId: "loop-1", endRole: "start" });
  addAngle(registry, emitter, "angle-1", { geodesicId: "loop-2", endRole: "start" }, { geodesicId: "loop-3", endRole: "start" });
  const engine = createWorldEngine({
    registry,
    getWorld: () => world,
    participants: [createLocalPlayerParticipant(createDefaultPlayerPose("torus-room"))],
  });
  return { world, registry, engine };
}

function createManyArcsScene(): Scene {
  const { world, registry } = createManyArcsFlowScenario(manyArcsExtraArcs);
  return { world, registry, engine: createFlowEngine(world, registry, [geodesicModelModule(), curveShorteningModule()]) };
}

function createFlowEngine(world: CompiledCellComplex, registry: RuntimeObjectRegistry, modules: NonNullable<Parameters<typeof createWorldEngine>[0]["modules"]>): WorldEngine {
  return createWorldEngine({
    registry,
    getWorld: () => world,
    participants: [createLocalPlayerParticipant(createDefaultPlayerPose("torus-room"))],
    modules,
  });
}

function createFlowScene(withDependents: boolean): Scene {
  const { world, registry } = createTorusTiedPairScenario();
  if (!withDependents) return { world, registry, engine: createFlowEngine(world, registry, [geodesicModelModule(), curveShorteningModule()]) };
  addLength(registry, world, "length-g1", "g1");
  const emitter = registry.get("e1") as GeodesicCannonObject;
  addAngle(registry, emitter, "angle-g", { geodesicId: "g1", endRole: "start" }, { geodesicId: "g2", endRole: "end" });
  // The dependents are derived by the engine's derive pass: crossings, then lengths and angles.
  return { world, registry, engine: createFlowEngine(world, registry, [geodesicModelModule(), geodesicMeasurementsModule(), curveShorteningModule()]) };
}

function addLength(registry: RuntimeObjectRegistry, world: CompiledCellComplex, id: string, geodesicId: string): void {
  const length = createMeasuredGeodesicLengthObject({ id, registry, geodesicId, playerCellId: "torus-room", playerPoint, world });
  if (!length) throw new Error(`bench scene: no length for ${geodesicId}`);
  registry.add(length);
}

type Side = { readonly geodesicId: string; readonly endRole: "start" | "end" };

function addAngle(registry: RuntimeObjectRegistry, emitter: GeodesicCannonObject, id: string, first: Side, second: Side): void {
  const center = {
    ...resolveProtractorCenterSelection(registry, emitter),
    geodesicIds: [first.geodesicId, second.geodesicId],
  };
  const firstSide = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, ...first });
  const secondSide = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, ...second });
  if (!firstSide || !secondSide) throw new Error(`bench scene: no sides for ${id}`);
  registry.add(createProtractorAngleObject({ id, center, first: firstSide, second: secondSide }));
}

// ---- the driver ---------------------------------------------------------------------------------------------

/** One frame's engine calls: a step, then the end-of-frame clearing. */
function frameStep(scene: Scene): void {
  scene.engine.step(deltaSeconds);
  scene.engine.endFrame();
}

// ---- measurements -------------------------------------------------------------------------------------------

function timeIdle(): number {
  const scene = createIdleScene();
  for (let i = 0; i < 200; i += 1) frameStep(scene);
  const start = performance.now();
  for (let i = 0; i < idleTimingSteps; i += 1) frameStep(scene);
  return ((performance.now() - start) * 1000) / idleTimingSteps;
}

/** Steps `scene` until the flow is at rest or `maxFlowSteps` steps; returns the steps taken. The loop condition reads `isAtRest`, which scans no kind, so the driver does not count itself as a scan. */
function runFlow(scene: Scene): number {
  const flow = scene.engine.query(curveDynamicsToken);
  let runSteps = 0;
  while (runSteps < maxFlowSteps && !flow.isAtRest()) {
    frameStep(scene);
    runSteps += 1;
  }
  return runSteps;
}

/** Mean microseconds per step over `flowRepeats` fresh runs of the flow (scene construction is not timed). */
function timeFlow(createScene: () => Scene): number {
  let steps = 0;
  let milliseconds = 0;
  for (let repeat = 0; repeat < flowRepeats; repeat += 1) {
    const scene = createScene();
    const start = performance.now();
    steps += runFlow(scene);
    milliseconds += performance.now() - start;
  }
  return (milliseconds * 1000) / Math.max(steps, 1);
}

/** Steps, registry writes and kind scans of one flow run to its end, each as the difference from before the run (writes are ring sequence numbers, which `endFrame` does not reset). */
function measureCounters(scene: Scene): SceneCounters {
  const writesBefore = scene.registry.changes.ring.headSeq;
  const scansBefore = scene.registry.getKindScanCounts();
  const steps = runFlow(scene);
  const scansAfter = scene.registry.getKindScanCounts();
  const scans: Record<string, number> = {};
  for (const kind of Object.keys(scansAfter).sort()) {
    const difference = scansAfter[kind]! - (scansBefore[kind] ?? 0);
    if (difference > 0) scans[kind] = difference;
  }
  return { steps, writes: scene.registry.changes.ring.headSeq - writesBefore, scans };
}

function measureAllCounters(): CounterSet {
  return {
    flow: measureCounters(createFlowScene(false)),
    "flow+dependents": measureCounters(createFlowScene(true)),
    manyArcs: measureCounters(createManyArcsScene()),
  };
}

function measureIdleBytesPerStep(gc: () => void): number {
  const scene = createIdleScene();
  for (let i = 0; i < 200; i += 1) frameStep(scene);
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < idleAllocationSteps; i += 1) frameStep(scene);
  const after = process.memoryUsage().heapUsed;
  return Math.max(0, after - before) / idleAllocationSteps;
}

/** Bytes allocated per `step` plus `endFrame` of an engine with no modules and no commands (the bare engine on its own). */
function measureBareEngineBytesPerStep(gc: () => void): number {
  const { world, registry } = createIdleScene();
  const engine = createWorldEngine({ registry, getWorld: () => world, participants: [createLocalPlayerParticipant(createDefaultPlayerPose("torus-room"))] });
  for (let i = 0; i < 200; i += 1) {
    engine.step(deltaSeconds);
    engine.endFrame();
  }
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < idleAllocationSteps; i += 1) {
    engine.step(deltaSeconds);
    engine.endFrame();
  }
  const after = process.memoryUsage().heapUsed;
  return Math.max(0, after - before) / idleAllocationSteps;
}

/** V1: bytes allocated per read of a toy derived cache over the idle scene when nothing has changed since the last read (the hit path). */
function measureCacheHitBytesPerRead(gc: () => void): number {
  const { registry } = createIdleScene();
  const cannons = defineDerived<RuntimeObjectReader, RuntimeWorldObject, readonly string[]>({
    id: "bench/cannonIds",
    kinds: ["geodesic-cannon"],
    compute: (source) => Object.freeze(source.getObjectsOfKind("geodesic-cannon").map((object) => object.id)),
  });
  let sink = 0;
  for (let i = 0; i < 1_000; i += 1) sink += cannons.read(registry).length;
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < cacheHitReads; i += 1) sink += cannons.read(registry).length;
  const after = process.memoryUsage().heapUsed;
  if (sink < 0) throw new Error("unreachable");
  return Math.max(0, after - before) / cacheHitReads;
}

function measureRound(gc: () => void): Results {
  return {
    idleMicroseconds: median(Array.from({ length: trials }, () => timeIdle())),
    flowMicroseconds: median(Array.from({ length: trials }, () => timeFlow(() => createFlowScene(false)))),
    flowDependentsMicroseconds: median(Array.from({ length: trials }, () => timeFlow(() => createFlowScene(true)))),
    manyArcsMicroseconds: median(Array.from({ length: trials }, () => timeFlow(createManyArcsScene))),
    idleBytesPerStep: measureIdleBytesPerStep(gc),
    bareEngineBytesPerStep: measureBareEngineBytesPerStep(gc),
  };
}
