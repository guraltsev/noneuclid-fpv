# Unculled portal-path tables explode in memory

- `buildPortalPathTables` (no static cull) builds a table for every root cell; paths grow like
  (sides - 1)^depth per root. At the app's depth 10 this is far beyond memory for most worlds.
- Depths that fit (measured 2026-10-30, `NODE_OPTIONS=--max-old-space-size=8192`): cube, icosahedron, torus moduli at
  8 (cube: 13,121 paths per root); dodecahedron at 6 (6,826); genus-2 at 5 (22,409).
- `buildPortalPathTables` also uses `queue.shift()`, so large tables are slow to build as well.
- Symptom of ignoring this: the process runs out of heap or appears hung while building tables.
