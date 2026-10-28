/**
 * Console guides printed when debug options are enabled.
 * These functions only write to the console (info and table) and have no state; the command lists they print name the window helpers installed by appDebugHelpers, so the two must be kept in sync by hand.
 */
import { type PortalPathTablesByRootCell } from "../../cell-complex/portalPaths";
import { type StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import { type DebugLevelId } from "../../glue/debugLevels";
import { type DebugOptionId } from "../../glue/debugOptions";

/** Prints which portal-overlay console commands are usable; portalPathDebugActive indicates whether the overlay helpers were installed. */
export function logPortalOverlayGuide(portalPathDebugActive: boolean): void {
  const commands = [
    "window.noneuclidPortalDebug.state",
    'window.noneuclidPortalDebug.CheckCellPath("0 2 3")',
    'window.noneuclidPortalDebug.ShowCellPath("0 2 3")',
    'window.noneuclidPortalDebug.ShowCellPathClipPolygon("0 2 3")',
    'window.noneuclidPortalDebug.HideCellPathClipPolygon("0 2 3")',
    "window.noneuclidPortalDebug.HideClipPolygons()",
    "window.noneuclidPortalDebug.HideCellPaths()",
  ];

  console.info(
    portalPathDebugActive
      ? `Portal Path Overlays are enabled. Useful commands: ${commands.join("; ")}.`
      : "Portal Path Overlays are enabled, but Portal Path Debug is required before overlay commands are installed.",
  );
}

/** Prints the debugging quick start: the current debug level, the enabled options and the available console commands. */
export function logDebugStartupGuide(debugLevel: DebugLevelId, debugOptions: readonly DebugOptionId[]): void {
  const commands = [
    "debug_help()",
    "dump_geodesic_creatures()",
    "dump_all_geodesics()",
    "dump_geodesic_path()",
    "dump_locked_geodesic_words()",
    "window.noneuclidDebug.DumpGeodesicCreatures()",
    "window.noneuclidDebug.DumpAllGeodesics()",
    "window.noneuclidDebug.DumpGeodesicPath()",
    "window.noneuclidDebug.DumpLockedGeodesicWords()",
    "window.noneuclidPortalDebug.state",
    'window.noneuclidPortalDebug.CheckCellPath("0 2 3")',
    'window.noneuclidPortalDebug.ShowCellPath("0 2 3")',
    "window.noneuclidPortalDebug.HideCellPaths()",
    'window.noneuclidPortalDebug.ShowCellPathClipPolygon("0 2 3")',
    'window.noneuclidPortalDebug.HideCellPathClipPolygon("0 2 3")',
    "window.noneuclidPortalDebug.HideClipPolygons()",
    "window.noneuclidPortalDebug.DumpCameraPose()",
    "window.noneuclidPortalDebug.ShowCellPathRendersInstances = true",
  ];
  const activeOptions = debugOptions.length > 0 ? debugOptions.join(", ") : "(none)";

  console.info(
    [
      "Debugging quick start:",
      `debugLevel=${debugLevel}`,
      `debugOptions=${activeOptions}`,
      "Geodesic debug helpers are installed as debug_help(), dump_geodesic_creatures(), dump_all_geodesics(), dump_geodesic_path(), and dump_locked_geodesic_words().",
      "Portal debug helpers are installed when portal-path-debug or portal-visible-path-debug is active.",
      "ShowCellPath overlays also need portal-path-overlays.",
      "Live clip polygons need portal-visible-path-debug.",
      "Useful commands:",
      ...commands.map((command) => `  ${command}`),
    ].join("\n"),
  );
}

/**
 * Prints how to use the portal path debug helpers and a table of per-root-cell path counts (generated, kept, rejected, budget-rejected).
 * overlayActive and staticCullDebugActive only change the hint text. maxAvailableDepth is computed from the unculled table paths.
 */
export function logPortalDebugInstall(
  candidateTables: PortalPathTablesByRootCell,
  staticCull: StaticPortalPathCullResult,
  staticCullDebugActive: boolean,
  overlayActive: boolean,
): void {
  console.info(
    [
      "Portal path debug is active.",
      `Contextual static culling is applied while expanding each path node to depth ${candidateTables.maxDepth}.`,
      "Use window.noneuclidPortalDebug.CheckCellPath(\"0 2 3\") to inspect a path.",
      overlayActive
        ? "Use window.noneuclidPortalDebug.ShowCellPath(\"0 2 3\") to draw a destination-cell overlay."
        : "Enable portal-path-overlays to allow ShowCellPath overlays.",
      "Use window.noneuclidPortalDebug.ShowCellPathClipPolygon(\"0 2 3\") to draw a live screen-space clip polygon.",
      "Use window.noneuclidPortalDebug.HideCellPathClipPolygon(\"0 2 3\") to remove one tracked clip polygon.",
      "Use window.noneuclidPortalDebug.HideClipPolygons() to clear all tracked clip polygons.",
      "Use window.noneuclidPortalDebug.DumpCameraPose() to inspect the current culling camera pose.",
      staticCullDebugActive
        ? "Static-cull rejected path details are included."
        : "Enable portal-static-cull-debug to include rejected path details.",
    ].join(" "),
  );

  console.table(
    [...candidateTables.tablesByRootCellId.entries()].map(([rootCellId, table]) => {
      const summary = staticCull.summariesByRootCellId.get(rootCellId);

      return {
        rootCellId,
        maxDepth: table.maxDepth,
        generatedPaths: summary?.inputPathCount ?? table.paths.length,
        keptPaths: summary?.keptPathCount ?? table.paths.length,
        rejectedPaths: summary?.rejectedPathCount ?? 0,
        maxAvailableDepth: Math.max(0, ...table.paths.map((path) => path.depth)),
        budgetRejected: summary?.rejectedByReason.get("static-path-budget") ?? 0,
      };
    }),
  );
}
