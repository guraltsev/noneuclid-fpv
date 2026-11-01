/**
 * `tests/render/aimFeedback.test.ts` — unit tier.
 *
 * `createAimFeedback` draws what the player aims at each frame: the floating tooltip, the help lens, the aim cross and the
 * XR controller ray. These tests drive the handle with a shell session, a real registry and recording stand-ins for the DOM
 * and Three handles: with a menu open everything is hidden, a focused sign gets a desktop tooltip, a pinned help follows the
 * focused object until it is dismissed, and the aim cross is shown for the aim tool with a ray only in XR.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { createWorldFocusMessageDefinition } from "../../src/ui/worldInteractionDefinition";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry, type RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { createAimFeedback } from "../../src/render/three/aimFeedback";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import type { AppSessionState } from "../../src/runtime/appSession";
import { createTestAppSession } from "../support/appSession";

const sign = createPlacedFlagObject({
  id: "sign-a",
  cellId: "room-a",
  localPose: identityRigidTransform3,
  flagType: "WoodenSign1",
  message: "Hi",
});

const aimRay: RootAimRay = {
  origin: new THREE.Vector3(0, 1.6, 0),
  direction: new THREE.Vector3(0, -1, 0),
  quaternion: new THREE.Quaternion(),
};

const floorTarget: AimTarget = {
  kind: "floor",
  cellId: "room-a",
  localEyePosition: { x: 0, y: -2, z: 1.6 },
  localPoint: { x: 1, y: 0.5, z: 0 },
  localNormal: { x: 0, y: 0, z: 1 },
  rootPoint: { x: 1, y: 0.5, z: 0 },
  rootNormal: { x: 0, y: 0, z: 1 },
  distanceMeters: 2,
  hopCount: 0,
};

function createHarness(sessionOverrides: Partial<AppSessionState> = {}) {
  const focus: { object: RuntimeWorldObject | undefined } = { object: sign };
  const session = createTestAppSession({ playerPose: createDefaultPlayerPose("room-a"), ...sessionOverrides });
  const scene = new THREE.Scene();
  const tooltipUpdates: { visible: boolean; text?: string }[] = [];
  const helpUpdates: { visible: boolean; title?: string }[] = [];
  const crossUpdates: (AimTarget | undefined)[] = [];
  const xrTooltipUpdates: unknown[] = [];
  const crossRoot = new THREE.Group();
  const feedback = createAimFeedback({
    scene,
    camera: new THREE.PerspectiveCamera(),
    session,
    runtimeObjectRegistry: createRuntimeObjectRegistry(),
    cellMeshes: new Map(),
    floatingObjectTooltip: {
      root: {} as HTMLDivElement,
      update: (options) => tooltipUpdates.push(options),
      dispose: vi.fn(),
    },
    aimCrossMarker: {
      root: crossRoot,
      update: (target) => crossUpdates.push(target),
      dispose: vi.fn(),
    },
    helpLensRenderer: {
      update: (options) => helpUpdates.push({ visible: options.visible, title: options.definition?.title }),
      dispose: vi.fn(),
    },
    updateXrObjectTooltip: (options) => xrTooltipUpdates.push(options),
    resolveCurrentAimTarget: () => floorTarget,
    targetIsWithinInteractionRange: () => true,
    findFocusedRuntimeObject: () => focus.object
      ? { object: focus.object, distance: 1, tooltipAnchor: { x: 0, y: 0, z: 1 } }
      : undefined,
    resolveDesktopTooltipScreenPosition: () => ({ x: 10, y: 20 }),
    getRuntimeObjectTooltipText: () => "Sign",
    getWorldFocusMessageDefinition: (object) =>
      createWorldFocusMessageDefinition({ object, selectedTool: session.get().menuState.selectedTool }),
    getGeodesicDisplayName: (geodesicId) => geodesicId,
  });
  return { feedback, focus, scene, tooltipUpdates, helpUpdates, crossUpdates, xrTooltipUpdates };
}

const openMenu = { menuState: { ...createRuntimeMenuState({ selectedWorldId: "test" }), isOpen: true } };

describe("createAimFeedback", () => {
  it("hides the tooltips and the help lens while a menu is open", () => {
    const { feedback, tooltipUpdates, helpUpdates, xrTooltipUpdates } = createHarness(openMenu);

    feedback.updateTooltips(false, aimRay, undefined);

    expect(tooltipUpdates).toEqual([{ visible: false }]);
    expect(helpUpdates).toEqual([{ visible: false, title: undefined }]);
    expect(xrTooltipUpdates).toEqual([undefined]);
  });

  it("shows the tooltip of the focused object on the desktop", () => {
    const { feedback, tooltipUpdates } = createHarness();

    feedback.updateTooltips(false, aimRay, undefined);

    expect(tooltipUpdates).toEqual([{ visible: true, text: "Sign", xPixels: 10, yPixels: 20 }]);
  });

  it("keeps a pinned help on the focused object until it is dismissed", () => {
    const { feedback, helpUpdates } = createHarness();

    feedback.requestHelpLensForFocusedObject(aimRay);
    feedback.updateTooltips(false, aimRay, undefined);

    expect(helpUpdates.at(-1)?.visible).toBe(true);
    expect(feedback.dismissHelpLensFocus()).toBe(true);
    expect(feedback.dismissHelpLensFocus()).toBe(false);
  });

  it("unpins the help when the same object is requested twice", () => {
    const { feedback } = createHarness();

    feedback.requestHelpLensForFocusedObject(aimRay);
    feedback.requestHelpLensForFocusedObject(aimRay);

    expect(feedback.dismissHelpLensFocus()).toBe(false);
  });

  it("drops a pinned help when the aim leaves its object", () => {
    const { feedback, focus } = createHarness();

    feedback.requestHelpLensForFocusedObject(aimRay);
    focus.object = undefined;
    feedback.updateTooltips(false, aimRay, undefined);

    expect(feedback.dismissHelpLensFocus()).toBe(false);
  });

  it("shows the aim cross for the aim tool and hides it while a menu is open", () => {
    const aiming = createHarness({ menuState: { ...createRuntimeMenuState({ selectedWorldId: "test" }), selectedTool: "aim" } });
    aiming.feedback.updateAim(false, aimRay);
    expect(aiming.crossUpdates).toEqual([floorTarget]);

    const menu = createHarness(openMenu);
    menu.feedback.updateAim(true, aimRay);
    expect(menu.crossUpdates).toEqual([undefined]);
  });

  it("draws the controller ray only in XR and removes it on dispose", () => {
    const { feedback, scene } = createHarness();
    const ray = scene.getObjectByName("aim-controller-ray");

    feedback.updateAim(false, aimRay);
    expect(ray?.visible).toBe(false);
    feedback.updateAim(true, aimRay);
    expect(ray?.visible).toBe(true);

    feedback.dispose();
    expect(scene.getObjectByName("aim-controller-ray")).toBeUndefined();
  });
});
