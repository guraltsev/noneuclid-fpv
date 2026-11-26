/**
 * Recolours an authored decoration (a bench, a tree, a sign, ...) in the palette of the face it stands on (design 018 section 9.6), so
 * hand-placed models belong to their face like the generated landmarks do.
 *
 * The recolouring happens in the shader, after the texture: the surface colour (texture times material colour) loses
 * {@link decorationRecolorStrength} of its own colour, then takes the palette role's hue at the same brightness. So a textured model (most
 * of them are one white material with a texture) changes as much as a plain one: green leaves take the face's hue, and a dark trunk stays
 * dark with a trace of it. Every distinct material takes a role in turn (`primary`, `secondary`, `accent`, `light`).
 *
 * Material clones lose shader hooks, and the instanced copies of a model are made from clones, so the recolouring travels in
 * `material.userData.decorationRecolor` (which clones keep) and {@link applyDecorationRecolor} installs the hook on the clone that is drawn.
 */
import * as THREE from "three";
import type { FacePalette } from "../../world-assets/facePalettes";
import { hexToLinearRgb } from "../../world-assets/facePalettes";

/** How far a decoration loses its own colour to its palette role (0 keeps it, 1 is the role's hue at the model's brightness). */
export const decorationRecolorStrength = 0.85;
/** Largest multiplier a colour channel may get, so a saturated role colour keeps some brightness. */
export const decorationTintMaxChannel = 2;

const roles = ["primary", "secondary", "accent", "light"] as const;

/** What `material.userData.decorationRecolor` holds. */
export interface DecorationRecolor {
  /** Linear RGB multiplier: the role colour at unit luminance. */
  readonly tint: readonly [number, number, number];
  readonly strength: number;
}

/** The tint of a palette colour: its linear RGB at unit luminance, scaled down where a channel would exceed {@link decorationTintMaxChannel}. */
export function decorationTint(hex: string): readonly [number, number, number] {
  const [r, g, b] = hexToLinearRgb(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
  const channels = [r / luminance, g / luminance, b / luminance] as const;
  const scale = Math.min(1, decorationTintMaxChannel / Math.max(...channels));
  return [channels[0] * scale, channels[1] * scale, channels[2] * scale];
}

/** The colour the shader makes of a surface colour (linear RGB): desaturated by `strength`, then tinted (also by `strength`). */
export function recoloredSurface(color: readonly [number, number, number], recolor: DecorationRecolor): readonly [number, number, number] {
  const grey = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return color.map((channel, index) => (channel + (grey - channel) * recolor.strength) * (1 + (recolor.tint[index] - 1) * recolor.strength)) as unknown as readonly [
    number,
    number,
    number,
  ];
}

const recolorDeclarations = ["uniform vec3 decorationTint;", "uniform float decorationRecolorStrength;"].join("\n");
const recolorFragment = [
  "#include <map_fragment>",
  "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), decorationRecolorStrength)",
  "  * mix(vec3(1.0), decorationTint, decorationRecolorStrength);",
].join("\n");

/**
 * Installs the recolouring hook on `material` if its `userData.decorationRecolor` asks for one (see the module header); chains any earlier
 * hook and program cache key. Call it on the material that is drawn, after any clone. Returns the material.
 */
export function applyDecorationRecolor<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  const recolor = material.userData.decorationRecolor as DecorationRecolor | undefined;

  if (!recolor) {
    return material;
  }

  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramKey =
    material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms.decorationTint = { value: new THREE.Vector3(...recolor.tint) };
    shader.uniforms.decorationRecolorStrength = { value: recolor.strength };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${recolorDeclarations}`)
      .replace("#include <map_fragment>", recolorFragment);
  };
  material.customProgramCacheKey = () => `${previousProgramKey}decoration-recolor:`;
  material.needsUpdate = true;
  return material;
}

/**
 * Recolours every material under `root` in `palette`: each distinct material is cloned (glTF clones share materials, so the preloaded asset
 * is never changed), marked with its role's tint and hooked. Returns the number of materials recoloured.
 */
export function recolorDecoration(root: THREE.Object3D, palette: FacePalette, strength = decorationRecolorStrength): number {
  const replaced = new Map<THREE.Material, THREE.Material>();

  const recolor = (material: THREE.Material): THREE.Material => {
    const known = replaced.get(material);

    if (known) {
      return known;
    }

    const clone = material.clone();
    const value: DecorationRecolor = { tint: decorationTint(palette[roles[replaced.size % roles.length]]), strength };
    clone.userData = { ...clone.userData, decorationRecolor: value };
    replaced.set(material, applyDecorationRecolor(clone));
    return clone;
  };

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material) ? child.material.map(recolor) : recolor(child.material);
    }
  });

  return replaced.size;
}
