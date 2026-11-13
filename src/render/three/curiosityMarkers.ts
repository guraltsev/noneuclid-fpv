/**
 * Curiosity markers (design 017 section 9.4, "Places worth a look"): a small glowing "?" disc on the floor where an author put one. Within 3 m it shows the teaser of its discovery as a floating label; when the discovery is found the disc turns into a tick and the label goes.
 * A marker is a signpost, not an exercise: it blocks nothing and is not picked. Each marker is placed in the player's cell frame the way the help cube's label is (the marker's own cell frame, or its image through at most two portals), so it is drawn where the player sees that place. The textures are drawn once into canvases; `dispose` releases everything.
 */
import * as THREE from "three";
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import { composeRigidTransform3, identityRigidTransform3, invertRigidTransform3, transformPoint3 } from "../../math/rigidTransform3";
import type { DiscoveryMarkerSpec } from "../../modules/discoveries";
import { roundRect } from "./canvasDrawing";
import { disposeObject3DWithTextures } from "./runtimeSceneUtils";
import { worldPointToThree } from "./worldAxes";

/** The distance within which a marker shows its teaser, in meters. */
export const curiosityMarkerLabelRangeMeters = 3;
/** The distance beyond which a marker is not drawn, in meters. */
const markerDrawRangeMeters = 30;
/** The disc's diameter in meters, and its height above the floor. */
const discDiameterMeters = 0.7;
const discHeightMeters = 0.03;
/** The label's height above the floor, its width and height in meters. */
const labelHeightMeters = 1.25;
const labelWidthMeters = 1.3;
const labelAspect = 3 / 8;
const maxHops = 2;

/** One marker to show: the discovery it belongs to, where it stands and the teaser it shows. */
export interface CuriosityMarkerEntry {
  readonly discoveryId: string;
  readonly marker: DiscoveryMarkerSpec;
  readonly teaser: string;
}

/** What the markers need from the shell. */
export interface CuriosityMarkersDeps {
  readonly scene: THREE.Scene;
  /** The camera the labels turn to face. */
  readonly camera: THREE.Camera;
  readonly engine: WorldEngine;
  /** The active compiled world; read on each call because geometry commits replace it. */
  getWorld(): CompiledCellComplex;
  readonly entries: readonly CuriosityMarkerEntry[];
  /** True once the discovery with this id has been found. */
  isFound(discoveryId: string): boolean;
}

/** Handle to the markers. */
export interface CuriosityMarkers {
  /** Places and shows the markers for the time `seconds` (any steady clock); call once per frame. */
  update(seconds: number): void;
  dispose(): void;
}

interface MarkerView {
  readonly entry: CuriosityMarkerEntry;
  readonly disc: THREE.Mesh;
  readonly questionMaterial: THREE.MeshBasicMaterial;
  readonly tickMaterial: THREE.MeshBasicMaterial;
  readonly label: THREE.Mesh;
}

/** Creates the markers for `deps.entries` (none: a handle that does nothing). */
export function createCuriosityMarkers(deps: CuriosityMarkersDeps): CuriosityMarkers {
  const views: MarkerView[] = deps.entries.map((entry) => createView(entry, deps.scene));
  const cameraQuaternion = new THREE.Quaternion();
  const cameraPosition = new THREE.Vector3();

  // The marker's point as the player sees it: in the player's own frame, through up to two portals; undefined when no straight line reaches it.
  function appearance(cellId: string, point: { readonly x: number; readonly y: number; readonly z: number }): { readonly x: number; readonly y: number; readonly z: number } | undefined {
    const player = readLocalPlayerPose(deps.engine);
    if (cellId === player.cellId) return point;
    const route = findNearestImageRoute(deps.getWorld(), { cellId: player.cellId, point: player.position }, { cellId, point }, maxHops);
    if (!route) return undefined;
    const cellFromPlayerFrame = route.hops.reduce((frame, hop) => composeRigidTransform3(hop.transformToTarget, frame), identityRigidTransform3);
    return transformPoint3(invertRigidTransform3(cellFromPlayerFrame), point);
  }

  return {
    update(seconds) {
      if (views.length === 0) return;
      const player = readLocalPlayerPose(deps.engine);
      deps.camera.getWorldQuaternion(cameraQuaternion);
      deps.camera.getWorldPosition(cameraPosition);
      for (const view of views) {
        const { marker, discoveryId } = view.entry;
        const point = appearance(marker.cellId, marker.position);
        const distance = point === undefined ? Infinity : Math.hypot(point.x - player.position.x, point.y - player.position.y);
        if (point === undefined || distance > markerDrawRangeMeters) {
          view.disc.visible = false;
          view.label.visible = false;
          continue;
        }

        const found = deps.isFound(discoveryId);
        view.disc.material = found ? view.tickMaterial : view.questionMaterial;
        // A gentle pulse says "look here" until the discovery is found.
        view.disc.scale.setScalar(found ? 1 : 1 + 0.08 * Math.sin(seconds * 3));
        view.disc.position.copy(worldPointToThree({ x: point.x, y: point.y, z: discHeightMeters }));
        // The glyph reads upright from where the player stands: its top points away from the player.
        view.disc.rotation.y = Math.atan2(cameraPosition.x - view.disc.position.x, cameraPosition.z - view.disc.position.z);
        view.disc.visible = true;

        const showLabel = !found && distance <= curiosityMarkerLabelRangeMeters;
        view.label.visible = showLabel;
        if (showLabel) {
          view.label.position.copy(worldPointToThree({ x: point.x, y: point.y, z: labelHeightMeters }));
          view.label.quaternion.copy(cameraQuaternion);
        }
      }
    },
    dispose() {
      for (const view of views) {
        view.disc.removeFromParent();
        view.label.removeFromParent();
        view.disc.geometry.dispose();
        disposeObject3DWithTextures(view.label);
        view.questionMaterial.map?.dispose();
        view.questionMaterial.dispose();
        view.tickMaterial.map?.dispose();
        view.tickMaterial.dispose();
      }
      views.length = 0;
    },
  };
}

function createView(entry: CuriosityMarkerEntry, scene: THREE.Scene): MarkerView {
  const questionMaterial = createDiscMaterial("?", "#f59e0b", "245, 158, 11", "#fef3c7");
  const tickMaterial = createDiscMaterial("✓", "#16a34a", "22, 163, 74", "#dcfce7");
  const disc = new THREE.Mesh(new THREE.CircleGeometry(discDiameterMeters / 2, 40), questionMaterial);
  // Lying on the floor, facing up; turned about the vertical axis each frame (the Euler order puts that turn first).
  disc.rotation.order = "YXZ";
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 6;
  disc.name = `curiosity-marker:${entry.discoveryId}`;
  disc.visible = false;
  scene.add(disc);

  const label = createLabel(entry.teaser);
  label.name = `curiosity-marker-label:${entry.discoveryId}`;
  label.visible = false;
  scene.add(label);
  return { entry, disc, questionMaterial, tickMaterial, label };
}

// A glowing disc with a big glyph: a soft halo, a solid face and the glyph in a light colour.
function createDiscMaterial(glyph: string, faceColor: string, haloRgb: string, glyphColor: string): THREE.MeshBasicMaterial {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the curiosity marker canvas context.");
  context.clearRect(0, 0, size, size);
  for (const [radius, alpha] of [[0.5, 0.16], [0.45, 0.3], [0.4, 0.5]] as const) {
    context.beginPath();
    context.arc(size / 2, size / 2, size * radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(${haloRgb}, ${alpha})`;
    context.fill();
  }
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  context.fillStyle = faceColor;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = glyphColor;
  context.stroke();
  context.fillStyle = glyphColor;
  context.font = "bold 150px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, size / 2, size / 2 + 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

// A plate of up to three lines of wrapped text, facing the camera.
function createLabel(text: string): THREE.Mesh {
  const width = 512;
  const height = 192;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the curiosity marker label canvas context.");
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(10, 17, 20, 0.78)";
  roundRect(context, 6, 6, width - 12, height - 12, 22);
  context.fill();
  context.strokeStyle = "rgba(251, 191, 36, 0.8)";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.font = "bold 36px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = wrapText(context, text, width - 56).slice(0, 3);
  const lineHeight = 46;
  const firstY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, width / 2, firstY + index * lineHeight));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(labelWidthMeters, labelWidthMeters * labelAspect), material);
  mesh.renderOrder = 941;
  return mesh;
}

/** Breaks `text` into lines no wider than `maxWidth` pixels in the context's current font, at spaces. */
export function wrapText(context: { measureText(text: string): { readonly width: number } }, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
