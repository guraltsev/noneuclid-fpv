/**
 * The geodesic measurements' public face (design 013 sections 12.1 and 16): the ids of the two tools, the plain-data shapes of the module's commands and their results, and the stable refusal codes.
 *
 * A length says how long a geodesic is; an angle says what the angle is between two geodesic rays at a vertex. What a person chooses is real: the geodesic of a length, the centre and the two sides of an angle. The values are refreshed from the world by the module's ticks.
 * A command carries what was chosen, never a ray: the client resolves its aim first.
 */
import type { EngineCommandBase } from "../../engine/moduleTypes";
import type { ProtractorDirectedGeodesic } from "../../world-objects/toolObjects";

declare module "../../glue/toolIds" {
  interface ModuleToolIds {
    /** The length tool: measures a geodesic. */
    geodesicMeasurementsLength: "geodesicMeasurements/length";
    /** The protractor: measures the angle between two sides at a vertex. */
    geodesicMeasurementsProtractor: "geodesicMeasurements/protractor";
  }
}

/** The id of the module, which is also the key of its client tool state. */
export const geodesicMeasurementsModuleId = "geodesicMeasurements";

/** The id of the length tool. */
export const geodesicLengthToolId = "geodesicMeasurements/length" as const;

/** The id of the protractor. */
export const geodesicProtractorToolId = "geodesicMeasurements/protractor" as const;

/** Measures the arc, labelling it near the issuing participant; measuring it again moves its label. Refusal: `geodesicMeasurements/notAnArc`. */
export interface GeodesicMeasurementsCreateLengthCommand extends EngineCommandBase {
  readonly kind: "geodesicMeasurements/createLength";
  readonly arcId: string;
}

/** Removes a length. Refusal: `geodesicMeasurements/notALength`. */
export interface GeodesicMeasurementsRemoveLengthCommand extends EngineCommandBase {
  readonly kind: "geodesicMeasurements/removeLength";
  readonly lengthId: string;
}

/**
 * Measures the angle at `center`, an emitter or a crossing named by its id, counterclockwise from `first` to `second`.
 * Refusals: `geodesicMeasurements/notACenter`, `/notASide` (a side that is no ray of the centre), `/sameSide` (one end of one geodesic twice).
 */
export interface GeodesicMeasurementsCreateAngleCommand extends EngineCommandBase {
  readonly kind: "geodesicMeasurements/createAngle";
  readonly center: string;
  readonly first: ProtractorDirectedGeodesic;
  readonly second: ProtractorDirectedGeodesic;
}

/** Removes an angle. Refusal: `geodesicMeasurements/notAnAngle`. */
export interface GeodesicMeasurementsRemoveAngleCommand extends EngineCommandBase {
  readonly kind: "geodesicMeasurements/removeAngle";
  readonly angleId: string;
}

/** Every command of the module. */
export type GeodesicMeasurementsCommand =
  | GeodesicMeasurementsCreateLengthCommand
  | GeodesicMeasurementsRemoveLengthCommand
  | GeodesicMeasurementsCreateAngleCommand
  | GeodesicMeasurementsRemoveAngleCommand;

/** What a command that succeeded answers with: `outcome` names the command, `id` is the record it created or removed. */
export interface GeodesicMeasurementsResult {
  readonly outcome: "lengthCreated" | "lengthRemoved" | "angleCreated" | "angleRemoved";
  readonly id: string;
}

/** The refusal codes of the module's commands. */
export const geodesicMeasurementsRefusals = {
  notAnArc: "geodesicMeasurements/notAnArc",
  notALength: "geodesicMeasurements/notALength",
  notACenter: "geodesicMeasurements/notACenter",
  notASide: "geodesicMeasurements/notASide",
  sameSide: "geodesicMeasurements/sameSide",
  notAnAngle: "geodesicMeasurements/notAnAngle",
} as const;
