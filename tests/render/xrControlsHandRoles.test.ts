/**
 * Hand roles of the XR reader (src/render/three/xrControls.ts and src/interaction/xrHandRoles.ts, design 017 sections
 * 7.2 and 7.3): the layout comes from the sources that have a gamepad, the pointer hand uses and the belt hand takes
 * tools, a single controller does every verb (stick press = next tool only when the stick rests; the upper face
 * button taps What's this? and held for 1 s opens the main menu), and losing a controller switches the layout.
 * Sources are plain literals that satisfy the structural input-source type.
 */
import { describe, expect, it } from "vitest";
import { createTapOrHoldTracker, resolveXrHandRoles } from "../../src/interaction/xrHandRoles";
import { createXrControls, createXrInputFrame, type XrInputSourceLike } from "../../src/render/three/xrControls";

const triggerButton = 0;
const gripButton = 1;
const stickPressButton = 3;
const lowerFaceButton = 4;
const upperFaceButton = 5;

function controller(handedness: string, down: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0]): XrInputSourceLike {
  return { handedness, gamepad: { axes, buttons: Array.from({ length: 6 }, (_, index) => ({ pressed: down.includes(index) })) } };
}

describe("XR hand roles", () => {
  it("picks two controllers when two sources have a gamepad, with the right hand pointing", () => {
    const left = controller("left");
    const right = controller("right");
    const roles = resolveXrHandRoles([left, right], { useOneController: false, leftHanded: false });

    expect(roles.layout).toBe("two-controllers");
    expect(roles.pointer).toBe(right);
    expect(roles.belt).toBe(left);
  });

  it("swaps the roles when left-handed", () => {
    const left = controller("left");
    const right = controller("right");
    const roles = resolveXrHandRoles([left, right], { useOneController: false, leftHanded: true });

    expect(roles.pointer).toBe(left);
    expect(roles.belt).toBe(right);
  });

  it("names one controller by its handedness, and handedness none counts as right", () => {
    const options = { useOneController: false, leftHanded: false };

    expect(resolveXrHandRoles([controller("left")], options).layout).toBe("one-left");
    expect(resolveXrHandRoles([controller("right")], options).layout).toBe("one-right");
    expect(resolveXrHandRoles([controller("none")], options).layout).toBe("one-right");
    expect(resolveXrHandRoles([], options).layout).toBeUndefined();
  });

  it("ignores sources without a gamepad when counting controllers", () => {
    const roles = resolveXrHandRoles([controller("left"), { handedness: "right" }], { useOneController: false, leftHanded: false });

    expect(roles.layout).toBe("one-left");
  });

  it("forces the pointer hand's controller with Use one controller", () => {
    const left = controller("left");
    const right = controller("right");

    expect(resolveXrHandRoles([left, right], { useOneController: true, leftHanded: false })).toMatchObject({ layout: "one-right", pointer: right });
    expect(resolveXrHandRoles([left, right], { useOneController: true, leftHanded: true })).toMatchObject({ layout: "one-left", pointer: left });
    expect(resolveXrHandRoles([left], { useOneController: true, leftHanded: false })).toMatchObject({ layout: "one-left", pointer: left });
  });

  it("times a tap and a hold", () => {
    const tracker = createTapOrHoldTracker(1000);

    expect(tracker.step(true, 0.4)).toEqual({ tap: false, hold: false });
    expect(tracker.step(false, 0.016)).toEqual({ tap: true, hold: false });
    expect(tracker.step(true, 0.6)).toEqual({ tap: false, hold: false });
    expect(tracker.step(true, 0.5)).toEqual({ tap: false, hold: true });
    expect(tracker.step(true, 0.5)).toEqual({ tap: false, hold: false });
    expect(tracker.step(false, 0.016)).toEqual({ tap: false, hold: false });
  });
});

describe("two controllers", () => {
  it("uses with the pointer-hand trigger and takes the next tool with the belt-hand trigger", () => {
    const controls = createXrControls();
    controls.consumeFrame([controller("left"), controller("right")], 0.016);

    const pointerTrigger = controls.consumeFrame([controller("left"), controller("right", [triggerButton])], 0.016);
    expect(pointerTrigger.primaryActionRequested).toBe(true);
    expect(pointerTrigger.nextToolRequested).toBe(false);
    controls.consumeFrame([controller("left"), controller("right")], 0.016);

    const beltTrigger = controls.consumeFrame([controller("left", [triggerButton]), controller("right")], 0.016);
    expect(beltTrigger.nextToolRequested).toBe(true);
    expect(beltTrigger.primaryActionRequested).toBe(false);
  });

  it("swaps which trigger uses and which takes the next tool when left-handed", () => {
    const controls = createXrControls({}, { useOneController: false, leftHanded: true });
    controls.consumeFrame([controller("left"), controller("right")], 0.016);

    const leftTrigger = controls.consumeFrame([controller("left", [triggerButton]), controller("right")], 0.016);
    expect(leftTrigger.primaryActionRequested).toBe(true);
    expect(leftTrigger.nextToolRequested).toBe(false);
    controls.consumeFrame([controller("left"), controller("right")], 0.016);

    expect(controls.consumeFrame([controller("left"), controller("right", [triggerButton])], 0.016).nextToolRequested).toBe(true);
  });

  it("gives the pointer hand menu, pick up and what's this; the belt hand hand and main menu", () => {
    const controls = createXrControls();
    const idle = [controller("left"), controller("right")];
    controls.consumeFrame(idle, 0.016);

    expect(controls.consumeFrame([controller("left"), controller("right", [gripButton])], 0.016)).toMatchObject({ interactRequested: true, handRequested: false });
    controls.consumeFrame(idle, 0.016);
    expect(controls.consumeFrame([controller("left"), controller("right", [lowerFaceButton])], 0.016)).toMatchObject({ carryActionRequested: true, mainMenuRequested: false });
    controls.consumeFrame(idle, 0.016);
    expect(controls.consumeFrame([controller("left"), controller("right", [upperFaceButton])], 0.016).helpRequested).toBe(true);
    controls.consumeFrame(idle, 0.016);

    expect(controls.consumeFrame([controller("left", [gripButton]), controller("right")], 0.016)).toMatchObject({ handRequested: true, interactRequested: false });
    controls.consumeFrame(idle, 0.016);
    expect(controls.consumeFrame([controller("left", [lowerFaceButton]), controller("right")], 0.016)).toMatchObject({ mainMenuRequested: true, carryActionRequested: false });
    controls.consumeFrame(idle, 0.016);
    // The belt hand's upper face button is unbound.
    const unbound = controls.consumeFrame([controller("left", [upperFaceButton]), controller("right")], 0.016);
    expect(unbound.helpRequested).toBe(false);
    expect(unbound.mainMenuRequested).toBe(false);
  });

  it("walks with the belt-hand stick only and turns with either stick", () => {
    const options = { moveSpeedMetersPerSecond: 2, turnSpeedRadiansPerSecond: 1 };
    const pointerPushedForward = createXrInputFrame([controller("left"), controller("right", [], [0, 0, 0, -1])], 1, options);
    const beltPushedForward = createXrInputFrame([controller("left", [], [0, 0, 0, -1]), controller("right")], 1, options);
    const pointerTurn = createXrInputFrame([controller("left"), controller("right", [], [0, 0, 1, 0])], 1, options);

    expect(pointerPushedForward.localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
    expect(beltPushedForward.localDisplacement).toEqual({ x: 0, y: 2, z: 0 });
    expect(pointerTurn.yawDeltaRadians).toBeCloseTo(-1);
  });

  it("does not take the next tool from the stick press", () => {
    const controls = createXrControls();
    controls.consumeFrame([controller("left"), controller("right")], 0.016);

    expect(controls.consumeFrame([controller("left", [stickPressButton]), controller("right", [stickPressButton])], 0.016).nextToolRequested).toBe(false);
  });
});

describe("one controller", () => {
  for (const handedness of ["left", "right"]) {
    describe(`one ${handedness} controller`, () => {
      it("uses with the trigger, opens menus with the grip and picks up with the lower face button", () => {
        const controls = createXrControls();
        controls.consumeFrame([controller(handedness)], 0.016);

        expect(controls.consumeFrame([controller(handedness, [triggerButton])], 0.016).primaryActionRequested).toBe(true);
        controls.consumeFrame([controller(handedness)], 0.016);
        expect(controls.consumeFrame([controller(handedness, [gripButton])], 0.016).interactRequested).toBe(true);
        controls.consumeFrame([controller(handedness)], 0.016);
        expect(controls.consumeFrame([controller(handedness, [lowerFaceButton])], 0.016).carryActionRequested).toBe(true);
      });

      it("takes the next tool with the stick press while the stick rests", () => {
        const controls = createXrControls();
        controls.consumeFrame([controller(handedness)], 0.016);

        const frame = controls.consumeFrame([controller(handedness, [stickPressButton], [0, 0, 0.05, -0.05])], 0.016);
        expect(frame.nextToolRequested).toBe(true);
        expect(frame.resetRequested).toBe(false);
      });

      it("ignores a stick press while the stick is pushed, even if it rests with the press held", () => {
        const controls = createXrControls();
        controls.consumeFrame([controller(handedness)], 0.016);

        expect(controls.consumeFrame([controller(handedness, [stickPressButton], [0, 0, 0, -0.9])], 0.016).nextToolRequested).toBe(false);
        expect(controls.consumeFrame([controller(handedness, [stickPressButton], [0, 0, 0, 0])], 0.016).nextToolRequested).toBe(false);
      });

      it("walks with stick y and turns with stick x", () => {
        const frame = createXrInputFrame([controller(handedness, [], [0, 0, 1, -1])], 1, { moveSpeedMetersPerSecond: 2, turnSpeedRadiansPerSecond: 1 });

        expect(frame.localDisplacement).toEqual({ x: 0, y: 2, z: 0 });
        expect(frame.yawDeltaRadians).toBeCloseTo(-1);
      });

      it("taps the upper face button for What's this? on release, before 1 s", () => {
        const controls = createXrControls();
        controls.consumeFrame([controller(handedness)], 0.016);

        const down = controls.consumeFrame([controller(handedness, [upperFaceButton])], 0.3);
        expect(down.helpRequested).toBe(false);
        expect(down.mainMenuRequested).toBe(false);
        const up = controls.consumeFrame([controller(handedness)], 0.016);
        expect(up.helpRequested).toBe(true);
        expect(up.mainMenuRequested).toBe(false);
      });

      it("opens the main menu when the upper face button is held 1 s; the release is no tap", () => {
        const controls = createXrControls();
        controls.consumeFrame([controller(handedness)], 0.016);

        expect(controls.consumeFrame([controller(handedness, [upperFaceButton])], 0.5).mainMenuRequested).toBe(false);
        const hold = controls.consumeFrame([controller(handedness, [upperFaceButton])], 0.5);
        expect(hold.mainMenuRequested).toBe(true);
        expect(controls.consumeFrame([controller(handedness, [upperFaceButton])], 0.5).mainMenuRequested).toBe(false);
        expect(controls.consumeFrame([controller(handedness)], 0.016).helpRequested).toBe(false);
      });
    });
  }

  it("reports the layout of the frame", () => {
    const controls = createXrControls();

    expect(controls.layout()).toBeUndefined();
    expect(controls.consumeFrame([controller("left")], 0.016).xrLayout).toBe("one-left");
    expect(controls.layout()).toBe("one-left");
    expect(controls.consumeFrame([controller("right")], 0.016).xrLayout).toBe("one-right");
  });

  it("switches layout when a controller is removed, raising no request on that frame", () => {
    const controls = createXrControls();
    const both = [controller("left"), controller("right")];
    expect(controls.consumeFrame(both, 0.016).xrLayout).toBe("two-controllers");

    // The belt hand's trigger was held (next tool in the two-controller layout); the controller then vanishes and the right one remains.
    controls.consumeFrame([controller("left", [triggerButton]), controller("right")], 0.016);
    const switched = controls.consumeFrame([controller("right", [triggerButton])], 0.016);
    expect(switched.xrLayout).toBe("one-right");
    expect(switched.primaryActionRequested).toBe(false);
    expect(controls.layout()).toBe("one-right");
  });

  it("applies the Use one controller switch from the next frame", () => {
    const controls = createXrControls();
    const both = [controller("left"), controller("right")];
    controls.consumeFrame(both, 0.016);

    controls.setHandOptions({ useOneController: true, leftHanded: false });
    expect(controls.consumeFrame(both, 0.016).xrLayout).toBe("one-right");
  });
});
