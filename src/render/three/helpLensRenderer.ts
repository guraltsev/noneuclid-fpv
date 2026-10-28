/**
 * Help panel ("help lens") renderer: shows the current contextual help definition either as a DOM panel (desktop) or as a floating textured plane in front of the camera (XR).
 * Exactly one presentation is active at a time; the other is hidden. The XR panel is rasterized into a 768x384 canvas texture, sized 0.96 x 0.48 m and placed relative to the camera in the Three.js frame (1.2 m ahead, 0.32 m right, 0.08 m down), and is rebuilt only when the definition changes.
 * Lifecycle: the renderer owns a DOM element and, when XR help has been shown, a scene object; dispose() must be called to release both.
 */
import * as THREE from "three";
import { publicAssetUrl } from "../../glue/assetUrls";
import type { HelpLensDefinition, HelpLensRow } from "../../ui/helpLensDefinition";
import { roundRect } from "./canvasDrawing";

/** Handle to the help panel created by {@link createHelpLensRenderer}; the creator must call dispose(). */
export interface HelpLensRenderer {
  /**
   * Shows or hides the help panel for this frame.
   * It is shown only when visible is true and a definition is given. With xrActive it uses the XR panel, positioned from camera's local position and quaternion each call (so camera should be a root-level camera, not one parented under a moved rig); otherwise the DOM panel is used. The DOM content is rebuilt on every call while visible.
   */
  update(options: {
    readonly visible: boolean;
    readonly xrActive: boolean;
    readonly definition?: HelpLensDefinition;
    readonly camera: THREE.Camera;
  }): void;
  /** Removes the DOM panel and removes and disposes any XR panel, including its texture. */
  dispose(): void;
}

/** Creates a hidden help panel: a DOM element with class help-lens appended to container, plus a lazily created XR panel added to scene. */
export function createHelpLensRenderer(container: HTMLElement, scene: THREE.Scene): HelpLensRenderer {
  const domRoot = document.createElement("div");
  domRoot.className = "help-lens";
  domRoot.hidden = true;
  container.append(domRoot);
  let xrPanel: { readonly signature: string; readonly root: THREE.Object3D } | undefined;

  return {
    update(options) {
      const visible = options.visible && options.definition !== undefined;
      if (!visible) {
        domRoot.hidden = true;
        if (xrPanel) {
          xrPanel.root.visible = false;
        }
        return;
      }

      if (options.xrActive) {
        domRoot.hidden = true;
        const panel = syncXrPanel(scene, xrPanel, options.definition);
        xrPanel = panel;
        panel.root.visible = true;
        positionXrPanel(panel.root, options.camera);
        return;
      }

      if (xrPanel) {
        xrPanel.root.visible = false;
      }
      syncDomPanel(domRoot, options.definition);
    },
    dispose() {
      domRoot.remove();
      if (xrPanel) {
        xrPanel.root.removeFromParent();
        disposeObject3D(xrPanel.root);
        xrPanel = undefined;
      }
    },
  };
}

// Rebuilds the DOM panel contents (title, body with inline key icons, hint rows) and shows it.
function syncDomPanel(root: HTMLDivElement, definition: HelpLensDefinition): void {
  root.hidden = false;
  root.replaceChildren();
  const title = document.createElement("div");
  title.className = "help-lens-title";
  title.textContent = definition.title;
  const body = document.createElement("div");
  body.className = "help-lens-body";
  appendTextWithMouseIcons(body, definition.body);
  const rows = document.createElement("div");
  rows.className = "help-lens-rows";
  for (const rowDefinition of definition.rows) {
    const row = document.createElement("div");
    row.className = "help-lens-row";
    row.append(createHintNode(rowDefinition), document.createTextNode(rowDefinition.label));
    rows.append(row);
  }
  root.append(title, body, rows);
}

// Input hint chip: icon when available (dark icons are inverted for desktop move/primary/context-menu hints), else text.
function createHintNode(row: HelpLensRow): HTMLElement {
  const hint = document.createElement("span");
  hint.className = "input-hint";
  hint.setAttribute("aria-label", row.hint.label);
  if (row.hint.iconSrc) {
    const icon = document.createElement("img");
    icon.className = "input-hint-icon";
    icon.src = row.hint.iconSrc;
    icon.alt = row.hint.label;
    if (
      row.hint.mode === "desktop" &&
      (row.hint.intent === "move" || row.hint.intent === "primary" || row.hint.intent === "context-menu")
    ) {
      icon.classList.add("input-hint-icon-inverted");
    }
    hint.append(icon);
    return hint;
  }

  hint.classList.add("input-hint-text");
  hint.textContent = row.hint.label;
  return hint;
}

// Replaces the tokens 'Arrow keys', 'Left click', 'Right click' and standalone F, B, H or Y with inline icons.
function appendTextWithMouseIcons(parent: HTMLElement, text: string): void {
  const pattern = /(Arrow keys|Left click|Right click|\b[FBHY]\b)/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (match.index > index) {
      parent.append(document.createTextNode(text.slice(index, match.index)));
    }
    parent.append(createInlineHintIcon(match[0]));
    index = match.index + match[0].length;
  }
  if (index < text.length) {
    parent.append(document.createTextNode(text.slice(index)));
  }
}

function createInlineHintIcon(label: string): HTMLImageElement {
  const icon = document.createElement("img");
  icon.className = "input-hint-icon input-hint-icon-inline input-hint-icon-inverted";
  icon.src = inlineIconSrcByLabel(label);
  icon.alt = label;
  return icon;
}

function inlineIconSrcByLabel(label: string): string {
  switch (label) {
    case "Arrow keys":
      return publicAssetUrl("icons/arrowkeys.svg");
    case "Left click":
      return publicAssetUrl("icons/mouse-button-left.svg");
    case "Right click":
      return publicAssetUrl("icons/mouse-button-right.svg");
    case "F":
      return publicAssetUrl("icons/f-alphabet.svg");
    case "B":
      return publicAssetUrl("icons/b-alphabet.svg");
    case "H":
      return publicAssetUrl("icons/h-alphabet.svg");
    case "Y":
      return publicAssetUrl("icons/y-alphabet.svg");
  }

  return "";
}

// Reuses the current panel when the definition is unchanged (compared by JSON signature); otherwise replaces and disposes it.
function syncXrPanel(
  scene: THREE.Scene,
  current: { readonly signature: string; readonly root: THREE.Object3D } | undefined,
  definition: HelpLensDefinition,
): { readonly signature: string; readonly root: THREE.Object3D } {
  const signature = JSON.stringify(definition);
  if (current?.signature === signature) {
    return current;
  }

  if (current) {
    current.root.removeFromParent();
    disposeObject3D(current.root);
  }

  const root = createXrHelpPanel(definition);
  scene.add(root);
  return { signature, root };
}

// Rasterizes title, body (up to 2 wrapped lines) and at most the first 3 hint rows into a textured plane; returns an empty object when no 2D context is available.
function createXrHelpPanel(definition: HelpLensDefinition): THREE.Object3D {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.Object3D();
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(context, 28, 28, 712, 320, 28);
  context.fillStyle = "rgba(15, 23, 42, 0.94)";
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(125, 211, 252, 0.92)";
  context.stroke();

  context.fillStyle = "#f8fafc";
  context.font = "bold 42px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(definition.title, 64, 58, 640);

  context.font = "28px sans-serif";
  wrapText(context, definition.body, 64, 124, 640, 34, 2);

  context.font = "bold 26px sans-serif";
  let rowY = 220;
  for (const row of definition.rows.slice(0, 3)) {
    context.fillText(`${row.hint.label}: ${row.label}`, 84, rowY, 600);
    rowY += 38;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.48), material);
  mesh.name = "help-lens:xr-panel";
  mesh.renderOrder = 1010;
  return mesh;
}

// Places the panel in front of the camera using the camera's local axes and copies its orientation.
function positionXrPanel(root: THREE.Object3D, camera: THREE.Camera): void {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  root.position.copy(camera.position)
    .addScaledVector(forward, 1.2)
    .addScaledVector(right, 0.32)
    .addScaledVector(up, -0.08);
  root.quaternion.copy(camera.quaternion);
  root.updateMatrixWorld(true);
}

// Greedy word wrap that stops after maxLines lines (further words are dropped).
function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(" ");
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) {
        return;
      }
    } else {
      line = testLine;
    }
  }
  if (line && lineCount < maxLines) {
    context.fillText(line, x, y + lineCount * lineHeight);
  }
}


// Local variant that also disposes texture maps (runtimeSceneUtils#disposeObject3D does not).
function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }
  if ("map" in material && material.map instanceof THREE.Texture) {
    material.map.dispose();
  }
  material.dispose();
}
