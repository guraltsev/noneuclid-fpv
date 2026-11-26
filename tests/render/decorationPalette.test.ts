/**
 * `tests/render/decorationPalette.test.ts` — unit tier.
 *
 * Recolouring a decoration clones its materials (the shared preloaded asset keeps its colours), gives each distinct material a palette role
 * in turn, keeps each colour's brightness and moves its hue towards the role colour.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { recolorDecoration, recoloredDecorationColor } from "../../src/render/three/decorationPalette";
import { buildFacePalette } from "../../src/world-assets/facePalettes";

const luminance = (color: THREE.Color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

describe("recolorDecoration", () => {
  it("clones shared materials and recolours each distinct one once", () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const other = new THREE.MeshStandardMaterial({ color: 0x404040 });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), [other, shared]));

    expect(recolorDecoration(root, buildFacePalette(0, "analogous"))).toBe(2);
    expect(shared.color.getHex()).toBe(0x808080);
    const [first, second, third] = root.children as THREE.Mesh[];
    expect(first.material).toBe(second.material);
    expect(first.material).not.toBe(shared);
    expect((third.material as THREE.Material[])[1]).toBe(first.material);
  });

  it("keeps the brightness and turns the hue towards the palette", () => {
    const grey = new THREE.Color(0.3, 0.3, 0.3);
    const red = new THREE.Color(0.8, 0.3, 0.25);
    const result = recoloredDecorationColor(grey, red, 1);
    expect(luminance(result)).toBeCloseTo(luminance(grey), 2);
    expect(result.r).toBeGreaterThan(result.g);
    expect(recoloredDecorationColor(grey, red, 0).equals(grey)).toBe(true);
  });
});
