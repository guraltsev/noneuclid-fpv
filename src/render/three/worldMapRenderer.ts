/**
 * The world map: the world in miniature, as the Platonic solid it is the surface of, with everything in it flat on its faces: the icons of its things, the player's among them, and geodesics as strips (`worldMapPieces.ts`).
 * An icon has one size on every map, a fixed part of the solid's size, whatever the size of its thing: like a road map's symbols, it says what stands there, not how large it is. The player's is larger.
 * The map's root is one group in the frame of the solid (`cell-complex/platonicSolid.ts`), scaled down and posed each frame. Its children are the faces, the edges and one mesh per piece; a piece's matrix is its cell-local placement carried onto the solid, so everything follows the world while the map is open. The faces wear the floors' own textures, which their mipmaps bring down to the map's size, and are lit by a matcap, a fixed light that turns with the viewer: they turn every way, and those turned from the world's sun would be dark.
 * Placement: on the desktop the map floats in front of the viewer with the player's point always at its center, turned so that the player faces them with their heading up and tilted back a little, like a table seen from above, so that what lies ahead shows. The solid turns under the player as they move, and as they near an edge it turns a little to bring the next face in. In XR it floats above the right hand. With the hand as it was when the map appeared, the map stands as on the desktop, facing the view it opened in, with the player's point above the hand; the hand's turn since then is composed with that pose, about the player's point, so a person looks around the solid by rotating their hand, and a turn of the wrist spins the solid about the player rather than swinging it through the air. While the hand is not tracked the map hides.
 * The map draws over the world without losing its own depth order: its meshes use a thin slice at the near end of the depth range, so a wall the player stands close to does not cut through it.
 * The renderer owns its GPU resources; the owner must call `dispose()`.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { floorMetricUv } from "../../cell-complex/floorUv";
import { faceCenter, findPlatonicSolid, type PlatonicSolid } from "../../cell-complex/platonicSolid";
import { composeRigidTransform3, transformDirection3, transformPoint3, yawRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { vec3, type Vec3 } from "../../math/vec3";
import type { PlayerPose } from "../../movement/playerPose";
import { floorColorTexture } from "./buildCellMesh";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
import { threeToWorldBasis } from "./worldAxes";
import { worldMapPieceHeightMeters, type WorldMapIconPiece, type WorldMapPiece } from "./worldMapPieces";

/** What the map needs each frame. */
export interface WorldMapFrame {
  readonly world: CompiledCellComplex;
  readonly pieces: readonly WorldMapPiece[];
  readonly playerPose: PlayerPose;
  /** The viewer's eye in the scene. */
  readonly viewerPosition: THREE.Vector3;
  readonly viewerQuaternion: THREE.Quaternion;
  /** Present in XR: the right hand's pose in the scene, `tracked` undefined while it is lost. */
  readonly hand: { readonly tracked: Pick<THREE.Object3D, "position" | "quaternion"> | undefined } | undefined;
  readonly deltaSeconds: number;
}

/** Handle returned by {@link createWorldMapRenderer}. */
export interface WorldMapRenderer {
  /** The map's root, in the solid's frame; for tests and inspection. */
  readonly root: THREE.Group;
  /** Shows the map for this frame; call each frame while it is open. */
  update(frame: WorldMapFrame): void;
  /** Closes the map: it hides, and it faces the rover again when it next opens. */
  hide(): void;
  dispose(): void;
}

// Radius of the sphere around the map, in meters, and where its center stands.
const desktopRadiusMeters = 0.17;
const xrRadiusMeters = 0.13;
const desktopOffsetFromEye = new THREE.Vector3(0, -0.06, -0.62);
const xrHeightAboveHandMeters = 0.2;
// The tilt back of the player's surface: its outward direction leans up from the viewer's line of sight, so the viewer looks down on it and sees what lies ahead.
const facingView = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-15));
// How fast the desktop map turns to a new heading; it also hides the small jump in heading at an edge.
const facingTurnRate = 10;
const edgeColor = "#0f172a";
const edgeLift = 1.004;
// Things flat on one face are drawn in this order; they write no depth, so the order is what stacks them.
const stripRenderOrder = 1;
const iconRenderOrder = 2;
const avatarRenderOrder = 3;
// Side of an icon, and of the player's, as a part of the solid's circumradius.
const iconSizeOfCircumradius = 0.2;
const avatarIconSizeOfCircumradius = 0.26;
// The map's light, a little above and to the left of the viewer, and how much of the brightness does not depend on it.
const matcapLight = new THREE.Vector3(-0.3, 0.6, 0.75).normalize();
const matcapAmbient = 0.6;
const matcapSizePixels = 32;
// The near end of the depth range; the world's depths still reach it only at the near plane.
const depthSlice = 0.01;

/**
 * The turn of the solid, relative to a viewer looking along -z with +y up, that faces the rover at `position` to the viewer with `heading` up, tilted back (both in the solid's frame).
 * Radial, not face-normal, so it does not jump when the rover crosses an edge.
 */
export function worldMapFacing(position: Vec3, heading: Vec3): THREE.Quaternion {
  const outward = new THREE.Vector3(position.x, position.y, position.z).normalize();
  const up = new THREE.Vector3(heading.x, heading.y, heading.z);
  up.addScaledVector(outward, -up.dot(outward)).normalize();
  const right = new THREE.Vector3().crossVectors(up, outward);
  const solid = new THREE.Matrix4().makeBasis(right, up, outward);
  return new THREE.Quaternion().setFromRotationMatrix(facingView.clone().multiply(solid.transpose()));
}

// The map's light as a matcap: the brightness of a surface by the direction it faces, seen from the viewer.
function createMatcap(): THREE.DataTexture {
  const pixels = new Uint8Array(matcapSizePixels * matcapSizePixels * 4);
  const normal = new THREE.Vector3();
  for (let row = 0; row < matcapSizePixels; row += 1) {
    for (let column = 0; column < matcapSizePixels; column += 1) {
      normal.set(((column + 0.5) / matcapSizePixels) * 2 - 1, ((row + 0.5) / matcapSizePixels) * 2 - 1, 0);
      normal.z = Math.sqrt(Math.max(0, 1 - normal.lengthSq()));
      const brightness = matcapAmbient + (1 - matcapAmbient) * Math.max(0, normal.dot(matcapLight));
      const offset = (row * matcapSizePixels + column) * 4;
      pixels.fill(Math.round(brightness * 255), offset, offset + 3);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, matcapSizePixels, matcapSizePixels);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Creates the map, hidden, under `scene`. */
export function createWorldMapRenderer(scene: THREE.Scene, renderer: Pick<THREE.WebGLRenderer, "getContext">, assets: Pick<PreparedWorldAssets, "getConfiguredTexture">): WorldMapRenderer {
  const root = new THREE.Group();
  root.name = "world-map";
  root.visible = false;
  scene.add(root);

  const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor, fog: false });
  const matcap = createMatcap();
  // An icon is a unit square lying on the floor, its picture's top toward the thing's forward, -z. A strip runs along x from 0 to 1.
  const iconGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const stripGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  // One material per icon image, made when first shown; undefined for an image that was not loaded.
  const iconMaterials = new Map<string, THREE.Material | undefined>();
  const drawnPieces = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>>();
  const seenPieceIds = new Set<string>();
  const solidFromCell = new THREE.Matrix4();

  let shownWorld: CompiledCellComplex | undefined;
  let solid: PlatonicSolid | undefined;
  let surface: readonly (THREE.Mesh<THREE.BufferGeometry, THREE.Material> | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>)[] = [];
  // The map's turn relative to the view, as it eases to the player's facing.
  let facing: THREE.Quaternion | undefined;
  // In XR, the view and the hand's turn when the map first appeared in the hand.
  let held: { readonly view: THREE.Quaternion; readonly hand: THREE.Quaternion } | undefined;
  // Whether the map was last shown in the hand; a switch starts it afresh.
  let shownInHand: boolean | undefined;

  function useNearDepth(): void {
    renderer.getContext().depthRange(0, depthSlice);
  }

  function restoreDepth(): void {
    renderer.getContext().depthRange(0, 1);
  }

  function drawnOverTheWorld<T extends THREE.Object3D>(object: T): T {
    object.onBeforeRender = useNearDepth;
    object.onAfterRender = restoreDepth;
    object.matrixAutoUpdate = false;
    return object;
  }

  function createPieceMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const mesh = drawnOverTheWorld(new THREE.Mesh<THREE.BufferGeometry, THREE.Material>());
    root.add(mesh);
    return mesh;
  }

  function iconMaterial(iconPath: string): THREE.Material | undefined {
    if (!iconMaterials.has(iconPath)) {
      const map = assets.getConfiguredTexture({ assetPath: iconPath, colorSpace: THREE.SRGBColorSpace, repeatX: 1, repeatY: 1 });
      // It writes no depth, so that things flat on one face do not fight; the render order stacks them.
      iconMaterials.set(iconPath, map && new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false }));
    }
    return iconMaterials.get(iconPath);
  }

  function placeIcon(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>, piece: WorldMapIconPiece, circumradiusMeters: number): void {
    const material = iconMaterial(piece.iconPath);
    mesh.visible = material !== undefined;
    if (material === undefined) return;
    const sizeMeters = circumradiusMeters * (piece.onTop ? avatarIconSizeOfCircumradius : iconSizeOfCircumradius);
    mesh.geometry = iconGeometry;
    mesh.material = material;
    mesh.renderOrder = piece.onTop ? avatarRenderOrder : iconRenderOrder;
    mesh.matrix.copy(solidFromCell).multiply(piece.cellFromIcon);
    mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, worldMapPieceHeightMeters, 0));
    mesh.matrix.scale(new THREE.Vector3(sizeMeters, 1, sizeMeters));
  }

  function clearSurface(): void {
    for (const part of surface) {
      root.remove(part);
      part.geometry.dispose();
      if (part.material !== edgeMaterial) part.material.dispose();
    }
  }

  function showWorld(world: CompiledCellComplex): void {
    if (world === shownWorld) return;
    shownWorld = world;
    clearSurface();
    solid = findPlatonicSolid(world);
    if (solid === undefined) {
      surface = [];
      return;
    }
    const edges = drawnOverTheWorld(new THREE.LineSegments(createEdgeGeometry(world, solid), edgeMaterial));
    edges.name = "world-map-edges";
    const faces = createFaces(world, solid).map((mesh) => drawnOverTheWorld(mesh));
    root.add(...faces, edges);
    surface = [...faces, edges];
  }

  // One mesh per floor texture; a floor with none has the color alone.
  function createFaces(world: CompiledCellComplex, shown: PlatonicSolid): readonly THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] {
    const cellsByTexture = new Map<THREE.Texture | undefined, CompiledCellComplex["cells"][number][]>();
    for (const cell of world.cells) {
      const texture = floorColorTexture(cell, assets);
      cellsByTexture.set(texture, [...(cellsByTexture.get(texture) ?? []), cell]);
    }
    return [...cellsByTexture].map(([map, cells]) => {
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(createFaceGeometry(cells, shown), new THREE.MeshMatcapMaterial({ map: map ?? null, matcap, vertexColors: true, fog: false }));
      mesh.name = "world-map-faces";
      return mesh;
    });
  }

  function syncPieces(pieces: readonly WorldMapPiece[], shown: PlatonicSolid): void {
    seenPieceIds.clear();
    for (const piece of pieces) {
      const frame = shown.cellFrames.get(piece.cellId);
      if (frame === undefined) continue;
      setRigidMatrix(solidFromCell, frame);
      solidFromCell.multiply(threeToWorldBasis);
      let mesh = drawnPieces.get(piece.id);
      if (mesh === undefined) {
        mesh = createPieceMesh();
        mesh.name = `world-map-piece:${piece.id}`;
        drawnPieces.set(piece.id, mesh);
      }
      seenPieceIds.add(piece.id);
      if (piece.kind === "icon") {
        placeIcon(mesh, piece, shown.circumradiusMeters);
        continue;
      }
      mesh.visible = true;
      mesh.geometry = stripGeometry;
      mesh.material = piece.material;
      mesh.renderOrder = stripRenderOrder;
      mesh.matrix.copy(solidFromCell).multiply(piece.cellFromStrip);
    }
    for (const [id, mesh] of drawnPieces) {
      if (seenPieceIds.has(id)) continue;
      root.remove(mesh);
      drawnPieces.delete(id);
    }
  }

  // Turns and places the map so that the player's point stands at `anchor`.
  function standRoverAt(anchor: THREE.Vector3, turn: THREE.Quaternion, roverPosition: Vec3, radiusMeters: number, circumradiusMeters: number): void {
    root.quaternion.copy(turn);
    root.scale.setScalar(radiusMeters / circumradiusMeters);
    const roverFromCenter = new THREE.Vector3(roverPosition.x, roverPosition.y, roverPosition.z).multiplyScalar(root.scale.x).applyQuaternion(turn);
    root.position.copy(anchor).sub(roverFromCenter);
  }

  function place(frame: WorldMapFrame, roverPosition: Vec3, roverHeading: Vec3, circumradiusMeters: number): boolean {
    const target = worldMapFacing(roverPosition, roverHeading);
    const inHand = frame.hand !== undefined;
    if (shownInHand !== inHand) {
      held = undefined;
      facing = undefined;
      shownInHand = inHand;
    }
    const hand = frame.hand?.tracked;
    if (inHand && hand === undefined) return false;
    facing = facing === undefined ? target : facing.slerp(target, 1 - Math.exp(-facingTurnRate * frame.deltaSeconds));
    if (hand === undefined) {
      const anchor = desktopOffsetFromEye.clone().applyQuaternion(frame.viewerQuaternion).add(frame.viewerPosition);
      standRoverAt(anchor, frame.viewerQuaternion.clone().multiply(facing), roverPosition, desktopRadiusMeters, circumradiusMeters);
      return true;
    }
    held ??= { view: frame.viewerQuaternion.clone(), hand: hand.quaternion.clone() };
    // The default pose faces the player to the view the map opened in; the hand's turn since then turns it about the player's point.
    const handTurn = hand.quaternion.clone().multiply(held.hand.clone().invert());
    const anchor = hand.position.clone();
    anchor.y += xrHeightAboveHandMeters;
    standRoverAt(anchor, handTurn.multiply(held.view).multiply(facing), roverPosition, xrRadiusMeters, circumradiusMeters);
    return true;
  }

  return {
    root,
    update(frame) {
      showWorld(frame.world);
      const roverFrame = solid?.cellFrames.get(frame.playerPose.cellId);
      if (solid === undefined || roverFrame === undefined) {
        root.visible = false;
        return;
      }
      const roverPose = composeRigidTransform3(roverFrame, yawRigidTransform3(frame.playerPose.yawRadians, frame.playerPose.position));
      const roverPosition = transformPoint3(roverPose, vec3(0, 0, 0));
      const roverHeading = transformDirection3(roverPose, vec3(0, 1, 0));
      root.visible = place(frame, roverPosition, roverHeading, solid.circumradiusMeters);
      if (!root.visible) return;
      syncPieces(frame.pieces, solid);
    },
    hide() {
      root.visible = false;
      facing = undefined;
      held = undefined;
    },
    dispose() {
      scene.remove(root);
      clearSurface();
      for (const mesh of drawnPieces.values()) root.remove(mesh);
      for (const material of iconMaterials.values()) material?.dispose();
      iconGeometry.dispose();
      stripGeometry.dispose();
      matcap.dispose();
      edgeMaterial.dispose();
    },
  };
}

function setRigidMatrix(matrix: THREE.Matrix4, transform: RigidTransform3): void {
  const { rotation: r, translation: t } = transform;
  matrix.set(r.m00, r.m01, r.m02, t.x, r.m10, r.m11, r.m12, t.y, r.m20, r.m21, r.m22, t.z, 0, 0, 0, 1);
}

// Each face as a fan about its center, tinted and tiled as the floor is; no shared vertices, so it shades flat.
function createFaceGeometry(cells: CompiledCellComplex["cells"], solid: PlatonicSolid): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const cell of cells) {
    const frame = solid.cellFrames.get(cell.id)!;
    const tileSizeMeters = cell.floorMaterial.kind === "floor-texture" ? cell.floorMaterial.tileSizeMeters : 1;
    const center = faceCenter(cell);
    color.set(cell.floorColor);
    cell.baseVertices.forEach((corner, index) => {
      const next = cell.baseVertices[(index + 1) % cell.baseVertices.length]!;
      for (const point of [center, corner, next]) {
        const { x, y, z } = transformPoint3(frame, vec3(point.x, point.y, 0));
        positions.push(x, y, z);
        uvs.push(...floorMetricUv(point, tileSizeMeters));
        colors.push(color.r, color.g, color.b);
      }
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Every side of every face, lifted a little off the solid so that the lines do not fight the faces for depth.
function createEdgeGeometry(world: CompiledCellComplex, solid: PlatonicSolid): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const cell of world.cells) {
    const frame = solid.cellFrames.get(cell.id)!;
    for (const side of cell.sides) {
      const start = transformPoint3(frame, vec3(side.start.x, side.start.y, 0));
      const end = transformPoint3(frame, vec3(side.end.x, side.end.y, 0));
      positions.push(start.x * edgeLift, start.y * edgeLift, start.z * edgeLift, end.x * edgeLift, end.y * edgeLift, end.z * edgeLift);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
