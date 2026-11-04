/**
 * The editing state of the geodesic emitter (cannon) tools, as plain data: which cannon and geodesic the tool works on and the endpoints picked by tie-and-detach.
 * It is part of the shell session (runtime/clientSession.ts), so it lives below the runtime layer; the tools that change it are in the render layer.
 */
import type { GeodesicEndpointSelection } from "./objects";

/** Editing state of the geodesic emitter (cannon) tools. */
export interface GeodesicCannonToolState {
  /** Cannon currently being edited, carried, or tie-detached. */
  readonly selectedCannonId?: string;
  /** Geodesic of the selected cannon that rotate/aim/carry operate on. */
  readonly activeGeodesicId?: string;
  /** Endpoints picked so far in the tie-and-detach tool (at most two). */
  readonly tieAndDetachEndpointSelections?: readonly GeodesicEndpointSelection[];
}
