/**
 * The VR tool belt (design 017 sections 7.3 and 7.4): one scene object drawing the `toolBeltDefinition` slots as a strap of small panels on a single canvas texture, with a caption strip above it (the name of the tool in hand, or the subtitle of the slot the pointer is on).
 * Anchors: with two controllers the strap lies along the forearm of the belt-hand grip and grows to 1.8 times its size while the head looks at it; with one controller it hangs at waist height in front of the player, following the head yaw only (smoothed like the palette), tilted up toward the player.
 * The strap is pointable: `pick` intersects a ray with it and returns the slot. The placement numbers come from `interaction/xrBeltMath`; this module only applies them to Three.js objects.
 * Lifecycle: the canvas texture is built on the first visible update (a test without a DOM never builds it); the owner calls `dispose()`.
 */
import * as THREE from "three";
import type { XrLayout } from "../../glue/xrLayout";
import {
  beltSlotAtLocalPoint,
  beltSlotHeightMeters,
  beltSlotPitchMeters,
  beltStrapLengthMeters,
  resolveWaistBeltPose,
  wristBeltScale,
  type YawFollowingPose,
} from "../../interaction/xrBeltMath";
import type { ToolBeltDefinition, ToolBeltSlot } from "../../ui/toolBeltDefinition";
import { roundRect } from "./canvasDrawing";

/** Height of the caption strip above the slots, meters at scale 1. */
const captionHeightMeters = 0.05;
/** Texture pixels per meter of the strap. */
const pixelsPerMeter = 2500;
/** The strap tilts up toward the player by this angle from vertical-facing-back, radians (the waist belt only). */
const waistTiltRadians = (50 * Math.PI) / 180;
const beltRenderOrder = 1006;
/** Per call, how fast the wrist belt's scale follows its target (so a head near the 25 degree edge does not flicker). */
const scaleSmoothing = 0.25;
// The wrist strap sits behind the grip (toward the elbow) and above the back of the hand, in the grip's local axes.
const wristStrapGripOffset = new THREE.Vector3(0, 0.05, 0.16);
// Plane axes in grip axes: the strap's long side along the forearm (x toward the fingers), its normal up from the back of the hand.
const wristStrapBasis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));

/** What the belt is drawn from this frame. */
export interface XrToolBeltUpdate {
  readonly definition: ToolBeltDefinition;
  /** The controller layout; absent hides the belt. */
  readonly layout: XrLayout | undefined;
  /** The head in the scene frame; absent hides the belt. */
  readonly head: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion } | undefined;
  /** With two controllers: the belt-hand grip's pose in the scene (reference-space pose lifted by the rig matrix); absent hides the belt. */
  readonly beltGripWorldMatrix?: THREE.Matrix4;
  /** Floor height in the scene frame (default 0). */
  readonly floorY?: number;
  /** The slot the pointer is on, if any (its subtitle shows in the caption). */
  readonly hoveredSlotIndex?: number;
  /** Hides the belt without freeing it (a menu is open). */
  readonly hidden?: boolean;
}

/** A slot found by `pick`. */
export interface XrToolBeltPick {
  readonly index: number;
  readonly slot: ToolBeltSlot;
}

/** The VR belt handle. */
export interface XrToolBelt {
  /** Positions the belt for this frame and redraws it when the slots or the hover changed. */
  update(frame: XrToolBeltUpdate): void;
  /** The slot a ray hits, or undefined (also while the belt is hidden). The ray is in the scene frame. */
  pick(ray: { readonly origin: THREE.Vector3; readonly direction: THREE.Vector3 }): XrToolBeltPick | undefined;
  /** Where the belt is now (scene frame); undefined while hidden. The wrist belt's toasts and the aim test read it. */
  position(): THREE.Vector3 | undefined;
  /** True while the belt is drawn. */
  isVisible(): boolean;
  /** Removes the belt from the scene and frees its texture, material and geometry. */
  dispose(): void;
}

/** The text of the caption strip: the hovered slot's name and subtitle (or why it cannot be taken), else the name of the tool in hand. */
export function beltCaptionText(definition: ToolBeltDefinition, hoveredSlotIndex: number | undefined): string {
  const hovered = hoveredSlotIndex === undefined ? undefined : definition.slots[hoveredSlotIndex];
  if (hovered !== undefined) return `${hovered.name}: ${hovered.disabledReason ?? hovered.subtitle}`;
  return definition.slots.find((slot) => slot.active)?.name ?? "";
}

/** A string that changes exactly when the drawing would. */
export function beltDrawingSignature(definition: ToolBeltDefinition, hoveredSlotIndex: number | undefined): string {
  const slots = definition.slots.map((slot) => `${slot.key}|${slot.name}|${slot.enabled ? 1 : 0}|${slot.active ? 1 : 0}`).join(";");
  return `${slots}#${hoveredSlotIndex ?? -1}#${beltCaptionText(definition, hoveredSlotIndex)}`;
}

/** Creates the belt (hidden) in `scene`. */
export function createXrToolBelt(scene: THREE.Scene): XrToolBelt {
  const root = new THREE.Group();
  root.name = "xr-tool-belt";
  root.visible = false;
  scene.add(root);

  let canvas: HTMLCanvasElement | undefined;
  let texture: THREE.CanvasTexture | undefined;
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
  let slotCount = 0;
  let signature = "";
  let currentDefinition: ToolBeltDefinition | undefined;
  let waistPose: YawFollowingPose | undefined;
  let currentScale = 1;
  const raycaster = new THREE.Raycaster();
  const scratchPosition = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchMatrix = new THREE.Matrix4();
  const scratchForward = new THREE.Vector3();

  function ensureMesh(count: number): void {
    if (mesh !== undefined && slotCount === count) return;
    disposeMesh();
    slotCount = count;
    const width = beltStrapLengthMeters(count);
    const height = beltSlotHeightMeters + captionHeightMeters;
    canvas = document.createElement("canvas");
    canvas.width = Math.round(width * pixelsPerMeter);
    canvas.height = Math.round(height * pixelsPerMeter);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = "xr-tool-belt:strap";
    mesh.renderOrder = beltRenderOrder;
    mesh.frustumCulled = false;
    // The slots are centered on the group's origin; the caption strip stands above them.
    mesh.position.y = captionHeightMeters / 2;
    root.add(mesh);
    signature = "";
  }

  function disposeMesh(): void {
    if (mesh !== undefined) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh = undefined;
    }
    texture?.dispose();
    texture = undefined;
    canvas = undefined;
  }

  function redraw(definition: ToolBeltDefinition, hoveredSlotIndex: number | undefined): void {
    if (canvas === undefined || texture === undefined) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const pitch = beltSlotPitchMeters * pixelsPerMeter;
    const captionPixels = captionHeightMeters * pixelsPerMeter;
    const strapTop = captionPixels;
    const strapHeight = canvas.height - captionPixels;
    // Caption strip.
    const caption = beltCaptionText(definition, hoveredSlotIndex);
    if (caption.length > 0) {
      context.fillStyle = "rgba(15, 23, 42, 0.9)";
      roundRect(context, 4, 4, canvas.width - 8, captionPixels - 10, 22);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "600 40px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(caption, canvas.width / 2, captionPixels / 2 - 2, canvas.width - 40);
    }
    definition.slots.forEach((slot, index) => {
      const x = index * pitch;
      const raised = slot.active ? 10 : 0;
      context.fillStyle = slot.active ? "rgba(250, 204, 21, 0.96)" : index === hoveredSlotIndex ? "rgba(71, 85, 105, 0.96)" : "rgba(15, 23, 42, 0.9)";
      roundRect(context, x + 6, strapTop + 6 - raised, pitch - 12, strapHeight - 12, 22);
      context.fill();
      context.strokeStyle = slot.active ? "#ffffff" : "rgba(226, 232, 240, 0.6)";
      context.lineWidth = slot.active ? 6 : 3;
      context.stroke();
      context.globalAlpha = slot.enabled ? 1 : 0.4;
      context.fillStyle = slot.active ? "#0f172a" : "#f8fafc";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 54px system-ui, sans-serif";
      context.fillText(slot.key === "Esc" ? "☰" : slot.key, x + pitch / 2, strapTop + strapHeight * 0.36 - raised);
      context.font = "600 26px system-ui, sans-serif";
      context.fillText(slot.name, x + pitch / 2, strapTop + strapHeight * 0.72 - raised, pitch - 20);
      context.globalAlpha = 1;
    });
    texture.needsUpdate = true;
  }

  function hide(): void {
    root.visible = false;
  }

  return {
    update(frame) {
      const count = frame.definition.slots.length;
      if (frame.hidden === true || frame.layout === undefined || frame.head === undefined || count === 0) return hide();
      currentDefinition = frame.definition;
      scratchForward.set(0, 0, -1).applyQuaternion(frame.head.quaternion);
      if (frame.layout === "two-controllers") {
        if (frame.beltGripWorldMatrix === undefined) return hide();
        waistPose = undefined;
        scratchMatrix.copy(frame.beltGripWorldMatrix).multiply(new THREE.Matrix4().makeTranslation(wristStrapGripOffset.x, wristStrapGripOffset.y, wristStrapGripOffset.z)).multiply(wristStrapBasis);
        scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
        root.position.copy(scratchPosition);
        root.quaternion.copy(scratchQuaternion);
        const targetScale = wristBeltScale(scratchForward, frame.head.position, scratchPosition);
        currentScale += (targetScale - currentScale) * scaleSmoothing;
      } else {
        waistPose = resolveWaistBeltPose({ headPosition: frame.head.position, headForward: scratchForward, floorY: frame.floorY ?? 0, previous: waistPose });
        root.position.set(waistPose.position.x, waistPose.position.y, waistPose.position.z);
        // Face the player: yaw about +y, then tilt the plane normal up and back.
        scratchQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), waistPose.yawRadians);
        root.quaternion.copy(scratchQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -waistTiltRadians));
        currentScale = 1;
      }
      root.scale.setScalar(currentScale);
      ensureMesh(count);
      const nextSignature = beltDrawingSignature(frame.definition, frame.hoveredSlotIndex);
      if (nextSignature !== signature) {
        signature = nextSignature;
        redraw(frame.definition, frame.hoveredSlotIndex);
      }
      root.visible = true;
      root.updateMatrixWorld(true);
    },
    pick(ray) {
      if (!root.visible || mesh === undefined || currentDefinition === undefined) return undefined;
      raycaster.set(ray.origin, ray.direction);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (hit === undefined) return undefined;
      const local = root.worldToLocal(hit.point.clone());
      const index = beltSlotAtLocalPoint(local.x, local.y, currentDefinition.slots.length);
      const slot = index === undefined ? undefined : currentDefinition.slots[index];
      return index === undefined || slot === undefined ? undefined : { index, slot };
    },
    position() {
      return root.visible ? root.position.clone() : undefined;
    },
    isVisible() {
      return root.visible;
    },
    dispose() {
      disposeMesh();
      root.removeFromParent();
    },
  };
}
