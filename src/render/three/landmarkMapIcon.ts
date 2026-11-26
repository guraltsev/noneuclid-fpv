/**
 * Map icon of a generated landmark (design 018 section 9.7): the landmark itself, drawn from its parts as seen from the front, in its own
 * colours, on a light disc with a dark rim so it reads on any floor. The icon is the thing, not a symbol for its kind, so the map shows the
 * very cairn, tower or spider the player sees in the world, whatever the seed made of it.
 *
 * The front view looks along +v (the landmark's own forward); triangles are painted far to near, each shaded by how much it faces a light
 * from the upper left, glowing parts at full colour. Every triangle is first stroked in a dark colour, which leaves a thin outline around the
 * silhouette once the fills go on top. Needs a DOM canvas; returns undefined without one (tests, workers).
 */
import type { FacePalette } from "../../world-assets/facePalettes";
import type { LandmarkPlacement } from "../../world-assets/landmarkLayout";
import { tessellateParts, type Vec3 } from "../../world-assets/landmarkParts";

/** Side of the icon image, pixels. */
export const landmarkMapIconPixels = 128;

/** Direction from the landmark towards the light of the icon, in its frame (u right, v forward, w up): upper left, from the viewer's side. */
const iconLight: Vec3 = normalize([-0.5, -0.6, 0.65]);

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** One triangle of the icon in image space with its fill colour, painted in array order. */
export interface IconTriangle {
  readonly points: readonly (readonly [number, number])[];
  readonly fill: string;
}

/**
 * The triangles of the icon of `placement` in image pixels (y down), far to near, fitted into a disc of radius 0.38 of the image.
 * Pure, so the drawing can be tested without a canvas.
 */
export function landmarkIconTriangles(placement: Pick<LandmarkPlacement, "parts">, pixels = landmarkMapIconPixels): readonly IconTriangle[] {
  const triangles = tessellateParts(placement.parts);

  if (triangles.length === 0) {
    return [];
  }

  let minU = Infinity;
  let maxU = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  for (const { a, b, c } of triangles) {
    for (const [u, , w] of [a, b, c]) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minW = Math.min(minW, Math.max(0, w));
      maxW = Math.max(maxW, w);
    }
  }

  // Fit the larger extent into the disc, centred.
  const extent = Math.max(maxU - minU, maxW - minW, 1e-6);
  const scale = (pixels * 0.68) / extent;
  const centreU = (minU + maxU) / 2;
  const centreW = (minW + maxW) / 2;
  const toImage = ([u, , w]: Vec3): readonly [number, number] => [pixels / 2 + (u - centreU) * scale, pixels / 2 - (w - centreW) * scale];

  return triangles
    .map((triangle) => {
      const { a, b, c, inside } = triangle;
      const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let normal = normalize([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
      const outward = (a[0] + b[0] + c[0]) / 3 - inside[0];
      const outwardV = (a[1] + b[1] + c[1]) / 3 - inside[1];
      const outwardW = (a[2] + b[2] + c[2]) / 3 - inside[2];
      if (normal[0] * outward + normal[1] * outwardV + normal[2] * outwardW < 0) normal = [-normal[0], -normal[1], -normal[2]];
      const lit = Math.max(0, normal[0] * iconLight[0] + normal[1] * iconLight[1] + normal[2] * iconLight[2]);
      return {
        depth: (a[1] + b[1] + c[1]) / 3,
        points: [toImage(a), toImage(b), toImage(c)],
        fill: triangle.glow ? triangle.color : shade(triangle.color, 0.62 + 0.45 * lit),
      };
    })
    .sort((left, right) => right.depth - left.depth)
    .map(({ points, fill }) => ({ points, fill }));
}

/** Draws the icon of `placement` in `palette` onto a new canvas, or returns undefined where there is no DOM. */
export function drawLandmarkMapIcon(placement: Pick<LandmarkPlacement, "parts">, palette: Pick<FacePalette, "light" | "dark">): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const pixels = landmarkMapIconPixels;
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  context.beginPath();
  context.arc(pixels / 2, pixels / 2, pixels * 0.47, 0, Math.PI * 2);
  context.fillStyle = palette.light;
  context.globalAlpha = 0.92;
  context.fill();
  context.globalAlpha = 1;
  context.lineWidth = pixels * 0.035;
  context.strokeStyle = palette.dark;
  context.stroke();

  const triangles = landmarkIconTriangles(placement, pixels);
  const path = (points: IconTriangle["points"]) => {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    context.lineTo(points[1][0], points[1][1]);
    context.lineTo(points[2][0], points[2][1]);
    context.closePath();
  };

  context.lineJoin = "round";
  context.lineWidth = pixels * 0.03;
  context.strokeStyle = palette.dark;
  for (const triangle of triangles) {
    path(triangle.points);
    context.stroke();
  }

  for (const triangle of triangles) {
    path(triangle.points);
    context.fillStyle = triangle.fill;
    context.fill();
    // A hairline in the fill closes the gaps antialiasing leaves between neighbouring triangles.
    context.lineWidth = 0.6;
    context.strokeStyle = triangle.fill;
    context.stroke();
  }

  return canvas;
}
