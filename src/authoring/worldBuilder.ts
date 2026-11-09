/**
 * World builder: the imperative API behind the world-script DSL that assembles a CellComplexSpec.
 * A world script (see src/examples/*.world.js) calls PolygonFace to declare prism rooms from convex base polygons, Portal to glue two sides of two faces (a rigid-transform gluing is derived later by the cell-complex compiler), OnFace to place library objects, and startingHouse / startingQuestionCube / startingPosition for the player's start; build() returns the CellComplexSpec that compileCellComplex consumes.
 * Authoring conventions: base vertices are counterclockwise [x, y] pairs in meters in the cell's local plane, side i is the wall from vertex i to vertex i+1 (mod n), and object/start positions are [x, height, y] triples in meters (reordered here into cell-local x, y, z with z up); angles are degrees at this layer and radians in the spec. Every cell gets the same fixed height of 15 m.
 * Invariants enforced eagerly (each violation throws): unique face names, unique object ids, each side belongs to at most one portal, portals are created in reciprocal pairs, and only library-built objects can be placed.
 */
import type {
  AuthoredPortalSpec,
  CellComplexSpec,
  CellObjectSpec,
  FloorMaterialSpec,
  PrismCellSpec,
  StartingPositionSpec,
  TutorialPageSpec,
} from "../cell-complex/specs";
import { createConvexPrismBaseVertices, type ConvexPrismBaseVertices } from "../cell-complex/prismBase";
import { isWorldLibraryObjectSpec, type WorldLibraryObjectSpec } from "../world-objects/library";
import { normalizeFloorMaterial, type WorldFloorMaterialSpec } from "../world-assets/floorTextures";
import { worldObjectLibrary } from "../world-objects/library";
import { degreesToRadians, type StaticObjectAuthoringParams } from "../world-objects/staticAssets";
import { helpHubHomeGuidance } from "../world-objects/helpHubCopy";

const defaultHeightMeters = 15;
const startingHouseLookOffsetDegrees = 12;
/**
 * Default help message shown on the starting question cube when the author supplies none.
 */
export const defaultStartingQuestionCubeMessage =
  "Open this cube to page through the tutorial.";
/**
 * Default tutorial pages of the starting question cube: one page per thing a player can do, each with a screenshot and its controls (shown with the icons of the current device).
 * The tutorial opens on an index of these titles. A page that names `requiresTools` is left out when the app config (as it applies to the world) enables none of them.
 */
export const defaultStartingQuestionCubeTutorialPages: readonly TutorialPageSpec[] = [
  {
    title: "Look and walk",
    body: "Look around and walk. Walk off the edge of a flat piece and you carry on onto the piece glued to it. Look at nearby objects to see what you can do with them.",
    desktopBody: "Click the view once so the mouse turns your head; Esc gives the mouse back. Turn also with Q and E. Walk off the edge of a flat piece and you carry on onto the piece glued to it.",
    xrBody: "Turn your head, or push the stick sideways, to look around. Walk off the edge of a flat piece and you carry on onto the piece glued to it.",
    imagePath: "tutorial/walk.jpg",
    controls: [
      { intent: "look", label: "look around" },
      { intent: "move", label: "walk" },
      { intent: "reset", label: "start over: removes everything you placed" },
    ],
  },
  {
    title: "Get help",
    body: `Aim at anything to see its name. Ask for help about it, or open its menu. ${helpHubHomeGuidance}`,
    imagePath: "tutorial/help.jpg",
    controls: [
      { intent: "help", label: "help about what you aim at" },
      { intent: "context-menu", label: "menu of what you aim at" },
    ],
  },
  {
    title: "The tool menu",
    body: "Aim at empty floor and open the tool menu, then pick a tool. The buttons at the top are Settings (choose another world), Home (back to the start) and Reload (press twice).",
    imagePath: "tutorial/tool-menu.jpg",
    controls: [
      { intent: "context-menu", label: "open the tool menu" },
      { intent: "primary", label: "pick a tool or press a button" },
      { intent: "cancel", label: "close the menu" },
    ],
  },
  {
    title: "Straight rays",
    body: "Pick Geodesic emitter and select a spot on the floor: a post appears and fires a short, locally straight ray the way you face. Select the ray to make it 2 m longer. A ray stops if it runs into a corner: each corner of the surface is surrounded by a thin column.",
    imagePath: "tutorial/rays.jpg",
    requiresTools: ["geodesicEmitters/emitter"],
    controls: [
      { intent: "primary", label: "place a post, or lengthen a ray" },
      { intent: "context-menu", label: "on a post: its menu" },
    ],
  },
  {
    title: "Aim a ray",
    body: "Open a post's menu: it lists the post's rays. Press Aim next to a free ray; the ray now points wherever you look. Select to fix it. If it ends on another post, or close to one, it locks there. The + button adds a ray, the bin deletes one.",
    imagePath: "tutorial/post-menu.jpg",
    requiresTools: ["geodesicEmitters/emitter"],
    controls: [
      { intent: "context-menu", label: "open the post's menu" },
      { intent: "primary", label: "press Aim; select again to fix the ray" },
    ],
  },
  {
    title: "Locked rays",
    body: "A ray with a post at both ends is locked: it turns amber and shows a lock in the post's menu. It cannot be aimed or made longer. A ray locks when it reaches another post, or when you put a new post on a free ray, which cuts the ray in two.",
    imagePath: "tutorial/locked.jpg",
    requiresTools: ["geodesicEmitters/emitter"],
    controls: [
      { intent: "primary", label: "with Geodesic emitter, select a free ray to cut it with a post" },
    ],
  },
  {
    title: "Move a post",
    body: "Aim at a post and pick it up. Its locked rays stay attached: they are redrawn as straight rays between the posts while you walk, going the same way around the world. Its free rays are removed. Putting a post down on a ray cuts that ray.",
    imagePath: "tutorial/carry.jpg",
    requiresTools: ["geodesicEmitters/emitter"],
    controls: [
      { intent: "carry", label: "pick up or put down a post" },
      { intent: "primary", label: "put it down" },
    ],
  },
  {
    title: "Unite and shorten",
    body: "The orange button in a post's menu unites two of the post's locked geodesic segments into one curve and detaches it from the post. Select the two segments near the post. The curve-shortening flow then moves the corner where they meet so that the curve gets shorter, until it is a geodesic between the other two posts, or a closed geodesic.",
    imagePath: "tutorial/tie.jpg",
    requiresTools: ["geodesicEmitters/emitter"],
    controls: [
      { intent: "context-menu", label: "open the post's menu" },
      { intent: "primary", label: "press the orange button, then select the two segments" },
    ],
  },
  {
    title: "Measure",
    body: "Length: pick it and select a ray to see how long it is, all the way along. Protractor: select a post or a crossing, then two rays leaving it; the angle goes counter-clockwise from the first to the second. With no tool, select a measurement to remove it.",
    imagePath: "tutorial/measure.jpg",
    requiresTools: ["geodesicMeasurements/length", "geodesicMeasurements/protractor"],
    controls: [
      { intent: "primary", label: "select a ray, a post, a crossing or a side" },
    ],
  },
  {
    title: "Signs",
    body: "Pick Sign and select a spot on the floor. Signs are numbered A1, A2, and so on, so you can tell places apart. Open a sign's menu to type your own text on its keyboard, or delete it. The ... button on the Sign tool picks the style.",
    imagePath: "tutorial/signs.jpg",
    requiresTools: ["placedFlags/flag"],
    controls: [
      { intent: "primary", label: "put up a sign" },
      { intent: "context-menu", label: "on a sign: edit or delete it" },
    ],
  },
  {
    title: "World map",
    body: "Pick Map to see the whole world as a small solid in front of you, with you and the objects on it. Compare it with what you see around you.",
    imagePath: "tutorial/map.jpg",
    requiresTools: ["worldMap/map"],
    controls: [
      { intent: "primary", label: "close the map" },
    ],
  },
];
/**
 * Default goal pages of the starting question cube.
 */
export const defaultStartingQuestionCubeGoalPages: readonly TutorialPageSpec[] = [
  {
    title: "Goal",
    body: "Explore this world and use its portals to learn how the faces connect.",
    desktopBody: "Explore this world. Use Right click or F on objects for menus, and try to predict where each portal leads.",
    xrBody: "Explore this world. Use the side trigger on objects for menus, and try to predict where each portal leads.",
  },
];

// Cell under construction; `portals` and `visuals.objects` are appended by later builder calls and copied out by build().
interface MutableCell {
  readonly id: string;
  readonly heightMeters: number;
  readonly baseVertices: readonly { readonly x: number; readonly y: number }[];
  readonly portals: AuthoredPortalSpec[];
  readonly visuals: {
    floorColor: string;
    floorMaterial: FloorMaterialSpec;
    objects: CellObjectSpec[];
  };
}

/**
 * The set of calls available to world scripts for assembling a world.
 * All methods throw an Error with an explanatory message on invalid input (unknown face, duplicate name or id, side already used, ...); compileWorldScript wraps such errors with the script name.
 */
export interface WorldBuilder {
  /** Declares a prism cell `name` with the given floor and convex counterclockwise base polygon (3-8 vertices, meters); throws on duplicate names or invalid polygons. */
  PolygonFace(name: string, floor: string | WorldFloorMaterialSpec, vertices: ConvexPrismBaseVertices): void;
  /** Glues side `side1` of `face1` to side `side2` of `face2` by creating reciprocal portals (ids "side-<n>"); throws if either face is unknown, a side is already used, or it would join a side to itself. */
  Portal(face1: string, side1: number, face2: string, side2: number): void;
  /** Places library-built objects in a face; throws on unknown face, non-library objects, or duplicate object ids (unique across the whole world). */
  OnFace(faceName: string, objects: readonly WorldLibraryObjectSpec[]): void;
  /** Places the landmark house (object id "startingHouse") and sets the player's start in front of it, looking back at it; replaces any earlier start position. */
  startingHouse(faceName: string, params: StaticObjectAuthoringParams): void;
  /** Places the help question cube (object id "startingQuestionCube") with default or supplied tutorial and goal pages. */
  startingQuestionCube(faceName: string, params: StartingQuestionCubeAuthoringParams): void;
  /** Sets the player's start explicitly; the last of startingHouse / startingPosition called wins. */
  startingPosition(faceName: string, params: StartingPositionAuthoringParams): void;
  /** Snapshots the accumulated cells (copying their arrays) and start position into a CellComplexSpec; the builder remains usable. */
  build(): CellComplexSpec;
}

/**
 * Parameters for startingQuestionCube: ordinary static-object parameters plus tutorial content.
 * `message`, if given and no `tutorialPages` are supplied, becomes a single "Tutorial" page.
 */
export interface StartingQuestionCubeAuthoringParams extends StaticObjectAuthoringParams {
  readonly message?: string;
  readonly tutorialPages?: readonly TutorialPageSpec[];
  readonly goalPages?: readonly TutorialPageSpec[];
}

/**
 * Parameters for startingPosition: where the player's eye reference point starts.
 * `turn` (yaw) and `pitch` are in degrees and default to 0.
 */
export interface StartingPositionAuthoringParams {
  /**
   * Position in authored [x, height, y] axes, matching object library positions.
   */
  readonly position: readonly [x: number, height: number, y: number];
  readonly turn?: number;
  readonly pitch?: number;
}

/**
 * Creates an empty WorldBuilder.
 * Each builder owns its state; calling `build` does not reset it. Cells are emitted in the order their PolygonFace calls were made.
 */
export function createWorldBuilder(): WorldBuilder {
  const cells = new Map<string, MutableCell>();
  const portalAssignments = new Map<string, Set<string>>();
  const objectIds = new Set<string>();
  let startingPosition: StartingPositionSpec | undefined;

  return {
    PolygonFace(name, floor, vertices) {
      if (cells.has(name)) {
        throw new Error(`Duplicate face "${name}".`);
      }

      if (!Array.isArray(vertices) || vertices.length < 3) {
        throw new Error(`PolygonFace("${name}") requires at least 3 vertices.`);
      }

      const validatedVertices = createConvexPrismBaseVertices(vertices);
      // Convexity and orientation were validated above; this strips the type brand and checks that each vertex is a finite [x, y] pair.
      const normalizedVertices = validatedVertices.map((vertex, index) => normalizeVertex(name, vertex, index));
      const floorMaterial = normalizeFloorMaterial(floor);

      cells.set(name, {
        id: name,
        heightMeters: defaultHeightMeters,
        baseVertices: normalizedVertices,
        portals: [],
        visuals: {
          floorColor: floorMaterial.floorColor,
          floorMaterial,
          objects: [],
        },
      });
      portalAssignments.set(name, new Set());
    },

    Portal(face1, side1, face2, side2) {
      const cell1 = cells.get(face1);
      const cell2 = cells.get(face2);

      if (!cell1) {
        throw new Error(`Unknown face "${face1}" in Portal().`);
      }

      if (!cell2) {
        throw new Error(`Unknown face "${face2}" in Portal().`);
      }

      const authoredSide1 = normalizeSideIndex(side1, cell1.baseVertices.length);
      const authoredSide2 = normalizeSideIndex(side2, cell2.baseVertices.length);

      // Joining a side to itself would make a portal its own partner; two different sides of one face are allowed.
      if (face1 === face2 && authoredSide1.portalId === authoredSide2.portalId) {
        throw new Error(`Portal("${face1}", ${side1}, ...) cannot connect a side to itself.`);
      }

      assertUnassignedSide(portalAssignments, face1, authoredSide1.portalId);
      assertUnassignedSide(portalAssignments, face2, authoredSide2.portalId);

      cell1.portals.push({
        id: authoredSide1.portalId,
        sideIndex: authoredSide1.sideIndex,
        targetCellId: face2,
        targetPortalId: authoredSide2.portalId,
      });
      cell2.portals.push({
        id: authoredSide2.portalId,
        sideIndex: authoredSide2.sideIndex,
        targetCellId: face1,
        targetPortalId: authoredSide1.portalId,
      });
      portalAssignments.get(face1)?.add(authoredSide1.portalId);
      portalAssignments.get(face2)?.add(authoredSide2.portalId);
    },

    OnFace(faceName, objects) {
      const cell = cells.get(faceName);

      if (!cell) {
        throw new Error(`Unknown face "${faceName}" in OnFace().`);
      }

      if (!Array.isArray(objects)) {
        throw new Error(`OnFace("${faceName}", ...) requires an array of objects.`);
      }

      for (const object of objects) {
        if (!isWorldLibraryObjectSpec(object)) {
          throw new Error(`OnFace("${faceName}", ...) received an object that was not created by the object library.`);
        }

        if (objectIds.has(object.id)) {
          throw new Error(`Duplicate object id "${object.id}".`);
        }

        objectIds.add(object.id);
        cell.visuals.objects.push(stripLibraryBrand(object));
      }
    },

    startingHouse(faceName, params) {
      const cell = requireCell(cells, faceName, "startingHouse");

      if (objectIds.has("startingHouse")) {
        throw new Error('Duplicate object id "startingHouse".');
      }

      const house = worldObjectLibrary.small_house("startingHouse", params);
      objectIds.add(house.id);
      cell.visuals.objects.push(stripLibraryBrand(house));
      startingPosition = createStartingPositionInFrontOfHouse(faceName, params);
    },

    startingQuestionCube(faceName, params) {
      const cell = requireCell(cells, faceName, "startingQuestionCube");

      if (objectIds.has("startingQuestionCube")) {
        throw new Error('Duplicate object id "startingQuestionCube".');
      }

      const questionCube = worldObjectLibrary.question_cube("startingQuestionCube", {
        ...params,
        displayHelpMessage: params.displayHelpMessage ?? defaultStartingQuestionCubeMessage,
        tutorialPages: params.tutorialPages ?? (params.message
          ? [{ title: "Tutorial", body: params.message }]
          : defaultStartingQuestionCubeTutorialPages),
        goalPages: params.goalPages ?? defaultStartingQuestionCubeGoalPages,
      });
      objectIds.add(questionCube.id);
      cell.visuals.objects.push(stripLibraryBrand(questionCube));
    },

    startingPosition(faceName, params) {
      requireCell(cells, faceName, "startingPosition");
      startingPosition = {
        cellId: faceName,
        position: authorPositionToWorld(params.position),
        yawRadians: degreesToRadians(params.turn ?? 0),
        pitchRadians: degreesToRadians(params.pitch ?? 0),
      };
    },

    build() {
      return {
        cells: [...cells.values()].map((cell): PrismCellSpec => ({
          id: cell.id,
          heightMeters: cell.heightMeters,
          baseVertices: [...cell.baseVertices],
          portals: [...cell.portals],
          visuals: {
            floorColor: cell.visuals.floorColor,
            floorMaterial: cell.visuals.floorMaterial,
            objects: [...cell.visuals.objects],
          },
        })),
        startingPosition,
      };
    },
  };
}

/**
 * Validates an author-facing side number against a polygon's vertex count and returns it as the spec's `sideIndex`.
 * Currently the identity mapping: side i is the wall from base vertex i to vertex i+1 (mod n). Throws if `side` is not an integer in [0, vertexCount).
 */
export function authorSideToSideIndex(vertexCount: number, side: number): number {
  if (!Number.isInteger(side)) {
    throw new Error(`Invalid side ${String(side)}; side index must be an integer.`);
  }

  if (side < 0 || side >= vertexCount) {
    throw new Error(`Invalid side ${side}; expected an index in the range 0-${vertexCount - 1}.`);
  }

  return side;
}

function normalizeVertex(faceName: string, vertex: readonly number[], index: number): { readonly x: number; readonly y: number } {
  if (!Array.isArray(vertex) || vertex.length !== 2) {
    throw new Error(`PolygonFace("${faceName}") vertex ${index} must be a [x, y] pair.`);
  }

  const [x, y] = vertex;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`PolygonFace("${faceName}") vertex ${index} must contain finite numbers.`);
  }

  return { x, y };
}

function normalizeSideIndex(side: number, vertexCount: number): { readonly sideIndex: number; readonly portalId: string } {
  const sideIndex = authorSideToSideIndex(vertexCount, side);
  return {
    sideIndex,
    portalId: `side-${sideIndex}`,
  };
}

function assertUnassignedSide(
  portalAssignments: ReadonlyMap<string, ReadonlySet<string>>,
  faceName: string,
  portalId: string,
): void {
  if (portalAssignments.get(faceName)?.has(portalId)) {
    throw new Error(`Face "${faceName}" already has a portal on ${portalId}.`);
  }
}

function stripLibraryBrand(object: WorldLibraryObjectSpec): CellObjectSpec {
  return { ...object };
}

function requireCell(
  cells: ReadonlyMap<string, MutableCell>,
  faceName: string,
  callerName: string,
): MutableCell {
  const cell = cells.get(faceName);

  if (!cell) {
    throw new Error(`Unknown face "${faceName}" in ${callerName}().`);
  }

  return cell;
}

function createStartingPositionInFrontOfHouse(
  faceName: string,
  params: StaticObjectAuthoringParams,
): StartingPositionSpec {
  const housePosition = authorPositionToWorld(params.position);
  const yawRadians = degreesToRadians(params.turn ?? 0);
  // Player faces back towards the house (yaw + pi), rotated by a 12 degree look offset so the house is not dead centre.
  const playerYawRadians = yawRadians + Math.PI - degreesToRadians(startingHouseLookOffsetDegrees);
  const scale = params.scale ?? 1;
  // Stand-off distance in front of the house grows with its scale.
  const distanceMeters = 2.15 * scale + 0.55;

  return {
    cellId: faceName,
    position: {
      // The house front is its local +y axis rotated by yaw (counterclockwise), i.e. (-sin yaw, cos yaw); the start point is that far in front of it.
      x: housePosition.x - Math.sin(yawRadians) * distanceMeters,
      y: housePosition.y + Math.cos(yawRadians) * distanceMeters,
      z: housePosition.z,
    },
    yawRadians: playerYawRadians,
    pitchRadians: 0,
  };
}

// Reorders an authored [x, height, y] triple into cell-local {x, y, z} with z up.
function authorPositionToWorld(
  position: readonly [x: number, height: number, y: number],
): StartingPositionSpec["position"] {
  return {
    x: position[0],
    y: position[2],
    z: position[1],
  };
}
