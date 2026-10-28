/**
 * Builds the billboard mesh for the XR object tooltip: a rounded dark panel with up to three centered text lines, drawn on a canvas texture.
 * The plane is 0.92 x 0.31 meters, rendered without depth test on top of the scene so it stays readable through geometry.
 * Positioning and orientation are done by the caller (see xrObjectTooltipController).
 */
import * as THREE from "three";
import { roundRect } from "./canvasDrawing";

/**
 * Three.js `renderOrder` of the tooltip mesh; high so it draws after scene geometry.
 */
export const xrObjectTooltipRenderOrder = 960;
/**
 * Vertical offset in meters (cell-local +z) added above the object's anchor point before placing the tooltip.
 */
export const xrObjectTooltipYOffsetMeters = 0.18;

/**
 * Creates a hidden (`visible = false`) billboard mesh showing `text`; only the first three newline-separated lines are drawn.
 * Throws if a 2D canvas context cannot be created. Lifecycle: the caller owns the mesh and must dispose its geometry, material, and map
 * (e.g. with `disposeObject3D`).
 */
export function createXrObjectTooltip(text: string): THREE.Object3D {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create XR object tooltip canvas context.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(10, 17, 20, 0.9)";
  roundRect(context, 42, 34, canvas.width - 84, canvas.height - 68, 18);
  context.fill();
  context.strokeStyle = "rgba(226, 232, 240, 0.66)";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Fewer than three lines get a larger font; text is squeezed horizontally via maxWidth if too long.
  const lines = text.split("\n").slice(0, 3);
  const fontSize = lines.length > 2 ? 44 : 50;
  const lineHeight = fontSize * 1.18;
  const firstLineY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  context.font = `bold ${fontSize}px system-ui, sans-serif`;
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, firstLineY + index * lineHeight, canvas.width - 120);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.31), material);
  mesh.name = "xr-object-tooltip:billboard";
  mesh.renderOrder = xrObjectTooltipRenderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}
