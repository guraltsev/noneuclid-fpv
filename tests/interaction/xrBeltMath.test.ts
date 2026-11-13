/**
 * Placement maths of the VR tool belt (src/interaction/xrBeltMath.ts, design 017 sections 7.3 and 7.4): which slot a
 * point on the strap falls in, when the wrist belt grows (head forward within 25 degrees of the strap), where the
 * waist belt stands (0.35 m ahead along the head yaw, head height minus 0.55 m but 0.6 m above the floor) and the
 * low toast panel (0.6 m ahead, 0.3 m below eye level). Plain vectors; no renderer.
 */
import { describe, expect, it } from "vitest";
import {
  angleBetweenForwardAndTargetDegrees,
  beltEnlargedScale,
  beltSlotAtLocalPoint,
  beltSlotCenterX,
  beltSlotPitchMeters,
  beltStrapLengthMeters,
  lerpAngle,
  resolveLowToastPose,
  resolveWaistBeltPose,
  waistBeltHeight,
  wristBeltScale,
  yawOfForward,
} from "../../src/interaction/xrBeltMath";

describe("strap slots", () => {
  it("finds the slot under a point on the strap and nothing outside it", () => {
    const count = 7;
    const half = beltStrapLengthMeters(count) / 2;

    expect(beltSlotAtLocalPoint(-half + 0.001, 0, count)).toBe(0);
    expect(beltSlotAtLocalPoint(half - 0.001, 0, count)).toBe(6);
    expect(beltSlotAtLocalPoint(0, 0, count)).toBe(3);
    expect(beltSlotAtLocalPoint(half + 0.01, 0, count)).toBeUndefined();
    expect(beltSlotAtLocalPoint(0, 0.2, count)).toBeUndefined();
    expect(beltSlotAtLocalPoint(0, 0, 0)).toBeUndefined();
    expect(beltSlotAtLocalPoint(Number.NaN, 0, count)).toBeUndefined();
  });

  it("agrees between slot centers and the slot found at that center", () => {
    for (let index = 0; index < 7; index += 1) {
      expect(beltSlotAtLocalPoint(beltSlotCenterX(index, 7), 0, 7)).toBe(index);
    }
    expect(beltSlotCenterX(1, 7) - beltSlotCenterX(0, 7)).toBeCloseTo(beltSlotPitchMeters);
  });
});

describe("wrist belt scale", () => {
  const head = { x: 0, y: 1.6, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  it("is 1.8 when the strap is within 25 degrees of where the head looks", () => {
    expect(wristBeltScale(forward, head, { x: 0.1, y: 1.6, z: -0.5 })).toBe(beltEnlargedScale);
  });

  it("is 1 when the strap is further off axis, or behind", () => {
    expect(wristBeltScale(forward, head, { x: 0.5, y: 1.6, z: -0.5 })).toBe(1);
    expect(wristBeltScale(forward, head, { x: 0, y: 1.6, z: 0.5 })).toBe(1);
  });

  it("switches at exactly 25 degrees", () => {
    const angle = (25 * Math.PI) / 180;
    const justInside = { x: Math.sin(angle - 0.01), y: 1.6, z: -Math.cos(angle - 0.01) };
    const justOutside = { x: Math.sin(angle + 0.01), y: 1.6, z: -Math.cos(angle + 0.01) };

    expect(wristBeltScale(forward, head, justInside)).toBe(beltEnlargedScale);
    expect(wristBeltScale(forward, head, justOutside)).toBe(1);
    expect(angleBetweenForwardAndTargetDegrees(forward, head, { x: 0, y: 1.6, z: -1 })).toBeCloseTo(0);
    expect(angleBetweenForwardAndTargetDegrees(forward, head, head)).toBe(180);
  });
});

describe("waist belt", () => {
  it("hangs 0.55 m below the head, but at least 0.6 m above the floor", () => {
    expect(waistBeltHeight(1.7, 0)).toBeCloseTo(1.15);
    expect(waistBeltHeight(1.0, 0)).toBeCloseTo(0.6);
    expect(waistBeltHeight(1.0, 0.2)).toBeCloseTo(0.8);
  });

  it("stands 0.35 m ahead along the head yaw and ignores the head pitch", () => {
    const head = { x: 2, y: 1.7, z: 3 };
    const level = resolveWaistBeltPose({ headPosition: head, headForward: { x: 0, y: 0, z: -1 }, floorY: 0 });
    const lookingDown = resolveWaistBeltPose({ headPosition: head, headForward: { x: 0, y: -0.9, z: -0.1 }, floorY: 0 });

    expect(level.position.x).toBeCloseTo(2);
    expect(level.position.z).toBeCloseTo(3 - 0.35);
    expect(level.position.y).toBeCloseTo(1.15);
    expect(lookingDown.position.x).toBeCloseTo(2);
    expect(lookingDown.position.z).toBeCloseTo(3 - 0.35, 1);
    expect(lookingDown.position.y).toBeCloseTo(level.position.y);
  });

  it("follows the head yaw to the side", () => {
    // Looking along +x: yaw is -90 degrees; the belt is 0.35 m along +x.
    const pose = resolveWaistBeltPose({ headPosition: { x: 0, y: 1.7, z: 0 }, headForward: { x: 1, y: 0, z: 0 }, floorY: 0 });

    expect(pose.position.x).toBeCloseTo(0.35);
    expect(pose.position.z).toBeCloseTo(0);
    expect(pose.yawRadians).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps its yaw while the head looks straight down", () => {
    const first = resolveWaistBeltPose({ headPosition: { x: 0, y: 1.7, z: 0 }, headForward: { x: 1, y: 0, z: 0 }, floorY: 0 });
    const down = resolveWaistBeltPose({ headPosition: { x: 0, y: 1.7, z: 0 }, headForward: { x: 0, y: -1, z: 0 }, floorY: 0, previous: first });

    expect(down.yawRadians).toBeCloseTo(first.yawRadians);
  });

  it("smooths toward the target by the factor each call", () => {
    const previous = { position: { x: 0, y: 1, z: 0 }, yawRadians: 0 };
    const next = resolveWaistBeltPose({ headPosition: { x: 10, y: 1.7, z: 0 }, headForward: { x: 0, y: 0, z: -1 }, floorY: 0, previous, smoothing: 0.5 });

    expect(next.position.x).toBeCloseTo(5);
    expect(next.position.y).toBeCloseTo(1.075);
  });

  it("turns the short way round the circle", () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + ((2 * Math.PI - 6) / 2));
    expect(yawOfForward({ x: 0, y: 0, z: -1 }, 5)).toBeCloseTo(0);
    expect(yawOfForward({ x: 0, y: -1, z: 0 }, 5)).toBe(5);
  });
});

describe("low toast panel", () => {
  it("stands 0.6 m ahead and 0.3 m below the eyes, following the yaw", () => {
    const pose = resolveLowToastPose({ headPosition: { x: 1, y: 1.6, z: 1 }, headForward: { x: 0, y: 0.3, z: -1 } });

    expect(pose.position.x).toBeCloseTo(1);
    expect(pose.position.z).toBeCloseTo(0.4);
    expect(pose.position.y).toBeCloseTo(1.3);
  });
});
