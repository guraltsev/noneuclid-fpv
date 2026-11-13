/**
 * The VR hand-role interface of the shell (design 017 sections 7.2 to 7.4 and 8.1): owns the tool belt strap and the start card, decides from the input sources where the belt and the toasts stand, and answers "which belt slot is the pointer on".
 * Role: glue between `interaction/xrHandRoles` (who is the pointer hand and the belt hand), `xrToolBelt` (the strap) and `xrStartCard`; the shell calls `pickBeltSlot` while it reads input and `update` once per XR frame.
 * Two controllers: the belt is on the belt-hand grip, toasts stand above that wrist. One controller: the belt hangs at the waist, toasts stand low in the field of view (0.6 m ahead, 0.3 m below the eyes).
 * Lifecycle: `beginSession` shows the start card; `dismissStartCard` hides it (the trigger); `endSession` hides everything; `dispose` frees the scene objects.
 */
import * as THREE from "three";
import type { XrHandOptions, XrLayout } from "../../glue/xrLayout";
import { resolveLowToastPose, type YawFollowingPose } from "../../interaction/xrBeltMath";
import { resolveXrHandRoles, type XrRoleSourceLike } from "../../interaction/xrHandRoles";
import type { ToolBeltDefinition } from "../../ui/toolBeltDefinition";
import { createVrStartCardDefinition } from "../../ui/vrStartCardDefinition";
import type { XrToastAnchor } from "./xrControllerHandModels";
import { xrRigidTransformLocalMatrix } from "./xrPlayerRig";
import { createXrStartCard, type XrStartCard } from "./xrStartCard";
import { createXrToolBelt, type XrToolBelt, type XrToolBeltPick } from "./xrToolBelt";

/** The input source as far as the hand UI reads it: roles, plus the grip space the wrist belt lies on. */
export interface XrHandUiSource extends XrRoleSourceLike {
  readonly gripSpace?: XRSpace;
  readonly hand?: unknown;
}

/** What `update` needs from the XR frame. */
export interface XrHandUiUpdate {
  readonly inputSources: readonly XrHandUiSource[];
  /** Reads the pose of a space in the reference space (the XR frame's `getPose`). */
  readonly getPose: (space: XRSpace) => { readonly transform: Pick<XRRigidTransform, "position" | "orientation"> } | undefined;
  /** Reference space to scene matrix (the rig's `matrixWorld`). */
  readonly referenceSpaceToWorldMatrix: THREE.Matrix4;
  readonly head: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion } | undefined;
  readonly definition: ToolBeltDefinition;
  readonly menuOpen: boolean;
}

/** What `update` tells the shell. */
export interface XrHandUiResult {
  readonly layout: XrLayout | undefined;
  /** The sources the palette should treat as pointers: the pointer hand only (all sources while no role is known). */
  readonly paletteSources: readonly XrHandUiSource[];
  readonly pointerHandedness: "left" | "right";
  readonly toastAnchor: XrToastAnchor;
}

/** The hand UI handle. */
export interface XrHandUi {
  /** Starts a session: shows the start card (once a layout and a head are known). */
  beginSession(): void;
  /** Ends the session: hides the card, the belt and forgets the layout. */
  endSession(): void;
  /** True while the start card shows. */
  startCardVisible(): boolean;
  /** Hides the start card (the trigger was pulled). */
  dismissStartCard(): void;
  /** The belt slot the ray hits (also remembered as the hover shown on the belt), or undefined. Call with `undefined` to clear the hover. */
  pickBeltSlot(ray: { readonly origin: THREE.Vector3; readonly direction: THREE.Vector3 } | undefined): XrToolBeltPick | undefined;
  /** Positions the belt, the start card and the toast anchor for this frame. */
  update(frame: XrHandUiUpdate): XrHandUiResult;
  dispose(): void;
}

/** Creates the hand UI in `scene`; `handOptions` is read each call, so a Settings change applies at once. */
export function createXrHandUi(scene: THREE.Scene, handOptions: () => XrHandOptions, parts?: { readonly belt?: XrToolBelt; readonly startCard?: XrStartCard }): XrHandUi {
  const belt = parts?.belt ?? createXrToolBelt(scene);
  const startCard = parts?.startCard ?? createXrStartCard(scene);
  let startCardWanted = false;
  let hoveredSlotIndex: number | undefined;
  let lowToastPose: YawFollowingPose | undefined;
  const gripMatrix = new THREE.Matrix4();
  const toastPosition = new THREE.Vector3();
  const headForward = new THREE.Vector3();

  return {
    beginSession() {
      startCardWanted = true;
    },
    endSession() {
      startCardWanted = false;
      hoveredSlotIndex = undefined;
      lowToastPose = undefined;
      startCard.update({ definition: undefined, head: undefined });
      belt.update({ definition: { slots: [] }, layout: undefined, head: undefined });
    },
    startCardVisible() {
      return startCardWanted && startCard.isVisible();
    },
    dismissStartCard() {
      startCardWanted = false;
    },
    pickBeltSlot(ray) {
      const pick = ray === undefined ? undefined : belt.pick(ray);
      hoveredSlotIndex = pick?.index;
      return pick;
    },
    update(frame) {
      const options = handOptions();
      const roles = resolveXrHandRoles(frame.inputSources, options);
      const layout = roles.layout;
      const pointerHandedness: "left" | "right" = roles.pointer?.handedness === "left" ? "left" : roles.pointer?.handedness === "right" ? "right" : options.leftHanded ? "left" : "right";
      let beltGripWorldMatrix: THREE.Matrix4 | undefined;
      if (layout === "two-controllers" && roles.belt?.gripSpace !== undefined) {
        const pose = frame.getPose(roles.belt.gripSpace);
        if (pose !== undefined) {
          beltGripWorldMatrix = gripMatrix.copy(frame.referenceSpaceToWorldMatrix).multiply(xrRigidTransformLocalMatrix(pose.transform));
        }
      }
      belt.update({
        definition: frame.definition,
        layout,
        head: frame.head,
        beltGripWorldMatrix,
        hoveredSlotIndex,
        hidden: frame.menuOpen || startCardWanted,
      });
      startCard.update({
        definition: startCardWanted && layout !== undefined ? createVrStartCardDefinition(layout, options.leftHanded) : undefined,
        head: frame.head,
      });

      let toastAnchor: XrToastAnchor;
      if (layout === "two-controllers") {
        const beltHand = roles.belt?.handedness === "left" || roles.belt?.handedness === "right" ? roles.belt.handedness : pointerHandedness === "left" ? "right" : "left";
        toastAnchor = { kind: "wrist", handedness: beltHand };
      } else if (frame.head !== undefined) {
        headForward.set(0, 0, -1).applyQuaternion(frame.head.quaternion);
        lowToastPose = resolveLowToastPose({ headPosition: frame.head.position, headForward, previous: lowToastPose });
        toastPosition.set(lowToastPose.position.x, lowToastPose.position.y, lowToastPose.position.z);
        toastAnchor = { kind: "world", position: toastPosition };
      } else {
        toastAnchor = { kind: "wrist", handedness: pointerHandedness };
      }
      const paletteSources = roles.pointer !== undefined ? [roles.pointer] : frame.inputSources;
      return { layout, paletteSources, pointerHandedness, toastAnchor };
    },
    dispose() {
      belt.dispose();
      startCard.dispose();
    },
  };
}
