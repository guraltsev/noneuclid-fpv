# 15 - Stage 05: Portal viewing

## Goal

Make portals visually meaningful. A student should be able to look at a portal and see enough of the connected cell to understand that the portal leads somewhere.

Start with one-hop portal views. Add recursive views only after the one-hop version is stable.

## Files to create

```text
src/render/three/portalView.ts
src/render/three/visiblePortalImages.ts
tests/render-contract/visiblePortalImages.test.ts
```

## Conceptual model

A visible portal image is not just a cell id. It is a cell seen through a particular portal path with a particular transform relative to the viewer.

Public debug data should include:

- source portal id,
- target cell id,
- portal depth,
- accumulated transform,
- stop reason if not rendered.

## Level 1: one-hop views

First render only the target cell visible through a portal.

Simplifications allowed:

- simple portal aperture rectangles,
- no deep recursion,
- no perfect stencil behavior,
- conservative clipping,
- debug coloring.

The visual result must be stable and understandable, not graphically perfect.

## Level 2: recursive views

After one-hop views work, add limited recursive portal rendering.

Use explicit limits:

```text
maxPortalViewDepth
maxPortalViewCount
```

Expose those limits in debug state.

## VR caution

Do not build a portal renderer that only works in desktop mono rendering. VR stereo rendering can behave differently because each eye has its own view.

If recursive rendering is fragile in VR, keep a simpler VR portal mode and a richer desktop debug mode.

## Tests to write

Required behavior tests:

- a visible portal list includes a first-hop target when the player looks at a portal,
- portals outside the view are omitted or marked invisible,
- recursion stops at max depth,
- two different paths to the same cell are represented as different visible images when their transforms differ.

Do not test exact renderer pass counts unless the pass count is made an intentional public debug contract.

## Manual checks

Manual check:

- a portal shows the connected room,
- moving through it lands in the visible target,
- portal frame remains stable while moving,
- debug overlay reports visible portal count,
- lowering max depth changes visible recursion predictably.

## Exit criteria

Portals are visually useful enough for exploration, even if not yet visually perfect.

## Do not do in this stage

Do not implement straight rays.

Do not implement theorem tools.

Do not over-optimize rendering before classroom-relevant behavior exists.
