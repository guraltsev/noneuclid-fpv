/**
 * The VR tool belt (src/render/three/xrToolBelt.ts, design 017 sections 7.3 and 7.4): one strap of slots that stays
 * hidden without a layout, hangs at the waist in front of the player with one controller, lies on the belt-hand grip
 * with two (and grows while the head looks at it), and can be picked with a ray. The canvas is the shared fake, so
 * only the geometry, the visibility and the picking are checked, not the pixels.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { beltDrawingSignature, beltCaptionText, createXrToolBelt } from "../../src/render/three/xrToolBelt";
import { createToolBeltDefinition } from "../../src/ui/toolBeltDefinition";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";

const definition = createToolBeltDefinition({ appConfig: defaultAppConfig, worldHasMap: true, selectedTool: "none" });
const head = { position: new THREE.Vector3(0, 1.7, 0), quaternion: new THREE.Quaternion() };

describe("XR tool belt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeCanvas2d();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays hidden without a layout, a head, or (two controllers) a belt-hand grip", () => {
    const scene = new THREE.Scene();
    const belt = createXrToolBelt(scene);

    belt.update({ definition, layout: undefined, head });
    expect(belt.isVisible()).toBe(false);
    belt.update({ definition, layout: "one-right", head: undefined });
    expect(belt.isVisible()).toBe(false);
    belt.update({ definition, layout: "two-controllers", head });
    expect(belt.isVisible()).toBe(false);
    expect(belt.pick({ origin: new THREE.Vector3(0, 2, 0), direction: new THREE.Vector3(0, -1, 0) })).toBeUndefined();
    belt.dispose();
  });

  it("hangs at the waist, 0.35 m ahead of a player who looks along -z", () => {
    const belt = createXrToolBelt(new THREE.Scene());

    belt.update({ definition, layout: "one-right", head });
    const position = belt.position();

    expect(belt.isVisible()).toBe(true);
    expect(position?.x).toBeCloseTo(0);
    expect(position?.y).toBeCloseTo(1.15);
    expect(position?.z).toBeCloseTo(-0.35);
    belt.dispose();
  });

  it("picks the slot a ray hits and nothing beside the strap", () => {
    const belt = createXrToolBelt(new THREE.Scene());
    belt.update({ definition, layout: "one-right", head });
    const center = belt.position() as THREE.Vector3;
    const down = new THREE.Vector3(0, -1, 0);
    // A strap tilted about 50 degrees from facing the player is hit by a ray from above and in front of it.
    const aimAt = (offsetAlongStrap: number): { origin: THREE.Vector3; direction: THREE.Vector3 } => {
      const target = center.clone().add(new THREE.Vector3(offsetAlongStrap, 0, 0));
      const origin = target.clone().add(new THREE.Vector3(0, 0.5, 0.2));
      return { origin, direction: target.clone().sub(origin).normalize() };
    };

    expect(belt.pick(aimAt(0))?.slot.toolId).toBe(definition.slots[Math.floor(definition.slots.length / 2)].toolId);
    expect(belt.pick(aimAt(-0.19))?.index).toBe(0);
    expect(belt.pick(aimAt(0.19))?.index).toBe(definition.slots.length - 1);
    expect(belt.pick(aimAt(1))).toBeUndefined();
    expect(belt.pick({ origin: new THREE.Vector3(0, 3, 3), direction: down })).toBeUndefined();
    belt.dispose();
  });

  it("lies on the belt-hand grip with two controllers and grows while the head looks at it", () => {
    const belt = createXrToolBelt(new THREE.Scene());
    const gripAhead = new THREE.Matrix4().makeTranslation(0, 1.5, -0.4);
    const gripAside = new THREE.Matrix4().makeTranslation(1.2, 1.5, -0.4);

    for (let frame = 0; frame < 40; frame += 1) belt.update({ definition, layout: "two-controllers", head, beltGripWorldMatrix: gripAhead });
    expect(belt.isVisible()).toBe(true);
    const grown = belt.position();
    for (let frame = 0; frame < 40; frame += 1) belt.update({ definition, layout: "two-controllers", head, beltGripWorldMatrix: gripAside });

    expect(grown?.z).toBeLessThan(0);
    expect(belt.position()?.x).toBeGreaterThan(1);
    belt.dispose();
  });

  it("hides when asked and when a menu is open", () => {
    const belt = createXrToolBelt(new THREE.Scene());
    belt.update({ definition, layout: "one-left", head });
    belt.update({ definition, layout: "one-left", head, hidden: true });

    expect(belt.isVisible()).toBe(false);
    belt.dispose();
  });

  it("captions the hovered slot's subtitle or disabled reason, else the tool in hand", () => {
    const noMap = createToolBeltDefinition({ appConfig: defaultAppConfig, worldHasMap: false, selectedTool: "geodesicEmitters/emitter" });
    const mapIndex = noMap.slots.findIndex((slot) => slot.toolId === "worldMap/map");

    expect(beltCaptionText(noMap, undefined)).toBe("Laser");
    expect(beltCaptionText(noMap, mapIndex)).toContain("No map for this world");
    expect(beltCaptionText(definition, 0)).toContain(definition.slots[0].subtitle);
  });

  it("changes its drawing signature when the tool in hand or the hover changes", () => {
    const laser = createToolBeltDefinition({ appConfig: defaultAppConfig, worldHasMap: true, selectedTool: "geodesicEmitters/emitter" });

    expect(beltDrawingSignature(definition, undefined)).not.toBe(beltDrawingSignature(laser, undefined));
    expect(beltDrawingSignature(definition, undefined)).not.toBe(beltDrawingSignature(definition, 2));
    expect(beltDrawingSignature(definition, 2)).toBe(beltDrawingSignature(definition, 2));
  });
});
