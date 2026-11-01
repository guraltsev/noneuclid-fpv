/**
 * Reads the bounding box of a binary glTF (.glb) file from its JSON chunk, without a renderer: the min/max of every mesh primitive's POSITION
 * accessor, with the node transforms of the scene applied. The box is in the file's own axes (glTF: y up), before any scale or placement the
 * renderer applies. Used to pin hand-written model dimensions to the assets they describe.
 */
import { readFileSync } from "node:fs";

/** An axis-aligned box in glTF axes (y up). */
export interface GlbBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

interface GltfNode {
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

interface GltfJson {
  readonly scene?: number;
  readonly scenes: readonly { readonly nodes: readonly number[] }[];
  readonly nodes: readonly GltfNode[];
  readonly meshes: readonly { readonly primitives: readonly { readonly attributes: { readonly POSITION: number } }[] }[];
  readonly accessors: readonly { readonly min: readonly number[]; readonly max: readonly number[] }[];
}

type Matrix4 = readonly number[];

const identity: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major product a * b.
function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
  }
  return out;
}

// Local matrix of a node: its matrix, or translation * rotation (quaternion) * scale.
function localMatrix(node: GltfNode): Matrix4 {
  if (node.matrix) {
    return node.matrix;
  }
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const r0 = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
  const r1 = [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)];
  const r2 = [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [
    r0[0] * sx, r0[1] * sx, r0[2] * sx, 0,
    r1[0] * sy, r1[1] * sy, r1[2] * sy, 0,
    r2[0] * sz, r2[1] * sz, r2[2] * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** The bounding box of every mesh of the default scene of the .glb file at `url`, with node transforms applied. */
export function readGlbBounds(url: URL): GlbBounds {
  const bytes = readFileSync(url);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GltfJson;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const visit = (nodeIndex: number, parent: Matrix4): void => {
    const node = gltf.nodes[nodeIndex];
    const matrix = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        for (const cx of [accessor.min[0], accessor.max[0]]) {
          for (const cy of [accessor.min[1], accessor.max[1]]) {
            for (const cz of [accessor.min[2], accessor.max[2]]) {
              for (let axis = 0; axis < 3; axis += 1) {
                const value = matrix[axis] * cx + matrix[4 + axis] * cy + matrix[8 + axis] * cz + matrix[12 + axis];
                min[axis] = Math.min(min[axis], value);
                max[axis] = Math.max(max[axis], value);
              }
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child, matrix);
    }
  };

  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) {
    visit(root, identity);
  }
  return { min, max };
}
