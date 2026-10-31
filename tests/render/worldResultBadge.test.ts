/**
 * World result badge (src/render/three/worldResultBadge.ts): a floating text "pill", with an optional downward
 * pointer, used as an in-world label for a measured length or angle. Double-faced badges build two meshes (front
 * and back) at the requested render order, each facing +z in its own local frame.
 */
import { describe, expect, it } from "vitest";
import { createWorldResultBadge } from "../../src/render/three/worldResultBadge";

describe("worldResultBadge", () => {
  it("creates double-faced persistent result badge meshes", () => {
    const badge = createWorldResultBadge({
      text: "G1 length = 5 m",
      variant: "length",
      widthMeters: 0.5,
      heightMeters: 0.15625,
      pointer: "down",
      doubleFaced: true,
      renderOrder: 57,
    });

    expect(badge.children).toHaveLength(2);
    expect(badge.children.map((child) => child.name)).toEqual([
      "world-result-badge:front",
      "world-result-badge:back",
    ]);
    expect(badge.children.every((child) => child.renderOrder === 57)).toBe(true);
  });
});

