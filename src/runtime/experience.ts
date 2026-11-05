/**
 * The default experience (design 013 section 12.1): the world modules the app composes into its engine, in list order.
 * Modules are added here as their jobs land; the client parts (the tools) are composed by the shell into its tool lookup.
 */
import type { AnyModuleDefinition, ModuleClient } from "../engine/moduleTypes";
import type { SimulationClockOptions } from "../engine/worldEngine";
import { carryModule } from "../modules/carry";
import { geodesicMeasurementsModule } from "../modules/geodesicMeasurements";
import { curveShorteningModule } from "../modules/curveShortening";
import { geodesicModelClient, geodesicModelModule } from "../modules/geodesicModel";

/** The time of the default experience (design 012 P8): ticks of \(1/90\) s, up to \(1/30\) s, taking at most a third of the last half second of real time before they grow. The share is a starting value. */
export const defaultSimulationClockOptions: SimulationClockOptions = { tickSeconds: 1 / 90, maxTickSeconds: 1 / 30, tickBudgetShare: 1 / 3 };

/** The world modules of the default experience. */
export function createDefaultWorldModules(): readonly AnyModuleDefinition[] {
  return [geodesicModelModule(), geodesicMeasurementsModule(), carryModule(), curveShorteningModule()];
}

/** The client parts of the default experience's modules (only the modules with tools have one). */
export function createDefaultClientModules(): readonly ModuleClient[] {
  return [geodesicModelClient()];
}
