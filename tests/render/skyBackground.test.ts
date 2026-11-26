/**
 * `tests/render/skyBackground.test.ts` — unit tier.
 *
 * The dusk sky is glowing gold at the horizon, green and teal above, deep teal-blue from 70 degrees up and a pale moon exactly at the
 * zenith (last data row), with dark warm haze at the bottom; it needs no canvas; and the plane under the cells takes the dark earth colour.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GROUND_HAZE_COLOR,
  SKY_GREEN_COLOR,
  SKY_HORIZON_COLOR,
  SKY_LOW_GOLD_COLOR,
  SKY_MOON_COLOR,
  SKY_TEAL_COLOR,
  SKY_ZENITH_COLOR,
  UNDER_FLOOR_COLOR,
} from "../../src/render/three/sceneColors";
import { createSkyBackgroundTexture, skyColorAtElevation, skyMoonRadiusDegrees } from "../../src/render/three/skyBackground";
import { createUnderCellInfinityFloor } from "../../src/render/three/underCellFloor";

const bytes = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const at = (degrees: number) => {
  const color = skyColorAtElevation((degrees * Math.PI) / 180);
  return [color.r, color.g, color.b].map((v) => Math.round(v * 255));
};

describe("sky background", () => {
  it("is glowing gold at the horizon and runs through gold, green and teal", () => {
    expect(at(0)).toEqual(bytes(SKY_HORIZON_COLOR));
    expect(at(6)).toEqual(bytes(SKY_LOW_GOLD_COLOR));
    expect(at(20)).toEqual(bytes(SKY_GREEN_COLOR));
    expect(at(45)).toEqual(bytes(SKY_TEAL_COLOR));
    expect(at(-90)).toEqual(bytes(GROUND_HAZE_COLOR));
  });

  it("is deep teal-blue from 70 degrees up to the moon, and pale moon at the zenith", () => {
    expect(at(70)).toEqual(bytes(SKY_ZENITH_COLOR));
    expect(at(77)).toEqual(bytes(SKY_ZENITH_COLOR));
    expect(at(90)).toEqual(bytes(SKY_MOON_COLOR));
    expect(at(90 - skyMoonRadiusDegrees + 1)).toEqual(bytes(SKY_MOON_COLOR));
    // The halo lifts the sky next to the disc, and fades out by 12 degrees from the zenith.
    expect(at(90 - skyMoonRadiusDegrees - 1)[0]).toBeGreaterThan(at(77)[0]);
    expect(at(78)).toEqual(bytes(SKY_ZENITH_COLOR));
  });

  it("builds a 1 x 1024 equirectangular texture with the moon in the last row", () => {
    const texture = createSkyBackgroundTexture();
    const data = texture.image.data as Uint8Array;
    expect([texture.image.width, texture.image.height]).toEqual([1, 1024]);
    expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.generateMipmaps).toBe(false);
    expect(Array.from(data.slice(1023 * 4, 1023 * 4 + 3))).toEqual(bytes(SKY_MOON_COLOR));
    expect(Array.from(data.slice(0, 3))).toEqual(bytes(GROUND_HAZE_COLOR));
    // Just under the moon (elevation 80 degrees) the sky is still the deep blue.
    const row = Math.floor((80 / 180 + 0.5) * 1024);
    expect(data[row * 4 + 2]).toBeGreaterThan(data[row * 4]);
    texture.dispose();
  });

  it("colours the plane under the cells with the dark earth tone", () => {
    const floor = createUnderCellInfinityFloor();
    expect((floor.material as THREE.MeshBasicMaterial).color.getHex()).toBe(UNDER_FLOOR_COLOR);
  });
});
