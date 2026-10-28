/**
 * Renderer for player-placed text signs ("flags"): a glTF sign model with the user's message drawn on both faces.
 *
 * Each flag is a Three.js group posed by the flag's cell-local rigid transform (world axes: x right, y forward,
 * z up, meters; converted to the Three.js frame by `applyWorldRigidTransform`) and parented under the root node of the
 * cell it lives in. The message is rasterised into a shared 512x256 canvas texture that is mapped onto two
 * transparent planes (front and back) laid over the sign board; the board rectangle is found by scanning the model's
 * meshes for the most board-like bounding box, with per-sign-type calibration constants. Invariants: the flag id and
 * flag type of a runtime never change. Disposal frees the canvas texture and also disposes every geometry and material under
 * the root, including those of the cloned sign model, which are shared with the preloaded glTF (so they are re-uploaded lazily if used again).
 */
import * as THREE from "three";
import type { PlacedFlagObject } from "../../world-objects/placedFlags";
import { placedFlagAssetPaths } from "../../world-objects/placedFlags";
import type { PreparedWorldAssets } from "./preloadWorldAssets";
import { applyWorldRigidTransform } from "./worldAxes";

/** Lifecycle handle for one placed sign in the scene. */
export interface PlacedFlagRuntime {
  /** Sign group; stays the same object for the runtime's lifetime and is re-parented by {@link PlacedFlagRuntime.syncParent}. */
  readonly root: THREE.Object3D;
  /** Id of the cell whose local frame the sign pose is expressed in (tracks the latest synced flag). */
  readonly cellId: string;
  readonly flagId: string;
  /** Applies the flag's pose and, if changed, redraws its text; throws if the flag id or sign type differs from this runtime's. */
  syncFromObject(flag: PlacedFlagObject): void;
  /** Attaches `root` under `cellRoots.get(cellId)`; does nothing if that cell has no root or the sign is already there. */
  syncParent(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
  /** Detaches the sign and releases its geometries, materials and text texture. */
  dispose(): void;
}

// Mutable state of one rendered sign; message/fontColor cache what is currently painted on the canvas.
interface RenderedFlag {
  readonly root: THREE.Group;
  readonly textTexture: THREE.CanvasTexture;
  cellId: string;
  flagType: PlacedFlagObject["flagType"];
  message: string;
  fontColor: string;
}

// Text-plane placement in the sign model's local (Three.js) frame, meters; front/back Z are the two face depths.
interface FlagTextLayout {
  readonly centerX: number;
  readonly centerY: number;
  readonly frontZ: number;
  readonly backZ: number;
  readonly width: number;
  readonly height: number;
}

// Per-sign-type tuning: xScale/yScale are fractions of the board box width/height giving the text area size; xOffset/yOffset shift its centre by fractions of that width/height; zOffset is in meters.
interface WritableAreaCalibration {
  readonly xScale: number;
  readonly yScale: number;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly zOffset: number;
}

// Uniform scale applied to the sign glTF.
const SIGN_MODEL_SCALE = 0.75;
// Canvas pixels: line height tried first, shrunk in steps of 1 px down to 12 px until the wrapped text fits.
const MAX_TEXT_LINE_HEIGHT = 96;
// Font size = floor(line height * this ratio).
const TEXT_LINE_HEIGHT_TO_FONT_SIZE = 0.82;
// Hand-tuned per sign model: where the writable area sits on the board's bounding box.
const writableAreaCalibrations: Record<PlacedFlagObject["flagType"], WritableAreaCalibration> = {
  WoodenSign1: {
    xScale: 0.53,
    yScale: 0.405,
    xOffset: -0.01,
    yOffset: 0.105,
    zOffset: 0.00,
  },
  WoodenSign2: {
    xScale: 0.55,
    yScale: 0.3,
    xOffset: -0.13,
    yOffset: 0.15,
    zOffset: 0.00,
  },
};
// Used when no board-like mesh is found in the sign model (meters, sign local frame).
const FALLBACK_TEXT_LAYOUT: FlagTextLayout = {
  centerX: 0,
  centerY: 1,
  frontZ: -0.08,
  backZ: 0.08,
  width: 0.8,
  height: 0.4,
};

/**
 * Creates the render runtime for `flag`, instantiating its sign model from `assets`.
 *
 * Throws if the sign glTF for `flag.flagType` was not preloaded. The returned `root` is detached;
 * call `syncParent` to attach it. Allocates a canvas and texture per flag, which `dispose` releases.
 */
export function createPlacedFlagRuntime(flag: PlacedFlagObject, assets: PreparedWorldAssets): PlacedFlagRuntime {
  const rendered = createRenderedFlag(flag, assets);

  return {
    root: rendered.root,
    flagId: flag.id,
    get cellId() {
      return rendered.cellId;
    },
    syncFromObject(nextFlag) {
      if (nextFlag.id !== flag.id) {
        throw new Error(`Cannot sync placed flag runtime "${flag.id}" from "${nextFlag.id}".`);
      }

      syncRenderedFlag(nextFlag, rendered);
    },
    syncParent(cellRoots) {
      const parent = cellRoots.get(rendered.cellId);
      if (parent && rendered.root.parent !== parent) {
        parent.add(rendered.root);
      }
    },
    dispose() {
      rendered.root.removeFromParent();
      disposeRenderedFlag(rendered);
    },
  };
}

function createRenderedFlag(flag: PlacedFlagObject, assets: PreparedWorldAssets): RenderedFlag {
  const root = new THREE.Group();
  root.name = `placed-flag:${flag.id}`;

  const prepared = assets.instantiateGltf(placedFlagAssetPaths[flag.flagType]);
  if (!prepared) {
    throw new Error(`Placed flag asset was not preloaded: ${placedFlagAssetPaths[flag.flagType]}`);
  }

  prepared.scene.name = `asset:${flag.id}`;
  prepared.scene.scale.setScalar(SIGN_MODEL_SCALE);
  // Half-turn so the model's authored front faces the intended direction in the flag's local frame.
  prepared.scene.rotation.y = Math.PI;
  root.add(prepared.scene);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const textTexture = new THREE.CanvasTexture(canvas);
  textTexture.colorSpace = THREE.SRGBColorSpace;
  textTexture.name = `placed-flag-text:${flag.id}`;
  const textLayout = resolveFlagTextLayout(prepared.scene, flag.flagType);
  root.add(
    // Front plane is turned by pi to read correctly from the front; the back plane shares the same texture.
    createSignTextPlane(flag.id, "front", textTexture, textLayout, textLayout.frontZ, Math.PI),
    createSignTextPlane(flag.id, "back", textTexture, textLayout, textLayout.backZ, 0),
  );

  const rendered: RenderedFlag = {
    root,
    textTexture,
    cellId: flag.cellId,
    flagType: flag.flagType,
    message: "",
    fontColor: "",
  };
  redrawText(rendered, flag);
  syncRenderedFlag(flag, rendered);
  return rendered;
}

function syncRenderedFlag(flag: PlacedFlagObject, rendered: RenderedFlag): void {
  if (rendered.flagType !== flag.flagType) {
    throw new Error(`Cannot change placed flag runtime type from "${rendered.flagType}" to "${flag.flagType}".`);
  }

  rendered.cellId = flag.cellId;
  applyWorldRigidTransform(rendered.root, flag.localPose);
  if (rendered.message !== flag.message || rendered.fontColor !== flag.fontColor) {
    redrawText(rendered, flag);
  }
}

function redrawText(rendered: RenderedFlag, flag: PlacedFlagObject): void {
  const canvas = rendered.textTexture.image as HTMLCanvasElement;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  // Text is centred; lines are stacked as a block centred vertically on the canvas.
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = flag.fontColor;

  const layout = fitTextToCanvas(context, flag.message, canvas.width, canvas.height);
  context.font = `bold ${layout.fontSize}px sans-serif`;
  const blockHeight = layout.lines.length * layout.lineHeight;
  const firstLineY = canvas.height / 2 - blockHeight / 2 + layout.lineHeight / 2;

  for (let index = 0; index < layout.lines.length; index += 1) {
    context.fillText(layout.lines[index], canvas.width / 2, firstLineY + index * layout.lineHeight, canvas.width);
  }

  rendered.message = flag.message;
  rendered.fontColor = flag.fontColor;
  rendered.flagType = flag.flagType;
  rendered.textTexture.needsUpdate = true;
}

// Picks the largest font whose character-wrapped lines fit within `maxWidth` x `maxHeight` (canvas pixels).
function fitTextToCanvas(
  context: CanvasRenderingContext2D,
  message: string,
  maxWidth: number,
  maxHeight: number,
): { readonly lines: readonly string[]; readonly lineHeight: number; readonly fontSize: number } {
  const text = message;
  if (text.length === 0) {
    return {
      lines: [""],
      lineHeight: MAX_TEXT_LINE_HEIGHT,
      fontSize: Math.floor(MAX_TEXT_LINE_HEIGHT * TEXT_LINE_HEIGHT_TO_FONT_SIZE),
    };
  }

  // Choose the largest line height whose wrapped text fits the canvas height.
  for (let lineHeight = MAX_TEXT_LINE_HEIGHT; lineHeight >= 12; lineHeight -= 1) {
    const fontSize = Math.floor(lineHeight * TEXT_LINE_HEIGHT_TO_FONT_SIZE);
    context.font = `bold ${fontSize}px sans-serif`;
    const lines = wrapTextToWidth(context, text, maxWidth);
    if (lines.length * lineHeight <= maxHeight) {
      return { lines, lineHeight, fontSize };
    }
  }

  // Nothing fit even at the minimum size; fall back to the minimum and let the text overflow.
  const lineHeight = 12;
  const fontSize = Math.floor(lineHeight * TEXT_LINE_HEIGHT_TO_FONT_SIZE);
  context.font = `bold ${fontSize}px sans-serif`;
  return {
    lines: wrapTextToWidth(context, text, maxWidth),
    lineHeight,
    fontSize,
  };
}

// Greedy per-character wrapping (no word boundaries); explicit newlines are honoured and empty lines kept.
function wrapTextToWidth(context: CanvasRenderingContext2D, text: string, maxWidth: number): readonly string[] {
  const lines: string[] = [];

  for (const explicitLine of text.split("\n")) {
    let line = "";
    for (const character of explicitLine) {
      const candidate = `${line}${character}`;
      if (line && measureTextWidth(context, candidate) > maxWidth) {
        lines.push(line);
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }

    if (line || explicitLine.length === 0) {
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines : [""];
}

function measureTextWidth(context: CanvasRenderingContext2D, text: string): number {
  const measurement = context.measureText?.(text);
  // Fallback estimate (16 px per character) for canvas implementations without measureText.
  return measurement?.width ?? text.length * 16;
}

function disposeRenderedFlag(rendered: RenderedFlag): void {
  rendered.root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    }
  });
  rendered.textTexture.dispose();
}

function createSignTextPlane(
  flagId: string,
  side: "front" | "back",
  texture: THREE.CanvasTexture,
  layout: FlagTextLayout,
  zOffset: number,
  rotationY: number,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    // Pull the text towards the camera in depth to avoid z-fighting with the sign board.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(layout.width, layout.height), material);
  plane.name = `placed-flag-text-plane:${flagId}:${side}`;
  plane.position.set(layout.centerX, layout.centerY, zOffset);
  plane.rotation.y = rotationY;
  plane.renderOrder = 20;
  return plane;
}

function resolveFlagTextLayout(scene: THREE.Object3D, flagType: PlacedFlagObject["flagType"]): FlagTextLayout {
  // World matrices are needed so Box3.setFromObject measures the scaled/rotated model.
  scene.updateMatrixWorld(true);
  const boardBox = findReadableBoardBox(scene);

  if (!boardBox) {
    return FALLBACK_TEXT_LAYOUT;
  }

  const center = boardBox.getCenter(new THREE.Vector3());
  const size = boardBox.getSize(new THREE.Vector3());
  // Front face lies at -z of the board box and back face at +z; calibration.zOffset pushes the planes outward.
  const halfDepth = size.z / 2;
  const calibration = writableAreaCalibrations[flagType];

  return {
    centerX: center.x + size.x * calibration.xOffset,
    centerY: center.y + size.y * calibration.yOffset,
    frontZ: center.z - halfDepth - calibration.zOffset,
    backZ: center.z + halfDepth + calibration.zOffset,
    width: Math.max(size.x * calibration.xScale, 0.2),
    height: Math.max(size.y * calibration.yScale, 0.16),
  };
}

// Heuristic: among meshes that are wide, tall and thin (depth < 40% of the larger face dimension),
// pick the one maximising area * squareness * flatness, i.e. the large flat board rather than the post.
function findReadableBoardBox(scene: THREE.Object3D): THREE.Box3 | undefined {
  let best: { readonly box: THREE.Box3; readonly score: number } | undefined;

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) {
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    if (size.x < 0.35 || size.y < 0.22 || size.z > Math.max(size.x, size.y) * 0.4) {
      return;
    }

    const area = size.x * size.y;
    const squareness = Math.min(size.x, size.y) / Math.max(size.x, size.y);
    const flatness = Math.max(size.x, size.y) / Math.max(size.z, 0.01);
    const score = area * squareness * flatness;

    if (!best || score > best.score) {
      best = { box, score };
    }
  });

  return best?.box;
}
