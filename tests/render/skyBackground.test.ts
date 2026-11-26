/**
 * `tests/render/skyBackground.test.ts` — unit tier.
 *
 * The sky gradient has the zenith blue at the top (last data row), the horizon haze at the middle and the ground
 * haze at the bottom; it needs no canvas; and the plane under the cells takes the dark earth colour.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_HAZE_COLOR, SKY_HORIZON_COLOR, SKY_ZENITH_COLOR, UNDER_FLOOR_COLOR } from "../../src/render/three/sceneColors";
import { createSkyBackgroundTexture, skyColorAtElevation } from "../../src/render/three/skyBackground";
import { createUnderCellInfinityFloor } from "../../src/render/three/underCellFloor";

const bytes = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

describe("sky background", () => {
  it("hits the end colours of the gradient", () => {
    const zenith = skyColorAtElevation(Math.PI / 2);
    const horizon = skyColorAtElevation(0);
    const nadir = skyColorAtElevation(-Math.PI / 2);
    expect([zenith.r, zenith.g, zenith.b].map((v) => Math.round(v * 255))).toEqual(bytes(SKY_ZENITH_COLOR));
    expect([horizon.r, horizon.g, horizon.b].map((v) => Math.round(v * 255))).toEqual(bytes(SKY_HORIZON_COLOR));
    expect([nadir.r, nadir.g, nadir.b].map((v) => Math.round(v * 255))).toEqual(bytes(GROUND_HAZE_COLOR));
    expect(skyColorAtElevation((25 * Math.PI) / 180).b).toBeGreaterThan(zenith.b - 0.5);
  });

  it("builds a 1 x 256 equirectangular texture with the zenith in the last row", () => {
    const texture = createSkyBackgroundTexture();
    const data = texture.image.data as Uint8Array;
    expect([texture.image.width, texture.image.height]).toEqual([1, 256]);
    expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.generateMipmaps).toBe(false);
    const top = Array.from(data.slice(255 * 4, 255 * 4 + 3));
    const bottom = Array.from(data.slice(0, 3));
    expect(top[2]).toBeGreaterThan(top[0]);
    expect(top[0]).toBeLessThan(bottom[0]);
    expect(top).toEqual(bytes(SKY_ZENITH_COLOR));
    expect(bottom).toEqual(bytes(GROUND_HAZE_COLOR));
    texture.dispose();
  });

  it("colours the plane under the cells with the dark earth tone", () => {
    const floor = createUnderCellInfinityFloor();
    expect((floor.material as THREE.MeshBasicMaterial).color.getHex()).toBe(UNDER_FLOOR_COLOR);
  });
});
