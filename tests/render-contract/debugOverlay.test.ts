import { describe, expect, it } from "vitest";
import {
  formatDebugOverlayLines,
  formatLocationLine,
  formatPortalEyeLine,
  formatStereoPortalPathLine,
  type DebugOverlayState,
} from "../../src/render/three/debugOverlay";
import type { StereoPortalPathRenderState, XrDebugRenderState } from "../../src/render/three/renderState";

const location: XrDebugRenderState = {
  currentCellId: "cell-a",
  playerPosition: { x: 1, y: 2, z: 3 },
  yawRadians: 0.5,
  sessionStatus: "presenting",
  lastMovementBlocked: false,
} as unknown as XrDebugRenderState;

const eyes = [
  { eyeIndex: 0, visiblePathCount: 4, maxVisibleDepth: 2 },
  { eyeIndex: 1, visiblePathCount: 5, maxVisibleDepth: 3 },
] as unknown as DebugOverlayState["portalEyes"];

describe("formatDebugOverlayLines", () => {
  it("lists the portal-eyes line before the location line", () => {
    const state: DebugOverlayState = { visible: true, location, portalEyes: eyes };
    const lines = formatDebugOverlayLines(state);
    expect(lines).toEqual([formatPortalEyeLine(eyes!), formatLocationLine(location)]);
    expect(lines[1]).toBe(formatLocationLine(state.location!));
  });

  it("omits the portal-eyes line with a single eye", () => {
    const lines = formatDebugOverlayLines({ visible: true, location, portalEyes: eyes!.slice(0, 1) });
    expect(lines).toEqual([formatLocationLine(location)]);
  });

  it("does not depend on visibility", () => {
    const shown = formatDebugOverlayLines({ visible: true, location, portalEyes: eyes });
    const hidden = formatDebugOverlayLines({ visible: false, location, portalEyes: eyes });
    expect(hidden).toEqual(shown);
  });
});

describe("formatStereoPortalPathLine", () => {
  const split: StereoPortalPathRenderState = {
    splitRoots: true,
    leftRootCellId: "a",
    rightRootCellId: "b",
    leftPathCount: 812,
    rightPathCount: 790,
    unionPathCount: 840,
    leftOnlyPathCount: 50,
    rightOnlyPathCount: 28,
    bothEyesPathCount: 762,
    droppedLeftPathCount: 0,
    droppedRightPathCount: 0,
  };

  it("formats split and shared roots", () => {
    expect(formatStereoPortalPathLine(split)).toBe(
      "stereo: L 812 / R 790 / union 840 / L-only 50 / R-only 28 / both 762 / dropped 0|0 / roots a|b split",
    );
    expect(formatStereoPortalPathLine({ ...split, splitRoots: false, rightRootCellId: "a" })).toBe(
      "stereo: L 812 / R 790 / union 840 / L-only 50 / R-only 28 / both 762 / dropped 0|0 / roots a shared",
    );
  });

  it("is listed right after the portal-eyes line", () => {
    const lines = formatDebugOverlayLines({ visible: true, location, portalEyes: eyes, stereoPortalPaths: split });

    expect(lines).toEqual([formatPortalEyeLine(eyes!), formatStereoPortalPathLine(split), formatLocationLine(location)]);
  });
});
