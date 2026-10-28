# 25 - Runtime object archetype portal rendering

Status: closed on 2026-06-14.

## Outcome

Issue 25 is complete.

Portal-visible runtime objects now render through runtime archetype instanced meshes instead of per-path cloned `Object3D` trees. Mouse, butterfly, marmot, and placed sign render parts publish registry-backed runtime render records, while collision, movement, interactions, and sign editing remain registry-owned.

## Goal

Move portal-renderable runtime objects onto the same archetype/instance rendering model used by static cell content.

Runtime objects such as geodesic mice, butterflies, marmots, and placed signs should remain live registry objects for movement, collision, interaction, editing, and reset behavior. Their portal-visible rendering should not deep-clone `Object3D` trees when the player crosses portals or when visible portal paths change.

This issue replaces the runtime-object portal clone path with a shared runtime-object archetype renderer.

Depends on: [24_desktop_place_flag_runtime_objects.md](./24_desktop_place_flag_runtime_objects.md).

## Problem

The current runtime-object portal rendering path mirrors runtime object roots by cloning children of visible destination cell roots. This was convenient for early dynamic objects, but it is not the same optimized path as static cell archetypes.

The static cell renderer already does the right kind of work:

- prepare geometry/material archetypes once,
- allocate instance capacity,
- update instance matrices for visible portal paths,
- update portal path id and clip index attributes,
- avoid rebuilding heavy scene graphs during ordinary portal crossing.

Runtime objects currently do more expensive work:

- each runtime object owns a real `THREE.Object3D` root under a cell root,
- portal visibility code clones those roots for visible destination paths,
- heavy runtime objects, especially placed signs, can introduce crossing-frame hitches,
- caching cloned roots is only a bandage because it preserves a second rendering architecture.

Placed signs make the problem obvious, but the fix should not be sign-specific. Geodesic mice and other runtime objects should render through the same archetype/instance machinery as static renderables.

## Key Principle

There should be one portal-visible render architecture for ordinary mesh-like world objects:

```text
authoring/runtime state -> render archetype + instance records -> portal instance renderer
```

Runtime object state should stay separate from renderer resources:

```text
runtime registry: authoritative id, cell, pose, collision, mutable data
runtime render adapters: translate runtime state into archetype instance records
portal renderer: draws instances for visible portal paths
```

Do not introduce or preserve a separate runtime-object portal clone renderer unless an object truly cannot be represented as render instances.

## Scope

Implement a runtime-object archetype rendering path and migrate ordinary portal-renderable runtime objects to it:

- geodesic mouse,
- geodesic butterfly,
- geodesci marmot proxy,
- placed sign model meshes,
- placed sign text planes.

Remove the runtime-object portal clone path once migrated.

Keep runtime object registry, collision, movement, tooltips, and interactions unchanged except where renderer integration requires a narrower interface.

## Non-Goals

- Do not change movement or collision rules.
- Do not rewrite static cell archetype rendering from scratch.
- Do not implement saving/loading placed signs.
- Do not make renderer meshes the source of truth for runtime object identity.
- Do not optimize debug collision wireframes through this path; issue 22 keeps them out of portal rendering by default.
- Do not support arbitrary animated/skinned runtime GLTF objects unless the existing objects require it. If a future object needs skeletal animation, document the extension separately.

## Design Direction

### Runtime render records

Add a small renderer-side representation for runtime object drawables. A runtime object may emit one or more render records.

Suggested shape:

```ts
interface RuntimeObjectRenderRecord {
  readonly objectId: string;
  readonly cellId: string;
  readonly archetypeKey: string;
  readonly localMatrix: THREE.Matrix4;
}
```

The `localMatrix` is the object draw transform in the object's current cell. The portal renderer composes it with each visible path's `rootFromDestinationMatrix`.

Runtime objects with multiple draw parts emit multiple records:

- a placed sign emits sign model part records plus text plane records,
- a mouse emits one or more mesh primitive records from its model,
- a marmot proxy emits records for its box-based mesh parts.

### Runtime archetypes

Create a runtime archetype registry or builder that prepares reusable geometry/material pairs.

Suggested shape:

```ts
interface RuntimeRenderArchetype {
  readonly archetypeKey: string;
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  readonly portalPathIdAttribute: THREE.InstancedBufferAttribute;
  readonly portalClipIndexAttribute: THREE.InstancedBufferAttribute;
}
```

This should intentionally resemble `CellRenderArchetype` so the existing `updateCellRenderArchetypeInstances` logic can be reused or generalized.

Prefer generalizing shared instance update code rather than copying another complete portal instance updater.

### Visible runtime instances

For each frame:

1. Compute visible portal paths as today.
2. Build or maintain runtime render records from the runtime object registry/adapters.
3. For each visible path, find records whose `cellId` matches `path.destinationCellId`.
4. For each matching record, compute:

```ts
instanceMatrix = path.rootFromDestinationMatrix * record.localMatrix
portalPathId = path.pathId
portalClipIndex = path.depth === 0 ? unclippedPortalClipIndex : clipIndexByPathId.get(path.pathId) ?? -1
```

5. Write those values into the matching runtime archetype instanced mesh.

This is the runtime-object equivalent of static cell archetype rendering.

### Placed signs

Placed signs are a good fit for runtime archetype rendering.

The text content is identical for all portal-visible instances of the same placed sign. Do not clone sign roots per portal view.

Represent signs as:

- prepared model mesh archetypes for `WoodenSign1` and `WoodenSign2`,
- per-placed-sign text material using one `CanvasTexture`,
- front/back text plane records that share that same texture,
- one or more instance records per sign part.

Editing a sign should:

1. update the `PlacedFlagObject` in the registry,
2. redraw the one canvas texture owned by that placed sign's runtime render data,
3. mark the texture dirty,
4. leave portal instances alone except for normal per-frame matrix/clip updates.

All portal-visible sign instances should automatically show the same updated text because they share the sign's text texture/material.

If the two sign GLBs have multiple mesh primitives, either:

- create one runtime archetype per primitive/material tuple, or
- flatten/preprocess each sign model into stable runtime archetype parts.

Do not infer collision from sign mesh bounds. Collision remains runtime state from `placedFlags.ts`.

### Geodesic mouse, butterfly, and marmot

Migrate the existing runtime adapters so they no longer depend on their root being cloned for portal visibility.

They may still own lightweight local roots for non-portal purposes if useful, but portal rendering should come from runtime render records.

For each creature:

- keep registry object state authoritative,
- keep movement updates as they are,
- after movement, update the runtime render record matrix,
- parented `Object3D` roots should not be required for portal visibility.

For the geodesic mouse and butterfly GLTF assets, convert instantiated scene meshes into runtime archetype parts once. Reuse those archetypes for all runtime instances of that object type.

For marmot proxy geometry, create runtime archetype parts from the proxy meshes or replace the proxy builder with explicit reusable geometries/materials.

### Runtime object root policy

After this issue, ordinary portal-renderable runtime objects should not rely on cell-root child cloning for portal rendering.

Allowed uses for runtime `Object3D` roots:

- current-cell-only debug helpers,
- invisible interaction anchors if needed,
- local-only editor gizmos,
- transitional compatibility during migration.

Disallowed for ordinary portal rendering:

- cloning runtime object roots per visible portal path,
- adding new runtime render behavior to the clone path,
- treating placed signs as a separate renderer-only mesh list.

### Removing the clone path

Once migrated, remove these concepts from `createThreeApp.ts` or their equivalent current names:

- runtime object portal render root,
- runtime object portal render entries,
- retained/cached runtime object portal clone entries,
- `cloneObject3DWithFreshMeshResources`,
- `syncObject3DTreeState` for portal object clones,
- portal attribute stamping over cloned runtime object trees.

If any helper remains because static/debug code still needs it, rename it narrowly and document why it is not a runtime-object portal rendering path.

## Likely Files

Likely new files:

- `src/render/three/runtimeObjectRenderArchetypes.ts`
- `src/render/three/runtimeObjectRenderRecords.ts`
- `tests/render-contract/runtimeObjectRenderArchetypes.test.ts`
- `tests/render-contract/runtimeObjectPortalInstances.test.ts`

Likely touched files:

- `src/render/three/createThreeApp.ts`
- `src/render/three/cellRenderArchetypes.ts`
- `src/render/three/renderPortalInstances.ts`
- `src/render/three/placedFlagRenderer.ts`
- `src/world-objects/geodesciMarmot.ts`
- `src/world-objects/simpleGeoCreature.ts`
- `src/world-objects/placedFlags.ts`
- `tests/render-contract/placedFlagRenderer.test.ts`
- `tests/world-objects/geodesciMarmot.test.ts`
- `tests/world-objects/simpleGeoCreature.test.ts`

## Implementation Plan

### 1. Identify shared instance update logic

Inspect:

- `cellRenderArchetypes.ts`,
- `renderPortalInstances.ts`,
- `portalClipMaterial.ts`.

Extract or generalize the instance update logic so both static cell archetypes and runtime object archetypes can write:

- instance matrices,
- portal path ids,
- portal clip indexes,
- diagnostics/capacity overflow state.

Do not duplicate a full second implementation if a small common interface can support both.

### 2. Add runtime render record API

Create renderer-side types for runtime render records and runtime render archetypes.

The API should let runtime adapters publish current records without exposing registry internals to the portal renderer.

A minimal first version can be:

```ts
interface RuntimeObjectRenderSource {
  collectRuntimeRenderRecords(): readonly RuntimeObjectRenderRecord[];
  dispose(): void;
}
```

or a central mutable store:

```ts
setRuntimeObjectRenderRecords(objectId, records)
removeRuntimeObjectRenderRecords(objectId)
```

Choose the style that best matches existing code, but keep object state authoritative in the runtime registry.

### 3. Build runtime archetypes for creature assets

Migrate mouse, butterfly, and marmot rendering first.

The goal is to prove the architecture with objects that already work behaviorally.

Required behavior:

- existing movement still updates registry state,
- visible portal rendering uses runtime archetype instances,
- no runtime object root cloning is required for portal views,
- current-cell visibility remains visually equivalent.

Keep collision wireframes outside the portal archetype path unless explicitly enabled by a debug renderer.

### 4. Build placed sign runtime archetypes

Split placed sign rendering into archetype parts:

- model mesh part records,
- front text plane record,
- back text plane record.

Each placed sign owns:

- text canvas,
- text texture,
- text material(s) or material pair if front/back differ,
- current text layout calibration.

Each visible portal copy uses instance transforms against those shared materials.

Editing text/color must update the one sign texture/material state. It must not create new portal clone trees.

### 5. Integrate runtime archetypes into portal render loop

In `createThreeApp.ts`, replace `syncRuntimeObjectPortalRenders()` with runtime archetype instance updates.

The frame should have one flow:

1. update runtime objects and their render records,
2. compute visible portal paths,
3. update static cell archetype instances,
4. update runtime object archetype instances,
5. render.

Do not scan cell root children for portal-renderable runtime objects.

### 6. Remove runtime object portal cloning

After all runtime objects render through archetypes:

- delete clone-entry maps and retained clone caches,
- delete or narrow clone helpers,
- remove runtime-object portal clone diagnostics if any,
- update names/comments so future LLM developers do not reintroduce the clone path.

### 7. Keep interactions and tooltips registry-based

Interaction targeting should continue to use runtime registry state and collision bounds.

Do not target renderer instances for editing/interacting. Renderer instances are views only.

### 8. Update docs and debug text

Update issue 24 language if necessary so it says placed signs participate in runtime archetype portal rendering, not root cloning.

Update debug overlay labels if they distinguish static portal instances from runtime portal instances.

## Tests

Add tests before deleting the clone path where practical.

Required runtime archetype tests:

- runtime render records are grouped by archetype key,
- visible paths produce one instance per matching runtime record per path,
- instance matrices compose `path.rootFromDestinationMatrix * record.localMatrix`,
- path id and clip index attributes are written for runtime object instances,
- capacity overflow is reported for runtime archetypes.

Required migration tests:

- geodesic mouse publishes runtime render records after movement,
- mouse portal visibility no longer depends on a cloned root under a cell root,
- marmot proxy publishes runtime render records,
- placed sign publishes model and front/back text records,
- editing sign text redraws one texture and does not rebuild portal render entries,
- changing a placed sign cell changes record `cellId` and instance placement.

Required negative tests:

- runtime object portal rendering does not call `cloneObject3DWithFreshMeshResources`,
- collision debug helpers are not included in runtime object archetypes by default,
- deleting a placed sign removes its runtime render records and disposes its text texture/material.

Required integration tests:

- portal-visible runtime object instance counts include mouse/sign records,
- crossing portals after placing multiple signs does not rebuild runtime object clone trees,
- existing movement, interaction, reset, desktop controls, and VR tests continue to pass.

## Acceptance Criteria

- Runtime objects render through archetype/instance portal rendering.
- Placed signs do not use per-portal cloned `Object3D` trees.
- Sign text is represented once per placed sign and shared by all portal-visible instances.
- Mouse, butterfly, marmot, and placed signs use the same runtime object render architecture.
- Runtime object registry remains the source of truth for object identity, cell membership, pose, collision, and mutable sign data.
- Renderer instances remain views and are not used for interaction or collision source of truth.
- The old runtime-object portal clone path is removed or reduced to a clearly documented non-runtime compatibility helper.
- Portal crossing with several placed signs does not introduce clone/rebuild hitches.
- Full test suite passes.

## Notes for LLM Devs

Do not solve this by adding a sign-specific cache.

Do not solve this by retaining more cloned runtime `Object3D` trees.

The intended architecture is to reuse the static archetype/instance portal rendering idea for runtime objects. If a runtime object appears to need a real scene graph, first decompose it into render records and archetype parts. Only keep a separate path if the object fundamentally cannot be represented as instanced geometry/material records, and document that exception in the issue or code.

For placed signs, remember that portal-visible copies have identical text content. One placed sign should own one text texture, and all portal-visible instances should share it.
