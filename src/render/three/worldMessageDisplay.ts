/**
 * On-screen messages: the world's and the tools' sentences (a refused action, a notice) shown briefly in front of the player, so an action that does nothing says why.
 * One message shows at a time, as a textured plane placed relative to the camera every frame (1.5 m ahead, 0.35 m below the line of sight), so it reads the same on desktop and in VR. It stays for `durationMs`, then fades out; a new message replaces the old one at once.
 * The text is wrapped onto at most two lines of a 1024x200 canvas. Without a DOM (tests) nothing is drawn and show() only records the text.
 * Lifecycle: the display owns one scene object, its geometry, material and texture; dispose() must be called to release them.
 */
import * as THREE from "three";
import { roundRect } from "./canvasDrawing";

/** Handle to the message display created by {@link createWorldMessageDisplay}. */
export interface WorldMessageDisplay {
  /** Shows `message` now, replacing any message on screen. */
  show(message: string): void;
  /** Places the message in front of `camera` and fades it; call once per frame. `nowMs` is a monotonic time in milliseconds. */
  update(camera: THREE.Camera, nowMs: number): void;
  /** The message on screen, or undefined; for tests and diagnostics. */
  currentMessage(): string | undefined;
  /** Removes the scene object and frees its resources. */
  dispose(): void;
}

/** Tuning of {@link createWorldMessageDisplay}. */
export interface WorldMessageDisplayOptions {
  /** How long a message stays fully visible, in milliseconds; default 3500. */
  readonly durationMs?: number;
  /** How long it takes to fade out afterwards, in milliseconds; default 500. */
  readonly fadeMs?: number;
  /** Clock for show(); defaults to performance.now. Must match the clock passed to update(). */
  readonly now?: () => number;
}

const canvasWidth = 1024;
const canvasHeight = 200;
const planeWidthMeters = 1.0;
const planeHeightMeters = (planeWidthMeters * canvasHeight) / canvasWidth;
const distanceMeters = 1.5;
const dropMeters = 0.35;
const fontSize = 44;

/** Creates the display and adds its (hidden) plane to `scene`. */
export function createWorldMessageDisplay(scene: THREE.Scene, options: WorldMessageDisplayOptions = {}): WorldMessageDisplay {
  const durationMs = options.durationMs ?? 3500;
  const fadeMs = options.fadeMs ?? 500;
  const now = options.now ?? (() => performance.now());
  const canvas = typeof document === "undefined" ? undefined : document.createElement("canvas");
  const context = canvas?.getContext("2d") ?? undefined;
  if (canvas) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }
  const texture = canvas ? new THREE.CanvasTexture(canvas) : undefined;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture ?? null,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeWidthMeters, planeHeightMeters), material);
  mesh.name = "world-message";
  mesh.renderOrder = 1100;
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let message: string | undefined;
  let shownAtMs = 0;

  return {
    show(text) {
      message = text;
      shownAtMs = now();
      if (context && canvas && texture) {
        drawMessage(context, text);
        texture.needsUpdate = true;
      }
    },
    update(camera, nowMs) {
      const elapsed = nowMs - shownAtMs;
      if (message === undefined || elapsed > durationMs + fadeMs) {
        message = undefined;
        mesh.visible = false;
        return;
      }
      material.opacity = elapsed <= durationMs ? 1 : 1 - (elapsed - durationMs) / fadeMs;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      mesh.position.copy(camera.position).addScaledVector(forward, distanceMeters).addScaledVector(up, -dropMeters);
      mesh.quaternion.copy(camera.quaternion);
      mesh.visible = true;
    },
    currentMessage() {
      return message;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture?.dispose();
    },
  };
}

// Draws the rounded panel and the text, wrapped onto at most two lines (the second ends with an ellipsis if cut).
function drawMessage(context: CanvasRenderingContext2D, text: string): void {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  roundRect(context, 8, 8, canvasWidth - 16, canvasHeight - 16, 28);
  context.fillStyle = "rgba(15, 23, 42, 0.92)";
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(253, 186, 116, 0.95)";
  context.stroke();

  context.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  context.fillStyle = "#f8fafc";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = wrapText(context, text, canvasWidth - 80, 2);
  const lineHeight = fontSize * 1.25;
  const top = canvasHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, canvasWidth / 2, top + index * lineHeight));
}

// Greedy word wrap; the last allowed line is shortened with an ellipsis when text is left over.
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}
