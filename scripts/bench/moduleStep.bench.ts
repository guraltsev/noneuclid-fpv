/**
 * Per-step cost of the curve shortening flow and its dependents (measured lengths, protractor angles), driven the way
 * the frame loop drives them today ("the legacy driver"). Three scenes: idle (no flow), flow, flow plus dependents.
 * Design 013 section 15, job 48. A benchmark, not a test (_docs/tests.md section 4.7).
 *
 *   npm run bench -- moduleStep            print the table
 *   npm run bench -- moduleStep --record   write scripts/bench/baselines/moduleStep.json (this host only)
 *   npm run bench -- moduleStep --check    exit 1 when a scene is slower than its baseline (see `checkBaseline`)
 *
 * Needs `--expose-gc`, which `scripts/bench/run.mjs` passes through NODE_OPTIONS. Arguments reach this script in the
 * BENCH_ARGS environment variable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { advanceCurveShorteningPairs } from "../../src/world-objects/geodesic/curveShortening";
import { pruneMissingGeodesicIntersectionObjects } from "../../src/world-objects/geodesic/intersections";
import { createMeasuredGeodesicLengthObject, refreshMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import type { RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createTorusLoopBenchmarkScene, createTorusTiedPairScenario } from "../../tests/fixtures/world-objects/geodesic";

const deltaSeconds = 1 / 90;
const maxFlowSteps = 600;
const trials = 7;
const flowRepeats = 10;
const idleTimingSteps = 2_000;
const idleAllocationSteps = 20_000;
/** The design asks for at most 16 bytes per idle step. The legacy driver itself allocates more (a fresh array per kind query), so the check holds it to its own baseline plus this slack; the absolute 16 is the target for the engine step. */
const allocationSlackBytesPerStep = 16;
const playerPoint = { x: 0, y: 0, z: 0 };

interface Scene {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
}

interface Results {
  readonly idleMicroseconds: number;
  readonly flowMicroseconds: number;
  readonly flowDependentsMicroseconds: number;
  readonly idleBytesPerStep: number;
}

const args = (process.env.BENCH_ARGS ?? "").split(/\s+/).filter(Boolean);
const baselinePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "baselines", "moduleStep.json");

main();

function main(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) {
    console.error("moduleStep needs --expose-gc; run it with `npm run bench -- moduleStep`.");
    process.exit(2);
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
    idleBytesPerStep: pick(...rounds.map((r) => r.idleBytesPerStep)),
  };

  console.info(`\nmodule step (host ${os.hostname()}, ${trials} trials, median)`);
  console.info(`idle              ${results.idleMicroseconds.toFixed(2)} us/step`);
  console.info(`flow              ${results.flowMicroseconds.toFixed(2)} us/step`);
  console.info(`flow+dependents   ${results.flowDependentsMicroseconds.toFixed(2)} us/step`);
  console.info(`idle allocation   ${results.idleBytesPerStep.toFixed(1)} bytes/step`);

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
  return failures;
}

/** Exit code: 1 when a limit is broken on the recorded host or no baseline exists; on another host a broken limit only warns. */
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
  return 1;
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
  return { world, registry };
}

function createFlowScene(withDependents: boolean): Scene {
  const { world, registry } = createTorusTiedPairScenario();
  if (withDependents) {
    addLength(registry, world, "length-g1", "g1");
    const emitter = registry.get("e1") as GeodesicCannonObject;
    addAngle(registry, emitter, "angle-g", { geodesicId: "g1", endRole: "start" }, { geodesicId: "g2", endRole: "end" });
  }
  return { world, registry };
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

// ---- the legacy driver --------------------------------------------------------------------------------------

/** Today's objects-phase sequence: the flow, then the follow-ups for the geodesics it returned, then pruning. */
function legacyStep(scene: Scene): void {
  const { world, registry } = scene;
  const straightened = advanceCurveShorteningPairs({ world, registry, deltaSeconds });
  for (const geodesicId of straightened) {
    for (const angle of registry.getObjectsOfKind("protractor-angle")) {
      if (angle.first.geodesicId !== geodesicId && angle.second.geodesicId !== geodesicId) continue;
      const refreshed = refreshProtractorAngleObject({ registry, angle });
      if (!refreshed) registry.remove(angle.id);
      else registry.update(refreshed);
    }
    for (const length of registry.getObjectsOfKind("measured-geodesic-length")) {
      if (length.geodesicId !== geodesicId) continue;
      const refreshed = refreshMeasuredGeodesicLengthObject({ registry, world, measurement: length, playerCellId: "torus-room", playerPoint });
      if (!refreshed) registry.remove(length.id);
      else registry.update(refreshed);
    }
  }
  if (straightened.length > 0) {
    pruneMissingGeodesicIntersectionObjects(registry);
  }
}

// ---- measurements -------------------------------------------------------------------------------------------

function timeIdle(): number {
  const scene = createIdleScene();
  for (let i = 0; i < 200; i += 1) legacyStep(scene);
  const start = performance.now();
  for (let i = 0; i < idleTimingSteps; i += 1) legacyStep(scene);
  return ((performance.now() - start) * 1000) / idleTimingSteps;
}

/** Mean microseconds per step over `flowRepeats` fresh runs of the flow, each until no pair is left or `maxFlowSteps` steps (scene construction is not timed). */
function timeFlow(withDependents: boolean): number {
  let steps = 0;
  let milliseconds = 0;
  for (let repeat = 0; repeat < flowRepeats; repeat += 1) {
    const scene = createFlowScene(withDependents);
    let runSteps = 0;
    const start = performance.now();
    while (runSteps < maxFlowSteps && scene.registry.getObjectsOfKind("curve-shortening-pair").length > 0) {
      legacyStep(scene);
      runSteps += 1;
    }
    milliseconds += performance.now() - start;
    steps += runSteps;
  }
  return (milliseconds * 1000) / Math.max(steps, 1);
}

function measureIdleBytesPerStep(gc: () => void): number {
  const scene = createIdleScene();
  for (let i = 0; i < 200; i += 1) legacyStep(scene);
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < idleAllocationSteps; i += 1) legacyStep(scene);
  const after = process.memoryUsage().heapUsed;
  return Math.max(0, after - before) / idleAllocationSteps;
}

function measureRound(gc: () => void): Results {
  return {
    idleMicroseconds: median(Array.from({ length: trials }, () => timeIdle())),
    flowMicroseconds: median(Array.from({ length: trials }, () => timeFlow(false))),
    flowDependentsMicroseconds: median(Array.from({ length: trials }, () => timeFlow(true))),
    idleBytesPerStep: measureIdleBytesPerStep(gc),
  };
}
