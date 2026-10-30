/**
 * Head-locked debug text panel for immersive XR sessions: shows the lines of the desktop debug overlay (see `formatDebugOverlayLines`)
 * on a canvas-textured plane in the upper left of the headset view. The panel is visible exactly when XR is presenting and the debug
 * overlay is enabled, whether or not the palette is open.
 * Layout, wrapping, pose, visibility, redraw gating and input-mode description are pure functions (tested in node); only
 * `createXrDebugPanel` touches the canvas and Three.js and runs in the browser. Units: meters in the head frame, pixels on the canvas.
 */
import * as THREE from "three";
import { roundRect } from "./canvasDrawing";
import { formatDebugOverlayLines, type DebugOverlayState } from "./debugOverlay";
import type { XrHeadWorldPose } from "./carriedGeodesicCannon";

/** Panel centre in the head frame (Three axes: x right, y up, -z forward), meters. */
export const xrDebugPanelOffsetMeters = { x: -0.17, y: 0.1, z: -0.55 } as const;
/** Panel plane size in meters. */
export const xrDebugPanelSizeMeters = { width: 0.36, height: 0.18 } as const;
/** Canvas resolution in pixels. */
export const xrDebugPanelCanvasPixels = { width: 1024, height: 512 } as const;
/** Maximum number of text lines drawn. */
export const xrDebugPanelMaxLines = 14;
/** Maximum characters per drawn line. */
export const xrDebugPanelMaxLineChars = 64;
/** Minimum time between canvas redraws in milliseconds (at most 4 redraws per second). */
export const xrDebugPanelMinRedrawIntervalMs = 250;
/** Three.js `renderOrder` of the panel; above the palette (1000-1010) and the tooltip (960). */
export const xrDebugPanelRenderOrder = 1100;

const lineSeparator = " / ";

/**
 * Splits each line at " / " so no line exceeds `maxChars` (parts are packed greedily); a part without separator longer
 * than `maxChars` is cut to `maxChars`. If the result has more than `maxLines` lines, keeps `maxLines - 1` and appends "... (+K lines)".
 */
export function wrapXrDebugPanelLines(
  lines: readonly string[],
  maxChars: number = xrDebugPanelMaxLineChars,
  maxLines: number = xrDebugPanelMaxLines,
): readonly string[] {
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.length <= maxChars) {
      wrapped.push(line);
      continue;
    }

    let current: string | undefined;
    for (const rawPart of line.split(lineSeparator)) {
      const part = rawPart.length > maxChars ? rawPart.slice(0, maxChars) : rawPart;
      if (current === undefined) {
        current = part;
      } else if (current.length + lineSeparator.length + part.length <= maxChars) {
        current += lineSeparator + part;
      } else {
        wrapped.push(current);
        current = part;
      }
    }
    if (current !== undefined) {
      wrapped.push(current);
    }
  }

  if (wrapped.length <= maxLines) {
    return wrapped;
  }

  const kept = wrapped.slice(0, maxLines - 1);
  kept.push(`... (+${wrapped.length - kept.length} lines)`);
  return kept;
}

/** World pose of the panel: head.position + offset rotated by head.quaternion; quaternion = head.quaternion. */
export function resolveXrDebugPanelPose(head: XrHeadWorldPose): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const position = new THREE.Vector3(
    xrDebugPanelOffsetMeters.x,
    xrDebugPanelOffsetMeters.y,
    xrDebugPanelOffsetMeters.z,
  )
    .applyQuaternion(head.quaternion)
    .add(head.position);

  return { position, quaternion: head.quaternion.clone() };
}

/** xrActive && debugEnabled && debugOverlayEnabled. The palette's open state is deliberately not an input. */
export function isXrDebugPanelVisible(input: {
  xrActive: boolean;
  debugEnabled: boolean;
  debugOverlayEnabled: boolean;
}): boolean {
  return input.xrActive && input.debugEnabled && input.debugOverlayEnabled;
}

/**
 * Redraw gate: shouldRedraw(text, nowMs) is true iff text differs from the last drawn text and either nothing was
 * drawn yet or nowMs - lastDrawnMs >= minIntervalMs; when true it records text and nowMs.
 */
export function createXrDebugPanelRedrawGate(
  minIntervalMs: number = xrDebugPanelMinRedrawIntervalMs,
): { shouldRedraw(text: string, nowMs: number): boolean } {
  let lastText: string | undefined;
  let lastDrawnMs = 0;

  return {
    shouldRedraw(text, nowMs) {
      if (text === lastText) {
        return false;
      }
      if (lastText !== undefined && nowMs - lastDrawnMs < minIntervalMs) {
        return false;
      }
      lastText = text;
      lastDrawnMs = nowMs;
      return true;
    },
  };
}

/** "none" (no sources), "controllers", "hands" (every source has .hand), or "hybrid". */
export function describeXrInputMode(
  sources: readonly { readonly hand?: unknown }[],
): "none" | "controllers" | "hands" | "hybrid" {
  if (sources.length === 0) {
    return "none";
  }
  const handCount = sources.filter((source) => source.hand !== undefined && source.hand !== null).length;
  if (handCount === 0) {
    return "controllers";
  }
  return handCount === sources.length ? "hands" : "hybrid";
}

/** Handle to the in-headset debug panel; the creator adds `object` to the scene and must call dispose(). */
export interface XrDebugPanel {
  readonly object: THREE.Object3D;
  /** Shows or hides the panel, follows the head every call and redraws the text when it changed (rate limited). */
  update(input: { visible: boolean; state: DebugOverlayState; head: XrHeadWorldPose | undefined; nowMs: number }): void;
  /** Frees geometry, material and texture. */
  dispose(): void;
}

/**
 * Creates the hidden panel mesh `xr-debug-panel`. Throws if a 2D canvas context cannot be created (browser only).
 * The caller owns the mesh: add `object` to the scene and call dispose().
 */
export function createXrDebugPanel(): XrDebugPanel {
  const canvas = document.createElement("canvas");
  canvas.width = xrDebugPanelCanvasPixels.width;
  canvas.height = xrDebugPanelCanvasPixels.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create XR debug panel canvas context.");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(xrDebugPanelSizeMeters.width, xrDebugPanelSizeMeters.height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "xr-debug-panel";
  mesh.renderOrder = xrDebugPanelRenderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  const gate = createXrDebugPanelRedrawGate();

  function draw(lines: readonly string[]): void {
    const ctx = context as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(10, 17, 20, 0.78)";
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 24);
    ctx.fill();
    ctx.fillStyle = "#e2f3f5";
    ctx.font = "24px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, 20, 20 + index * 30);
    });
    texture.needsUpdate = true;
  }

  return {
    object: mesh,
    update({ visible, state, head, nowMs }) {
      const lines = visible && head ? wrapXrDebugPanelLines(formatDebugOverlayLines(state)) : [];
      if (!visible || !head || lines.length === 0) {
        mesh.visible = false;
        return;
      }

      const pose = resolveXrDebugPanelPose(head);
      mesh.position.copy(pose.position);
      mesh.quaternion.copy(pose.quaternion);
      mesh.visible = true;

      if (gate.shouldRedraw(lines.join("\n"), nowMs)) {
        draw(lines);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
