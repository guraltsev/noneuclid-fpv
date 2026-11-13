/**
 * The discoveries module's factories (design 017 section 9.4): the catalog of a world's discoveries, the tracker that notices them, the beam events read from the world's writes and the entries of the Discoveries page.
 * It is a client-side module: it owns no world state and registers no engine module. The shell feeds the tracker each frame and keeps the found record for the session.
 */
export type {
  BuiltinDiscoveryId,
  DiscoveryCrossing,
  DiscoveryDefinition,
  DiscoveryDetector,
  DiscoveryFrame,
  DiscoveryMarkerSpec,
  DiscoveryPageEntry,
  StringPhase,
  WorldDiscoveriesSpec,
} from "./api";
export { builtinDiscoveryIds, createDiscoveryCatalog, type DiscoveryCatalog } from "./catalog";
export { beamEventsInChanges, type BeamChangeReader, type BeamDiscoveryEvents } from "./events";
export { discoveryPageEntries } from "./pageEntries";
export { createDiscoveryTracker, type DiscoveryTracker } from "./tracker";
