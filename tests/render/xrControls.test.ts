import { describe, expect, it } from "vitest";
import { combineStickAxes, createXrControls, createXrInputFrame, isCarryActionPressed, isHelpPressed, isInteractPressed, isResetPressed, readPrimaryStickAxes } from "../../src/render/three/xrControls";

describe("XR controls", () => {
  it("never throws and returns no movement when gamepad data is missing", () => {
    const frame = createXrInputFrame([{ handedness: "left" }], 1);

    expect(frame.localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
    expect(frame.yawDeltaRadians).toBe(0);
    expect(frame.source).toBe("xr");
  });

  it("reads thumbstick axes defensively across common WebXR layouts", () => {
    expect(readPrimaryStickAxes({ axes: [0, 0, 0.25, -0.5] })).toEqual({ x: 0.25, y: -0.5 });
    expect(readPrimaryStickAxes({ axes: [0.3, -0.4] })).toEqual({ x: 0.3, y: -0.4 });
  });

  it("maps either stick to forward locomotion and continuous rotation", () => {
    const frame = createXrInputFrame(
      [
        { handedness: "left", gamepad: { axes: [0, 0, 0.25, -1] } },
        { handedness: "right", gamepad: { axes: [0, 0, 0.75, -0.5] } },
      ],
      1,
      {
        moveSpeedMetersPerSecond: 1.5,
        turnSpeedRadiansPerSecond: 1,
      },
    );

    expect(frame.localDisplacement).toEqual({ x: 0, y: 1.5, z: 0 });
    expect(frame.yawDeltaRadians).toBeCloseTo(-1);
    expect(frame.pitchDeltaRadians).toBe(0);
  });

  it("does not strafe from either controller joystick", () => {
    const leftOnly = createXrInputFrame(
      [{ handedness: "left", gamepad: { axes: [0, 0, 1, -0.5] } }],
      1,
      { moveSpeedMetersPerSecond: 1.5, turnSpeedRadiansPerSecond: 1 },
    );
    const rightOnly = createXrInputFrame(
      [{ handedness: "right", gamepad: { axes: [0, 0, -1, -0.5] } }],
      1,
      { moveSpeedMetersPerSecond: 1.5, turnSpeedRadiansPerSecond: 1 },
    );

    expect(leftOnly.localDisplacement).toEqual({ x: 0, y: 0.75, z: 0 });
    expect(leftOnly.yawDeltaRadians).toBeCloseTo(-1);
    expect(rightOnly.localDisplacement).toEqual({ x: 0, y: 0.75, z: 0 });
    expect(rightOnly.yawDeltaRadians).toBeCloseTo(1);
  });

  it("combines both controller joysticks with clamped axes", () => {
    expect(combineStickAxes([
      { x: 0.75, y: -0.75 },
      { x: 0.75, y: -0.75 },
    ])).toEqual({ x: 1, y: -1 });
  });

  it("dead-zones small controller rotation", () => {
    const frame = createXrInputFrame(
      [
        { handedness: "left", gamepad: { axes: [0, 0, 0, 0] } },
        { handedness: "right", gamepad: { axes: [0, 0, 0.1, 0] } },
      ],
      1,
      { joystickDeadZone: 0.18 },
    );

    expect(frame.yawDeltaRadians).toBe(0);
  });

  it("maps thumbstick click style buttons to reset without consuming menu buttons", () => {
    expect(isResetPressed({ buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: true }] }))
      .toBe(true);
    expect(isResetPressed({ buttons: [{ pressed: false }, { pressed: true }] })).toBe(false);
    expect(
      createXrInputFrame([
        { gamepad: { buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: true }] } },
      ], 1).resetRequested,
    ).toBe(true);
  });

  it("reports reset as a thumbstick-click edge in stateful controls", () => {
    const controls = createXrControls();
    const buttons = (down: boolean) => ({ gamepad: { buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: down }] } });

    expect(controls.consumeFrame([buttons(false)], 1).resetRequested).toBe(false);
    expect(controls.consumeFrame([buttons(true)], 1).resetRequested).toBe(true);
    expect(controls.consumeFrame([buttons(true)], 1).resetRequested).toBe(false);
    expect(controls.consumeFrame([buttons(false)], 1).resetRequested).toBe(false);
    expect(controls.consumeFrame([buttons(true)], 1).resetRequested).toBe(true);
  });

  it("treats NaN stick axes as zero", () => {
    expect(readPrimaryStickAxes({ axes: [Number.NaN, 0.5] })).toEqual({ x: 0, y: 0.5 });
    expect(readPrimaryStickAxes({ axes: [0, 0, Number.NaN, Number.NaN] })).toEqual({ x: 0, y: 0 });
  });

  it("reports trigger as a primary action edge in stateful controls", () => {
    const controls = createXrControls();
    const released = { gamepad: { buttons: [{ pressed: false }] } };
    const pressed = { gamepad: { buttons: [{ pressed: true }] } };

    expect(controls.consumeFrame([released], 1).primaryActionRequested).toBe(false);
    expect(controls.consumeFrame([pressed], 1).primaryActionRequested).toBe(true);
    expect(controls.consumeFrame([pressed], 1).primaryActionRequested).toBe(false);
    expect(controls.consumeFrame([released], 1).primaryActionRequested).toBe(false);
  });

  it("maps side trigger buttons to object context interaction edges", () => {
    const controls = createXrControls();
    const released = {
      gamepad: {
        buttons: [
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
        ],
      },
    };
    const pressed = {
      gamepad: {
        buttons: [
          { pressed: false },
          { pressed: true },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
        ],
      },
    };

    expect(isInteractPressed(pressed.gamepad)).toBe(true);
    expect(createXrInputFrame([pressed], 1).interactRequested).toBe(true);
    expect(controls.consumeFrame([released], 1).interactRequested).toBe(false);
    expect(controls.consumeFrame([pressed], 1).interactRequested).toBe(true);
    expect(controls.consumeFrame([pressed], 1).interactRequested).toBe(false);
    expect(controls.consumeFrame([released], 1).interactRequested).toBe(false);
  });

  it("does not treat A or B face buttons as object context interaction", () => {
    const aPressed = {
      buttons: [
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: true },
        { pressed: false },
      ],
    };
    const bPressed = {
      buttons: [
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: true },
      ],
    };

    expect(isInteractPressed(aPressed)).toBe(false);
    expect(isInteractPressed(bPressed)).toBe(false);
  });

  it("maps button 4 to carry edges", () => {
    const controls = createXrControls();
    const buttons = (index: number | undefined) =>
      Array.from({ length: 6 }, (_, i) => ({ pressed: i === index }));
    const released = { handedness: "right", gamepad: { buttons: buttons(undefined) } };
    const pressed = { handedness: "right", gamepad: { buttons: buttons(4) } };
    const leftPressed = { handedness: "left", gamepad: { buttons: buttons(4) } };
    const sidePressed = { handedness: "right", gamepad: { buttons: buttons(1) } };
    const helpPressed = { handedness: "right", gamepad: { buttons: buttons(5) } };

    expect(isCarryActionPressed(pressed)).toBe(true);
    expect(isCarryActionPressed(leftPressed)).toBe(true);
    expect(isCarryActionPressed(sidePressed)).toBe(false);
    expect(isCarryActionPressed(helpPressed)).toBe(false);
    expect(isCarryActionPressed({ handedness: "right" })).toBe(false);
    expect(createXrInputFrame([pressed], 1).carryActionRequested).toBe(true);
    expect(controls.consumeFrame([released], 1).carryActionRequested).toBe(false);
    expect(controls.consumeFrame([pressed], 1).carryActionRequested).toBe(true);
    expect(controls.consumeFrame([pressed], 1).carryActionRequested).toBe(false);
    expect(controls.consumeFrame([released], 1).carryActionRequested).toBe(false);
  });

  it("maps the help face button to help edges", () => {
    const controls = createXrControls();
    const released = { gamepad: { buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }] } };
    const pressed = { gamepad: { buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: true }] } };

    expect(isHelpPressed(pressed.gamepad)).toBe(true);
    expect(createXrInputFrame([pressed], 1).helpRequested).toBe(true);
    expect(controls.consumeFrame([released], 1).helpRequested).toBe(false);
    expect(controls.consumeFrame([pressed], 1).helpRequested).toBe(true);
    expect(controls.consumeFrame([pressed], 1).helpRequested).toBe(false);
    expect(controls.consumeFrame([released], 1).helpRequested).toBe(false);
  });
});
