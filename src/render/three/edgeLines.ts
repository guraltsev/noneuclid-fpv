/**
 * "Show edges" (design 017 section 9.5): the glued edges of a face drawn as a thin line on the floor, from the sides that have a portal. The line is off by default because showing it gives away the main thing to discover; Settings (and the Discoveries page, after "Across an edge") switch it on.
 * `buildEdgeLines` makes one group per face, to be parented to the face's root group, which is drawn only while the player is in that face and disposed with it; `setEdgeLinesVisible` shows or hides every group at once.
 */
import * as THREE from "three";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import { worldPointToThree } from "./worldAxes";

/** The name of the group a face's edge lines hang in. */
export const edgeLinesGroupName = "edge-lines";
/** The line's width in meters, measured inward from the wall, and its height above the floor. */
export const edgeLineWidthMeters = 0.08;
const edgeLineHeightMeters = 0.025;
const edgeLineColor = "#fbbf24";

/** The edge lines of `cell`: one flat strip along every side that has a portal; an empty group for a face with none. Hidden until `visible` is set. */
export function buildEdgeLines(cell: Pick<CompiledPrismCell, "id" | "sides">, visible: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = edgeLinesGroupName;
  group.visible = visible;

  const positions: number[] = [];
  const indices: number[] = [];
  for (const side of cell.sides) {
    if (side.portal === undefined) continue;
    const inset = edgeLineWidthMeters;
    const corners = [
      { x: side.start.x, y: side.start.y },
      { x: side.end.x, y: side.end.y },
      { x: side.end.x + side.inwardNormal.x * inset, y: side.end.y + side.inwardNormal.y * inset },
      { x: side.start.x + side.inwardNormal.x * inset, y: side.start.y + side.inwardNormal.y * inset },
    ];
    const first = positions.length / 3;
    for (const corner of corners) {
      const point = worldPointToThree({ x: corner.x, y: corner.y, z: edgeLineHeightMeters });
      positions.push(point.x, point.y, point.z);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  if (indices.length === 0) return group;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: edgeLineColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const strips = new THREE.Mesh(geometry, material);
  strips.name = `${edgeLinesGroupName}:${cell.id}`;
  strips.renderOrder = 5;
  group.add(strips);
  return group;
}

/** Shows or hides the edge lines under each of `roots` (the faces' root groups). */
export function setEdgeLinesVisible(roots: Iterable<THREE.Object3D>, visible: boolean): void {
  for (const root of roots) {
    for (const child of root.children) {
      if (child.name === edgeLinesGroupName) child.visible = visible;
    }
  }
}
