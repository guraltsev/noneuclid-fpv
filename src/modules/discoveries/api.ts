/**
 * The discoveries' public face (design 017 section 9.4): the plain-data shapes of a discovery, of what a detector is shown each frame, and of an entry of the Discoveries page.
 * The app does not check goals; it notices. A discovery is a remarkable event the sandbox detects whatever the student was doing, and its detector is a pure function of what it is shown.
 * Everything here is plain data, so the shell, the menu state and the tests can pass it around without the module's code.
 */

import type { AuthoredDiscoveryDetector, DiscoveryMarkerSpec } from "../../cell-complex/specs";

export type { AuthoredDiscoveryDetector, DiscoveryMarkerSpec, WorldDiscoveriesSpec } from "../../cell-complex/specs";

/** The ids of the discoveries the app notices by itself. */
export type BuiltinDiscoveryId =
  | "across-an-edge"
  | "back-where-you-started"
  | "beam-came-home"
  | "beam-hits-corner"
  | "tight-string"
  | "new-shape";

/**
 * What notices a discovery: a built-in detector (named by the discovery's own id), or one a world script may name (`visitFace`, `approach`).
 */
export type DiscoveryDetector = { readonly kind: "builtin" } | AuthoredDiscoveryDetector;

/** One discovery of a world: its words, its detector and, if an author placed one, its curiosity marker. */
export interface DiscoveryDefinition {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly teaser: string;
  readonly detector: DiscoveryDetector;
  readonly marker?: DiscoveryMarkerSpec;
}

/** One portal crossing of the player, as the movement reports it. */
export interface DiscoveryCrossing {
  readonly sourceCellId: string;
  readonly portalId: string;
  readonly targetCellId: string;
  readonly targetPortalId: string;
}

/** How the strings of joined beams stand: none exist, some are still straightening, or all are taut. */
export type StringPhase = "none" | "shortening" | "taut";

/** What the world did this frame that a detector may care about. All of it is plain data. */
export interface DiscoveryFrame {
  /** The player's face and floor position. */
  readonly cellId: string;
  readonly position: { readonly x: number; readonly y: number };
  /** The portals the player crossed this frame, in order; empty after a teleport. */
  readonly crossings: readonly DiscoveryCrossing[];
  /** A beam ended at a corner this frame. */
  readonly beamHitCorner: boolean;
  /** A beam's trace ended at its own laser this frame. */
  readonly beamCameHome: boolean;
  /** The state of the strings of joined beams now, and the number of beams there are. */
  readonly stringPhase: StringPhase;
  readonly beamCount: number;
  /** The shape machine changed the world this frame. */
  readonly shapeChanged: boolean;
}

/** An entry of the Discoveries page. */
export interface DiscoveryPageEntry {
  readonly id: string;
  readonly found: boolean;
  /** The name when found; "??? - <teaser>" when not. */
  readonly title: string;
  /** The question when found; empty when not. */
  readonly text: string;
  /** A button the entry offers: "Show edges" under "Across an edge" once it is found. */
  readonly action?: "show-edges";
}
