/**
 * Floating text badge ("pill" with an optional downward pointer) used as an in-world result label, for example for measured lengths and protractor angles.
 * The badge is a Three.js plane in its own local frame (width along x, height along y, facing +z) sized in meters; the text is rasterized once into a 512x160 canvas texture. When no DOM or 2D canvas is available it degrades to a flat colored plane without text.
 * Lifecycle: the returned object owns geometry, materials and textures; callers must dispose them with `disposeObject3DWithTextures` from runtimeSceneUtils (plain `disposeObject3D` would leak the canvas texture maps).
 */
import * as THREE from "three";
import { roundRect } from "./canvasDrawing";

/** Color scheme of a world result badge. */
export type WorldResultBadgeVariant = "length" | "angle" | "success" | "warning";

/** Options for {@link createWorldResultBadge}. */
export interface WorldResultBadgeOptions {
  /** Label text, drawn on a single line and squeezed horizontally to fit. */
  readonly text: string;
  readonly variant: WorldResultBadgeVariant;
  /** World size of the badge plane along its x axis, meters. */
  readonly widthMeters: number;
  /** World size of the badge plane along its y axis, meters. */
  readonly heightMeters: number;
  /** Whether to draw a small pointer under the pill; defaults to "down". */
  readonly pointer?: "down" | "none";
  /** When true, a mirrored back face with its own cloned texture is added so the badge reads from both sides; defaults to false. */
  readonly doubleFaced?: boolean;
  /** Three.js render order applied to the group and its faces; defaults to 0. */
  readonly renderOrder?: number;
}

// Canvas fill/stroke per variant, plus a flat fallback color used when no canvas is available.
const variantColors: Readonly<Record<WorldResultBadgeVariant, {
  readonly fill: string;
  readonly stroke: string;
  readonly fallback: number;
}>> = {
  length: {
    fill: "rgba(20, 83, 45, 0.94)",
    stroke: "rgba(134, 239, 172, 0.96)",
    fallback: 0x14532d,
  },
  angle: {
    fill: "rgba(15, 118, 110, 0.94)",
    stroke: "rgba(255, 209, 102, 0.96)",
    fallback: 0x0f766e,
  },
  success: {
    fill: "rgba(22, 101, 52, 0.94)",
    stroke: "rgba(187, 247, 208, 0.96)",
    fallback: 0x166534,
  },
  warning: {
    fill: "rgba(146, 64, 14, 0.94)",
    stroke: "rgba(253, 186, 116, 0.96)",
    fallback: 0x92400e,
  },
};

/**
 * Creates a badge group (front face, optionally a back face) for the given text, variant and size.
 * The faces sit 1 mm in front of and behind the group origin to avoid z-fighting. Materials are transparent and do not write depth. Never throws on missing DOM support; it falls back to an untextured plane.
 */
export function createWorldResultBadge(options: WorldResultBadgeOptions): THREE.Object3D {
  const material = createWorldResultBadgeMaterial(options);
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(options.widthMeters, options.heightMeters);
  const front = new THREE.Mesh(geometry, material);
  front.name = "world-result-badge:front";
  front.position.z = 0.001;
  front.renderOrder = options.renderOrder ?? 0;
  group.add(front);

  if (options.doubleFaced ?? false) {
    const back = new THREE.Mesh(geometry.clone(), cloneBadgeMaterial(material));
    back.name = "world-result-badge:back";
    back.position.z = -0.001;
    back.rotation.y = Math.PI;
    back.renderOrder = options.renderOrder ?? 0;
    group.add(back);
  }

  group.renderOrder = options.renderOrder ?? 0;
  return group;
}

// Builds the textured material, or a flat-colored one when there is no document or no 2D context.
function createWorldResultBadgeMaterial(options: WorldResultBadgeOptions): THREE.MeshBasicMaterial {
  const colors = variantColors[options.variant];
  if (typeof document === "undefined") {
    return new THREE.MeshBasicMaterial({
      color: colors.fallback,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.MeshBasicMaterial({
      color: colors.fallback,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }

  drawBadgeCanvas(context, canvas, options, colors);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

// Draws the pill, the optional pointer and the outlined white text into the 512x160 canvas.
function drawBadgeCanvas(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  options: WorldResultBadgeOptions,
  colors: typeof variantColors[WorldResultBadgeVariant],
): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(context, 36, 28, 440, 82, 18);
  context.fillStyle = colors.fill;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = colors.stroke;
  context.stroke();

  if ((options.pointer ?? "down") === "down") {
    context.beginPath();
    context.moveTo(238, 110);
    context.lineTo(256, 134);
    context.lineTo(274, 110);
    context.closePath();
    context.fillStyle = colors.fill;
    context.fill();
    context.strokeStyle = colors.stroke;
    context.stroke();
  }

  context.font = "bold 40px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 5;
  context.strokeStyle = "rgba(2, 6, 23, 0.78)";
  context.fillStyle = "#ffffff";
  context.strokeText(options.text, canvas.width / 2, 70, 410);
  context.fillText(options.text, canvas.width / 2, 70, 410);
}

// Clones the material and its texture so the back face can be disposed independently of the front.
function cloneBadgeMaterial(material: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const clone = material.clone();
  if (material.map) {
    clone.map = material.map.clone();
    clone.map.needsUpdate = true;
  }
  return clone;
}
