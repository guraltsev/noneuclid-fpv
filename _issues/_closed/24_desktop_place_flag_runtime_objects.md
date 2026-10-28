# 24 - Desktop place-flag tool and runtime object registry

Status: closed on 2026-06-14.

## Outcome

Issue 24 is complete.

The app now has a runtime object registry for authored creatures and placed signs, desktop sign placement and editing, registry-based collision/interactions/tooltips, and placed sign rendering that participates in the runtime object portal rendering architecture.

## Goal

Add a desktop-only place-flag tool backed by a general runtime object registry.

Placed flags should be live world objects, not renderer-only decorations. Existing authored creatures such as marmots, mice, and butterflies should also be represented as runtime objects so that collision, portal rendering, interaction, reset behavior, and future object-object logic have one authoritative object system.

Depends on: [23_cylindrical_collision_shapes.md](./23_cylindrical_collision_shapes.md).

## Scope

Implement the first runtime object system and use it for the desktop place-flag feature:

- add a runtime object registry keyed by object id and indexed by cell id,
- seed the registry from authored dynamic world objects at startup,
- migrate existing marmot and simple creature runtime handling onto the registry boundary,
- add placed flag runtime objects with type, pose, collision, message, and font color,
- add desktop palette controls for `Place flag` and flag type options,
- use `WoodenSign1` and `WoodenSign2` as the selectable flag models,
- place flags from desktop camera aim,
- allow desktop interaction with focused flags using `F`,
- open a desktop editor for a placed flag message of up to 15 characters and font color,
- render sign text on the sign surface,
- keep placed signs visible through portals using the runtime-object portal rendering path,
- keep shared palette data compatible with VR, but do not implement VR placement or editing.

## Non-Goals

- Do not implement VR place-flag controls.
- Do not implement VR sign editing.
- Do not add an in-headset keyboard.
- Do not implement saving/loading placed flags yet.
- Do not make static floors, walls, portal frames, or pure background decoration runtime objects.
- Do not add a physics solver, pushing, impulses, stacking, or object ownership rules.
- Do not implement true oriented-box collision.
- Do not make renderer meshes the source of truth for object identity, collision, or interaction.

## Design Direction

### Runtime object registry

Create a small engine-level registry for live world objects. The registry should own object identity, cell membership, pose, collision, and mutable object data.

Use cell-level indexing as the first spatial partition:

```ts
objectsById: Map<string, RuntimeWorldObject>
objectIdsByCellId: Map<string, Set<string>>
```

This is efficient enough for the current cell-based world. A finer grid or tree can be added later if individual cells contain many objects.

Runtime objects should expose a movement/collision-compatible shape:

```ts
interface RuntimeWorldObjectBase {
  readonly id: string;
  readonly cellId: string;
  readonly localPose: RigidTransform3;
  readonly collision?: SimpleCollisionCylinder;
  readonly portalRenderable: boolean;
  readonly interactable?: RuntimeObjectInteraction;
}
```

Use discriminated variants for object-specific state:

```ts
type RuntimeWorldObject =
  | RuntimeCreatureObject
  | PlacedFlagObject;

interface RuntimeCreatureObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesci-marmot" | "geo-mouse" | "geo-butterfly";
}

interface PlacedFlagObject extends RuntimeWorldObjectBase {
  readonly kind: "placed-flag";
  readonly flagType: "WoodenSign1" | "WoodenSign2";
  readonly message: string;
  readonly fontColor: string;
}
```

Static visual-only assets may remain compiled cell objects and render archetypes. An object should become a runtime object when it has identity, behavior, collision, interaction, mutable state, or needs to be placed at runtime.

### Authored objects become initial runtime objects

Authored world object specs should act as spawn data for runtime objects.

At startup:

1. Compile the world as usual.
2. Read each cell's authored objects.
3. Register authored dynamic objects as runtime objects in their starting cells.
4. Build behavior/render adapters from the runtime registry.

Do not treat placed flags as a separate side system. A placed flag is simply a new runtime object inserted after startup.

### Desktop-only tool UI

Use the shared palette definition as the source of menu state. This is option 2 from the design discussion: shared data exists now, while the VR renderer ignores tool content until VR tool design is implemented.

Extend the runtime menu state with desktop tool state:

```ts
selectedTool: "none" | "place-flag";
placeFlagOptions: {
  flagType: "WoodenSign1" | "WoodenSign2";
};
editingFlagId?: string;
```

The main palette should offer:

- a `Place flag` tool action,
- a small options button for flag type,
- settings access as before.

The flag options page should allow choosing:

- `WoodenSign1`,
- `WoodenSign2`.

The VR palette adapter must keep compiling after the shared definition changes. It may render an empty main content area for tool content and should not dispatch placement or editing actions.

### Desktop placement

When the place-flag tool is active, desktop placement should use camera aim.

Initial placement behavior:

- cast from the desktop camera through the center of the view,
- find a floor point in the player's current cell,
- orient the sign to face the player,
- build a candidate `PlacedFlagObject`,
- reject the candidate if its collision bounds intersect walls, floor, ceiling, forbidden zones, or collidable runtime objects in the same cell,
- insert the object into the runtime registry if placement succeeds.

Collision should use the cylinder bounds from issue 23. Do not derive collision from rendered mesh bounds.

### Desktop interaction

Use `F`, not `E`, for desktop interaction.

`E` is already part of desktop keyboard turning. `F` should be a one-shot input action, similar in spirit to reset, not a continuous movement key.

Interaction targeting should be based on player/camera focus:

- only consider runtime objects in the player's current cell,
- require an interactable object within a short range,
- prefer the nearest object near the view direction,
- open the flag editor when the focused object is a placed flag.

Do not support interacting with signs through portal images in this issue.

### Flag editor

The desktop editor should be a DOM UI, not a Three.js overlay.

The editor should support:

- text entry with a maximum of 15 characters,
- font color selection from a small fixed palette,
- closing without changing the selected tool,
- immediate or apply-on-close updates, as long as behavior is deterministic and tested.

The runtime object registry should store the authoritative message and font color. The sign renderer should update from registry state.

### Rendering and Portal Visibility

Use these assets:

```text
WoodenSign1/WoodenSign1.glb
WoodenSign2/WoodenSign2.glb
```

Ensure these runtime tool assets are preloaded even when no authored world object references them.

Each runtime object adapter should own a root `THREE.Object3D` and parent it under the current cell root. When an object changes cells, the adapter should reparent it to the new cell root.

Runtime roots may remain parented under the current cell for local-only helpers, but portal visibility is handled by runtime object archetype records. Placed flags and migrated creature render roots should publish renderer records from the shared runtime object registry, not by adding a separate side system.

For sign text, render a small canvas texture on a plane slightly in front of the sign board. Updating a sign message or font color should redraw the canvas texture and mark it dirty.

## Likely Files

Likely new files:

- `src/world-objects/runtimeObjectRegistry.ts`
- `src/world-objects/placedFlags.ts`
- `src/render/three/placedFlagRenderer.ts`
- `tests/world-objects/runtimeObjectRegistry.test.ts`
- `tests/world-objects/placedFlags.test.ts`

Likely touched files:

- `src/appState.ts`
- `src/runtime/runtimeMenuState.ts`
- `src/ui/paletteDefinition.ts`
- `src/render/dom/desktopToolPalette.ts`
- `src/render/three/desktopControls.ts`
- `src/render/three/createThreeApp.ts`
- `src/render/three/preloadWorldAssets.ts`
- `src/render/three/vrPaletteLibraryAdapter.ts`
- `src/world-objects/geodesciMarmot.ts`
- `src/world-objects/simpleGeoCreature.ts`
- `src/movement/moveDynamicObject.ts`

Likely tests:

- `tests/render-contract/desktopToolPalette.test.ts`
- `tests/render-contract/preloadWorldAssets.test.ts`
- `tests/render-contract/vrPaletteController.test.ts`
- `tests/movement/moveDynamicObject.test.ts`

## Implementation Plan

### 1. Add runtime object types and registry

Create a pure registry module with operations to:

- add an object,
- update an object,
- remove an object,
- move an object to another cell,
- get an object by id,
- get objects in a cell,
- get collidable objects in a cell,
- get interactable objects in a cell.

Keep this module independent of Three.js and DOM code.

### 2. Seed authored dynamic objects into the registry

Convert existing authored marmot, mouse, and butterfly specs into runtime object entries during app startup or renderer initialization.

Existing behavior code can remain in specialized adapters initially, but those adapters should read and write object state through the registry boundary instead of owning the only live object state.

### 3. Add placed flag model helpers

Add helpers for:

- creating a placed flag object,
- clamping/sanitizing flag text to 15 characters,
- validating flag type,
- updating message and font color,
- converting a flag object to a `DynamicObjectState` for collision helpers.

### 4. Add desktop palette state

Extend shared menu state and palette definitions for:

- selected tool,
- place flag options,
- flag editor state.

Render the tool controls in the desktop DOM palette.

Update the VR palette adapter only enough to handle the widened shared content union without implementing VR tool behavior.

### 5. Add desktop placement input

Extend desktop controls or app input aggregation with:

- a one-shot primary action for placing the active tool,
- a one-shot `F` interaction action.

When `Place flag` is active and the primary action fires, compute a placement candidate from camera aim and register it if collision checks pass.

### 6. Add flag runtime rendering

Add a Three.js runtime adapter for placed flags, matching the marmot and simple geodesic creature adapter shape:

- instantiate the selected sign GLB,
- place it from the runtime object's cell-local pose,
- add a text plane with a canvas texture,
- update pose/text/color when registry state changes,
- dispose geometries/materials/textures cleanly.

Runtime object roots may be parented under cell roots for local helpers, while portal rendering should consume runtime object archetype records keyed by registry state.

### 7. Add desktop flag editing

When `F` targets a placed flag, open the DOM editor.

The editor should update the registry, and the flag runtime should sync from registry state. The editor must not require pointer lock while typing.

### 8. Integrate object-object collision carefully

Use the registry's cell index for candidate placement checks against existing collidable runtime objects.

If movement collision is expanded in this issue, reject candidate dynamic-object movement when it intersects another collidable runtime object in the same cell. Otherwise, keep object-object collision limited to flag placement and leave movement integration as a documented follow-up.

## Tests

Add focused tests before broad renderer tests.

Required registry tests:

- adding an object makes it available by id,
- adding an object indexes it under its cell id,
- moving an object updates the old and new cell indexes,
- removing an object clears id and cell indexes,
- collidable lookup omits objects without collision,
- interactable lookup omits objects without interaction data.

Required flag model tests:

- `WoodenSign1` and `WoodenSign2` are accepted flag types,
- unknown flag types are rejected or never constructible,
- messages are clamped to 15 characters,
- font color updates preserve all unrelated flag state,
- placed flags expose collision as a dynamic object state.

Required palette tests:

- the main desktop palette exposes the place-flag action,
- the flag options page exposes both flag types,
- selecting a flag type updates menu state,
- VR palette/controller tests still compile and pass with the expanded shared palette definition.

Required placement/collision tests:

- a valid floor placement creates a runtime flag in the player's current cell,
- placement outside the current cell is rejected,
- placement intersecting a wall is rejected,
- placement intersecting a forbidden zone is rejected,
- placement intersecting an existing collidable runtime object is rejected,
- successful placement uses the selected flag type.

Required interaction/editor tests:

- pressing `F` with no focused interactable does nothing,
- pressing `F` while focused on a placed flag opens the editor,
- editing text stores no more than 15 characters,
- editing font color updates the runtime object,
- closing the editor leaves the selected tool state deterministic.

Required render/preload tests:

- both WoodenSign assets are included in the preload set for the runtime tool,
- placed flag runtime creates a root parented to the correct cell root,
- changing a flag cell reparents the runtime root,
- updating message or font color refreshes the text material/texture state,
- runtime-object portal rendering continues to include runtime object roots parented under cell roots.

## Acceptance Criteria

- There is one runtime object registry for live objects with id and cell indexes.
- Existing authored marmots, mice, and butterflies are represented as runtime objects.
- Placed flags are runtime objects, not renderer-only meshes.
- Desktop palette includes a `Place flag` tool and a flag type options control.
- The user can choose `WoodenSign1` or `WoodenSign2` before placing a flag.
- Desktop placement creates a flag in the player's current cell when the candidate location is valid.
- Invalid placements against walls, floor/ceiling, forbidden zones, and existing collidable runtime objects are rejected.
- Placed flags render with the selected wooden sign model.
- Placed flags show editable text on the sign surface.
- Flag messages are limited to 15 characters.
- The user can press `F` in desktop mode to edit a focused placed flag.
- The flag editor supports message and font color changes.
- Placed flags participate in runtime-object archetype portal rendering from registry-backed render records.
- Shared palette definitions remain compatible with VR code, but no VR placement or VR editing behavior is implemented.
- Collision uses runtime object state and existing cylinder bounds helpers, not renderer mesh bounds.
- Existing movement, portal, desktop controls, and VR tests continue to pass.

## Notes for LLM Devs

The central architectural move is:

```text
authored objects: initial spawn data
runtime objects: authoritative live state
render objects: views of runtime state
```

Do not build the flag tool as a special-case Three.js mesh list. The flag tool should prove the runtime object registry is useful by sharing it with existing dynamic creatures.

Avoid using legacy code for new runtime-object behavior unless it is strictly necessary to preserve an existing compatibility boundary. If legacy code must be touched, keep it isolated, name the new runtime-object path clearly, and document why the legacy dependency could not be removed in the same change.

Do not implement VR controls for this issue. It is acceptable and intentional for shared palette types to mention tool content while the VR adapter ignores or renders empty content for those pages.
