/**
 * Render sources and per-frame render records for geodesic cannons, geodesic segments and geodesic intersections.
 *
 * Geodesics are drawn through the instanced runtime-object pipeline: this module builds the source meshes once (a unit-length
 * cross-shaped ribbon in four colour variants, the cannon post, the cannon "head" lightsaber, and the intersection balloon) and
 * maps each runtime object to records naming an archetype and a Three.js model matrix (meters, cell-local pose converted
 * from world axes with x right, y forward, z up). Segments are a unit-length ribbon along local +x scaled non-uniformly to
 * the segment length; cannon heads are yawed per geodesic emitter. The ribbon colour selects archetype state: tie-detach
 * selection beats connected, which beats the default. Assets that fail to be preloaded fall back to simple procedural
 * stand-ins, so source creation never throws.
 */
import * as THREE from "three";
import {
  geodesicRayBeamHeightMeters,
  type GeodesicEmitterObject,
  type GeodesicCrossingObject,
  type GeodesicSegmentObject,
} from "../../world-objects/geodesic/objects";
import { yawRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { getEmitterGeodesicIds } from "../../world-objects/geodesic/endpoints";
import { resolveEmitterLaunchYaw } from "../../world-objects/geodesic/segments";
import type { RuntimeObjectReader } from "../../world-objects/runtimeObjectRegistry";
import { collectRuntimeObjectRenderSourceMeshes, type RuntimeObjectRenderRecord, type RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** Archetype of an ordinary (unconnected) geodesic segment ribbon. */
export const geodesicSegmentArchetypeKey = "geodesic-segment:ribbon-cross";
/** Archetype of a geodesic segment that is connected (tied) to others; amber ribbon. */
export const geodesicSegmentConnectedArchetypeKey = "geodesic-segment:ribbon-cross:connected";
/** Archetype of a segment selected for tie detachment; green ribbon. */
export const geodesicSegmentTieDetachSelectedArchetypeKey = "geodesic-segment:ribbon-cross:tie-detach-selected";
/** Archetype-key prefix (followed by `:<mesh>`) for the cannon post meshes. */
export const geodesicRayPostArchetypePrefix = "geodesic-ray:post";
/** Archetype-key prefix (followed by `:<mesh>`) for the per-geodesic cannon head (lightsaber) meshes. */
export const geodesicRayHeadArchetypePrefix = "geodesic-ray:head";
/** Archetype-key prefix (followed by `:<mesh>`) for the intersection balloon meshes. */
export const geodesicIntersectionArchetypePrefix = "geodesicModel/crossing:balloon";
/** glTF asset paths (relative to the public asset root) needed by the geodesic renderer. */
export const geodesicRayAssetPaths = {
  post: "flashlight/Post.glb",
  lightsaber: "flashlight/Lightsaber.glb",
  balloon: "baloon/Balloon.glb",
} as const;
/** Uniform scale of the post and lightsaber models. */
export const geodesicRayAssetScale = 0.42;
/** Lifts the loaded post model so its base sits on the floor (meters, Three.js y); not applied to the fallback. */
export const geodesicRayPostAssetFloorOffsetMeters = 0.74;
// Uniform scale of the balloon model.
const geodesicIntersectionBalloonScale = 0.825;
/** Position of the lightsaber (beam emission point) in the cannon's local Three.js frame, meters; y matches the beam height used for aiming and ray tracing. */
export const geodesicRayEmitterPosition = { x: 0, y: geodesicRayBeamHeightMeters, z: 0 } as const;

/**
 * Builds all source meshes for geodesic objects: four segment ribbon variants, cannon post, cannon head and intersection balloon.
 *
 * Uses the preloaded glTF models from `assets` where available and procedural fallbacks otherwise (always when
 * `assets` is omitted). Allocates fresh geometries and materials on each call.
 */
export function createGeodesicRuntimeRenderSources(
  assets?: PreparedWorldAssets,
): readonly RuntimeObjectRenderSourceMesh[] {
  return [
    createSegmentSource(),
    createSegmentSource({
      archetypeKey: geodesicSegmentConnectedArchetypeKey,
      color: 0xf6c445,
      opacity: 0.92,
    }),
    createSegmentSource({
      archetypeKey: geodesicSegmentTieDetachSelectedArchetypeKey,
      color: 0x22c55e,
      opacity: 0.98,
    }),
    ...createRayEmitterOnPostSources(assets),
    ...createIntersectionBalloonSources(assets),
  ];
}

/**
 * A body part of a geodesic object: meshes drawn at a pose of the object (the cannon post, a cannon head, an intersection balloon).
 *
 * A body part is an ordinary rigid object piece, so it gets portal ghosts exactly like the parts of any other object (the instance sync sends
 * every placement through `collectRuntimeObjectRenderRecordsWithPortalGhosts`). A geodesic segment is not a body part: it is computed per cell
 * and continues in the next cell as the next segment, so it has no placement and no ghosts (ghosting it would draw it twice).
 */
export interface GeodesicBodyPlacement {
  /** Object id of the records of this part (`<cannonId>:<geodesicId>:head` for a head). */
  readonly objectId: string;
  /** Cell whose frame `localPose` uses. */
  readonly cellId: string;
  /** Cell-local pose of the part; its ghosts are this pose carried through the developed portals. */
  readonly localPose: RigidTransform3;
  /** Archetype keys of the part's meshes (only keys that exist in the built sources). */
  readonly archetypeKeys: readonly string[];
}

/**
 * The body parts of one geodesic object, in drawing order (none for a segment, and none when `geodesicArchetypeKeys` has no matching key).
 *
 * For a cannon: the post at the cannon pose, plus one head per geodesic attached to the cannon (`getEmitterGeodesicIds`), yawed along that geodesic's launch
 * tangent. For an intersection: the balloon at its pose.
 */
export function collectGeodesicBodyPlacements(
  registry: RuntimeObjectReader,
  object: GeodesicEmitterObject | GeodesicSegmentObject | GeodesicCrossingObject,
  geodesicArchetypeKeys: readonly string[] = [],
): readonly GeodesicBodyPlacement[] {
  const keysWithPrefix = (prefix: string): readonly string[] => geodesicArchetypeKeys.filter((key) => key.startsWith(`${prefix}:`));
  const placements: GeodesicBodyPlacement[] = [];

  if (object.kind === "geodesicEmitters/emitter") {
    placements.push({ objectId: object.id, cellId: object.cellId, localPose: object.localPose, archetypeKeys: keysWithPrefix(geodesicRayPostArchetypePrefix) });
    const headKeys = keysWithPrefix(geodesicRayHeadArchetypePrefix);
    for (const geodesicId of getEmitterGeodesicIds(registry, object.id)) {
      placements.push({
        objectId: `${object.id}:${geodesicId}:head`,
        cellId: object.cellId,
        localPose: emitterYawPose(registry, object, geodesicId),
        archetypeKeys: headKeys,
      });
    }
  } else if (object.kind === "geodesicModel/crossing") {
    placements.push({ objectId: object.id, cellId: object.cellId, localPose: object.localPose, archetypeKeys: keysWithPrefix(geodesicIntersectionArchetypePrefix) });
  }

  return placements.filter((placement) => placement.archetypeKeys.length > 0);
}

/**
 * Produces the render records of one geodesic object in its own cell, one per matching archetype mesh (no portal ghosts; the instance sync adds
 * them for the body parts, see {@link collectGeodesicBodyPlacements}).
 *
 * For a cannon: one record per post mesh at the cannon pose, plus one record per (geodesic id, head mesh) with the head yawed to that
 * geodesic's launch tangent (`<cannonId>:<geodesicId>:head` object ids, one per attached geodesic).
 * For an intersection: balloon meshes at its pose. For a segment: a single record whose archetype encodes its highlight and
 * connection state. `geodesicArchetypeKeys` limits cannon and intersection output to keys that exist in the built sources
 * (empty means no cannon or intersection records).
 */
export function collectGeodesicRuntimeRenderRecords(
  registry: RuntimeObjectReader,
  object: GeodesicEmitterObject | GeodesicSegmentObject | GeodesicCrossingObject,
  geodesicArchetypeKeys: readonly string[] = [],
): readonly RuntimeObjectRenderRecord[] {
  if (object.kind === "geodesicEmitters/emitter" || object.kind === "geodesicModel/crossing") {
    return collectGeodesicBodyPlacements(registry, object, geodesicArchetypeKeys).flatMap((placement) => {
      const localMatrix = rigidTransformToThreeMatrix(placement.localPose);
      return placement.archetypeKeys.map((archetypeKey) => ({
        objectId: placement.objectId,
        cellId: placement.cellId,
        archetypeKey,
        localMatrix,
      }));
    });
  }

  return [
    {
      objectId: object.id,
      cellId: object.cellId,
      // State priority: tie-detach selection, then connected, else default.
      archetypeKey: object.highlightState === "tie-detach-selected"
        ? geodesicSegmentTieDetachSelectedArchetypeKey
        : object.connectionState === "connected"
          ? geodesicSegmentConnectedArchetypeKey
          : geodesicSegmentArchetypeKey,
      localMatrix: composeSegmentMatrix(object),
    },
  ];
}

// Yaw about world +z at the cannon's position, along the geodesic's launch tangent.
function emitterYawPose(registry: RuntimeObjectReader, cannon: GeodesicEmitterObject, geodesicId: string): RigidTransform3 {
  return yawRigidTransform3(resolveEmitterLaunchYaw(registry, cannon, geodesicId), cannon.localPose.translation);
}

/** A string that changes whenever the heads drawn at a cannon change: the attached geodesics and their launch yaws. Empty for any other object. */
export function emitterHeadsKey(registry: RuntimeObjectReader, object: { readonly kind: string }): string {
  if (object.kind !== "geodesicEmitters/emitter") {
    return "";
  }
  const cannon = object as GeodesicEmitterObject;
  return getEmitterGeodesicIds(registry, cannon.id)
    .map((geodesicId) => `${geodesicId}@${resolveEmitterLaunchYaw(registry, cannon, geodesicId)}`)
    .join("|");
}

/**
 * Returns the Three.js model matrix mapping the unit ribbon (x from 0 to 1) onto `segment`.
 *
 * The segment's start (cell-local world frame, meters) becomes the origin and its horizontal heading
 * atan2(direction.y, direction.x) the yaw about world +z; local +x is then stretched to `lengthMeters`.
 * The direction's vertical component is ignored, so segments are assumed horizontal.
 */
export function composeSegmentMatrix(segment: GeodesicSegmentObject): THREE.Matrix4 {
  const yaw = Math.atan2(segment.direction.y, segment.direction.x);
  // Rigid part: rotation about world z by yaw, translation to the start; the scale on the right acts first, in the ribbon's own frame.
  return rigidTransformToThreeMatrix({
    rotation: {
      m00: Math.cos(yaw),
      m01: -Math.sin(yaw),
      m02: 0,
      m10: Math.sin(yaw),
      m11: Math.cos(yaw),
      m12: 0,
      m20: 0,
      m21: 0,
      m22: 1,
    },
    translation: segment.start,
  }).multiply(new THREE.Matrix4().makeScale(segment.lengthMeters, 1, 1));
}

function createSegmentSource(options: {
  readonly archetypeKey?: string;
  readonly color?: number;
  readonly opacity?: number;
} = {}): RuntimeObjectRenderSourceMesh {
  const segmentMaterial = new THREE.MeshBasicMaterial({
    color: options.color ?? 0x38f2ff,
    transparent: true,
    opacity: options.opacity ?? 0.88,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Ribbon is 2.5 cm wide; one unit long (stretched per segment by the model matrix).
  const segment = new THREE.Mesh(createCrossRibbonGeometry(0.025), segmentMaterial);
  segment.name = "geodesic-segment-ribbon-cross";
  const root = new THREE.Group();
  root.name = "geodesic-segment-runtime-render-source";
  root.add(segment);
  root.updateMatrixWorld(true);

  return {
    objectId: "geodesic-segment:source",
    archetypeKey: options.archetypeKey ?? geodesicSegmentArchetypeKey,
    mesh: segment,
    root,
  };
}

function createRayEmitterOnPostSources(
  assets: PreparedWorldAssets | undefined,
): readonly RuntimeObjectRenderSourceMesh[] {
  const postRoot = new THREE.Group();
  postRoot.name = "geodesic-ray-post-source";
  const headRoot = new THREE.Group();
  headRoot.name = "geodesic-ray-head-source";

  // The loaded post model is lifted by the floor offset; the fallback post is already built with its base at y = 0.
  const preparedPost = assets?.instantiateGltf(geodesicRayAssetPaths.post)?.scene;
  const post = preparedPost ?? createFallbackPost();
  post.name = "asset:geodesic-ray-post";
  post.scale.setScalar(geodesicRayAssetScale);
  if (preparedPost) {
    post.position.y = geodesicRayPostAssetFloorOffsetMeters;
  }
  postRoot.add(post);

  const lightsaber = assets?.instantiateGltf(geodesicRayAssetPaths.lightsaber)?.scene ?? createFallbackLightsaber();
  lightsaber.name = "asset:geodesic-ray-lightsaber";
  lightsaber.scale.setScalar(geodesicRayAssetScale);
  lightsaber.position.set(
    geodesicRayEmitterPosition.x,
    geodesicRayEmitterPosition.y,
    geodesicRayEmitterPosition.z,
  );
  headRoot.add(lightsaber);

  postRoot.updateMatrixWorld(true);
  headRoot.updateMatrixWorld(true);

  return [
    ...collectRuntimeObjectRenderSourceMeshes(
      "geodesic-ray:post-source",
      postRoot,
      geodesicRayPostArchetypePrefix,
    ),
    ...collectRuntimeObjectRenderSourceMeshes(
      "geodesic-ray:head-source",
      headRoot,
      geodesicRayHeadArchetypePrefix,
    ),
  ];
}

function createIntersectionBalloonSources(
  assets: PreparedWorldAssets | undefined,
): readonly RuntimeObjectRenderSourceMesh[] {
  const root = new THREE.Group();
  root.name = "geodesicModel/crossing-balloon-source";
  const balloon = assets?.instantiateGltf(geodesicRayAssetPaths.balloon)?.scene ?? createFallbackBalloon();
  balloon.name = "asset:geodesicModel/crossing-balloon";
  balloon.scale.setScalar(geodesicIntersectionBalloonScale);
  root.add(balloon);
  root.updateMatrixWorld(true);

  return collectRuntimeObjectRenderSourceMeshes(
    "geodesicModel/crossing:balloon-source",
    root,
    geodesicIntersectionArchetypePrefix,
  );
}

// Procedural stand-in: pink stretched sphere with a knot cone, built in the Three.js frame (y up), about 0.7 m tall.
function createFallbackBalloon(): THREE.Object3D {
  const root = new THREE.Group();
  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xff4d8d, roughness: 0.42, metalness: 0.02 }),
  );
  balloon.scale.y = 1.25;
  balloon.position.y = 0.3;
  const knot = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0xd61f69, roughness: 0.5 }),
  );
  knot.position.y = 0.02;
  knot.rotation.x = Math.PI;
  root.add(balloon, knot);
  return root;
}

// Two perpendicular unit-long quads along +x: one flat in the xy plane (width along y), one upright in the xz plane (width along z), forming a cross section visible from any side.
function createCrossRibbonGeometry(width: number): THREE.BufferGeometry {
  const half = width / 2;
  const positions = new Float32Array([
    0, -half, 0, 1, -half, 0, 1, half, 0, 0, half, 0,
    0, 0, -half, 1, 0, -half, 1, 0, half, 0, 0, half,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Procedural stand-in: a pole on a round base, about 1.55 m tall, base at y = 0.
function createFallbackPost(): THREE.Object3D {
  const root = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 1.55, 14),
    new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.8, metalness: 0.18 }),
  );
  pole.position.y = 0.775;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 0.08, 18),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.72, metalness: 0.14 }),
  );
  base.position.y = 0.04;
  root.add(base, pole);
  return root;
}

// Procedural stand-in: hilt and glowing blade laid out along +x (the emission direction).
function createFallbackLightsaber(): THREE.Object3D {
  const root = new THREE.Group();
  const hilt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 0.22, 18),
    new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.38, metalness: 0.42 }),
  );
  hilt.rotation.z = Math.PI / 2;
  hilt.position.x = 0.04;
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.42, 18),
    new THREE.MeshStandardMaterial({ color: 0x38f2ff, emissive: 0x0e7490, roughness: 0.18 }),
  );
  blade.rotation.z = Math.PI / 2;
  blade.position.x = 0.34;
  root.add(hilt, blade);
  return root;
}
