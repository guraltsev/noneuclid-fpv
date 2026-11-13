/**
 * The VR hand UI of the shell (src/render/three/xrHandUi.ts, design 017 sections 7.2 to 7.4 and 8.1): from the input
 * sources it decides which source is the pointer hand, where the belt lies (the belt-hand grip with two controllers, the
 * waist with one), where the toast panel stands, and when the start card is shown and dismissed. The belt and the card
 * are recording stand-ins; their own drawing is tested in xrToolBelt.test.ts.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createXrHandUi, type XrHandUiSource } from "../../src/render/three/xrHandUi";
import type { XrStartCard } from "../../src/render/three/xrStartCard";
import type { XrToolBelt, XrToolBeltUpdate } from "../../src/render/three/xrToolBelt";
import { createToolBeltDefinition } from "../../src/ui/toolBeltDefinition";

const definition = createToolBeltDefinition({ appConfig: defaultAppConfig, worldHasMap: true, selectedTool: "none" });
const head = { position: new THREE.Vector3(0, 1.7, 0), quaternion: new THREE.Quaternion() };

function source(handedness: string): XrHandUiSource {
  return { handedness, gamepad: {}, gripSpace: { name: `${handedness}-grip` } as unknown as XRSpace };
}

function createHarness(options: { leftHanded?: boolean; useOneController?: boolean } = {}) {
  const beltUpdates: XrToolBeltUpdate[] = [];
  const cardUpdates: { definition: unknown }[] = [];
  let cardVisible = false;
  const belt: XrToolBelt = {
    update: (frame) => { beltUpdates.push(frame); },
    pick: vi.fn(() => undefined),
    position: () => undefined,
    isVisible: () => true,
    dispose: vi.fn(),
  };
  const card: XrStartCard = {
    update: (frame) => { cardUpdates.push({ definition: frame.definition }); cardVisible = frame.definition !== undefined; },
    isVisible: () => cardVisible,
    dispose: vi.fn(),
  };
  const ui = createXrHandUi(new THREE.Scene(), () => ({ useOneController: options.useOneController ?? false, leftHanded: options.leftHanded ?? false }), { belt, startCard: card });
  const getPose = vi.fn((space: XRSpace) => ({ transform: { position: { x: (space as unknown as { name: string }).name.startsWith("left") ? -0.2 : 0.2, y: 1.2, z: -0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }));
  const update = (inputSources: readonly XrHandUiSource[], menuOpen = false) => ui.update({
    inputSources,
    getPose: getPose as never,
    referenceSpaceToWorldMatrix: new THREE.Matrix4(),
    head,
    definition,
    menuOpen,
  });
  return { ui, belt, beltUpdates, cardUpdates, update, getPose };
}

describe("XR hand UI", () => {
  it("puts the belt on the left grip and the toasts above the left wrist with two controllers", () => {
    const { update, beltUpdates, getPose } = createHarness();

    const result = update([source("left"), source("right")]);

    expect(result.layout).toBe("two-controllers");
    expect(result.pointerHandedness).toBe("right");
    expect(result.toastAnchor).toEqual({ kind: "wrist", handedness: "left" });
    expect(result.paletteSources.map((entry) => entry.handedness)).toEqual(["right"]);
    expect(getPose).toHaveBeenCalledTimes(1);
    expect(beltUpdates.at(-1)?.beltGripWorldMatrix?.elements[12]).toBeCloseTo(-0.2);
  });

  it("swaps the hands when left-handed", () => {
    const { update, beltUpdates } = createHarness({ leftHanded: true });

    const result = update([source("left"), source("right")]);

    expect(result.pointerHandedness).toBe("left");
    expect(result.toastAnchor).toEqual({ kind: "wrist", handedness: "right" });
    expect(result.paletteSources.map((entry) => entry.handedness)).toEqual(["left"]);
    expect(beltUpdates.at(-1)?.beltGripWorldMatrix?.elements[12]).toBeCloseTo(0.2);
  });

  it("hangs the belt at the waist and the toasts low with one controller", () => {
    const { update, beltUpdates, getPose } = createHarness();

    const result = update([source("left")]);

    expect(result.layout).toBe("one-left");
    expect(result.pointerHandedness).toBe("left");
    expect(result.toastAnchor.kind).toBe("world");
    if (result.toastAnchor.kind === "world") {
      expect(result.toastAnchor.position.y).toBeCloseTo(1.4);
      expect(result.toastAnchor.position.z).toBeCloseTo(-0.6);
    }
    expect(beltUpdates.at(-1)?.beltGripWorldMatrix).toBeUndefined();
    expect(getPose).not.toHaveBeenCalled();
  });

  it("uses the pointer hand's controller alone when Use one controller is on", () => {
    const { update } = createHarness({ useOneController: true });

    const result = update([source("left"), source("right")]);

    expect(result.layout).toBe("one-right");
    expect(result.paletteSources.map((entry) => entry.handedness)).toEqual(["right"]);
  });

  it("shows the start card after the session begins, until the trigger dismisses it", () => {
    const { ui, update, cardUpdates, beltUpdates } = createHarness();

    update([source("right")]);
    expect(ui.startCardVisible()).toBe(false);
    ui.beginSession();
    update([source("right")]);
    expect(ui.startCardVisible()).toBe(true);
    expect(cardUpdates.at(-1)?.definition).toMatchObject({ sections: [{ heading: "Your controller" }] });
    expect(beltUpdates.at(-1)?.hidden).toBe(true);

    ui.dismissStartCard();
    update([source("right")]);
    expect(ui.startCardVisible()).toBe(false);
    expect(beltUpdates.at(-1)?.hidden).toBe(false);
  });

  it("regenerates the card for the new layout while it is up", () => {
    const { ui, update, cardUpdates } = createHarness();
    ui.beginSession();

    update([source("right")]);
    update([source("left"), source("right")]);

    expect(cardUpdates.at(-1)?.definition).toMatchObject({ sections: [{ heading: "Pointer hand" }, { heading: "Belt hand" }] });
  });

  it("hides the belt while a menu is open and everything when the session ends", () => {
    const { ui, update, beltUpdates, cardUpdates } = createHarness();

    update([source("right")], true);
    expect(beltUpdates.at(-1)?.hidden).toBe(true);
    ui.endSession();
    expect(beltUpdates.at(-1)?.layout).toBeUndefined();
    expect(cardUpdates.at(-1)?.definition).toBeUndefined();
  });

  it("remembers the slot the pointer is on for the belt's caption, and forgets it", () => {
    const { ui, update, belt, beltUpdates } = createHarness();
    vi.mocked(belt.pick).mockReturnValueOnce({ index: 2, slot: definition.slots[2] });

    ui.pickBeltSlot({ origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) });
    update([source("right")]);
    expect(beltUpdates.at(-1)?.hoveredSlotIndex).toBe(2);
    ui.pickBeltSlot(undefined);
    update([source("right")]);
    expect(beltUpdates.at(-1)?.hoveredSlotIndex).toBeUndefined();
  });
});
