# 22 - Collision wireframe debug performance

Status: closed on 2026-08-03.

## Outcome

Forbidden-zone and object collision helpers now use lightweight line-segment
cylinder outlines and remain outside ordinary portal archetype rendering.
Relevant render-contract coverage exists. Reopen only for a measured regression.

## Closing evidence

The repository audit at `09dafe7` inspected the dedicated debug-wireframe path
and tests. Node/npm were unavailable, so tests were not rerun for this
documentation-only closure.

## Goal

Fix the large frame-rate regression caused by the collision geometry wireframe debug toggle.

Observed behavior: enabling collision geometry wireframes can reduce desktop performance from roughly 170 FPS to roughly 50 FPS.

This is a debug-rendering performance issue. The movement and collision rules should remain unchanged.

## Problem

The current collision wireframe debug implementation makes lightweight-looking helpers participate in expensive render paths.

Likely causes:

- forbidden-zone wireframe cylinders are collected as cell render archetypes,
- those archetypes can be rendered through the portal-visible path instance pipeline,
- one debug helper can therefore be drawn many times across portal paths rather than only once in the active view,
- `THREE.MeshBasicMaterial` with `wireframe: true` on cylinder meshes emits many line edges,
- transparent materials with `depthWrite: false` can increase sorting and overdraw cost,
- object collision cylinder helpers are attached to dynamic object roots and may be cloned or rendered through portal object paths.

The result is that the debug toggle is not simply drawing a few local lines. It can amplify debug geometry through the same machinery used for portal-rendered world geometry.

## Scope

Replace the expensive collision debug rendering path with a lightweight renderer:

- keep collision debug helpers out of the cell archetype collection path,
- keep collision debug helpers out of runtime-object portal rendering unless explicitly needed,
- render forbidden zones and object cylinders as simple `THREE.LineSegments` or equivalent line helpers,
- prefer current-cell-only rendering for the first fix,
- keep the existing debug option ids and palette toggle,
- preserve the visual distinction between forbidden zones and object collision cylinders.

## Non-Goals

- Do not change movement collision behavior.
- Do not change forbidden-zone construction.
- Do not optimize the portal renderer generally.
- Do not add a new debug UI surface.
- Do not make these helpers visible through recursive portal views in the first fix unless it can be done cheaply.

## Implementation Plan

### 1. Remove debug helpers from archetype collection

Make sure collision wireframe objects are not collected by `cellRenderArchetypes`.

The current `debug-wireframe` archetype kind should either be removed or restricted so collision helpers cannot enter the normal portal instance path.

### 2. Add a dedicated collision debug renderer

Create a small renderer-side module responsible for collision debug visuals.

Expected responsibilities:

- own one root group in the main scene,
- rebuild or update forbidden-zone line geometry when the active cell changes,
- update dynamic object cylinder helpers each frame or when object poses change,
- hide all helpers when `object-collision-wireframes` and `forbidden-zone-wireframes` are inactive,
- dispose geometries and materials cleanly.

### 3. Use simple line geometry

Forbidden zones should be represented with cheap line circles and vertical segments rather than transparent wireframe cylinder meshes.

Object collision cylinders should use cheap circle and vertical edge line segments rather than mesh wireframes.

The renderer should avoid per-frame geometry allocation where practical.

### 4. Limit first pass to active cell

For the first fix, render collision debug helpers only for the player's current cell.

This avoids multiplying debug geometry through portal paths and is sufficient for inspecting local collision behavior during movement.

### 5. Add focused tests

Add or update render-contract tests to verify:

- collision debug helpers are not included in cell render archetype plans,
- enabling the debug option creates current-cell helper state,
- disabling the debug option removes or hides helper state,
- creature collision dimensions remain covered by world-object tests.

## Acceptance Criteria

- Enabling collision geometry wireframes no longer causes a major frame-rate collapse in ordinary desktop worlds.
- Forbidden zones are still visually inspectable when their debug option is active.
- Dynamic object collision cylinders are still visually inspectable when their debug option is active.
- Collision debug helpers do not enter portal archetype rendering by default.
- The existing palette toggle and URL debug options continue to work.
- Tests cover the render-contract boundary that keeps these helpers out of expensive portal render paths.
