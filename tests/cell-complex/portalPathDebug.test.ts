import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { checkPortalPathString, createPortalPathDebugState } from "../../src/cell-complex/portalPathDebug";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import { staticallyCullPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { cube } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";

describe("portal path debug helpers", () => {
  it("checks an empty path as the root path", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 2 });

    expect(checkPortalPathString("", { world, rootCellId: "room-a", candidateTables })).toMatchObject({
      parsed: true,
      valid: true,
      destinationCellId: "room-a",
      matchedPathId: 0,
      existsInBuiltTable: true,
      survivedStaticCull: true,
    });
  });

  it("checks step existence and matched kept paths", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 2 });

    expect(checkPortalPathString("1", { world, rootCellId: "room-a", candidateTables })).toMatchObject({
      parsed: true,
      valid: true,
      destinationCellId: "room-b",
      matchedPathId: 1,
      existsInBuiltTable: true,
      survivedStaticCull: true,
    });
  });

  it("reports parse and traversal failures", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 2 });

    expect(checkPortalPathString("left", { world, rootCellId: "room-a", candidateTables })).toMatchObject({
      parsed: false,
      valid: false,
    });
    expect(checkPortalPathString("2", { world, rootCellId: "room-a", candidateTables })).toMatchObject({
      parsed: true,
      valid: false,
      existsInBuiltTable: false,
      survivedStaticCull: false,
    });
  });

  it("prefers side indices and warns when a token falls back to the portal-array index", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 2 });

    const bySideIndex = checkPortalPathString("1", { world, rootCellId: "room-a", candidateTables });
    expect(bySideIndex.warnings).toBeUndefined();

    // room-a has a single portal on side 1; token "0" is not a side index but is a valid array index.
    const byArrayIndex = checkPortalPathString("0", { world, rootCellId: "room-a", candidateTables });
    expect(byArrayIndex.valid).toBe(true);
    expect(byArrayIndex.steps[0].sourcePortalSideIndex).toBe(1);
    expect(byArrayIndex.warnings).toHaveLength(1);
    expect(byArrayIndex.warnings?.[0]).toContain("portal-array index");

    // Out of range on both interpretations is an error, not a silent pick.
    const outOfRange = checkPortalPathString("2", { world, rootCellId: "room-a", candidateTables });
    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.warnings).toBeUndefined();
  });

  it("reports culled paths by reason when a kept table excludes them", () => {
    const world = compileCellComplex(cube);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 1 });
    const staticCull = staticallyCullPortalPathTables(world, candidateTables, {
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 1,
      keepRejectedPathDetails: true,
    });
    const result = checkPortalPathString("0", {
      world,
      rootCellId: "front",
      candidateTables,
      keptTables: staticCull.tables,
      cullSummariesByRootCellId: staticCull.summariesByRootCellId,
    });

    expect(result).toMatchObject({
      parsed: true,
      valid: true,
      existsInBuiltTable: true,
      survivedStaticCull: false,
      rejectionReason: "static-path-budget",
    });
  });

  it("creates compact debug state for UI and console helpers", () => {
    const world = compileCellComplex(cube);
    const candidateTables = buildPortalPathTables(world, { maxDepth: 2 });
    const staticCull = staticallyCullPortalPathTables(world, candidateTables, {
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 2,
    });

    expect(createPortalPathDebugState("front", candidateTables, staticCull)).toMatchObject({
      currentRootCellId: "front",
      maxDepth: 2,
      keptPathCount: 2,
      maximumAvailablePathDepth: 2,
      staticPathBudgetExhausted: true,
    });
  });
});
