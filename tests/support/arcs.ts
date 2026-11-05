/**
 * Shared test fake: an arc as a fixture builds it by hand, whose test does not care how long it means to be. `createGeodesicArcObject` requires the intended length, so a test that does care says it.
 */
import { createGeodesicArcObject } from "../../src/world-objects/geodesic/objects";

/** The intended length of a fixture arc, in meters. */
export const fixtureIntendedLengthMeters = 2;

/** `createGeodesicArcObject` with the intended length filled in. */
export function createFixtureArc(input: Omit<Parameters<typeof createGeodesicArcObject>[0], "intendedLengthMeters"> & { readonly intendedLengthMeters?: number }): ReturnType<typeof createGeodesicArcObject> {
  return createGeodesicArcObject({ intendedLengthMeters: fixtureIntendedLengthMeters, ...input });
}
