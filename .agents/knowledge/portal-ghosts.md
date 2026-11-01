# Portal ghosts follow the drawn shape, and the footprint is mandatory

A ghost is the copy of a drawn part in the cell on the other side of a portal it reaches (`render/three/runtimeObjectGhostRecords.ts`).
Rules (maintainer, 2026-11-01):

- **What decides a ghost is the render footprint** (`RenderFootprint` in `runtimeObjectRenderRecords.ts`): a disk, centre and radius in the object's own frame, of what is
  DRAWN. The collision shape plays no part. A creature's model need not be centred on, or as wide as, its collision cylinder: the mouse's collision disk is
  centre (0, 0.35) radius 0.725, its drawn disk is centre (0, 0) radius 1.52 (`Mouse.glb` is 2.97 m long at the renderer's scale, the cylinder is a 1.45 m body),
  and the ghosts used to follow the cylinder. Symptom of the old rule: a ghost that pops in or out at the wrong distance from a portal, or an object cut at a portal.
- **The footprint is a required input** of `collectPortalGhostRuntimeObjectRenderRecords` (a call without one fails typecheck) and there is no collision or default
  fallback. A silent fallback is a silent failure, so a drawn part whose footprint cannot be measured **throws** (`Render footprint missing for "<prefix>"` from the instance
  sync, which the frame error guard reports; at setup it throws outright).
- **Where each footprint comes from:** it is measured from the meshes actually drawn (`computeRenderSourceFootprint`: the corners of every source mesh's bounding box, in the
  object root's frame, as the disk around the horizontal bounding box). So it follows the model, its scale, tilts and offset with no hand-copied number to go stale, for
  creatures, assets, placed flags and the geodesic body parts (post, heads, balloon). The carry highlight declares its own: its shape's centre and longest horizontal semi-axis.
  A part with no archetypes draws nothing and needs none.
- The disk is a loose fit for a long thin model (the mouse's box is 0.64 x 2.97 m, its disk radius 1.52 m), so such an object is ghosted somewhat earlier than strictly needed;
  the extra copy lies exactly where the object's own copy appears in the developed picture, so it is harmless. A tighter shape would be a refinement of `RenderFootprint`.
- `placeSimpleGeoCreatureModel` (`render/three/creatures/simpleGeoCreatureView.ts`) is the one place that puts a creature's model in its frame, so tests can reproduce what is drawn.
- Guard: `tests/render/runtimeObjectPortalGhostContract.test.ts` has a `Record` keyed by every object `kind`; for the kinds drawn from a model it also checks that a model
  reaching the portal is ghosted while a collision cylinder reaching it is not, and that an unmeasurable model fails loudly.
- Found while measuring: the butterfly's collision offset `y` has the opposite sign to the drawn model's centre (`butterflyAssetBounds.centerYMetersAtAuthorScale` is +0.036, the
  model's centre is at -0.036 in world y after the creature view's half turn): a 7 cm mismatch of the collision cylinder, not fixed here.
