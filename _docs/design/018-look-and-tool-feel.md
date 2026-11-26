# 018 - Look of the polyhedral worlds and feel of the desktop tools

Status: proposal (2026-11-25), implemented on branch `look-and-feel`. Sections 3 to 5 are the specification the
implementation follows; section 7 lists what was left out.

## 1. What a walk through the cube showed

Seen in the `001-basic-cube` world, desktop first person, before this work:

- **The sky is one flat blue and the horizon is a hard line.** Fog fades distant floors toward the same blue, so the
  far copies of the faces turn into grey-blue slabs.
- **The floors are dark and uniform.** Each face is one photo texture at low exposure. Grass, leaves and mud are all
  dark and differ little at a distance, yet the first activity asks the student to "use landmarks and floor textures
  to tell the regions apart".
- **A face is 15 m by 15 m and holds one small landmark.** Most of what you see is empty ground. Nothing tells two
  places on the same face apart, so you cannot tell "I am here again" from "I am somewhere similar".
- **Objects float.** Light is one hemisphere light and there are no shadows, so nothing ties a tree or the house to
  the ground.
- **The crosshair does not say what a click will do.** It is a dot that becomes a ring on an object that has a
  tooltip, in range. Aiming a Laser or a Sign at the floor (a valid target) keeps the dot; an object that is too far
  shows a dot and no reason. A red cross drawn on the surface doubles the crosshair. Many clicks fail without any
  message (too far, wrong kind of target).
- **Some hints are wrong.** The Laser aimed at a beam says "extend 2 m" but places a laser that cuts the beam; signs
  show "G: pick up" although only lasers can be picked up; in the Aim mode the hint reads "0: put the Hand away".
- **Closing an object's menu puts the tool away.** With the Ruler in hand, opening a laser's menu and closing it
  leaves you with the Hand.

## 2. Principles

1. **Nothing global has a horizontal direction.** On a polyhedron, carrying a direction around a corner turns it
   (that is the mathematics the world teaches), so a sun, a cloud or a wind direction fixed in the sky would either
   jump when the player crosses an edge or mean different things after different walks. The sky, the fog and the
   light are therefore symmetric under rotation about the vertical: a gradient by elevation, light from straight
   above, shadows straight below. Existing rule kept: the light rig is the same in every cell.
2. **Identity belongs to the cell.** Everything that helps recognise a place is geometry or colour fixed in a cell:
   ground variation, small scenery, authored landmarks. A copy of the cell seen through portals carries exactly the
   same details. This serves the mathematics: a student who sees the same ring of stones twice can check that it is
   the same place, not a similar one.
3. **Generated, seeded, repeatable.** Details come from noise seeded by the cell id. The same world file gives the
   same world on every machine and every visit; no authoring is needed for a world to get them.
4. **Quiet.** Scenery stays at or below knee height (0.6 m), never blocks walking, aiming or lines of sight, and is
   less saturated than anything a tool draws. Beams, measurements and signs stay the brightest things on screen.
   Corners of the polyhedron (where the curvature is) are kept clear of scenery.
5. **A fixed budget.** Per cell: one extra draw call, a bounded number of triangles, and scenery only on nearby
   copies. No new per-frame work on the CPU.
6. **The crosshair tells the truth.** Its shape says whether a click will do something; when it will not, a few
   words next to it say why.

## 3. Sky, haze and light (all worlds)

- `scene.background` becomes a vertical gradient: deep blue at the zenith, pale haze at the horizon, a muted ground
  tone below it. It is a small generated texture mapped by elevation only (equirectangular, one column), built from
  a `DataTexture` so it needs no canvas.
- Fog takes the horizon colour, so distant geometry dissolves into the horizon instead of into a blue slab. Range
  stays close to the current one because it also hides the limit of the portal search.
- The plane under the cells takes the muted ground tone instead of black.
- The hemisphere light gets a slightly warm sky colour and a lighter ground colour. No directional light, no
  shadows cast by lights (principle 1).
- Colours live in `sceneColors.ts`.

## 4. Ground and scenery (polyhedral worlds)

Applies to a cell whose floor is a floor texture with metric UVs. Cells with a lattice floor frame (the torus
family) are left as they are: their floor is continuous across cells by design, and per-cell variation would draw
seams where the surface has none.

### 4.1 Ground variation and contact shadows

- A pure function computes, per cell, a small tint image over the cell's bounding box (`groundTint.ts`): two octaves
  of value noise (features of about 8 m and 2 m) around 1.0, a slight warm/cool shift, and a soft dark disc under
  every authored static object (radius from its collision radius), which is its shadow from a sun at the zenith.
  Creatures move and get none. Static objects cannot be moved by the player, so the baked shadow stays right.
- The floor material multiplies its colour by that image and by a gain that lifts the dark photo textures. One extra
  texture fetch per floor fragment; no extra geometry.

### 4.2 Scenery

- A pure function lays out, per cell, a seeded list of small props (`sceneryLayout.ts`): kind, position, turn, size,
  colour variant. Placement is a jittered grid thinned by the same noise as the ground, so clumps sit on the lusher
  patches and clearings stay clear. Each cell also gets one or two *features*: a tight recognisable group (a ring of
  stones, a ring of mushrooms, a patch of flowers) at a seeded place.
- What grows depends on the floor texture, so the scenery repeats the identity the floor already has:

  | Floor | Props |
  | --- | --- |
  | `grass1` | grass tufts, daisies, clover-dark tufts |
  | `forest_leaves` | ferns, mushrooms, twigs |
  | `river_pebbles` | rounded stones, reeds |
  | `gravelly_sand` | dry tufts, pale stones, small succulents |
  | `red_mud_stones` | angular red rocks, dark shrubs |
  | `snow` | snow mounds, ice crystals, bare twigs |
  | anything else | none |

- Kept clear: 0.35 m along every side (cell geometry has no portal ghosts, so a prop must not cross a side), 1.0 m
  around every vertex, and each authored object's collision radius plus 0.5 m.
- The renderer turns the list into one merged mesh per cell with vertex colours (`buildCellScenery.ts`), a new cell
  archetype kind `scenery`. It is instanced over portal copies and clipped like the floor. It is not in the object
  registry: no collision, no aim target, no tooltip, not on the map.
- Budget: at most 1500 triangles per cell, and a `scenery` archetype is drawn only on paths of depth 3 or less
  (about 45 m; at that distance a tuft is a few pixels and half faded by fog).

## 5. Desktop tools

1. **Crosshair states.** Dot: nothing to do here. Ring in the tool's colour: a click does something (this now
   includes the floor for the Laser and the Sign). Hollow ring with a bar: there is something here but the click is
   refused, with the reason in a few words beside it ("Too far", "Aim at a beam", "Aim at the floor"). The same
   reason is used when the player clicks anyway, so no click is silent.
2. **The red cross on the surface** is drawn only where it adds information the crosshair lacks: for the Sign (which
   has no ghost) and the Aim mode, in the tool's colour. Design 017 section 8.2 already called it a debug overlay.
3. **Hints say what happens.** Laser on a beam: "place a laser here"; Laser on a laser: "add a beam"; no "pick up" on
   signs; each laser mode (pick up, aim) names its own action and how to leave it.
4. **The belt uses the tool's colour** for the active slot, and the Sign gets its own colour (it shared the Ruler's).
5. **Closing a menu keeps the tool** when it was opened on an object with right click or F. Putting the tool away
   remains 0 or the Hand slot.
6. **The pause card lists every key** (adds pick up, put away, next target, start over, undo) and shows WASD.

## 6. Performance

Measured on the cube at the standard poses (see the branch description for numbers): draw calls rise by at most 12
(six cells, instanced and root mesh), triangles by at most 1500 per drawn copy of a cell within depth 3, floor
fragments pay one more texture fetch. Nothing is added to the per-frame CPU path except one comparison per path in
the cell instance writer.

## 7. Left out

- **A held-tool model in the corner of the view.** It is the usual first-person cue, but issue 96 redesigns how the
  laser is held; it should be designed there.
- **Scenery and ground variation on the torus family.** Needs noise that is periodic on the lattice and follows the
  deformation.
- **Larger generated landmarks** (rock formations, groves). They would need collision and portal ghosts, that is,
  registry objects; the authored models already fill this role.
- **A setting to turn scenery off.** Easy to add to the Settings page if wanted.
