import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createXrDebugPanelRedrawGate,
  describeXrInputMode,
  isXrDebugPanelVisible,
  resolveXrDebugPanelPose,
  wrapXrDebugPanelLines,
} from "../../src/render/three/xrDebugPanel";

describe("xrDebugPanel", () => {
  it("wraps lines at separators, cuts long parts and truncates the line count", () => {
    expect(wrapXrDebugPanelLines(["aaaa / bbbb / cccc"], 11)).toEqual(["aaaa / bbbb", "cccc"]);

    const cut = wrapXrDebugPanelLines(["x".repeat(70)]);
    expect(cut).toHaveLength(1);
    expect(cut[0]).toHaveLength(64);

    const many = wrapXrDebugPanelLines(Array.from({ length: 20 }, (_, i) => `l${i}`), 64, 14);
    expect(many).toHaveLength(14);
    expect(many[13]).toBe("... (+7 lines)");
  });

  it("places the panel in the head frame", () => {
    const identity = resolveXrDebugPanelPose({
      position: new THREE.Vector3(1, 1.6, 2),
      quaternion: new THREE.Quaternion(),
    });
    expect(identity.position.x).toBeCloseTo(0.83, 9);
    expect(identity.position.y).toBeCloseTo(1.7, 9);
    expect(identity.position.z).toBeCloseTo(1.45, 9);
    expect(identity.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);

    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const pose = resolveXrDebugPanelPose({ position: new THREE.Vector3(1, 1.6, 2), quaternion: turned });
    expect(pose.position.x).toBeCloseTo(0.45, 9);
    expect(pose.position.y).toBeCloseTo(1.7, 9);
    expect(pose.position.z).toBeCloseTo(2.17, 9);
    expect(pose.quaternion.angleTo(turned)).toBeLessThan(1e-9);
  });

  it("is visible only when XR, debug and the overlay are all on", () => {
    for (const mask of range(8)) {
      const xrActive = (mask & 1) !== 0;
      const debugEnabled = (mask & 2) !== 0;
      const debugOverlayEnabled = (mask & 4) !== 0;
      expect(isXrDebugPanelVisible({ xrActive, debugEnabled, debugOverlayEnabled })).toBe(mask === 7);
    }
  });

  it("gates redraws by change and interval", () => {
    const gate = createXrDebugPanelRedrawGate(250);
    expect(gate.shouldRedraw("a", 0)).toBe(true);
    expect(gate.shouldRedraw("a", 100)).toBe(false);
    expect(gate.shouldRedraw("b", 100)).toBe(false);
    expect(gate.shouldRedraw("b", 260)).toBe(true);
    expect(gate.shouldRedraw("b", 600)).toBe(false);
    expect(gate.shouldRedraw("c", 600)).toBe(true);
  });

  it("describes the XR input mode", () => {
    expect(describeXrInputMode([])).toBe("none");
    expect(describeXrInputMode([{}, {}])).toBe("controllers");
    expect(describeXrInputMode([{ hand: {} }, { hand: {} }])).toBe("hands");
    expect(describeXrInputMode([{}, { hand: {} }])).toBe("hybrid");
  });
});

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
