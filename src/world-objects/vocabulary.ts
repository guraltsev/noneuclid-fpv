/**
 * The student vocabulary (design 017 section 6): every student-visible noun, verb and subtitle of the app, in one place.
 * Tool descriptors, tooltips, the help lens, the focus messages, the menus, the tutorial and the world scripts take their words from here, so that one concept has one name everywhere. Code ids (`geodesicEmitters/emitter`, ...) never change; this module maps them to words.
 * It lives in `world-objects` because the authoring layer (tutorial text) and the module descriptors both have to import it and neither may import the other's layer; `src/ui/vocabulary.ts` re-exports it under the name the design uses.
 * Everything is plain constants and string templates. `retiredTerms` lists the words that no student-visible string may use any more; `tests/ui/vocabulary.test.ts` scans the sources for them.
 */

/** A tool's name on the belt and its one-line subtitle, which gives the mathematical word once. */
export interface ToolName {
  readonly name: string;
  readonly subtitle: string;
}

/** The names of the tools, by tool id (design 017 section 6.2). "none" is the empty hand. */
export const toolNames = {
  none: { name: "Hand", subtitle: "Use things you aim at" },
  "geodesicEmitters/emitter": { name: "Laser", subtitle: "Places a laser that fires straight beams" },
  "geodesicMeasurements/length": { name: "Ruler", subtitle: "Measures a beam end to end" },
  "geodesicMeasurements/protractor": { name: "Protractor", subtitle: "Measures the angle between two beams" },
  "placedFlags/flag": { name: "Sign", subtitle: "Marks a place with a name" },
  "worldMap/map": { name: "Map", subtitle: "The whole world, small enough to hold" },
  "geodesicModel/tie": { name: "Join", subtitle: "Turns two linked beams at a laser into one string" },
} as const satisfies Readonly<Record<string, ToolName>>;

/** A noun in the singular and the plural. */
export interface ObjectNoun {
  readonly singular: string;
  readonly plural: string;
}

/** The things in the world, as the student names them (design 017 section 6.2), each with a short first-mention sentence where the design gives one. */
export const objectNouns = {
  laser: { singular: "laser", plural: "lasers" },
  beam: { singular: "beam", plural: "beams" },
  linkedBeam: { singular: "linked beam", plural: "linked beams" },
  string: { singular: "string", plural: "strings" },
  measurement: { singular: "measurement", plural: "measurements" },
  sign: { singular: "sign", plural: "signs" },
  helpCube: { singular: "help cube", plural: "help cubes" },
  shapeMachine: { singular: "shape machine", plural: "shape machines" },
  face: { singular: "face", plural: "faces" },
  edge: { singular: "edge", plural: "edges" },
  corner: { singular: "corner", plural: "corners" },
} as const satisfies Readonly<Record<string, ObjectNoun>>;

/** The sentences that explain a noun when it first appears. The mathematical word is given here, once. */
export const objectSubtitles = {
  beam: "A beam is a geodesic: the straightest possible path",
  linkedBeam: "A beam from one laser to another",
  string: "A string pulls itself tight until it is a beam again",
  edge: "Walk across an edge and you arrive at the face glued to it",
  shapeMachine: "Changes the shape of this world",
} as const;

/** The object actions (design 017 section 6.3). The closed list: no other verb names an action. */
export const objectActions = {
  place: "Place",
  extend: "Extend",
  aim: "Aim",
  addBeam: "Add beam",
  join: "Join",
  pickUp: "Pick up",
  putDown: "Put down",
  rename: "Rename",
  delete: "Delete",
  goHome: "Go home",
  startOver: "Start over",
} as const;

/** The input verbs (design 017 section 7): one meaning each, bound on desktop and in VR. */
export const verbNames = {
  use: "Use",
  menu: "Menu",
  pickUp: "Pick up",
  whatsThis: "What's this?",
  switchTool: "Switch tool",
  mainMenu: "Main menu",
} as const;

/** The parts of the interface (design 017 section 6.4). */
export const surfaceNames = {
  toolBelt: "tool belt",
  mainMenu: "main menu",
  help: "Help",
  howTo: "How to",
  thingsToTry: "Things to try",
  discoveries: "Discoveries",
} as const;

/** The first letter of a short id: the first letter of the noun (design 017 section 6.1 rule 6). */
export const shortIdLetters = { laser: "L", sign: "S" } as const;

/** The name of laser number `number`: "L1". */
export function laserShortId(number: number): string {
  return `${shortIdLetters.laser}${number}`;
}

/** The name of sign number `number`: "S1". */
export function signShortId(number: number): string {
  return `${shortIdLetters.sign}${number}`;
}

/** What a beam is called in a menu and on a label: "Beam 1". */
export function beamName(number: number): string {
  return `Beam ${number}`;
}

/** The tooltip of a laser: "Laser" with its short id when it has one, "Laser L1". */
export function laserLabel(number?: number): string {
  return number === undefined ? "Laser" : `Laser ${laserShortId(number)}`;
}

/** The sentence for a student who is lost. The desktop sentence serves VR until the VR variant exists. */
export const lostGuidance = "Lost? Press Esc and choose Go home.";

/**
 * The words that no student-visible string may use (the "Retire" columns of design 017 tables 6.2 and 6.3).
 * Terms of one or two characters (R, G, +) are key names and symbols: the scan in `tests/ui/vocabulary.test.ts` does not look for them in prose.
 */
export const retiredTerms: readonly string[] = [
  // 6.2 nouns
  "Geodesic emitter",
  "RAY",
  "Ray tool",
  "emitter",
  "post",
  "cannon",
  "ray",
  "geodesic",
  "G1",
  "straight line",
  "locked",
  "connected",
  "united curve",
  "curve-shortening flow",
  "Length",
  "Measure length",
  "angles",
  "badge",
  "tooltip",
  "flag",
  "World map",
  "question cube",
  "World deformation",
  "Geometry computer",
  "piece",
  "cell",
  "polygon",
  "portal",
  "seam",
  "vertex",
  "column",
  "geodesic mouse",
  // 6.3 actions
  "create",
  "+",
  "lock",
  "unite",
  "orange button",
  "carry",
  "G",
  "edit",
  "remove",
  "Home",
  "reset",
  "R",
  "Reload",
];
