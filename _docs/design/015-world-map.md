# 015 - World map

Status: **built** (2026-11-06). The tool is `worldMap/map`, in `src/modules/worldMap/`; the map itself is `src/render/three/worldMapRenderer.ts`.

## What it does

The map tool shows the whole world in miniature until it is dismissed: the solid, an icon for each object, and one for the player. It has an entry on the main tool list. The primary action (click, trigger) dismisses it, and choosing another tool ends it as it ends any tool.

- **Desktop.** The map floats in front of the player. It is fixed to the view and turned so the avatar faces the viewer with its heading up, which makes the solid turn under the avatar as the player walks. The palette hides it while open, because both stand in the same place.
- **VR.** The map floats above the right hand and turns exactly as the hand turns.

## Decisions

**A world's map is derived from its gluings, not listed.** `cell-complex/platonicSolid.ts#findPlatonicSolid` folds the cells along the portals by the solid's dihedral angle, and accepts the world only if every portal agrees with the result. There is no table of worlds, so a new solid world gets a map with no further work, and a torus, a genus-2 surface or a mis-glued cube gets none.

**A world with no map has no tool.** `glue/appConfig.ts#appConfigForWorld` switches `tools.worldMap` off for such a world, once, as the app starts. That one change takes the tile off the palette and makes the world refuse the tool with its usual `world/toolDisabled`. It holds for the life of the app because only torus worlds deform, and a deformation keeps them tori. A deformable solid would need this revisited: the map is rebuilt from `activeWorld()`, but the config is not.

**The tool writes nothing.** The module defines the tool id so that the engine can gate it, and has no commands, object kinds or ticks. The renderer reads the selection, the registry, the world's render sources and the player's pose.

**Nothing on the map has height.** Everything lies flat on the faces. At height, each face lifts what stands on it along its own normal, and two lifted lines meet only where a geodesic crosses an edge square on, so a geodesic could be straight on the faces or connected over the edges, not both, and laying only the geodesic flat left it apart from its emitter. Both were tried, along with mitering the ends to a common point over the edge, which kinks the line on every face. Flat, a geodesic is straight and connected, and it runs through its emitter.

**A thing on the map is its icon, declared with the thing.** Each icon is a symbol in the style of a road map: a stop sign is the sign without its pole, a tree a round crown on a trunk. It is an SVG named `map-icon.svg` in the folder of the thing's model, and its path is declared next to the model's path: `mapIconPath` in a library entry (`world-objects/library.ts`), which the spec and the runtime record carry; `placedFlagMapIconPaths` beside the sign models; `geodesicMapIconPaths` beside the emitter and balloon models; and `mapIconPath` in the avatar's definition. `preloadWorldAssets` loads the icons with the models. A library entry must state its icon, and `undefined` keeps it off the map; grass has none. `render/three/worldMapPieces.ts#worldMapIconPathOf` is the one place that reads them. Measurements, vertices and arcs have no icon.

Two earlier designs were dropped. Low-poly 3D copies made with a mesh simplifier had height, which breaks the geodesics (above). Sprites drawn at run time from each model's own meshes, in a three-quarter view at true scale, needed no files, but a model seen from above at map size is a blur, and small things vanished.

**An icon has one size.** Every icon is the same part of the solid's circumradius, and the player's is larger, as on a road map: the icon says what stands there, not how large it is. An icon is centered where its thing stands, and its top points along the thing's forward direction, so it turns with its thing; the player's icon has a pointer on top that shows the heading.

**The map has its own light.** Its faces turn every way, so under the world's lights those turned from the sun were nearly black. Faces use a matcap, a fixed light that turns with the viewer. Icons are drawn unlit.

**A geodesic is a strip in the ribbon's own material.** So it has the world's color and state. It is 30 cm wide, or it would be thinner than a pixel, and it keeps the segment's own line. A strip stands a few centimeters off the face, so each end on a side runs on along that line, a few centimeters, to overlap the next piece.

**Flat things are stacked by render order, not depth.** They write no depth, so overlapping icons on one face cannot fight: strips first, then icons, then the player's on top.

**The hand gives the map its turn, not its offset.** The map's center stays a fixed height above the hand, rather than riding on a rigid arm. Otherwise a turn of the wrist would swing the whole map through the air, and looking at the far side of the solid would move it out of view. It also needs no assumption about the axes of grip and wrist spaces, which differ. The turn relative to the hand is captured the first frame the map appears there, so it opens with the avatar facing the viewer.

**The map draws in a thin near slice of the depth range** (`gl.depthRange`), on each of its meshes. A wall close to the player cannot cut through it, and it keeps depth testing among its own parts, which `depthTest: false` would lose. Clearing the depth buffer instead would break the transparent world objects drawn after it.

**The player is always at the map's center.** On the desktop the map is placed so that the player's point, not the solid's center, stands at the map's place in front of the eye, and the solid is turned so that the direction from its center to the player points at the viewer, tilted back 15° so the face is seen a little from above. The turn uses that radial direction, not the face normal, so it does not jump at an edge: in the middle of a face the face is seen almost square on, and toward an edge or a corner the solid turns to show the next faces. A three-quarter view with the player off to the lower left came first and lost the player on faces seen edge-on; a 30° tilt hid the face ahead when walking toward an edge. In XR the hand turns the map and the solid's center stays above the hand.

## Not verified on a headset

The hand anchoring is covered by unit tests over fake poses and has not been tried in a headset. The height above the hand, the map's size, the icons' size and the depth slice's precision on a headset's depth buffer are starting values.
