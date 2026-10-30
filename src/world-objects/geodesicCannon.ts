/**
 * Facade that re-exports the geodesic modules of `src/world-objects/geodesic/` under their old names while they are being split
 * (job 25); it will be deleted.
 */

export {
  canExtendGeodesicSegment,
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  type CreateGeodesicCannonOptions,
  createGeodesicIntervalObject,
  type CurveShorteningPairObject,
  type FreeGeodesicEndObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEmitterConnection,
  type GeodesicEndpointAttachment,
  type GeodesicEndpointSelection,
  type GeodesicEndRole,
  type GeodesicHalfRole,
  type GeodesicIntersectionObject,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
  type GeodesicSegmentObject,
  type GeodesicSegmentTerminal,
  type GeodesicTraceBuildResult,
  getGeodesicSegmentEnd,
  isCurveShorteningPairObject,
  isFreeGeodesicEndObject,
  isGeodesicCannonObject,
  isGeodesicIntersectionObject,
  isGeodesicIntervalObject,
  isGeodesicSegmentObject,
  type LiftedGeodesicEndpoint,
  minGeodesicSegmentLengthMeters,
  type PlaceGeodesicCannonResult,
  resolveGeodesicCannonAimYawRadians,
  type TraceGeodesicSegmentResult,
} from "./geodesic/objects";

export {
  applyAnchorCrossingTraversals,
  getPortalWordBetweenEndpointRoles,
  reverseGeodesicPortalWord,
} from "./geodesic/portalWord";

export {
  findNearestEmitterHitOnTrace,
  geodesicTerminalFromWalkPiece,
  traceGeodesicSegment,
  type TraceGeodesicSegmentInput,
  traceGeodesicSegmentWithEmitters,
  type TraceGeodesicSegmentWithEmittersInput,
} from "./geodesic/trace";

export {
  getRememberedGeodesicIntersectionObject,
  pruneMissingGeodesicIntersectionObjects,
  updateGeodesicIntersectionObjects,
} from "./geodesic/intersections";

export {
  geodesicHasNonzeroLiftedDisplacement,
  getGeodesicEndpointAttachmentsForAnchor,
  getGeodesicEndpoints,
  getGeodesicPortalWord,
  liftGeodesicEndpoint,
  replaceGeodesicEndpointAttachment,
  resolveGeodesicEndpointSelectionFromSegmentHit,
} from "./geodesic/endpoints";

export {
  collectGeodesicMenuRowsForEmitter,
  collectGeodesicPortalWord,
  getGeodesicSegments,
  getGeodesicTail,
  removeGeodesicIntervalAndDerivedObjects,
  resolveEndpointTangentAtAnchor,
  resolveGeodesicNumber,
  splitDerivedSegmentsIntoEndpointHalves,
} from "./geodesic/segments";

export {
  collectLockedIncidentGeodesicIdsForEmitter,
  getGeodesicConnection,
  isGeodesicLocked,
  removeGeodesic,
  removeGeodesicCannonAndSegments,
  removeUnlockedGeodesicsFromCannon,
} from "./geodesic/lifecycle";

export {
  aimFreeGeodesicFromEndpoint,
  previewRebuildGeodesicInterval,
  rebuildDerivedGeodesicSegments,
  rebuildLockedGeodesicFromEndpointsAndPortalWord,
  splitGeodesicIntervalAtSegmentHit,
  traceGeodesicFromLiftedChord,
  updateLockedGeodesicPortalWordForCarriedAnchorTraversal,
  updateLockedGeodesicPortalWordForCarriedAnchorTraversals,
  updatePortalWordForMovedEndpoint,
} from "./geodesic/intervals";

export {
  advanceCurveShorteningPairs,
  type AdvanceCurveShorteningPairsRequest,
  curveShorteningDefaultSpeedMetersPerSecond,
  curveShorteningFuseAngleToleranceRadians,
  curveShorteningFuseStepToleranceMeters,
  curveShorteningLengthIncreaseToleranceMeters,
  curveShorteningMinStepMeters,
  fuseCurveShorteningPair,
  tieAndDetachGeodesicEndpoints,
  type TieAndDetachGeodesicEndpointsRequest,
} from "./geodesic/curveShortening";

export {
  advanceStraighteningGeodesics,
  type AdvanceStraighteningGeodesicsRequest,
  geodesicStraighteningSpeedMetersPerSecond,
  hasStraighteningIncidentGeodesic,
  isGeodesicStraightening,
  tieAndDetachIncidentGeodesics,
  type TieAndDetachIncidentGeodesicsRequest,
} from "./geodesic/legacyConnection";

export {
  connectGeodesicToEmitter,
  type ConnectGeodesicToEmitterRequest,
  extendGeodesic,
  type ExtendGeodesicInput,
  placeGeodesicCannonAtFloorPoint,
  type PlaceGeodesicCannonAtFloorPointRequest,
  placeGeodesicCannonAtGeodesicVertex,
  type PlaceGeodesicCannonAtGeodesicVertexRequest,
  placeGeodesicCannonOnGeodesic,
  type PlaceGeodesicCannonOnGeodesicRequest,
  rebuildConnectedGeodesicBetweenEmitters,
  type RebuildConnectedGeodesicBetweenEmittersRequest,
  rebuildGeodesicToLength,
  type RebuildGeodesicToLengthInput,
  shootGeodesic,
  type ShootGeodesicInput,
} from "./geodesic/cannon";
