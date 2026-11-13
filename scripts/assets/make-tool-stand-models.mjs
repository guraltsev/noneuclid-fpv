/**
 * Writes the tool stand's models to public/assets/toolstand/: a low table and one small object per tool
 * (laser, ruler, protractor, sign, map). The models are simple primitives made by this script, original to this
 * project (see _docs/ASSET_PROVENANCE.md). Run `node scripts/assets/make-tool-stand-models.mjs` to regenerate them.
 *
 * Every model is glTF 2.0 (binary), in meters, Y up, with its origin at the middle of its base on y = 0 so the
 * world script can stand it on the table top (0.60 m) by its height. Faces are flat shaded.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "assets", "toolstand");
mkdirSync(outDir, { recursive: true });

/** A part is a list of triangles (flat arrays of positions and normals) with a material. */
function newPart(color, options = {}) {
  return { color, roughness: options.roughness ?? 0.7, metallic: options.metallic ?? 0, positions: [], normals: [], indices: [] };
}

function addTriangle(part, a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length; ny /= length; nz /= length;
  const base = part.positions.length / 3;
  for (const p of [a, b, c]) {
    part.positions.push(p[0], p[1], p[2]);
    part.normals.push(nx, ny, nz);
  }
  part.indices.push(base, base + 1, base + 2);
}

/** A quad a-b-c-d, counterclockwise seen from outside. */
function addQuad(part, a, b, c, d) {
  addTriangle(part, a, b, c);
  addTriangle(part, a, c, d);
}

/** An axis-aligned box centred at (cx, cy, cz). */
function addBox(part, sx, sy, sz, cx, cy, cz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  addQuad(part, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  addQuad(part, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  addQuad(part, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  addQuad(part, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  addQuad(part, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  addQuad(part, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
}

/** A cylinder of `radius` and `length` along `axis` ("x", "y" or "z") through (cx, cy, cz). */
function addCylinder(part, radius, length, axis, cx, cy, cz, segments = 16) {
  const point = (angle, along) => {
    const u = Math.cos(angle) * radius, v = Math.sin(angle) * radius;
    if (axis === "x") return [cx + along, cy + u, cz + v];
    if (axis === "y") return [cx + u, cy + along, cz + v];
    return [cx + u, cy + v, cz + along];
  };
  const half = length / 2;
  const middle = (along) => (axis === "x" ? [cx + along, cy, cz] : axis === "y" ? [cx, cy + along, cz] : [cx, cy, cz + along]);
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const flip = axis === "y" ? 1 : -1;
    // Side
    const s = [point(a0, -half), point(a1, -half), point(a1, half), point(a0, half)];
    if (flip > 0) addQuad(part, s[1], s[0], s[3], s[2]); else addQuad(part, s[0], s[1], s[2], s[3]);
    // Caps
    const top = middle(half), bottom = middle(-half);
    if (flip > 0) {
      addTriangle(part, top, point(a1, half), point(a0, half));
      addTriangle(part, bottom, point(a0, -half), point(a1, -half));
    } else {
      addTriangle(part, top, point(a0, half), point(a1, half));
      addTriangle(part, bottom, point(a1, -half), point(a0, -half));
    }
  }
}

/** A half disc (flat side along z = 0, bulging towards +z) of `radius`, `thickness` high, standing on y = 0. */
function addHalfDisc(part, radius, thickness, segments = 24) {
  const ring = (angle, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI, a1 = ((i + 1) / segments) * Math.PI;
    addTriangle(part, [0, thickness, 0], ring(a1, thickness), ring(a0, thickness));
    addTriangle(part, [0, 0, 0], ring(a0, 0), ring(a1, 0));
    addQuad(part, ring(a0, 0), ring(a1, 0), ring(a1, thickness), ring(a0, thickness));
  }
  addQuad(part, [-radius, 0, 0], [radius, 0, 0], [radius, thickness, 0], [-radius, thickness, 0]);
}

/** Packs parts into one binary glTF. */
function glb(name, parts) {
  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  const meshPrimitives = [];
  const materials = [];
  let offset = 0;
  const push = (typedArray, target) => {
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };
  parts.forEach((part, index) => {
    materials.push({
      name: `${name}-${index}`,
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [...part.color, 1], metallicFactor: part.metallic, roughnessFactor: part.roughness },
    });
    const positions = new Float32Array(part.positions);
    const normals = new Float32Array(part.normals);
    const indices = new Uint32Array(part.indices);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }
    accessors.push({ bufferView: push(positions, 34962), componentType: 5126, count: positions.length / 3, type: "VEC3", min, max });
    const positionAccessor = accessors.length - 1;
    accessors.push({ bufferView: push(normals, 34962), componentType: 5126, count: normals.length / 3, type: "VEC3" });
    const normalAccessor = accessors.length - 1;
    accessors.push({ bufferView: push(indices, 34963), componentType: 5125, count: indices.length, type: "SCALAR" });
    meshPrimitives.push({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: accessors.length - 1, material: index });
  });
  const json = {
    asset: { version: "2.0", generator: "scripts/assets/make-tool-stand-models.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: meshPrimitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const binary = Buffer.concat(chunks);
  const total = 12 + 8 + jsonBytes.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path.join(outDir, `${name}.glb`), Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binary]));
  console.log(`wrote ${name}.glb (${total} bytes)`);
}

// The table: a 1.30 m by 0.46 m top at 0.60 m on four legs.
{
  const wood = newPart([0.55, 0.38, 0.22]);
  const dark = newPart([0.38, 0.26, 0.15]);
  addBox(wood, 1.3, 0.05, 0.46, 0, 0.575, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(dark, 0.06, 0.55, 0.06, sx * 0.6, 0.275, sz * 0.19);
  glb("table", [wood, dark]);
}

// The laser: a red-tipped cylinder lying along the table's depth.
{
  const body = newPart([0.2, 0.22, 0.26], { metallic: 0.6, roughness: 0.4 });
  const tip = newPart([0.9, 0.12, 0.12], { roughness: 0.3 });
  addCylinder(body, 0.035, 0.17, "z", 0, 0.035, -0.015, 18);
  addCylinder(tip, 0.022, 0.04, "z", 0, 0.035, 0.09, 18);
  glb("laser", [body, tip]);
}

// The ruler: a flat bar with tick marks.
{
  const bar = newPart([0.93, 0.8, 0.35]);
  const ticks = newPart([0.15, 0.15, 0.15]);
  addBox(bar, 0.05, 0.008, 0.26, 0, 0.004, 0);
  for (let i = 0; i < 13; i += 1) addBox(ticks, i % 4 === 0 ? 0.03 : 0.018, 0.002, 0.004, -0.01 + (i % 4 === 0 ? 0 : 0.006), 0.009, -0.12 + i * 0.02);
  glb("ruler", [bar, ticks]);
}

// The protractor: a half disc with a dark centre line.
{
  const disc = newPart([0.55, 0.78, 0.9], { roughness: 0.3 });
  const mark = newPart([0.12, 0.12, 0.14]);
  addHalfDisc(disc, 0.085, 0.006);
  addBox(mark, 0.004, 0.002, 0.07, 0, 0.007, 0.035);
  glb("protractor", [disc, mark]);
}

// The sign: a small board on a foot.
{
  const board = newPart([0.78, 0.6, 0.38]);
  const foot = newPart([0.4, 0.28, 0.17]);
  const writing = newPart([0.2, 0.15, 0.1]);
  addBox(foot, 0.07, 0.02, 0.05, 0, 0.01, 0);
  addBox(board, 0.15, 0.1, 0.012, 0, 0.07, 0);
  addBox(writing, 0.1, 0.012, 0.002, 0, 0.075, 0.007);
  addBox(writing, 0.07, 0.012, 0.002, -0.015, 0.05, 0.007);
  glb("sign", [board, foot, writing]);
}

// The map: a rolled sheet with two ties.
{
  const sheet = newPart([0.93, 0.87, 0.7]);
  const tie = newPart([0.5, 0.2, 0.15]);
  addCylinder(sheet, 0.03, 0.22, "z", 0, 0.03, 0, 20);
  for (const z of [-0.07, 0.07]) addCylinder(tie, 0.033, 0.014, "z", 0, 0.03, z, 20);
  glb("map", [sheet, tie]);
}
