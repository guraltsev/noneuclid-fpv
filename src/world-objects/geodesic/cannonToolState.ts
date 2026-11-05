/**
 * The editing state of the geodesic emitter (cannon) tools, as plain data: which cannon and geodesic the tool works on.
 * It is part of the shell session (runtime/clientSession.ts), so it lives below the runtime layer; the tools that change it are in the render layer.
 */

/** Editing state of the geodesic emitter (cannon) tools. */
export interface GeodesicCannonToolState {
  /** Cannon currently being edited or carried. */
  readonly selectedCannonId?: string;
  /** Geodesic of the selected cannon that rotate/aim/carry operate on. */
  readonly activeGeodesicId?: string;
}
