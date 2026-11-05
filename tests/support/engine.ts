/**
 * Shared test fake: a world engine over a registry, with the local player in "room-a" and the module write guard on (design 013 section 9.6: the guard is on in tests).
 */
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { createLocalPlayerParticipant } from "../../src/engine/participants";
import { createWorldEngine, type WorldEngineOptions } from "../../src/engine/worldEngine";
import type { WorldEngine } from "../../src/engine/moduleTypes";
import { createDefaultPlayerPose, type PlayerPose } from "../../src/movement/playerPose";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

/** Options of {@link createTestEngine}: any engine option, plus the local player's pose and the id of an object the local player already carries (an arrived carry attachment, without the carry module). */
export type TestEngineOptions = Partial<WorldEngineOptions> & { readonly playerPose?: PlayerPose; readonly carrying?: string };

/** An engine over `registry` (a fresh one by default). The world is an empty stand-in unless `getWorld` is given. */
export function createTestEngine(options: TestEngineOptions = {}): WorldEngine & { readonly registry: RuntimeObjectRegistry } {
  const { playerPose, carrying, ...engineOptions } = options;
  const registry = engineOptions.registry ?? createRuntimeObjectRegistry();
  const engine = createWorldEngine({
    registry,
    getWorld: () => ({}) as CompiledCellComplex,
    participants: [
      createLocalPlayerParticipant(playerPose ?? createDefaultPlayerPose("room-a"), carrying === undefined ? [] : [{ kind: "carry", objectId: carrying, arrived: true }]),
    ],
    writeGuard: true,
    ...engineOptions,
  });
  return Object.assign(engine, { registry });
}

/** An engine over `registry` with the modules that derive state from the journal: the geodesic model (crossings) and the geodesic measurements (lengths, angles). */
export function createDerivingTestEngine(registry: RuntimeObjectRegistry, options: TestEngineOptions = {}): WorldEngine & { readonly registry: RuntimeObjectRegistry } {
  return createTestEngine({ registry, modules: [geodesicModelModule(), geodesicMeasurementsModule()], ...options });
}

/** One frame as the app runs it: the fast channel, then a step of the same length. Tests of what follows a participant use this; `step` alone moves no attachment. */
export function runFrame(engine: Pick<WorldEngine, "applyControls" | "step">, seconds: number): void {
  engine.applyControls(seconds);
  engine.step(seconds);
}

/** Runs one derive pass: a zero-length step, which applies no command here and wakes every derive tick whose subscribed kinds were written since its last run. Tests that read crossings, lengths or angles right after a mutation call it first. */
export function runDerivePass(engine: Pick<WorldEngine, "step">): void {
  engine.step(0);
}
