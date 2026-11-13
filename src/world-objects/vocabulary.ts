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

/** The sentences of the toasts that follow a start over, an undo and a deletion (design 017 section 8.8). */
export const toastMessages = {
  worldReset: "World reset",
  undone: "Undone",
  /** "Sign deleted": what a deletion announces, from the noun of the thing. */
  deleted: (noun: string): string => `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted`,
} as const;

/** The input verbs (design 017 section 7): one meaning each, bound on desktop and in VR. */
export const verbNames = {
  look: "Look",
  walk: "Walk",
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

/** The short id inside a laser's label: "L1" from "Laser L1"; the label itself when it has no short id. */
export function laserShortIdOfLabel(label: string | undefined): string {
  return (label ?? "").replace(/^Laser\s+/, "") || "Laser";
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

/** The words of the pause card, the desktop main menu (design 017 section 8.1). */
export const pauseCardText = {
  clickToPlay: "Click to play",
  /** The "Switch tool" control on desktop: the number keys and the wheel. */
  switchToolControl: "1–5 · wheel",
  help: surfaceNames.help,
  settings: "Settings",
  goHome: objectActions.goHome,
  startOver: objectActions.startOver,
  startOverQuestion: "Remove everything you placed?",
  yes: "Yes",
  no: "No",
} as const;

/** The words of the main menu's buttons that are not named elsewhere. */
export const mainMenuText = {
  settings: "Settings",
  /** The start-over button while it waits for a second press. */
  startOverConfirm: "Click again to confirm",
} as const;

/**
 * The reasons a control is greyed out (design 017 section 8.5): every disabled control shows one in small text under it.
 */
export const disabledReasons = {
  /** Join, with fewer than two linked beams at the laser. */
  joinNeedsTwoLinkedBeams: "Needs two linked beams at this laser",
  /** Aim or Extend on a linked beam. */
  linkedBeamsCannotBeAimed: "Linked beams cannot be aimed",
  /** The Map slot in a world that has no map. */
  noMapForWorld: "No map for this world",
  /** Reshape world, when the target equals the current shape. */
  nothingToChange: "Nothing to change",
  /** The shape machine, in a world that is not the torus. */
  shapeMachineOnlyInTorus: "The shape machine only works in the torus world",
  /** Previous page, on the first page. */
  firstPage: "This is the first page",
  /** Next page, on the last page. */
  lastPage: "This is the last page",
  /** A help page button for a topic with no pages in this world. */
  nothingForThisWorld: "Nothing here for this world",
  /** A shape machine step button at the end of its range. */
  atTheLimit: "At the limit",
  /** The reason of a disabled control that had none given; a test fails on this being needed. */
  notAvailable: "Not available now",
} as const;

/** The words of the controls of the object menus (design 017 section 8.5): text on every button, the key or button after a dot. */
export const menuControlText = {
  /** "+ Add beam": the plus is a symbol, not the retired word. */
  addBeam: `+ ${objectActions.addBeam}`,
  /** The separator between an action and its key or button: "Pick up · G". */
  keySeparator: " · ",
  join: objectActions.join,
  delete: objectActions.delete,
  /** The paging buttons of the help pages. */
  previousPage: "Previous",
  nextPage: "Next",
  /** The title of the menu of a measurement. */
  measurementMenu: "Measurement menu",
  /** The one-line explanation under the title of the measurement menu. */
  measurementMenuBody: "Choose Delete to remove this measurement.",
  /** The header Delete of a laser; its tooltip says what goes with it. */
  deleteLaser: objectActions.delete,
  deleteLaserTooltip: "Delete this laser; its beams go with it",
  deleteSignTooltip: "Delete this sign",
  deleteMeasurementTooltip: "Delete this measurement",
} as const;

/** The text of a menu action with its key or button: "Pick up · G"; the bare action without a key. */
export function actionWithKey(action: string, key?: string): string {
  return key === undefined || key === "" ? action : `${action}${menuControlText.keySeparator}${key}`;
}

/**
 * A beam's row in the Laser menu (design 017 section 8.5): "Beam 1 · 4.0 m · free", "Beam 2 · L1–L3 · linked", "Beam 3 · string" for a beam of a string.
 * `ends` are the short ids of the two lasers a linked beam runs between; `lengthMeters` is shown with one decimal.
 */
export function beamRowLabel(number: number, state: { readonly kind: "free"; readonly lengthMeters: number } | { readonly kind: "linked"; readonly ends: readonly [string, string] } | { readonly kind: "string" }): string {
  const name = beamName(number);
  switch (state.kind) {
    case "free":
      return `${name} · ${state.lengthMeters.toFixed(1)} m · free`;
    case "linked":
      return `${name} · ${state.ends[0]}–${state.ends[1]} · linked`;
    case "string":
      return `${name} · ${objectNouns.string.singular}`;
  }
}

/** The words of the tool belt (design 017 section 7.4) and of the right click that finds nothing to open. */
export const toolBeltText = {
  /** Why the Map slot is greyed out in a world that has no map. */
  noMapForWorld: disabledReasons.noMapForWorld,
  /** The toast of a right click or F with nothing aimed at. */
  aimToOpenMenu: "Aim at something to open its menu",
  /** The label of the last slot, which opens the main menu. */
  mainMenuName: "Main menu",
  mainMenuSubtitle: "Help, Settings, Go home, Start over",
  /** The accessible name of the belt. */
  ariaLabel: "Tool belt",
} as const;

/** The "Controllers" section of Settings (VR hand options, design 017 sections 7.2 and 7.3). */
export const controllersSettingsText = {
  section: "Controllers",
  useOneController: "Use one controller",
  leftHanded: "Left-handed",
} as const;

/** The words of the VR belt, its toasts and the VR start card (design 017 sections 7.3, 7.4 and 8.1). */
export const vrBeltText = {
  /** Toast when the layout becomes one controller. */
  oneControllerToast: "One controller: your tools are on your belt, look down",
  /** Toast when the layout becomes two controllers. */
  twoControllersToast: "Two controllers: your tools are on your left wrist",
  /** Same, for the left-handed layout. */
  twoControllersLeftHandedToast: "Two controllers: your tools are on your right wrist",
  /** The title of the VR start card. */
  startCardTitle: "Your controllers",
  /** The line under the start card's list. */
  startCardDismiss: "Pull the trigger to start",
  /** Heading of the controllers in the card (two controllers). */
  pointerHandHeading: "Pointer hand",
  beltHandHeading: "Belt hand",
  oneControllerHeading: "Your controller",
} as const;

/** The words of the hint strip (design 017 section 8.2): what the listed input does right now, after the colon. Lowercase, since a glyph label comes first. */
export const hintStripText = {
  /** The label of the "Show hints" switch in Settings. */
  showHintsSwitch: "Show hints",
  tools: "tools",
  whatsThis: "what's this?",
  choose: "choose",
  close: "close",
  pickUp: "pick up",
  putDown: "put down",
  placeLaser: "place a laser",
  placeSign: "place a sign",
  openHelp: "open Help",
  measureBeam: "measure this beam",
  pickBeam: "pick this beam",
  pickMeetingPoint: "pick this meeting point",
  /** "extend 2 m": the beam grows by `lengthMeters`; without a length, just "extend". */
  extend: (lengthMeters?: number): string => lengthMeters === undefined ? "extend" : `extend ${lengthMeters} m`,
  /** "put the Laser away": what key 0 does with a tool in hand. */
  putAway: (toolName: string): string => `put the ${toolName} away`,
} as const;
