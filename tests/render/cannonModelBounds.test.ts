/**
 * `tests/render/cannonModelBounds.test.ts` — unit tier.
 *
 * The emitter's carry highlight (`cannonCarryHighlight`, `cannonModelHalfExtentsMeters` in src/world-objects/geodesic/objects.ts) is sized from the
 * model the renderer draws: the post and the lightsaber head of `geodesicCannonRenderer.ts`, at their scale and placement. This re-measures the two
 * .glb files, so a changed or rescaled model fails here instead of silently leaving a highlight that no longer fits.
 */
import { describe, expect, it } from "vitest";
import {
  geodesicRayAssetScale,
  geodesicRayPostAssetFloorOffsetMeters,
} from "../../src/render/three/geodesicCannonRenderer";
import {
  cannonCarryHighlight,
  cannonCarryHighlightLooseness,
  cannonModelHalfExtentsMeters,
  geodesicRayBeamHeightMeters,
} from "../../src/world-objects/geodesic/objects";
import { readGlbBounds, type GlbBounds } from "../support/glbBounds";

const assetUrl = (name: string): URL => new URL(`../../public/assets/flashlight/${name}`, import.meta.url);

// Largest distance from the vertical axis over the box's corners, with the box scaled by `scale` about the origin; glTF x and z are horizontal.
function horizontalReach(bounds: GlbBounds, scale: number): number {
  let reach = 0;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const z of [bounds.min[2], bounds.max[2]]) {
      reach = Math.max(reach, Math.hypot(x * scale, z * scale));
    }
  }
  return reach;
}

describe("the emitter model the highlight is sized from", () => {
  const post = readGlbBounds(assetUrl("Post.glb"));
  const head = readGlbBounds(assetUrl("Lightsaber.glb"));
  // Height above the floor: the post is lifted by its floor offset and only the part above the floor is visible; the head sits at the beam height.
  const postTop = post.max[1] * geodesicRayAssetScale + geodesicRayPostAssetFloorOffsetMeters;
  const headTop = geodesicRayBeamHeightMeters + head.max[1] * geodesicRayAssetScale;
  const visibleHeight = Math.max(postTop, headTop);
  const reach = Math.max(horizontalReach(post, geodesicRayAssetScale), horizontalReach(head, geodesicRayAssetScale));

  it("is as tall as the declared half-extent says", () => {
    expect(visibleHeight / 2).toBeCloseTo(cannonModelHalfExtentsMeters.z, 2);
  });

  it("reaches as far sideways as the declared half-extent says", () => {
    expect(reach).toBeCloseTo(cannonModelHalfExtentsMeters.x, 2);
    expect(cannonModelHalfExtentsMeters.y).toBe(cannonModelHalfExtentsMeters.x);
  });

  it("is hugged by the highlight ellipsoid within the stated looseness", () => {
    expect(cannonCarryHighlight.centre.z).toBeCloseTo(visibleHeight / 2, 2);
    expect(cannonCarryHighlight.radii.z / (visibleHeight / 2)).toBeCloseTo(cannonCarryHighlightLooseness, 1);
    expect(cannonCarryHighlight.radii.x / reach).toBeCloseTo(cannonCarryHighlightLooseness, 1);
    expect(cannonCarryHighlight.radii.z).toBeLessThan(visibleHeight);
  });
});
