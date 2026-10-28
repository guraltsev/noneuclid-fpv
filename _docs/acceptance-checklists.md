# Acceptance Checklists

## Global acceptance criteria

The project is on track when:

- the app builds as a static Vite site,
- the app can be deployed to GitHub Pages from a branch,
- desktop fallback works,
- VR entry works when available,
- world specs compile before runtime starts,
- movement works through prism portals,
- non-portal walls block movement,
- floor and ceiling block movement,
- forbidden zones and object-footprint clearance around portal junctions are enforced,
- straight rays pass through portals by rigid transforms,
- markers and traces preserve cell-local coordinates,
- tests cover behavior without freezing implementation details,
- renderer code is skippable for understanding world rules,
- no theorem engine has been accidentally added.

## Stage 00 checklist

- Vite app exists.
- TypeScript strict typecheck runs.
- Vitest runs.
- Build runs.
- GitHub Pages deployment script exists.
- Decision notes exist.

## Stage 01 checklist

- Vec3 operations work.
- Rigid transform inverse and composition work.
- Plane and polygon helpers work.
- Segment intersection tests pass.
- No Three.js dependency in math modules.

## Stage 02 checklist

- Prism specs compile.
- Invalid specs fail with readable errors.
- Portal transforms are explicit.
- Forbidden zones are generated at portal junctions.
- Floor and ceiling portals are rejected.

## Stage 03 checklist

- Player moves inside a prism.
- Player collides with walls, floor, and ceiling.
- Player crosses centered portals.
- Player orientation transforms across portals.
- Player cannot enter forbidden zones.

## Stage 04 checklist

- Desktop scene renders current cell.
- Desktop controls move the player through the movement contract.
- Debug overlay shows current cell and last movement result.
- Renderer tests assert public contracts only.

## Stage 05 checklist

- Portal views show connected cells.
- One-hop views work before recursion.
- Recursion has explicit depth and count limits.
- VR limitations are documented rather than hidden.

## Stage 06 checklist

- Straight ray traces inside a cell.
- Ray crosses portals.
- Ray stops at walls, forbidden zones, max distance, and max crossings.
- Code does not call this a geodesic solver.

## Stage 07 checklist

- Markers can be placed and cleared.
- Invalid markers are rejected.
- Path traces store cell-tagged local segments.
- Measurement tools show raw values only.
- Discovery log stores local action events.

## Stage 08 checklist

- WebXR entry appears when available.
- Desktop fallback remains intact.
- Controller ray can fire straight rays.
- Reset works in VR.
- Secure-context failure is readable.

## Stage 09 checklist

- Instructor can reset world and tools.
- Preflight status is visible.
- World compile errors are readable.
- Discovery log export works locally.
- GitHub Pages build works from subpath.

## Stage 10 checklist

- Optional JSON import validates input.
- QR scanning remains separate from VR runtime.
- QR output cannot bypass compiler validation.

## Stage 11 checklist

- General volume cells are still disabled unless fully implemented.
- If enabled, they support collision, portals, rays, rendering, and forbidden zones at prism-cell reliability.

## Stage 12 checklist

- Oversized mixed-concept files are split.
- Public contracts have useful docs.
- Dense logic has block comments.
- Tests remain behavior-focused.
- No new feature was smuggled into cleanup.
