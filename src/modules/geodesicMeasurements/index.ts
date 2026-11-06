/**
 * The geodesic measurements module's factories (design 013 section 12.1): `geodesicMeasurementsModule` is the world part, `geodesicMeasurementsClient` the client part (the length tool and the protractor).
 */
export { geodesicMeasurementsClient } from "./client";
export { geodesicMeasurementsModule, type GeodesicMeasurementsModuleDefinition, type GeodesicMeasurementsOptions } from "./module";
