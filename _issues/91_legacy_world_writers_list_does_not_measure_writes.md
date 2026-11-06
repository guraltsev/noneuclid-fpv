# 91 - `legacyWorldWriters` does not measure who writes the world

Status: open.

Priority: P3 (tooling; the migration's progress measure is wrong). Found 2026-11-05.

Jobs: [62](../.agents/jobs/62_client_write_check.md).

## Problem

Design 013 section 12.2 lists the render and ui files that write the world. The check in `scripts/docs/lib.mjs` flags a file that
imports a world-objects module containing a `registry.<write>(` call, whatever it imports from it.

- Over-counts: 8 of the 14 listed files write nothing. Five only read (`carriedGeodesicCannon`, `geodesicCannonRenderer`,
  `geodesicDebugDumps`, `geodesicEmitterLabelController`, `geodesicEmitterLabels`) and three take constants from `placedFlags.ts`
  (`placedFlagRenderer`, `preloadWorldAssets`, `ui/paletteDefinition`).
- Under-counts: `render/three/toolObjectRuntimes.ts` and `runtime/worldGeometryComputedObjects.ts` write and are not listed. The
  rule does not cover `runtime/` at all.
- `geometryCommit.ts` has a type-only import, yet writes through a registry it is handed.

The shell also holds the writer registry everywhere, so a client file needs no import to write. Section 6.1's reader type is not
enforced on clients.

The per-file claims come from a read-only audit on 2026-11-05 and were not all rechecked.

## Done when

- The check finds a client's writes, not its imports: for example, clients receive `RuntimeObjectReader`, and the few legacy files
  that still need the writer are the list.
- `runtime/` is covered.

- Job 62 (2026-11-05): done, needs review; see the Report in [the job](../.agents/jobs/_done/62_client_write_check.md). The count it gives is a lower bound: writes through owners are not counted.
