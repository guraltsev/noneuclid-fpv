# 018 - Look of the polyhedral worlds and feel of the desktop tools

Status: implemented on branch `look-and-feel` (2026-11-25), not yet checked on a real GPU or in VR. Sections 3 to 5 are
the specification; section 6a lists where the implementation differs and section 7 what was left out.

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
- Budget: at most 1500 triangles per cell, and a `scenery` archetype is drawn only within 50 m of the eye
  (it fades out from 38 m; section 8.7).

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

Counted on the cube (`001-basic-cube`) at four fixed poses, 1920 x 1000:

- Visible cell copies per frame: 213 to 275, of which 15 to 18 are at depth 3 or less. Only those draw scenery.
- Scenery per face: 125 to 250 props, 600 to 1300 triangles. Added per frame: at most 18 x 1500 = 27 000 triangles,
  in practice 15 000 to 20 000.
- Draw calls: at most 12 more (six cells, the instanced mesh and the root mesh of each).
- Floor fragments pay one more texture fetch (a 128 x 128 texture per cell).
- Per-frame CPU: one comparison per path in the cell instance writer; nothing else.

Frame times were not measured: the only display available while this was built was a software renderer. Check the
frame rate on a real GPU with the debug overlay (`debugOverlay=1&debugOverlayItems=fps`) before merging. If it
matters, lower `sceneryFadeEndMeters` (distanceFade.ts) or `maxSceneryTrianglesPerCell` (sceneryLayout.ts).

## 6a. Where the implementation differs from sections 3 to 5

- Values tuned by eye after the first build: floor gain 1.75, large ground variation 0.3, shadow strength 0.5; the
  plane under the cells is dark earth (`UNDER_FLOOR_COLOR`), not the haze colour, because it shows through hairline
  gaps between floors.
- An object with no use (the house, the tool stand) never makes the crosshair say "refused" for the Ruler and the
  Protractor: only objects the tool could act on do. The Sign and the Laser say "Aim at the floor" on any object.
- Escape on an object's menu still puts the tool away; right click, F and Close keep it.
- The hint and crosshair wording is shared with VR, so VR also reads "place a laser here" and "add a beam", and the
  palette Close button keeps the tool in VR too. The red cross is unchanged in VR.

## 7. Left out

- **A held-tool model in the corner of the view.** It is the usual first-person cue, but issue 96 redesigns how the
  laser is held; it should be designed there.
- **Scenery and ground variation on the torus family.** Needs noise that is periodic on the lattice and follows the
  deformation.
- **Larger generated landmarks** (rock formations, groves). They would need collision and portal ghosts, that is,
  registry objects; the authored models already fill this role.
- **A setting to turn scenery off.** Easy to add to the Settings page if wanted.

## 8. Second pass: the surreal direction (2026-11-26)

The first pass was judged too timid: nicer, not striking. This section replaces principle 4 ("quiet"), the sky of
section 3 and the "larger generated landmarks" entry of section 7, and refines principle 1.

### 8.1 Art direction

Low-poly surrealism: de Chirico (arcades, towers, empty squares, long shadows, a green-to-gold dusk sky), Dali
(stilt-legged forms, crutches, drooping slabs, a vast plain), Magritte (things that float: boulders, a lone door
frame), Tanguy (smooth biomorphic stones stacked and propped on a grey shore), Miro (thin black stalks carrying red,
yellow and blue discs, crescents and stars). Flat-shaded, few triangles, strong silhouettes, saturated but limited
palettes. What is large is far apart; what a tool draws stays the brightest thing nearby.

Each floor texture is a biome with its own school, so a face is recognised from far away by silhouette and colour:

| Floor | Biome | Landmarks (one major, a few minor) |
| --- | --- | --- |
| `gravelly_sand` | de Chirico piazza, ochre and terracotta | an arcade of 3 to 5 round arches, a tall tower with a pennant, plinths |
| `red_mud_stones` | Dali desert, burnt red and bone | a stilt-legged form 8 m tall, crutch-propped drooping slabs, thin obelisks |
| `grass1` | Magritte meadow, green and slate | boulders floating 2 to 5 m up, a lone door frame, a great pale sphere |
| `river_pebbles` | Tanguy shore, grey-blue and bone | stacks of smooth pebbles, bone-like forms on thin props, a leaning needle |
| `forest_leaves` | Miro garden, black with primaries | wire stalks with coloured discs, a crescent on a pole, biomorphic blobs |
| `snow` | white ruins, marble and ice blue | a colonnade of broken columns with a lintel, a free-standing arch, ice spires |

### 8.2 Light without a sun (refines principle 1)

There is still no light with a horizontal direction in the scene. Instead **every cell has its own baked light
direction** (`cell-complex/cellSun.ts`), used for the long ground shadows in the tint image and for the shading
baked into the vertex colours of generated landmarks. The direction is carried from cell to cell across portals
along a breadth-first tree, so it is continuous across most sides and jumps across the rest. The jump cannot be
removed: it is the holonomy of the surface. The shadows are part of the place, the same in every copy of a cell.

The sky stays symmetric about the vertical: a dusk gradient from deep teal at the zenith through green to a
glowing gold horizon, with a pale moon and its halo exactly at the zenith (a disc at the zenith has no horizontal
direction). Fog is the warm horizon colour.

### 8.3 Faces blend into each other

The floor of a metric cell is an inner polygon in its own texture plus one strip along every side. In a strip the
shader mixes the cell's own ground (texture times tint) with the neighbour's, carried across the portal so its
pattern continues exactly. The neighbour's share is `1 - smoothstep(-w, w, s + n)`, with `s` the distance from the
side into the cell, `w` the half-width of the transition and `n` a noise in the side's own frame with opposite sign
on the two sides: at the side itself the two cells show the same mixture, so the border is continuous and wanders.
Strips are opaque (no transparency, no overdraw) and meet at corners along the bisector. Scenery near a side is drawn
from both biomes in the same proportion. The torus family keeps its own floor.

### 8.4 Landmarks

`world-assets/landmarkLayout.ts` lays out, per cell and seeded, one major landmark (6 to 11 m) and one or two minor
ones (1.5 to 4 m), away from sides (cell geometry has no portal ghosts), corners, authored objects and the start.
`render/three/buildCellLandmarks.ts` builds one merged vertex-coloured mesh per cell, a cell archetype of kind
`landmark`, drawn up to 95 m from the eye (section 8.7). Pillars and feet are colliders for the player. Budget: 900 triangles per cell.

### 8.5 Generated creatures

Creatures that walk straight lines are part of the mathematics, so some are generated too: a stilt-walker (a small
body on four very long thin legs) and a drifting mobile (discs and a crescent on a wire), built in code and moved by
the existing geodesic creature behaviour.

### 8.6 What was built and what it costs (second pass)

Built as described in 8.1 to 8.5, with these differences:

- A cell gets one major and one or two minor landmarks (not two to four): with every copy of every face in view, more
  made the horizon a jumble.
- A major that does not fit its face shrinks in steps (down to 0.68), so some are under 6 m; the great sphere is 4.4 m.
- The transition between two floors was 1.5 m to each side of the border, wandering by up to 1.1 m, inside strips 2.6 m wide (now 0.5 m in all, section 9.4).
- Shadows tuned by eye: strength 0.6, 1.4 times the caster's height, edge 0.18 m.
- Generated creatures reuse the two existing motion families (walking, flying); their bodies are not animated, because the
  creature pipeline has no per-frame hook for the model. The rolling eye slides.
- Landmark feet block the player. They do not block creatures, beams, or the placing of lasers and signs, and they are not
  aim targets.

Cost on the cube (`001-basic-cube`), one pose with 286 visible cell copies:

- Floor: 5 instanced draws per cell instead of 1 (inner polygon and four strips), each with its root draw; about 120
  triangles per copy. Strip fragments sample four textures, inner fragments two.
- Landmarks: one draw per cell, 75 copies drawn (depth 6 or less), 140 to 400 triangles per cell: at most 30 000 triangles.
- Scenery: 14 copies drawn, as before.
- Creatures: three more objects of 70 to 125 triangles, instanced like the mouse.

Seen only on a software renderer; frame rate on a real GPU and in VR is not measured. A thin dark line can show along a
border on light floors where the plane under the cells shows through the hairline gap between two cells' floors.

### 8.7 Corners and distance (third pass)

Two artefacts of the second pass, and what replaced the rules that caused them:

- **A diagonal seam at every corner.** The strip of each side shows the neighbour across that side, and the strips of two
  sides meet on the corner bisector, so with a constant transition width the two strips showed two different neighbours
  along it. The transition (half-width plus noise) now narrows linearly towards both ends of a side, with slope
  `0.85 * tan(angle / 2)` for the smaller of the two cells' corner angles there (`groundBlendGeometry.ts`). On the
  bisector the neighbour's share is then 0 in both strips; the borders form a fan that closes at the vertex. Beyond a
  cone point the view is still split, because the two continuations of space there are different places.
- **Distant things popping.** Scenery (depth 3) and landmarks (depth 6) were cut by portal depth, which is not distance:
  a copy changes depth when the player crosses a portal or the path set changes. They are now cut by distance from the
  eye (`distanceFade.ts`): landmarks beyond the fog's far distance (95 m), scenery beyond 50 m, after a dithered fade from
  38 m. The fog itself now uses the distance from the eye instead of the view depth, so whatever is past 95 m is exactly
  the fog colour in every direction and the cut is invisible; turning the head no longer changes the fog either.

Cost: landmarks on the cube are now drawn up to 95 m instead of depth 6 (about 90 m there), so about as many copies;
on worlds with small faces, more. Scenery up to 50 m instead of depth 3 (about 45 m on the cube). Not measured on a GPU.

## 9. Faces as places: themes and palettes (fourth pass, 2026-11-25)

Faces were still hard to tell apart: the biome followed the authored floor texture, several biomes shared muted colours, and
the transition between floors was wide. Now every face is a place with its own **theme** (what stands on it) and **palette**
(every colour on it, the ground included), both drawn at random per world but constrained so that faces are told apart at a
glance. This replaces the biome-keyed landmarks of sections 8.1 and 8.4; the generated creatures and the scenery stay.

### 9.1 Themes

A theme is a family of silhouettes with generators for one major landmark (6 to 11 m), two or three minor ones (1.5 to 5 m) and
three to six small props (`world-assets/faceThemes.ts`). Each generator builds its landmark from a random source, so no two are
the same, but every landmark of a theme belongs to the same family:

| Theme | Major | Minor | Props |
| --- | --- | --- | --- |
| cairns | a cairn of 7 to 10 balanced stones, twin cairns | small cairn, balanced rock | pebble pairs, flat stones |
| village | town tower with pyramid roof and pennant, a hamlet | house, well | benches, fences |
| striders | a great spider on 6 to 8 jointed legs, a stilt walker | small spider, tripod | eggs |
| clockwork | clock tower with four faces and gears, a gear tree | standing gear, giant bicycle | fallen gear, pocket watch |
| lamplight | giant desk lamp, a grove of crooked lamp posts | street lamp, floor lamp | lantern, candles |
| thresholds | great gate with a door ajar, stair to nowhere ending in a door | doorway, arch, ring portal | floor hatches, steps |
| mobiles | Miro mobile with discs, moons and stars | disc stalk, moon pole | blobs, star sticks |
| parlour | giant chair, wardrobe | table, chest of drawers | stool, teacup, books |
| crystals | crystal cluster | small cluster, leaning shard | geode, shard |
| ruins | colonnade with a broken column, ruined portico | broken column, fallen drums | capital, drum |
| fungi | great mushroom with spots | mushroom, puffballs | toadstools |
| totems | totem pole of stacked shapes | small totem | cube pairs, cones |
| orbits | armillary sphere, planets on stalks | ringed planet, floating rings | globe, meteorite |
| kites | mast with flags and bunting, kites in flight | flag pole, windsock | pennant stakes |
| grove | a great tree, a copse | small tree, topiary | flower beds, shrubs |

Landmarks are lists of parts from a small kit (`world-assets/landmarkParts.ts`): box, prism or cone, lat-long ball, ring or
arc, star or gear, strut. The kit both draws the parts and measures them, so colliders (a part standing on the ground blocks
the player; a strut only at its foot), long shadows (also for hovering parts) and the triangle count come from the same
numbers as the mesh. Glowing parts (bulbs, eyes, lit windows) skip the baked light.

### 9.2 Palettes

A palette is built from a key hue and a scheme, analogous (second and accent hues a little to either side) or tonal (one hue,
lighter and stronger variants), with muted saturation (0.36 to 0.5 for the key colour): `primary`, `secondary` and `accent` from the scheme, `dark` and `light` from the key hue, a `glow`, and a `ground` colour (`world-assets/facePalettes.ts`).
Every part takes a palette role. The floor keeps its texture's detail and brightness but loses 80 percent of its own colour
and takes the palette's ground hue; this rides in the tint image (alpha = how much colour is removed), so the blend strips
recolour both cells' grounds correctly.

### 9.3 Assignment

`world-assets/faceThemeAssignment.ts` visits the faces breadth-first with a random source seeded from the world's cell ids:

- a face takes a theme no glued neighbour has, among the least used so far; with 15 themes, the cube and the dodecahedron
  give every face its own;
- the colour wheel is cut into min(faces, 12) evenly spaced key hues with a random offset; a face takes, among the least
  used hues, the one farthest from its neighbours' hues;
- schemes differ from the neighbours' where they can.

Contrasting schemes (complementary, split, triadic) and saturated colours were tried first and dropped: two-hue faces looked
cartoonish next to one-hue faces. Faces stay apart through their key hues, which neighbours never share.

The draw is seeded by the **look seed** (section 9.6).

A face that holds an authored decoration takes one of the themes that decoration fits (`decorationThemeIdsByAssetFolder`):
a bicycle fits clockwork, village or lamplight; a bench village, lamplight, grove or ruins; a tree grove, village, ruins or
fungi; flowers grove, parlour, village or fungi; a stop sign or traffic cone lamplight, village, kites or totems. Faces with
decorations choose first, by the same rules (differ from the neighbours, least used first), so a world whose faces are full
of trees still gets different themes side by side. Grass and objects with a job (question cube, starting house, tool stand,
creatures) constrain nothing.

### 9.4 Borders

The transition between two floors is now at most 0.5 m wide in all (0.3 m half-width plus 0.2 m of wander, with features of
0.7 m), so the border is a crisp ragged seam between two clearly different grounds. It still narrows to nothing at the
corners (section 8.7).

### 9.5 Cost

A face carries 250 to 2000 triangles of landmarks (budget 2400, was 900), drawn as one mesh per cell. Not measured on a GPU.

### 9.6 The look seed and authored decorations

The look (themes, palettes, generated landmarks) comes from one number, the **look seed**: `?lookSeed=N` (0 to 999999) in the
address. Without one, a seed is drawn at random on every load, written into the address bar (so a reload keeps the look) and
shown at the bottom of the pause card ("World look N"), so a look someone likes can be shared or reproduced; the copied link
with options carries it too. Every consumer of the dressing (cell meshes, ground tint, landmark collisions, decoration colours)
reads the same seed (`setActiveLookSeed`, `computeWorldDressing(world, seed)`).

Authored decorations stay where the world file puts them, on a face whose theme they fit (section 9.3), in that face's palette
(section 9.8).

### 9.7 Landmarks on the map

The world map shows each themed face's major landmark as an icon (`render/three/landmarkMapIcon.ts`, `landmarkPieces` in
`worldMapPieces.ts`). The icon is drawn from the landmark's own parts, seen from its front, in its own colours, on a disc in the
palette's light colour with a dark rim: the map shows the very cairn, tower or spider of this look, not a symbol for its kind.
Minor landmarks and props stay off the map, which would be a jumble with them.

### 9.8 Decorations generated in code

The hand-placed decorations (bench, bicycle, tree, swirl tree, flower pot, flower group, stop sign, traffic cone and the
house, the starting house included) are no longer glTF models: they are built from the same part kit as the landmarks
(`world-assets/decorationModels.ts`). Their asset path is `generated/<kind>`; nothing is preloaded, and the renderer builds
the mesh from parts. Each is drawn in its face's palette, with the cell's light baked in, and varied by its own seed (its id
and the look seed), so it belongs to its face and is a little different in every look. Sizes are real meters at author scale 1,
matched to the collision cylinders the library gives them; author scale keeps its meaning. Outside a themed face (the torus
family) they take a muted wood palette.

- The house fits only the village theme, so the player always starts in the village, the de Chirico face of houses and a
  tower; its door faces the start.
- The premade bicycles were removed from the themed worlds (the clockwork theme generates bicycles, and two different bikes
  were confusing). The basic cube's bottom face got a stop sign as its authored landmark instead.
- The models left loaded from files (grass, the question cube, legacy props) are recoloured in the shader where they fit a
  theme (`render/three/decorationPalette.ts`): desaturated, then tinted, so a texture changes as much as a plain colour.
- The removed models and their licences are gone from `public/assets`; their map icons, which were project-made, stay.
