/**
 * Counters of the expensive geodesic operations, read by the performance tests.
 * Internal calls inside an ES module cannot be spied on, so the two operations increment these integers instead.
 */

/** Number of intersection passes (`findGeodesicIntersections`) and chord traces (`traceGeodesicPathForConnectionMode`) since the last reset. */
export const geodesicPerfCounters = { intersectionPasses: 0, chordTraces: 0 };

/** Sets both counters to zero. */
export function resetGeodesicPerfCounters(): void {
  geodesicPerfCounters.intersectionPasses = 0;
  geodesicPerfCounters.chordTraces = 0;
}
