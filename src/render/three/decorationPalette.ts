/**
 * Recolours an authored decoration (a bicycle, a bench, a tree, ...) in the palette of the face it stands on (design 018 section 9.6), so
 * hand-placed models belong to their face like the generated landmarks do.
 *
 * Every distinct material of the model is cloned (glTF clones share materials, so the shared preloaded asset is never changed) and takes
 * a palette role in turn (`primary`, `secondary`, `accent`, `light`). The new colour keeps the brightness of the old one: the role colour
 * is scaled to the old colour's luminance and mixed in by {@link decorationRecolorStrength}. A textured material keeps its texture, which
 * the colour multiplies.
 */
import * as THREE from "three";
import type { FacePalette } from "../../world-assets/facePalettes";

/** How far a material's colour moves to its palette role (0 keeps it, 1 replaces its hue entirely). */
export const decorationRecolorStrength = 0.8;

const roles = ["primary", "secondary", "accent", "light"] as const;

function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** The colour `original` takes for the palette colour `target` (both linear): `target` at `original`'s luminance, mixed in by the strength. */
export function recoloredDecorationColor(original: THREE.Color, target: THREE.Color, strength = decorationRecolorStrength): THREE.Color {
  const scale = luminance(original) / Math.max(1e-4, luminance(target));
  const matched = new THREE.Color(Math.min(1, target.r * scale), Math.min(1, target.g * scale), Math.min(1, target.b * scale));
  return original.clone().lerp(matched, strength);
}

/** Recolours every material under `root` in `palette` (see the module header). Returns the number of materials recoloured. */
export function recolorDecoration(root: THREE.Object3D, palette: FacePalette): number {
  const replaced = new Map<THREE.Material, THREE.Material>();

  const recolor = (material: THREE.Material): THREE.Material => {
    const known = replaced.get(material);

    if (known) {
      return known;
    }

    const clone = material.clone();
    const colored = clone as THREE.Material & { color?: THREE.Color };

    if (colored.color instanceof THREE.Color) {
      const target = new THREE.Color(palette[roles[replaced.size % roles.length]]);
      colored.color.copy(recoloredDecorationColor(colored.color, target));
    }

    replaced.set(material, clone);
    return clone;
  };

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material) ? child.material.map(recolor) : recolor(child.material);
    }
  });

  return replaced.size;
}
