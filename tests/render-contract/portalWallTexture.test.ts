import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPortalWallDataTexture } from "../../src/render/three/portalWallTexture";

describe("createPortalWallDataTexture", () => {
  it("generates a 64x64 sRGB checkerboard with 8-pixel squares", () => {
    const texture = createPortalWallDataTexture();
    const data = texture.image.data as Uint8Array;
    const pixel = (x: number, y: number) => Array.from(data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    const lavender = [0xe6, 0xe6, 0xfa, 255];
    const slate = [0x6a, 0x5a, 0xcd, 255];

    expect(texture.image.width).toBe(64);
    expect(texture.image.height).toBe(64);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(pixel(0, 0)).toEqual(lavender);
    expect(pixel(8, 0)).toEqual(slate);
    expect(pixel(8, 8)).toEqual(lavender);
    expect(pixel(63, 0)).toEqual(slate);
    texture.dispose();
  });
});
