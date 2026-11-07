/**
 * `tests/render/worldMapPieces.test.ts` - unit tier.
 *
 * What the map shows, flat on the solid: a thing is the icon declared with it, at its own place with its height taken off, turned with it, the avatar's on top; a thing with no icon, a hidden one and measurements are left out; a sign, an emitter and a crossing have the icons declared with their models; a geodesic's segment is a strip in the ribbon's material of its state, along its own line, running on past a side to overlap the next piece.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { faceCenter } from "../../src/cell-complex/platonicSolid";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3, type Vec3 } from "../../src/math/vec3";
import type { PlayerPose } from "../../src/movement/playerPose";
import { createGeodesicRuntimeRenderSources, geodesicSegmentArchetypeKey, geodesicSegmentConnectedArchetypeKey } from "../../src/render/three/geodesicCannonRenderer";
import { geodesicMapIconPaths } from "../../src/render/three/geodesicCannonRenderer";
import { rigidTransformToThreeMatrix, threeToWorldBasis } from "../../src/render/three/worldAxes";
import { createWorldMapPieceReader, worldMapPieceHeightMeters, type WorldMapIconPiece, type WorldMapPiece, type WorldMapStripPiece } from "../../src/render/three/worldMapPieces";
import { standardUserRobotObject } from "../../src/world-objects/library";
import { placedFlagMapIconPaths } from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry, type RuntimeObjectReader, type RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";

const world = compileCellComplex(cube);
const pose: PlayerPose = { cellId: "front", position: vec3(2, 1, 0), yawRadians: 0.4, pitchRadians: 0 };
const geodesicRenderSources = createGeodesicRuntimeRenderSources();
const sourceOf = (key: string) => geodesicRenderSources.find((source) => source.archetypeKey === key)!;

// The pieces of `objects`, without the avatar's, which is always last.
function readPieces(objects: readonly unknown[]): readonly WorldMapPiece[] {
  return readAll(objects).slice(0, -1);
}

function readAll(objects: readonly unknown[]): readonly WorldMapPiece[] {
  const registry = { ...createRuntimeObjectRegistry(), getAll: () => objects } as unknown as RuntimeObjectReader;
  return createWorldMapPieceReader({ registry, geodesicRenderSources })(pose, world);
}

const object = (id: string, kind: string, fields: Record<string, unknown> = {}, position = vec3(1, 2, 0)) => ({ id, kind, cellId: "top", localPose: yawRigidTransform3(0.3, position), portalRenderable: true, ...fields }) as unknown as RuntimeWorldObject;
const icon = (piece: WorldMapPiece | undefined) => piece as WorldMapIconPiece;
const strip = (piece: WorldMapPiece | undefined) => piece as WorldMapStripPiece;

const segment = (id: string, cellId: string, start: Vec3, direction: Vec3, lengthMeters: number, connectionState = "free") => ({ id, kind: "geodesicModel/segment", cellId, start, direction, lengthMeters, connectionState, portalRenderable: true });

describe("the pieces", () => {
  it("show an object as the icon of its spec, at its own pose", () => {
    const [piece] = readPieces([object("house", "asset", { mapIconPath: "small_house/map-icon.svg" })]);
    expect(piece).toMatchObject({ kind: "icon", id: "house", cellId: "top", iconPath: "small_house/map-icon.svg", onTop: false });
    expect(icon(piece).cellFromIcon.equals(rigidTransformToThreeMatrix(yawRigidTransform3(0.3, vec3(1, 2, 0))))).toBe(true);
  });

  it("show a creature as the icon of its spec", () => {
    expect(readPieces([object("m", "geo-mouse", { mapIconPath: "mouse/map-icon.svg" })])).toMatchObject([{ kind: "icon", iconPath: "mouse/map-icon.svg" }]);
  });

  it("take the height off", () => {
    const [piece] = readPieces([object("high", "asset", { mapIconPath: "a.svg" }, vec3(1, 2, 3))]);
    const position = new THREE.Vector3().setFromMatrixPosition(icon(piece).cellFromIcon);
    expect(position.toArray()).toEqual([1, 0, -2]);
  });

  it("show a sign, an emitter and a crossing by the icons of their models", () => {
    const pieces = readPieces([object("sign", "placedFlags/flag", { flagType: "WoodenSign2" }), object("e", "geodesicEmitters/emitter"), object("x", "geodesicModel/crossing", {}, vec3(1, 2, 1.08))]);
    expect(pieces.map((piece) => icon(piece).iconPath)).toEqual([placedFlagMapIconPaths.WoodenSign2, geodesicMapIconPaths.emitter, geodesicMapIconPaths.crossing]);
    expect(new THREE.Vector3().setFromMatrixPosition(icon(pieces[2]).cellFromIcon).y).toBe(0);
  });

  it("leave out a thing with no icon, what the world does not draw, and measurements", () => {
    const hidden = object("hidden", "asset", { mapIconPath: "a.svg", portalRenderable: false });
    expect(readPieces([hidden, object("grass", "asset"), object("length", "geodesicMeasurements/length"), object("angle", "geodesicMeasurements/angle")])).toEqual([]);
  });

  it("include the avatar's icon, at the player, turned with them, on top", () => {
    const pieces = readAll([]);
    expect(pieces).toMatchObject([{ kind: "icon", id: standardUserRobotObject.id, cellId: "front", iconPath: standardUserRobotObject.mapIconPath, onTop: true }]);
    expect(icon(pieces[0]).cellFromIcon.equals(rigidTransformToThreeMatrix(yawRigidTransform3(pose.yawRadians, vec3(2, 1, 0))))).toBe(true);
  });

  it("are none in a world that is no solid", () => {
    const registry = { getAll: () => [object("house", "asset", { mapIconPath: "a.svg" })] } as unknown as RuntimeObjectReader;
    const read = createWorldMapPieceReader({ registry, geodesicRenderSources });
    expect(read(pose, { ...world, cells: world.cells.slice(1) })).toEqual([]);
  });
});

describe("a geodesic's segment on the map", () => {
  it("is a strip in the world's ribbon of its state", () => {
    const [free] = readPieces([segment("s", "front", vec3(0, 0, 1.08), vec3(1, 0, 0), 4)]);
    const [connected] = readPieces([segment("s", "front", vec3(0, 0, 1.08), vec3(1, 0, 0), 4, "connected")]);
    expect(strip(free).kind).toBe("strip");
    expect(strip(free).material).toBe(sourceOf(geodesicSegmentArchetypeKey).mesh.material);
    expect(strip(connected).material).toBe(sourceOf(geodesicSegmentConnectedArchetypeKey).mesh.material);
  });

  it("lies on the face along its own line, with its length and a width of its own", () => {
    const [piece] = readPieces([segment("s", "front", vec3(0.5, 0.5, 1.08), vec3(1, 0, 0), 2)]);
    const position = new THREE.Vector3().setFromMatrixPosition(strip(piece).cellFromStrip);
    expect(position.toArray()).toEqual([0.5, worldMapPieceHeightMeters, -0.5]);
    const scale = new THREE.Vector3().setFromMatrixScale(strip(piece).cellFromStrip);
    expect(scale.x).toBeCloseTo(2);
    expect(scale.z).toBeCloseTo(0.3);
  });

  it("stays straight across an edge: it keeps its line and runs on a little past the side", () => {
    const cell = world.cells[0]!;
    const side = cell.sides[0]!;
    const onSide = vec3((side.start.x + side.end.x) / 2, (side.start.y + side.end.y) / 2, 0);
    const center = faceCenter(cell);
    const start = vec3(center.x + 1.3, center.y - 0.7, 1.08);
    const lengthMeters = Math.hypot(onSide.x - start.x, onSide.y - start.y);
    const direction = vec3((onSide.x - start.x) / lengthMeters, (onSide.y - start.y) / lengthMeters, 0);
    const [piece] = readPieces([segment("s", cell.id, start, direction, lengthMeters)]);
    const inCell = (x: number) => new THREE.Vector3(x, 0, 0).applyMatrix4(new THREE.Matrix4().copy(threeToWorldBasis).multiply(strip(piece).cellFromStrip));
    const along = inCell(1).sub(inCell(0)).normalize();
    expect(along.distanceTo(new THREE.Vector3(direction.x, direction.y, 0))).toBeLessThan(1e-9);
    const overshoot = inCell(1).distanceTo(new THREE.Vector3(onSide.x, onSide.y, worldMapPieceHeightMeters));
    expect(overshoot).toBeGreaterThan(0.02);
    expect(overshoot).toBeLessThan(0.2);
    expect(inCell(0).distanceTo(new THREE.Vector3(start.x, start.y, worldMapPieceHeightMeters))).toBeLessThan(1e-9); // the end off the side does not move
  });
});
