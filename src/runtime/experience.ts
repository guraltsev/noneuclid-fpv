/**
 * The default experience (design 013 section 12.1): the world modules the app composes into its engine, in list order.
 * Modules are added here as their jobs land; the client parts (the tools) are composed by the shell into its tool lookup.
 */
import type { AnyModuleDefinition, ModuleClient } from "../engine/moduleTypes";
import { carryModule } from "../modules/carry";
import { geodesicMeasurementsModule } from "../modules/geodesicMeasurements";
import { curveShorteningModule } from "../modules/curveShortening";
import { geodesicModelClient, geodesicModelModule } from "../modules/geodesicModel";

/** The world modules of the default experience. */
export function createDefaultWorldModules(): readonly AnyModuleDefinition[] {
  return [geodesicModelModule(), geodesicMeasurementsModule(), carryModule(), curveShorteningModule({ onBlocked: "destroy" })];
}

/** The client parts of the default experience's modules (only the modules with tools have one). */
export function createDefaultClientModules(): readonly ModuleClient[] {
  return [geodesicModelClient()];
}
