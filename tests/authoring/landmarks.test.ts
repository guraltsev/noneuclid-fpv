/**
 * `tests/authoring/landmarks.test.ts` — unit tier.
 *
 * A face's landmark is the one object a student uses to tell the face from its neighbours (design 017 section 9.3). The
 * authoring rule is explicit: `landmark: true` on the object, and every face of the basic cube and the basic tetrahedron
 * has exactly one such object, a different kind of object on each face.
 */
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron } from "../../src/authoring/exampleWorlds";
import type { CellComplexSpec, CellObjectSpec } from "../../src/cell-complex/specs";

function landmarksOf(spec: CellComplexSpec): ReadonlyMap<string, readonly CellObjectSpec[]> {
  return new Map(spec.cells.map((cell) => [cell.id, (cell.visuals?.objects ?? []).filter((object) => object.landmark === true)]));
}

describe("landmarks", () => {
  it.each([
    ["001-basic-cube", basicCube, 6],
    ["002-basic-tetrahedron", basicTetrahedron, 4],
  ] as const)("%s: every face has exactly one landmark, and no two faces share a model", (_name, spec, faceCount) => {
    const landmarks = landmarksOf(spec);

    expect(landmarks.size).toBe(faceCount);
    for (const [, onFace] of landmarks) {
      expect(onFace).toHaveLength(1);
    }

    const models = [...landmarks.values()].map(([landmark]) => landmark!.kind === "asset" ? landmark!.assetPath : landmark!.kind);
    expect(new Set(models).size).toBe(faceCount);
  });
});
