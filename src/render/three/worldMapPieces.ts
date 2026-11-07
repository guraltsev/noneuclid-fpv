/**
 * What the world map shows, all of it flat on the solid: nothing on the map has height, so a geodesic stays straight on each face and meets itself at each edge, and it stays with its emitter.
 * A thing is its icon, a picture declared with the thing and kept next to its model: a static object or a creature has it in its spec, a sign, an emitter, a crossing and the avatar in the declarations of their models. The icon lies where the thing stands, turned with it; a thing with no icon, such as grass, is left out.
 * A geodesic's segment is a strip in the ribbon's own material, wider than in the world, where it would be thinner than a pixel. It keeps its own line and runs on past a side by a little, to overlap the next piece over the edge.
 * Measurements are left out: they are marks on a geodesic, with labels no one could read at this size.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findPlatonicSolid, type PlatonicSolid } from "../../cell-complex/platonicSolid";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import { yawRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { vec3, type Vec3 } from "../../math/vec3";
import type { PlayerPose } from "../../movement/playerPose";
import { standardUserRobotObject } from "../../world-objects/library";
import { placedFlagMapIconPaths } from "../../world-objects/placedFlags";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { collectGeodesicRuntimeRenderRecords, composeSegmentMatrix, geodesicMapIconPaths } from "./geodesicCannonRenderer";
import type { RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** A thing on the map, as its icon. */
export interface WorldMapIconPiece {
  readonly kind: "icon";
  /** Stable while the thing exists. */
  readonly id: string;
  readonly cellId: string;
  /** The icon's image, relative to the assets directory; preloaded with the world. */
  readonly iconPath: string;
  /** Where the thing stands in the cell, on the floor and turned with it, in Three axes: the icon's top points along -z. */
  readonly cellFromIcon: THREE.Matrix4;
  /** Drawn larger and over the other icons: the player must not get lost under a tree. */
  readonly onTop: boolean;
}

/** A piece of a geodesic on the map. */
export interface WorldMapStripPiece {
  readonly kind: "strip";
  readonly id: string;
  readonly cellId: string;
  readonly material: THREE.Material;
  /** A unit strip's frame in the cell, in Three axes: x along the strip, from 0 to 1, and z across it, from -1/2 to 1/2. */
  readonly cellFromStrip: THREE.Matrix4;
}

/** One thing on the map. */
export type WorldMapPiece = WorldMapIconPiece | WorldMapStripPiece;

/** Where the pieces are read from. */
export interface WorldMapPieceSources {
  readonly registry: RuntimeObjectReader;
  readonly geodesicRenderSources: readonly RuntimeObjectRenderSourceMesh[];
}

/** Height over the face of everything on it, in meters: only enough not to fight the face for depth. */
export const worldMapPieceHeightMeters = 0.05;

const stripWidthMeters = 0.3;
// A piece's end this close to a side is on it.
const onSideToleranceMeters = 1e-3;
// The sine of the shallowest crossing of a side that a strip's overshoot allows for; a shallower one would run along the edge.
const shallowestCrossing = 0.3;

/** The icon of `object`, as declared with it, or undefined for a thing the map does not show. */
export function worldMapIconPathOf(object: RuntimeWorldObject): string | undefined {
  switch (object.kind) {
    case "asset":
    case "geo-mouse":
    case "geo-butterfly":
    case "geodesci-marmot":
      return object.mapIconPath;
    case "placedFlags/flag":
      return placedFlagMapIconPaths[object.flagType];
    case "geodesicEmitters/emitter":
      return geodesicMapIconPaths.emitter;
    case "geodesicModel/crossing":
      return geodesicMapIconPaths.crossing;
    default:
      return undefined;
  }
}

/** Returns a function listing the pieces of the moment. */
export function createWorldMapPieceReader(from: WorldMapPieceSources): (playerPose: PlayerPose, world: CompiledCellComplex) => readonly WorldMapPiece[] {
  const geodesicKeys = from.geodesicRenderSources.map((source) => source.archetypeKey);
  const geodesicSourcesByKey = new Map(from.geodesicRenderSources.map((source) => [source.archetypeKey, source]));
  const solidsByWorld = new WeakMap<CompiledCellComplex, PlatonicSolid | undefined>();

  function solidOf(world: CompiledCellComplex): PlatonicSolid | undefined {
    if (!solidsByWorld.has(world)) solidsByWorld.set(world, findPlatonicSolid(world));
    return solidsByWorld.get(world);
  }

  function segmentPieces(segment: Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/segment" }>, world: CompiledCellComplex, solid: PlatonicSolid): readonly WorldMapPiece[] {
    const [record] = collectGeodesicRuntimeRenderRecords(from.registry, segment, geodesicKeys);
    const source = record && geodesicSourcesByKey.get(record.archetypeKey);
    const cell = world.cellsById.get(segment.cellId);
    if (source === undefined || cell === undefined) return [];
    return [{ kind: "strip", id: segment.id, cellId: segment.cellId, material: source.mesh.material as THREE.Material, cellFromStrip: stripMatrix(segment, cell, solid) }];
  }

  function objectPieces(object: RuntimeWorldObject, world: CompiledCellComplex, solid: PlatonicSolid): readonly WorldMapPiece[] {
    if (!object.portalRenderable) return [];
    if (object.kind === "geodesicModel/segment") return segmentPieces(object, world, solid);
    const iconPath = worldMapIconPathOf(object);
    return iconPath === undefined ? [] : [iconAt(object.id, object.cellId, iconPath, object.localPose, false)];
  }

  return (playerPose, world) => {
    const solid = solidOf(world);
    if (solid === undefined) return [];
    const pieces = from.registry.getAll().flatMap((object) => objectPieces(object, world, solid));
    const avatar = iconAt(standardUserRobotObject.id, playerPose.cellId, standardUserRobotObject.mapIconPath, yawRigidTransform3(playerPose.yawRadians, playerPose.position), true);
    return [...pieces, avatar];
  };
}

function iconAt(id: string, cellId: string, iconPath: string, localPose: RigidTransform3, onTop: boolean): WorldMapIconPiece {
  const cellFromIcon = rigidTransformToThreeMatrix(localPose);
  cellFromIcon.elements[13] = 0; // Three's y is the height
  return { kind: "icon", id, cellId, iconPath, cellFromIcon, onTop };
}

// How far a strip must run on past its end, along its own line, to reach the line over the side where the two faces' planes of pieces cross. Zero for an end that is not on a side.
function overshootAt(end: Vec3, direction: Vec3, cell: CompiledPrismCell, solid: PlatonicSolid): number {
  const onSide = cell.sides.find((side) => Math.abs((end.x - side.start.x) * side.inwardNormal.x + (end.y - side.start.y) * side.inwardNormal.y) <= onSideToleranceMeters);
  if (onSide === undefined) return 0;
  const crossing = Math.abs(direction.x * onSide.inwardNormal.x + direction.y * onSide.inwardNormal.y);
  return (worldMapPieceHeightMeters * Math.tan(solid.exteriorAngleRadians / 2)) / Math.max(crossing, shallowestCrossing);
}

function stripMatrix(segment: Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/segment" }>, cell: CompiledPrismCell, solid: PlatonicSolid): THREE.Matrix4 {
  const { start, direction, lengthMeters } = segment;
  const before = overshootAt(start, direction, cell, solid);
  const after = overshootAt(vec3(start.x + direction.x * lengthMeters, start.y + direction.y * lengthMeters, 0), direction, cell, solid);
  // The segment matrix stretches x to the length; z is then the strip's width.
  return composeSegmentMatrix({
    ...segment,
    start: vec3(start.x - direction.x * before, start.y - direction.y * before, worldMapPieceHeightMeters),
    lengthMeters: lengthMeters + before + after,
  }).multiply(new THREE.Matrix4().makeScale(1, 1, stripWidthMeters));
}
