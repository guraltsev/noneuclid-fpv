/**
 * `tests/render/worldMapRenderer.test.ts` - unit tier.
 *
 * The world map's renderer: the map is the solid, wearing the floors' textures, with each piece flat on its face, and they follow the world; it stands in front of the viewer on the desktop with the rover on the near side; in XR it stays above the right hand and turns exactly as the hand turns, and hides while the hand is lost; a world with no solid shows nothing; its draws sit in the near slice of the depth range and give it back. Every icon has one size, a part of the solid's, the player's larger, and icons of one image share a material. What the pieces are is checked in `worldMapPieces.test.ts`.
 * The depth range itself and how the map looks are checked by eye: a unit test has no GPU.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { cube, dodecahedron, icosahedron, octahedron, tetrahedron, torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { findPlatonicSolid } from "../../src/cell-complex/platonicSolid";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { transformPoint3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import type { PlayerPose } from "../../src/movement/playerPose";
import { rigidTransformToThreeMatrix } from "../../src/render/three/worldAxes";
import { worldMapPieceHeightMeters, type WorldMapIconPiece, type WorldMapPiece } from "../../src/render/three/worldMapPieces";
import { createWorldMapRenderer, worldMapFacing, type WorldMapFrame } from "../../src/render/three/worldMapRenderer";

const cubeWorld = compileCellComplex(cube);
const pose: PlayerPose = { cellId: "front", position: vec3(2, 1, 0), yawRadians: 0.4, pitchRadians: 0 };

// An icon standing at `position` of the cell.
function piece(id: string, cellId: string, position = vec3(1, 2, 0), iconPath = "tree/map-icon.svg"): WorldMapIconPiece {
  const cellFromIcon = rigidTransformToThreeMatrix(yawRigidTransform3(0, position));
  cellFromIcon.elements[13] = 0;
  return { kind: "icon", id, cellId, iconPath, cellFromIcon, onTop: false };
}

const rover = { ...piece("rover", "front", pose.position, "bot/map-icon.svg"), onTop: true };
const circumradius = findPlatonicSolid(cubeWorld)!.circumradiusMeters;

// Icons load; floors do not, unless a test says so.
const iconTextures = new Map<string, THREE.Texture>();
function iconTexture(request: { readonly assetPath: string }): THREE.Texture | undefined {
  if (!request.assetPath.endsWith("map-icon.svg")) return undefined;
  if (!iconTextures.has(request.assetPath)) iconTextures.set(request.assetPath, new THREE.Texture());
  return iconTextures.get(request.assetPath);
}

function setup(getConfiguredTexture: (request: { readonly assetPath: string }) => THREE.Texture | undefined = iconTexture) {
  const depthRange = vi.fn();
  const scene = new THREE.Scene();
  const map = createWorldMapRenderer(scene, { getContext: () => ({ depthRange }) } as never, { getConfiguredTexture });
  const frame = (overrides: Partial<WorldMapFrame> = {}): WorldMapFrame => ({
    world: cubeWorld,
    pieces: [rover],
    playerPose: pose,
    viewerPosition: new THREE.Vector3(1, 1.6, 2),
    viewerQuaternion: new THREE.Quaternion(),
    hand: undefined,
    deltaSeconds: 1 / 60,
    ...overrides,
  });
  return { map, frame, scene, depthRange };
}

const piecesIn = (root: THREE.Group, id: string) => root.children.filter((child) => child.name === `world-map-piece:${id}`);

describe("the world map", () => {
  it("starts hidden and hides again", () => {
    const { map, frame } = setup();
    expect(map.root.visible).toBe(false);
    map.update(frame());
    expect(map.root.visible).toBe(true);
    map.hide();
    expect(map.root.visible).toBe(false);
  });

  it.each([
    ["tetrahedron", tetrahedron, 4, 3],
    ["cube", cube, 6, 4],
    ["octahedron", octahedron, 8, 3],
    ["dodecahedron", dodecahedron, 12, 5],
    ["icosahedron", icosahedron, 20, 3],
  ] as const)("draws the %s with one fan of triangles per face", (_name, spec, faces, sides) => {
    const { map, frame } = setup();
    const world = compileCellComplex(spec);
    map.update(frame({ world, playerPose: { ...pose, cellId: world.cells[0]!.id, position: vec3(0, 0, 0) } }));
    const mesh = map.root.getObjectByName("world-map-faces") as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(faces * sides * 3);
  });

  it("wears the floors' own textures, tiled as the floor is", () => {
    const texture = new THREE.Texture();
    const { map, frame } = setup(() => texture);
    map.update(frame());
    const mesh = map.root.getObjectByName("world-map-faces") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshMatcapMaterial>;
    expect(mesh.material.map).toBe(texture);
    const uv = mesh.geometry.getAttribute("uv");
    expect(uv.count).toBe(mesh.geometry.getAttribute("position").count);
    const tileSizeMeters = (cubeWorld.cells[0]!.floorMaterial as { readonly tileSizeMeters: number }).tileSizeMeters;
    const corner = cubeWorld.cells[0]!.baseVertices[0]!;
    expect(uv.getX(1)).toBeCloseTo(corner.x / tileSizeMeters, 5);
    expect(uv.getY(1)).toBeCloseTo(corner.y / tileSizeMeters, 5);
  });

  it("shows nothing in a world that is no solid", () => {
    const { map, frame } = setup();
    const world = compileCellComplex(torus as CellComplexSpec);
    map.update(frame({ world, playerPose: { ...pose, cellId: world.cells[0]!.id } }));
    expect(map.root.visible).toBe(false);
    expect(map.root.getObjectByName("world-map-faces")).toBeUndefined();
  });

  it("stands the rover at the player's place on the solid", () => {
    const { map, frame } = setup();
    map.update(frame());
    const solid = findPlatonicSolid(cubeWorld)!;
    const expected = transformPoint3(solid.cellFrames.get("front")!, vec3(pose.position.x, pose.position.y, worldMapPieceHeightMeters));
    const [drawn] = piecesIn(map.root, "rover");
    expect(new THREE.Vector3().setFromMatrixPosition(drawn!.matrix).distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z))).toBeLessThan(1e-9);
  });

  it("draws every icon at one size, a part of the solid's, and the player's larger", () => {
    const { map, frame } = setup();
    map.update(frame({ pieces: [rover, piece("tree", "front"), piece("house", "top", vec3(0, 0, 0), "house/map-icon.svg")] }));
    const side = (id: string) => new THREE.Vector3().setFromMatrixScale(piecesIn(map.root, id)[0]!.matrix);
    expect(side("tree").x).toBeCloseTo(side("house").x);
    expect(side("tree").x).toBeCloseTo(side("tree").z);
    expect(side("tree").x / circumradius).toBeGreaterThan(0.05);
    expect(side("tree").x / circumradius).toBeLessThan(0.3);
    expect(side("rover").x).toBeGreaterThan(side("tree").x);
  });

  it("shows an icon's own image, with one material per image", () => {
    const { map, frame } = setup();
    map.update(frame({ pieces: [piece("a", "front"), piece("b", "top"), piece("c", "top", vec3(0, 0, 0), "house/map-icon.svg")] }));
    const material = (id: string) => (piecesIn(map.root, id)[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
    expect(material("a").map).toBe(iconTextures.get("tree/map-icon.svg"));
    expect(material("a")).toBe(material("b"));
    expect(material("c").map).toBe(iconTextures.get("house/map-icon.svg"));
  });

  it("hides an icon whose image was not loaded", () => {
    const { map, frame } = setup();
    map.update(frame({ pieces: [piece("missing", "front", vec3(1, 2, 0), "missing.svg")] }));
    expect(piecesIn(map.root, "missing")[0]!.visible).toBe(false);
  });

  it("lays every piece flat at the same height, whatever height it has in the world", () => {
    const { map, frame } = setup();
    const raised = piece("balloon", "front", vec3(0, 0, 0));
    map.update(frame({ pieces: [raised] }));
    const solid = findPlatonicSolid(cubeWorld)!;
    const cell = solid.cellFrames.get("front")!;
    const onFloor = transformPoint3(cell, vec3(0, 0, 0));
    const above = transformPoint3(cell, vec3(0, 0, 1));
    const normal = new THREE.Vector3(above.x - onFloor.x, above.y - onFloor.y, above.z - onFloor.z);
    const center = new THREE.Vector3().setFromMatrixPosition(piecesIn(map.root, "balloon")[0]!.matrix).sub(new THREE.Vector3(onFloor.x, onFloor.y, onFloor.z));
    expect(center.dot(normal)).toBeCloseTo(worldMapPieceHeightMeters);
  });

  it("draws a strip in the ribbon's own material, under the icons, the avatar on top", () => {
    const { map, frame } = setup();
    const material = new THREE.MeshBasicMaterial();
    const strip: WorldMapPiece = { kind: "strip", id: "strip", cellId: "front", material, cellFromStrip: new THREE.Matrix4() };
    map.update(frame({ pieces: [strip, piece("tree", "front"), { ...piece("avatar", "front"), onTop: true }] }));
    const [drawn] = piecesIn(map.root, "strip") as THREE.Mesh[];
    expect(drawn!.material).toBe(material);
    const order = (id: string) => piecesIn(map.root, id)[0]!.renderOrder;
    expect(order("strip")).toBeLessThan(order("tree"));
    expect(order("tree")).toBeLessThan(order("avatar"));
  });

  it("lays a piece along the face, with its up along the face's normal", () => {
    const { map, frame } = setup();
    map.update(frame());
    const solid = findPlatonicSolid(cubeWorld)!;
    const up = new THREE.Vector3(0, 1, 0).transformDirection(piecesIn(map.root, "rover")[0]!.matrix);
    const frameNormal = transformPoint3(solid.cellFrames.get("front")!, vec3(0, 0, 1));
    const frameOrigin = transformPoint3(solid.cellFrames.get("front")!, vec3(0, 0, 0));
    expect(up.distanceTo(new THREE.Vector3(frameNormal.x - frameOrigin.x, frameNormal.y - frameOrigin.y, frameNormal.z - frameOrigin.z))).toBeLessThan(1e-9);
  });

  it("keeps a mesh per piece, and drops it with the piece", () => {
    const { map, frame } = setup();
    const house = piece("house", "right");
    const tree = piece("tree", "top");
    map.update(frame({ pieces: [rover, house, tree] }));
    expect(piecesIn(map.root, "house")).toHaveLength(1);
    expect(piecesIn(map.root, "tree")).toHaveLength(1);
    expect(map.root.children).toHaveLength(5); // the faces, the edges, and the three pieces
    map.update(frame({ pieces: [rover, tree] }));
    expect(piecesIn(map.root, "house")).toHaveLength(0);
    expect(piecesIn(map.root, "tree")).toHaveLength(1);
  });

  it("moves a piece with its object", () => {
    const { map, frame } = setup();
    const house = piece("house", "right");
    map.update(frame({ pieces: [house] }));
    const group = piecesIn(map.root, "house")[0]!;
    const before = group.matrix.clone();
    map.update(frame({ pieces: [{ ...house, cellId: "top" }] }));
    expect(piecesIn(map.root, "house")[0]).toBe(group);
    expect(group.matrix.equals(before)).toBe(false);
  });

  it("stands in front of the desktop viewer with the rover on the near side", () => {
    const { map, frame } = setup();
    const viewerQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, 0));
    const viewerPosition = new THREE.Vector3(4, 1.6, -2);
    map.update(frame({ viewerPosition, viewerQuaternion }));
    map.root.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuaternion);
    const toMap = map.root.position.clone().sub(viewerPosition);
    expect(toMap.dot(forward)).toBeGreaterThan(0.4);
    expect(toMap.length()).toBeLessThan(1);
    const drawn = new THREE.Vector3().setFromMatrixPosition(piecesIn(map.root, "rover")[0]!.matrix).applyMatrix4(map.root.matrixWorld);
    expect(drawn.distanceTo(viewerPosition)).toBeLessThan(toMap.length());
  });

  it.each([
    ["in the middle of a face", pose],
    ["next to a corner", { ...pose, position: vec3(7, -7, 0), yawRadians: 2.1 }],
    ["on another face", { ...pose, cellId: "top", position: vec3(-3, 1, 0) }],
  ])("keeps the player at the same place in front of the desktop viewer, %s", (_where, playerPose) => {
    const { map, frame } = setup();
    const viewerQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, 0));
    const viewerPosition = new THREE.Vector3(4, 1.6, -2);
    const at = (shown: PlayerPose) => {
      map.update(frame({ viewerPosition, viewerQuaternion, playerPose: shown, pieces: [{ ...rover, cellId: shown.cellId, cellFromIcon: rigidTransformToThreeMatrix(yawRigidTransform3(0, shown.position)) }] }));
      map.root.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(piecesIn(map.root, "rover")[0]!.matrix).applyMatrix4(map.root.matrixWorld);
    };
    const center = at(pose);
    map.hide(); // the next opening turns at once, without easing
    expect(at(playerPose).distanceTo(center)).toBeLessThan(0.02); // the icon floats a little off the face
  });

  it("turns the desktop map to a new heading gradually", () => {
    const { map, frame } = setup();
    const viewerQuaternion = new THREE.Quaternion();
    map.update(frame({ viewerQuaternion }));
    const before = map.root.quaternion.clone();
    const turned = { ...pose, yawRadians: pose.yawRadians + 1 };
    map.update(frame({ viewerQuaternion, playerPose: turned }));
    const target = worldMapFacingFor(turned);
    const step = before.angleTo(map.root.quaternion);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(before.angleTo(target));
  });

  describe("in XR", () => {
    const handAt = (x: number, y: number, z: number, quaternion: THREE.Quaternion) => ({ tracked: { position: new THREE.Vector3(x, y, z), quaternion } });

    it("stays above the right hand wherever it goes", () => {
      const { map, frame } = setup();
      map.update(frame({ hand: handAt(0.3, 1.1, -0.4, new THREE.Quaternion()) }));
      const first = map.root.position.clone();
      map.update(frame({ hand: handAt(-0.2, 1.3, -0.5, new THREE.Quaternion()) }));
      expect(first.y).toBeGreaterThan(1.1);
      expect(map.root.position.x - first.x).toBeCloseTo(-0.5);
      expect(map.root.position.y - first.y).toBeCloseTo(0.2);
    });

    it("turns exactly as the hand turns, and spins in place", () => {
      const { map, frame } = setup();
      const held = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2));
      map.update(frame({ hand: handAt(0, 1, 0, held) }));
      const first = map.root.quaternion.clone();
      const position = map.root.position.clone();
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2);
      map.update(frame({ hand: handAt(0, 1, 0, turn.clone().multiply(held)) }));
      expect(map.root.quaternion.angleTo(turn.clone().multiply(first))).toBeLessThan(1e-6);
      expect(map.root.position.distanceTo(position)).toBeLessThan(1e-9);
    });

    it("first faces the rover to the viewer, and then the head and the rover no longer turn it", () => {
      const { map, frame } = setup();
      const hand = handAt(0, 1, 0, new THREE.Quaternion().setFromEuler(new THREE.Euler(1, 2, 0.5)));
      const viewerQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
      map.update(frame({ hand, viewerQuaternion }));
      expect(map.root.quaternion.angleTo(viewerQuaternion.clone().multiply(worldMapFacingFor(pose)))).toBeLessThan(1e-6);
      const first = map.root.quaternion.clone();
      map.update(frame({ hand, viewerQuaternion: new THREE.Quaternion(), playerPose: { ...pose, yawRadians: 2 } }));
      expect(map.root.quaternion.angleTo(first)).toBeLessThan(1e-6);
    });

    it("hides while the hand is lost and comes back with the same turn", () => {
      const { map, frame } = setup();
      const hand = handAt(0, 1, 0, new THREE.Quaternion());
      map.update(frame({ hand }));
      const first = map.root.quaternion.clone();
      map.update(frame({ hand: { tracked: undefined } }));
      expect(map.root.visible).toBe(false);
      map.update(frame({ hand, viewerQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1) }));
      expect(map.root.visible).toBe(true);
      expect(map.root.quaternion.angleTo(first)).toBeLessThan(1e-6);
    });

    it("faces the rover again when the map is opened anew", () => {
      const { map, frame } = setup();
      const hand = handAt(0, 1, 0, new THREE.Quaternion());
      map.update(frame({ hand }));
      map.hide();
      const viewerQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
      map.update(frame({ hand, viewerQuaternion }));
      expect(map.root.quaternion.angleTo(viewerQuaternion.clone().multiply(worldMapFacingFor(pose)))).toBeLessThan(1e-6);
    });
  });

  it("draws faces and pieces in the near slice of the depth range, and gives it back", () => {
    const { map, frame, depthRange } = setup();
    map.update(frame());
    const noArguments = [undefined, undefined, undefined, undefined, undefined, undefined] as unknown as Parameters<THREE.Object3D["onBeforeRender"]>;
    for (const mesh of [map.root.getObjectByName("world-map-faces")!, piecesIn(map.root, "rover")[0]!]) {
      mesh.onBeforeRender(...noArguments);
      expect(depthRange).toHaveBeenLastCalledWith(0, expect.any(Number));
      expect(depthRange.mock.lastCall![1]).toBeLessThan(0.1);
      mesh.onAfterRender(...noArguments);
      expect(depthRange).toHaveBeenLastCalledWith(0, 1);
    }
  });

  it("leaves the scene and frees its materials, not the icons' images", () => {
    const { map, frame, scene } = setup();
    map.update(frame());
    const material = (piecesIn(map.root, "rover")[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
    const materialDisposed = vi.fn();
    const imageDisposed = vi.fn();
    material.addEventListener("dispose", materialDisposed);
    material.map!.addEventListener("dispose", imageDisposed);
    map.dispose();
    expect(scene.children).not.toContain(map.root);
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(imageDisposed).not.toHaveBeenCalled();
  });
});

function worldMapFacingFor(playerPose: PlayerPose): THREE.Quaternion {
  const frame = findPlatonicSolid(cubeWorld)!.cellFrames.get(playerPose.cellId)!;
  const position = transformPoint3(frame, playerPose.position);
  const ahead = transformPoint3(frame, vec3(playerPose.position.x - Math.sin(playerPose.yawRadians), playerPose.position.y + Math.cos(playerPose.yawRadians), playerPose.position.z));
  return worldMapFacing(position, vec3(ahead.x - position.x, ahead.y - position.y, ahead.z - position.z));
}
