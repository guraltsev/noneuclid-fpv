/**
 * The VR start card (design 017 section 8.1): a panel in front of the player at session start that shows the controllers of the current layout with the verb on each button (`vrStartCardDefinition`), until the trigger dismisses it.
 * One canvas texture on a plane, redrawn only when the definition's lines change; it stands 1.2 m ahead along the head yaw, a little below eye level, and faces the player (smoothed like the palette).
 * Lifecycle: the canvas is built on the first visible update (a test without a DOM never builds it); the owner calls `dispose()`.
 */
import * as THREE from "three";
import { followHeadYaw, type YawFollowingPose } from "../../interaction/xrBeltMath";
import { vrStartCardLines, type VrStartCardDefinition } from "../../ui/vrStartCardDefinition";
import { roundRect } from "./canvasDrawing";

const cardWidthMeters = 0.9;
const cardForwardMeters = 1.2;
const cardDropMeters = 0.1;
const cardRenderOrder = 1007;
const canvasWidth = 900;
const lineHeight = 52;
const padding = 40;

/** What the card is drawn from this frame. */
export interface XrStartCardUpdate {
  /** The card to show; absent hides it. */
  readonly definition: VrStartCardDefinition | undefined;
  readonly head: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion } | undefined;
}

/** The start card handle. */
export interface XrStartCard {
  update(frame: XrStartCardUpdate): void;
  isVisible(): boolean;
  /** Removes the card from the scene and frees its texture, material and geometry. */
  dispose(): void;
}

/** Creates the card (hidden) in `scene`. */
export function createXrStartCard(scene: THREE.Scene): XrStartCard {
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let texture: THREE.CanvasTexture | undefined;
  let key = "";
  let pose: YawFollowingPose | undefined;
  const scratchForward = new THREE.Vector3();
  const yawAxis = new THREE.Vector3(0, 1, 0);

  function draw(definition: VrStartCardDefinition): void {
    const lines = vrStartCardLines(definition);
    const height = padding * 2 + lines.length * lineHeight;
    if (mesh === undefined) {
      canvas = document.createElement("canvas");
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.name = "xr-start-card";
      mesh.renderOrder = cardRenderOrder;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    if (canvas === undefined || texture === undefined) return;
    canvas.width = canvasWidth;
    canvas.height = height;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(cardWidthMeters, (cardWidthMeters * height) / canvasWidth);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, canvasWidth, height);
    context.fillStyle = "rgba(15, 23, 42, 0.93)";
    roundRect(context, 4, 4, canvasWidth - 8, height - 8, 32);
    context.fill();
    context.strokeStyle = "rgba(226, 232, 240, 0.7)";
    context.lineWidth = 4;
    context.stroke();
    context.textBaseline = "middle";
    context.textAlign = "left";
    let y = padding + lineHeight / 2;
    const headings = new Set(definition.sections.map((section) => section.heading));
    lines.forEach((line, index) => {
      const isTitle = index === 0;
      const isHeading = headings.has(line);
      const isDismiss = index === lines.length - 1;
      context.fillStyle = isTitle || isHeading ? "#facc15" : isDismiss ? "#93c5fd" : "#f8fafc";
      context.font = `${isTitle ? "700 40px" : isHeading ? "700 32px" : "600 32px"} system-ui, sans-serif`;
      context.textAlign = isTitle || isDismiss ? "center" : "left";
      context.fillText(line, isTitle || isDismiss ? canvasWidth / 2 : padding + (isHeading ? 0 : 24), y, canvasWidth - padding * 2);
      y += lineHeight;
    });
    texture.needsUpdate = true;
  }

  return {
    update(frame) {
      if (frame.definition === undefined || frame.head === undefined) {
        if (mesh !== undefined) mesh.visible = false;
        pose = undefined;
        return;
      }
      const nextKey = vrStartCardLines(frame.definition).join("\n");
      if (nextKey !== key || mesh === undefined) {
        key = nextKey;
        draw(frame.definition);
      }
      if (mesh === undefined) return;
      scratchForward.set(0, 0, -1).applyQuaternion(frame.head.quaternion);
      pose = followHeadYaw(frame.head.position, scratchForward, cardForwardMeters, frame.head.position.y - cardDropMeters, pose, undefined);
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      // The plane faces +z; yawing it by the head yaw turns its front toward the player.
      mesh.quaternion.setFromAxisAngle(yawAxis, pose.yawRadians);
      mesh.visible = true;
      mesh.updateMatrixWorld(true);
    },
    isVisible() {
      return mesh?.visible === true;
    },
    dispose() {
      if (mesh !== undefined) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh = undefined;
      }
      texture?.dispose();
      texture = undefined;
      canvas = undefined;
    },
  };
}
