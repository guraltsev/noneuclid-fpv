/**
 * Cosmetic low-poly hand models that follow XR controllers (or tracked hands), plus a small icon sprite near the right wrist showing the selected tool.
 * Poses come from the WebXR frame in the reference space and are placed with `referenceSpaceToWorldMatrix` (the XR player rig's `root.matrixWorld`),
 * so everything lives in the Three.js frame (meters, y up, -z forward), not in cell-local game axes.
 * The hand mesh is loaded asynchronously from a GLB; if loading fails the app continues without hands. All models are added to the scene given at creation
 * and must be released with `dispose()`.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { publicAssetUrl } from "../../glue/assetUrls";
import type { RuntimeToolId } from "../../runtime/runtimeMenuState";
import type { PlacedFlagType } from "../../world-objects/placedFlags";
import { xrRigidTransformLocalMatrix } from "./xrPlayerRig";

/**
 * Per-frame inputs for `XrControllerHandModels.update` (createThreeApp#shell fills these during the XR frame).
 */
export interface XrControllerHandModelsUpdate {
  /** Current session input sources; only those with handedness "left" or "right" are shown. */
  readonly inputSources: readonly XRInputSource[];
  /** The XR frame used to query poses. */
  readonly xrFrame: XRFrame;
  /** Reference space in which poses are requested (the shell's current XR reference space). */
  readonly referenceSpace: XRReferenceSpace;
  /** Transform from reference-space coordinates to Three.js world (the shell passes `xrRig.root.matrixWorld`; read each call, not copied). */
  readonly referenceSpaceToWorldMatrix: THREE.Matrix4;
  /** Tool shown by the right wrist indicator; defaults to "none" (indicator hidden). */
  readonly selectedTool?: RuntimeToolId;
  /** Sign variant shown when the tool is "place-flag"; defaults to "WoodenSign1". */
  readonly placeFlagType?: PlacedFlagType;
}

/**
 * Controller hand model manager returned by `createXrControllerHandModels`.
 */
export interface XrControllerHandModels {
  /** Poses and shows a hand for each visible left/right source, hiding the others; call every XR frame. */
  update(frame: XrControllerHandModelsUpdate): void;
  /** Hides all hands and the wrist indicator without freeing anything; call when an XR session ends. */
  reset(): void;
  /** Removes hands and indicator from the scene and frees their geometry, materials, textures; any in-flight model load is discarded. The owner must call it. */
  dispose(): void;
}

const lowPolyHandsAssetPath = "lowpolyhands/Lowpolyhands.glb";
// Uniform template scale and fixed rotation constants that map the GLB hand axes onto the grip/wrist frame.
const handScale = 0.42;
const baseHandMeshRotation = new THREE.Euler(THREE.MathUtils.degToRad(110), 0, Math.PI);
const handLocalLengthAxis = new THREE.Vector3(0, 1, 0);
const handLocalForwardBendAxis = new THREE.Vector3(1, 0, 0);
const handMeshQuaternion = createHandMeshQuaternion();
const handSideSplitEpsilon = 1e-5;
// Indicator placement relative to the right hand (meters, in the hand's local axes) and sprite size in meters.
const wristToolIndicatorLocalOffset = new THREE.Vector3(0, 0.18, -0.06);
const wristToolIndicatorScaleMeters = 0.082;
const wristToolIndicatorRenderOrder = 1004;
const wristToolIndicatorCarryIconSource = publicAssetUrl("icons/carry.svg");

type XrFrameWithJointPose = XRFrame & {
  getJointPose?(jointSpace: XRSpace, baseSpace: XRReferenceSpace): Pick<XRPose, "transform"> | undefined;
};

type XrHandLike = {
  get?(jointName: string): XRSpace | undefined;
};

/**
 * Creates hidden left/right hand anchors and the wrist indicator sprite in `scene` and starts loading the hand GLB.
 * Hand models appear once loading completes; a load failure is silently ignored. Lifecycle: the caller must call `dispose()`.
 */
export function createXrControllerHandModels(scene: THREE.Scene): XrControllerHandModels {
  const loader = new GLTFLoader();
  const instances = new Map<"left" | "right", THREE.Object3D>();
  const rightToolIndicator = createWristToolIndicator();
  for (const handedness of ["left", "right"] as const) {
    const anchor = new THREE.Group();
    anchor.name = `xr-controller-${handedness}-hand`;
    anchor.visible = false;
    scene.add(anchor);
    instances.set(handedness, anchor);
  }
  scene.add(rightToolIndicator.root);
  let templates: HandModelTemplates | undefined;
  let disposed = false;

  void loader.loadAsync(publicAssetUrl(lowPolyHandsAssetPath)).then((gltf) => {
    if (disposed) {
      disposeObject3D(gltf.scene);
      return;
    }

    templates = createHandModelTemplates(gltf.scene);
    for (const handedness of ["left", "right"] as const) {
      const model = cloneSkeleton(templates[handedness]);
      model.name = `xr-controller-${handedness}-hand-model`;
      instances.get(handedness)?.add(model);
    }
  }, () => {
    // The app should remain usable even if this optional cosmetic model fails.
  });

  return {
    update(frame) {
      const seenHands = new Set<"left" | "right">();

      const selectedTool = frame.selectedTool ?? "none";
      const placeFlagType = frame.placeFlagType ?? "WoodenSign1";

      for (const source of frame.inputSources) {
        const handedness = source.handedness === "left" || source.handedness === "right" ? source.handedness : undefined;
        if (!handedness) {
          continue;
        }

        // Pose priority: tracked-hand wrist joint, then controller grip, then target ray. Scale is 1 because templates carry the scale.
        const pose = getInputSourcePose(source, frame.xrFrame, frame.referenceSpace);
        const model = instances.get(handedness);
        if (!pose || !model) {
          continue;
        }

        seenHands.add(handedness);
        applyXrPoseToObject(model, pose.transform, frame.referenceSpaceToWorldMatrix, 1);
        model.visible = true;
        if (handedness === "right") {
          updateWristToolIndicator(rightToolIndicator, model, selectedTool, placeFlagType);
        }
      }

      for (const [handedness, model] of instances) {
        if (!seenHands.has(handedness)) {
          model.visible = false;
        }
      }
      if (!seenHands.has("right")) {
        rightToolIndicator.root.visible = false;
      }
    },
    reset() {
      hideInstances(instances);
      rightToolIndicator.root.visible = false;
    },
    dispose() {
      disposed = true;
      rightToolIndicator.root.removeFromParent();
      disposeWristToolIndicator(rightToolIndicator);
      for (const model of instances.values()) {
        model.removeFromParent();
        disposeObject3D(model);
      }
      instances.clear();
      if (templates) {
        disposeObject3D(templates.left);
        disposeObject3D(templates.right);
      }
    },
  };
}

/**
 * Icon description for the wrist tool indicator.
 */
export interface WristToolIndicatorVisual {
  /** Drawing style; every current tool uses "image". */
  readonly icon: "aim" | "image";
  /** Public asset URL of the icon when `icon` is "image". */
  readonly imageSource?: string;
  /** CSS color for the indicator's accent. */
  readonly color: string;
  /** Human-readable tool name. */
  readonly label: string;
}

const wristToolIndicatorSignIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};
const wristToolIndicatorRotateIconSource = publicAssetUrl("icons/arrow-circle-inverted.png");
const wristToolIndicatorAimIconSource = publicAssetUrl("icons/aim-inverted.png");
const wristToolIndicatorRayIconSource = publicAssetUrl("flashlight/Lightsaber.png");
const wristToolIndicatorProtractorIconSource = publicAssetUrl("icons/protractor.png");
const wristToolIndicatorMeasureLengthIconSource = publicAssetUrl("icons/ruler.svg");

/**
 * Maps a tool id (and sign variant for "place-flag") to the icon, color, and label shown on the wrist, or `undefined` for "aim" and "none" (no indicator).
 */
export function resolveWristToolIndicatorVisual(
  toolId: RuntimeToolId,
  flagType: PlacedFlagType,
): WristToolIndicatorVisual | undefined {
  switch (toolId) {
    case "aim":
      return undefined;
    case "place-flag":
      return {
        icon: "image",
        imageSource: wristToolIndicatorSignIconSources[flagType],
        color: flagType === "WoodenSign2" ? "#f59e0b" : "#22c55e",
        label: "Sign",
      };
    case "geodesic-cannon":
      return {
        icon: "image",
        imageSource: wristToolIndicatorRayIconSource,
        color: "#facc15",
        label: "Geodesic emitter",
      };
    case "protractor":
      return {
        icon: "image",
        imageSource: wristToolIndicatorProtractorIconSource,
        color: "#fb7185",
        label: "Protractor",
      };
    case "measure-length":
      return {
        icon: "image",
        imageSource: wristToolIndicatorMeasureLengthIconSource,
        color: "#22c55e",
        label: "Length",
      };
    case "geodesic-cannon-rotate":
      return {
        icon: "image",
        imageSource: wristToolIndicatorRotateIconSource,
        color: "#a78bfa",
        label: "Turn",
      };
    case "geodesic-cannon-carry":
      return {
        icon: "image",
        imageSource: wristToolIndicatorCarryIconSource,
        color: "#fb7ac8",
        label: "Carry",
      };
    case "geodesic-cannon-aim":
      return {
        icon: "image",
        imageSource: wristToolIndicatorAimIconSource,
        color: "#facc15",
        label: "Aim ray",
      };
    case "geodesic-cannon-tie-detach":
      return {
        icon: "image",
        imageSource: wristToolIndicatorRayIconSource,
        color: "#f59e0b",
        label: "Tie",
      };
    case "none":
      return undefined;
  }
}

/**
 * Per-hand template objects (already scaled, rotated, and centered) that are cloned for each hand instance.
 */
export interface HandModelTemplates {
  /** Template for the left hand. */
  readonly left: THREE.Object3D;
  /** Template for the right hand. */
  readonly right: THREE.Object3D;
}

/**
 * Builds left and right templates from a loaded GLB scene that contains both hands: each template keeps only the meshes on its side of the midpoint of the mesh centers
 * (left keeps those with larger x), then scales by 0.42, orients, and centers the model on its bounding box.
 * A source with a single mesh is not split, and an empty template is returned if the bounding box is not finite. Lifecycle: the caller owns the result and disposes it.
 */
export function createHandModelTemplates(sourceScene: THREE.Object3D): HandModelTemplates {
  const left = createCenteredTemplate(sourceScene, "left");
  const right = createCenteredTemplate(sourceScene, "right");

  return { left, right };
}

function collectMeshEntries(root: THREE.Object3D): readonly {
  readonly mesh: THREE.Mesh;
  readonly centerX: number;
}[] {
  const entries: Array<{ readonly mesh: THREE.Mesh; readonly centerX: number }> = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      entries.push({
        mesh,
        centerX: boxCenterX(mesh),
      });
    }
  });
  return entries;
}

function createCenteredTemplate(source: THREE.Object3D, handedness: "left" | "right"): THREE.Group {
  const template = new THREE.Group();
  template.name = `lowpoly-${handedness}-hand-template`;
  template.scale.setScalar(handScale);

  const model = cloneSkeleton(source);
  keepModelSide(model, handedness);
  model.quaternion.copy(handMeshQuaternion);
  model.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
    return createFallbackTemplate(handedness);
  }
  model.position.sub(center);
  template.add(model);

  return template;
}

// Composes the fixed rotation from the GLB's axes to the controller frame: base Euler, then a quarter-turn bend, then a quarter-turn roll about the bent length axis.
function createHandMeshQuaternion(): THREE.Quaternion {
  const base = new THREE.Quaternion().setFromEuler(baseHandMeshRotation);
  const bend = new THREE.Quaternion().setFromAxisAngle(handLocalForwardBendAxis, Math.PI / 2);
  const bent = base.clone().multiply(bend);
  const rollAxis = handLocalLengthAxis.clone().applyQuaternion(bent).normalize();
  const roll = new THREE.Quaternion().setFromAxisAngle(rollAxis, Math.PI / 2);

  return roll.multiply(bent);
}

function createFallbackTemplate(handedness: "left" | "right"): THREE.Group {
  const template = new THREE.Group();
  template.name = `lowpoly-${handedness}-hand-template`;
  return template;
}

function boxCenterX(object: THREE.Object3D): number {
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).x;
}

// Removes the meshes on the opposite side of the split so each template contains one hand.
function keepModelSide(model: THREE.Object3D, handedness: "left" | "right"): void {
  const entries = collectMeshEntries(model);
  if (entries.length <= 1) {
    return;
  }

  const minX = Math.min(...entries.map((entry) => entry.centerX));
  const maxX = Math.max(...entries.map((entry) => entry.centerX));
  const splitX = (minX + maxX) / 2;
  const meshesToRemove = entries
    .filter((entry) => handedness === "left"
      ? entry.centerX < splitX - handSideSplitEpsilon
      : entry.centerX > splitX + handSideSplitEpsilon)
    .map((entry) => entry.mesh);

  for (const mesh of meshesToRemove) {
    mesh.removeFromParent();
  }
}

function getInputSourcePose(
  source: XRInputSource,
  frame: XRFrame,
  referenceSpace: XRReferenceSpace,
): Pick<XRPose, "transform"> | undefined {
  const handPose = source.hand
    ? getHandJointPose(source.hand as XrHandLike, frame, referenceSpace)
    : undefined;
  if (handPose) {
    return handPose;
  }

  return source.gripSpace
    ? frame.getPose(source.gripSpace, referenceSpace)
    : frame.getPose(source.targetRaySpace, referenceSpace);
}

function getHandJointPose(
  hand: XrHandLike,
  frame: XRFrame,
  referenceSpace: XRReferenceSpace,
): Pick<XRPose, "transform"> | undefined {
  const getJointPose = (frame as XrFrameWithJointPose).getJointPose;
  const wrist = hand.get?.("wrist");
  if (!getJointPose || !wrist) {
    return undefined;
  }

  return getJointPose.call(frame, wrist, referenceSpace);
}

// Writes referenceSpaceToWorld * pose into the object's position/quaternion/scale, then multiplies the scale.
function applyXrPoseToObject(
  object: THREE.Object3D,
  transform: Pick<XRRigidTransform, "position" | "orientation">,
  referenceSpaceToWorldMatrix: THREE.Matrix4,
  scaleMultiplier = handScale,
): void {
  const worldMatrix = referenceSpaceToWorldMatrix.clone().multiply(xrRigidTransformLocalMatrix(transform));
  worldMatrix.decompose(object.position, object.quaternion, object.scale);
  object.scale.multiplyScalar(scaleMultiplier);
}

interface WristToolIndicator {
  readonly root: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly texturesByKey: Map<string, THREE.CanvasTexture>;
  readonly imagesBySource: Map<string, HTMLImageElement>;
  visualKey?: string;
}

function createWristToolIndicator(): WristToolIndicator {
  const material = new THREE.SpriteMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.96,
    sizeAttenuation: true,
  });
  const root = new THREE.Sprite(material);
  root.name = "xr-right-wrist-tool-indicator";
  root.visible = false;
  root.renderOrder = wristToolIndicatorRenderOrder;
  root.scale.setScalar(wristToolIndicatorScaleMeters);
  root.frustumCulled = false;
  return {
    root,
    material,
    texturesByKey: new Map(),
    imagesBySource: new Map(),
  };
}

// Positions the sprite at an offset in the right hand's frame and rebuilds its texture only when the visual changes.
function updateWristToolIndicator(
  indicator: WristToolIndicator,
  wrist: THREE.Object3D,
  selectedTool: RuntimeToolId,
  placeFlagType: PlacedFlagType,
): void {
  const visual = resolveWristToolIndicatorVisual(selectedTool, placeFlagType);
  if (!visual) {
    indicator.root.visible = false;
    return;
  }

  const visualKey = `${visual.icon}:${visual.imageSource ?? ""}:${visual.color}:${visual.label}`;
  if (indicator.visualKey !== visualKey) {
    indicator.visualKey = visualKey;
    indicator.material.map = getWristToolIndicatorTexture(indicator, visualKey, visual);
    indicator.material.needsUpdate = true;
  }

  indicator.root.position.copy(wristToolIndicatorLocalOffset).applyQuaternion(wrist.quaternion).add(wrist.position);
  indicator.root.visible = wrist.visible;
}

// Textures are cached by visual key; icon images load asynchronously and the cached texture is redrawn on load.
function getWristToolIndicatorTexture(
  indicator: WristToolIndicator,
  visualKey: string,
  visual: WristToolIndicatorVisual,
): THREE.CanvasTexture {
  const existing = indicator.texturesByKey.get(visualKey);
  if (existing) {
    refreshPendingWristToolIndicatorImage(indicator, visual);
    return existing;
  }

  const texture = createWristToolIndicatorTexture(indicator, visual);
  indicator.texturesByKey.set(visualKey, texture);
  return texture;
}

function createWristToolIndicatorTexture(
  indicator: WristToolIndicator,
  visual: WristToolIndicatorVisual,
): THREE.CanvasTexture {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create wrist tool indicator canvas.");
  }

  context.clearRect(0, 0, size, size);
  context.fillStyle = "rgba(15, 23, 42, 0.88)";
  context.beginPath();
  context.arc(size / 2, size / 2, 78, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = visual.color;
  context.stroke();

  context.strokeStyle = "#f8fafc";
  context.fillStyle = "#f8fafc";
  context.lineCap = "round";
  context.lineJoin = "round";
  drawWristToolIcon(indicator, context, visual, size / 2, 76);

  context.font = "700 24px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(visual.label, size / 2, 134, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawWristToolIcon(
  indicator: WristToolIndicator,
  context: CanvasRenderingContext2D,
  visual: WristToolIndicatorVisual,
  x: number,
  y: number,
): void {
  if (visual.icon === "image" && visual.imageSource) {
    const image = getWristToolIndicatorImage(indicator, visual.imageSource, () => {
      const visualKey = `${visual.icon}:${visual.imageSource ?? ""}:${visual.color}:${visual.label}`;
      const texture = indicator.texturesByKey.get(visualKey);
      if (!texture) {
        return;
      }
      redrawWristToolIndicatorTexture(indicator, texture, visual);
    });
    if (image.complete && image.naturalWidth > 0) {
      const imageSize = getWristToolIndicatorImageSize(visual);
      drawContainedImage(context, image, x - imageSize / 2, y - imageSize / 2, imageSize, imageSize);
      return;
    }
  }

  context.save();
  context.translate(x, y);
  context.lineWidth = 8;
  switch (visual.icon) {
    case "aim":
      context.beginPath();
      context.arc(0, 0, 23, 0, Math.PI * 2);
      context.moveTo(-44, 0);
      context.lineTo(-24, 0);
      context.moveTo(24, 0);
      context.lineTo(44, 0);
      context.moveTo(0, -44);
      context.lineTo(0, -24);
      context.moveTo(0, 24);
      context.lineTo(0, 44);
      context.stroke();
      break;
    case "image":
      context.font = "700 48px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("...", 0, 0);
      break;
  }
  context.restore();
}

function redrawWristToolIndicatorTexture(
  indicator: WristToolIndicator,
  texture: THREE.CanvasTexture,
  visual: WristToolIndicatorVisual,
): void {
  const canvas = texture.image as HTMLCanvasElement | undefined;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) {
    return;
  }

  const refreshed = createWristToolIndicatorTexture(indicator, visual);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(refreshed.image, 0, 0);
  refreshed.dispose();
  texture.needsUpdate = true;
}

function getWristToolIndicatorImage(
  indicator: WristToolIndicator,
  source: string,
  onLoaded: () => void,
): HTMLImageElement {
  const existing = indicator.imagesBySource.get(source);
  if (existing) {
    return existing;
  }

  const image = new window.Image();
  image.decoding = "async";
  image.onload = onLoaded;
  image.src = source;
  indicator.imagesBySource.set(source, image);
  return image;
}

function refreshPendingWristToolIndicatorImage(
  indicator: WristToolIndicator,
  visual: WristToolIndicatorVisual,
): void {
  if (visual.icon !== "image" || !visual.imageSource) {
    return;
  }

  getWristToolIndicatorImage(indicator, visual.imageSource, () => {
    const visualKey = `${visual.icon}:${visual.imageSource ?? ""}:${visual.color}:${visual.label}`;
    const texture = indicator.texturesByKey.get(visualKey);
    if (texture) {
      redrawWristToolIndicatorTexture(indicator, texture, visual);
    }
  });
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  const drawWidth = sourceRatio > targetRatio ? width : height * sourceRatio;
  const drawHeight = sourceRatio > targetRatio ? width / sourceRatio : height;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function getWristToolIndicatorImageSize(visual: WristToolIndicatorVisual): number {
  if (visual.imageSource === wristToolIndicatorRayIconSource) {
    return 120;
  }

  return 104;
}

function disposeWristToolIndicator(indicator: WristToolIndicator): void {
  indicator.material.dispose();
  for (const texture of indicator.texturesByKey.values()) {
    texture.dispose();
  }
  indicator.texturesByKey.clear();
}

function hideInstances(instances: Map<"left" | "right", THREE.Object3D>): void {
  for (const model of instances.values()) {
    model.visible = false;
  }
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    disposeMaterial(mesh.material);
  });
}

function disposeMaterial(material: THREE.Material | readonly THREE.Material[] | undefined): void {
  if (!material) {
    return;
  }

  if ("dispose" in material) {
    material.dispose();
    return;
  }

  for (const item of material) {
    item.dispose();
  }
}
