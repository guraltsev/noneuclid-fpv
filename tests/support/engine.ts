/**
 * Shared test fake: a world engine over a registry, with the local player in "room-a" and the module write guard on (design 013 section 9.6: the guard is on in tests).
 */
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createLocalPlayerParticipant } from "../../src/engine/participants";
import { createWorldEngine, type WorldEngineOptions } from "../../src/engine/worldEngine";
import type { WorldEngine } from "../../src/engine/moduleTypes";
import { createDefaultPlayerPose, type PlayerPose } from "../../src/movement/playerPose";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

/** Options of {@link createTestEngine}: any engine option, plus the local player's pose. */
export type TestEngineOptions = Partial<WorldEngineOptions> & { readonly playerPose?: PlayerPose };

/** An engine over `registry` (a fresh one by default). The world is an empty stand-in unless `getWorld` is given. */
export function createTestEngine(options: TestEngineOptions = {}): WorldEngine & { readonly registry: RuntimeObjectRegistry } {
  const { playerPose, ...engineOptions } = options;
  const registry = engineOptions.registry ?? createRuntimeObjectRegistry();
  const engine = createWorldEngine({
    registry,
    getWorld: () => ({}) as CompiledCellComplex,
    participants: [createLocalPlayerParticipant(playerPose ?? createDefaultPlayerPose("room-a"))],
    writeGuard: true,
    ...engineOptions,
  });
  return Object.assign(engine, { registry });
}
