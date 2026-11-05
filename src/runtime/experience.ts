/**
 * The default experience (design 013 section 12.1): the world modules the app composes into its engine, in list order.
 * Modules are added here as their jobs land; the client part of each is composed by the shell.
 */
import type { AnyModuleDefinition } from "../engine/moduleTypes";
import { carryModule } from "../modules/carry";
import { geodesicMeasurementsModule } from "../modules/geodesicMeasurements";
import { curveShorteningModule } from "../modules/curveShortening";
import { geodesicModelModule } from "../modules/geodesicModel";

/** The world modules of the default experience. */
export function createDefaultWorldModules(): readonly AnyModuleDefinition[] {
  return [geodesicModelModule(), geodesicMeasurementsModule(), carryModule(), curveShorteningModule()];
}
