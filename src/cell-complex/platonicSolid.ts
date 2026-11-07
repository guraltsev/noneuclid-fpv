/**
 * Recognizes a world that is the surface of a Platonic solid, and places its cells on that solid.
 * The floors of such a world are congruent regular polygons, so the portal gluings alone fix the solid: starting from one cell, each neighbor is unfolded across the shared side (the portal's transform) and folded down by the solid's exterior dihedral angle, which gives every cell a rigid map from its local frame into the solid's frame.
 * The check is that the folding closes up: every portal, not only those the walk crossed, must agree with the frames, and every corner must land on one sphere. No table of worlds is involved, and a surface that is not the solid (a torus, a genus-2 surface, a cube glued with a twist) fails here. Everything is pure.
 * Frames: the solid's center is the origin. A cell's floor plane z = 0 lies on its face, with +z outward, so what stands on a floor stands on the outside of the solid. Meters, the world's own scale.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { CompiledPrismCell } from "./prismCells";
import type { CompiledPortal } from "./specs";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  rigidTransform3,
  transformDirection3,
  transformPoint3,
  type Mat3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { dotVec3, lengthVec3, subVec3, vec3, type Vec3 } from "../math/vec3";

/** The name of a Platonic solid. */
export type PlatonicSolidName = "tetrahedron" | "cube" | "octahedron" | "dodecahedron" | "icosahedron";

/** A world recognized as a Platonic solid. */
export interface PlatonicSolid {
  readonly name: PlatonicSolidName;
  /** Distance from the center to a corner, in meters. */
  readonly circumradiusMeters: number;
  /** The angle between the outward normals of adjacent faces, in radians. */
  readonly exteriorAngleRadians: number;
  /** For each cell id, the rigid map from the cell's local frame into the solid's frame. */
  readonly cellFrames: ReadonlyMap<string, RigidTransform3>;
}

/** The solids by their face count and sides per face, with the cosine of the angle between adjacent faces. */
const solids: readonly { readonly name: PlatonicSolidName; readonly faces: number; readonly sides: number; readonly dihedralCosine: number }[] = [
  { name: "tetrahedron", faces: 4, sides: 3, dihedralCosine: 1 / 3 },
  { name: "cube", faces: 6, sides: 4, dihedralCosine: 0 },
  { name: "octahedron", faces: 8, sides: 3, dihedralCosine: -1 / 3 },
  { name: "dodecahedron", faces: 12, sides: 5, dihedralCosine: -1 / Math.sqrt(5) },
  { name: "icosahedron", faces: 20, sides: 3, dihedralCosine: -Math.sqrt(5) / 3 },
];

// A fraction of the side length: some worlds round their authored coordinates to a few decimals.
const relativeTolerance = 1e-3;

/** The solid `world` is the surface of, or undefined when it is not one. */
export function findPlatonicSolid(world: CompiledCellComplex): PlatonicSolid | undefined {
  const first = world.cells[0];
  if (first === undefined) return undefined;
  const solid = solids.find((entry) => entry.faces === world.cells.length && entry.sides === first.sideCount);
  if (solid === undefined) return undefined;
  const sideLength = first.sides[0]!.lengthMeters;
  const tolerance = sideLength * relativeTolerance;
  if (!world.cells.every((cell) => isRegularFace(cell, solid.sides, sideLength, tolerance))) return undefined;

  const exteriorAngle = Math.PI - Math.acos(solid.dihedralCosine);
  const frames = foldCells(world, exteriorAngle);
  if (frames === undefined || frames.size !== world.cells.length) return undefined;
  if (!foldingClosesUp(world, frames, exteriorAngle, tolerance)) return undefined;

  const center = meanOf(world.cells.map((cell) => transformPoint3(frames.get(cell.id)!, faceCenter(cell))));
  const cellFrames = new Map([...frames].map(([id, frame]) => [id, rigidTransform3(frame.rotation, subVec3(frame.translation, center))]));
  const radii = world.cells.flatMap((cell) => cell.baseVertices.map((corner) => lengthVec3(transformPoint3(cellFrames.get(cell.id)!, vec3(corner.x, corner.y, 0)))));
  const circumradiusMeters = radii[0]!;
  if (radii.some((radius) => Math.abs(radius - circumradiusMeters) > tolerance)) return undefined;
  const outward = world.cells.every((cell) => {
    const frame = cellFrames.get(cell.id)!;
    return dotVec3(transformPoint3(frame, faceCenter(cell)), transformDirection3(frame, vec3(0, 0, 1))) > 0;
  });
  return outward ? { name: solid.name, circumradiusMeters, exteriorAngleRadians: exteriorAngle, cellFrames } : undefined;
}

/** The center of a cell's floor polygon, in its local frame. */
export function faceCenter(cell: CompiledPrismCell): Vec3 {
  return meanOf(cell.baseVertices.map((corner) => vec3(corner.x, corner.y, 0)));
}

function meanOf(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce((total, point) => vec3(total.x + point.x, total.y + point.y, total.z + point.z), vec3(0, 0, 0));
  return vec3(sum.x / points.length, sum.y / points.length, sum.z / points.length);
}

// Equal sides and equal distances from the center, with a portal on every side.
function isRegularFace(cell: CompiledPrismCell, sides: number, sideLength: number, tolerance: number): boolean {
  if (cell.sideCount !== sides || cell.sides.some((side) => side.portal === undefined || Math.abs(side.lengthMeters - sideLength) > tolerance)) return false;
  const center = faceCenter(cell);
  const radii = cell.baseVertices.map((corner) => Math.hypot(corner.x - center.x, corner.y - center.y));
  return radii.every((radius) => Math.abs(radius - radii[0]!) <= tolerance);
}

// The frame of the portal's target cell, from the frame of its source: unfold across the side, then fold down about it.
function neighborFrame(frame: RigidTransform3, cell: CompiledPrismCell, portal: CompiledPortal, exteriorAngle: number): RigidTransform3 {
  return composeRigidTransform3(frame, composeRigidTransform3(foldAboutSide(cell, portal.sideIndex, exteriorAngle), invertRigidTransform3(portal.transformToTarget)));
}

function foldCells(world: CompiledCellComplex, exteriorAngle: number): Map<string, RigidTransform3> | undefined {
  const first = world.cells[0]!;
  const frames = new Map<string, RigidTransform3>([[first.id, identityRigidTransform3]]);
  const queue = [first];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const portal of next.portals) {
      const target = world.cellsById.get(portal.targetCellId);
      if (target === undefined) return undefined;
      if (frames.has(target.id)) continue;
      frames.set(target.id, neighborFrame(frames.get(next.id)!, next, portal, exteriorAngle));
      queue.push(target);
    }
  }
  return frames;
}

function foldingClosesUp(world: CompiledCellComplex, frames: ReadonlyMap<string, RigidTransform3>, exteriorAngle: number, tolerance: number): boolean {
  const probes = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)];
  return world.cells.every((cell) => cell.portals.every((portal) => {
    const folded = neighborFrame(frames.get(cell.id)!, cell, portal, exteriorAngle);
    const target = frames.get(portal.targetCellId)!;
    return probes.every((probe) => lengthVec3(subVec3(transformPoint3(folded, probe), transformPoint3(target, probe))) <= tolerance);
  }));
}

// The rotation by `angle` about the side's own line, directed along the side. On a counterclockwise polygon that takes what lies beyond the side down to -z.
function foldAboutSide(cell: CompiledPrismCell, sideIndex: number, angle: number): RigidTransform3 {
  const side = cell.sides[sideIndex]!;
  const rotation = rotationAboutHorizontalAxis((side.end.x - side.start.x) / side.lengthMeters, (side.end.y - side.start.y) / side.lengthMeters, angle);
  const pivot = vec3(side.start.x, side.start.y, 0);
  return rigidTransform3(rotation, subVec3(pivot, transformDirection3(rigidTransform3(rotation, vec3(0, 0, 0)), pivot)));
}

// Rodrigues' formula for the unit axis (x, y, 0).
function rotationAboutHorizontalAxis(x: number, y: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return {
    m00: c + t * x * x, m01: t * x * y, m02: s * y,
    m10: t * x * y, m11: c + t * y * y, m12: -s * x,
    m20: -s * y, m21: s * x, m22: c,
  };
}
