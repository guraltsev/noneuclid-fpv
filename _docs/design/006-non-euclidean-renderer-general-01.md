# Detailed outline: proposed portal-rendering architecture

This architecture keeps the existing project shape: **cell topology, portal transforms, movement, and collision stay in `src/cell-complex`, `src/math`, and `src/movement`; Three.js-only rendering work stays in `src/render/three`**. That matches the repo’s current design guidance and directory layout, where rendering is intentionally skippable glue rather than the source of truth for world rules. 

The core idea is:

```text
compiled cell complex
  -> precomputed portal path tables
  -> conservative static path pruning
  -> per-frame camera-visible path list
  -> compact instance buffers
  -> shader-clipped instanced rendering
```

The renderer should not recursively clone cells and instead render **visible path images** of cells using intance meshes and transformation matrixes

---

# 1. Architectural goals

## 1.1 Primary goals

The new renderer should:

1. Render portal views reliably in the cube world with six prism cells.
2. Support configurable recursive portal depth, for example depth 10.
3. Avoid per-frame cloning of whole cell meshes.
4. Avoid creating thousands of permanently hidden object instances.
5. Keep portal transforms consistent with movement.
6. Preserve distinct visual copies of the same destination cell reached through different portal paths.
7. Provide useful debug data: candidate paths, visible paths, max visible depth, clipped paths, and render budget exhaustion.
8. Stay compatible with later VR rendering.

## 1.2 Non-goals

The new renderer should **not**:

1. Reimplement portal validation.
2. Reimplement movement collision.
3. Compute curvature, holonomy, or theorem-level data.
4. Flatten the whole cell complex into one global Euclidean world.
5. Depend on stencil recursion as the main depth-10 strategy.
6. Create one permanent hidden instance per possible topological path per object.
7. Introduce broad “manager/service/engine” abstractions.

The codebase already uses a cell-complex-first runtime and Three.js renderer boundary, so this should be a renderer replacement, not a world-model replacement. 

---

# 2. High-level pipeline

The renderer should be organized as a staged pipeline:

```text
App startup:
  1. compileCellComplex(...)
  2. buildPortalPathTables(...)
  3. staticallyCullPortalPathTables(...)
  4. buildCellRenderArchetypes(...)
  5. buildPortalClipMaterials(...)

Each frame:
  1. read current player cell and camera pose
  2. select path table for current root cell
  3. compute visible portal paths for this camera
  4. compact visible paths into instance buffers
  5. upload clip polygons / clip rects / path ids
  6. render root cell and visible path instances
  7. update debug state
```

The crucial split is:

```text
precomputed:
  topology
  accumulated portal transforms
  destination cell per path
  static conservative culling

per-frame:
  camera visibility
  aperture clipping
  instance count
  clip polygons
```

Depth 10 belongs to the **precomputed path layer**. The actual frame should render only the visible, budgeted subset.

---

# 3. Proposed file layout

## 3.1 New pure portal-path modules

These should not import Three.js.

```text
src/cell-complex/portalPaths.ts
src/cell-complex/staticPortalPathCull.ts
```

Responsibilities:

```text
portalPaths.ts:
  - enumerate portal paths up to max depth
  - compose accumulated rigid transforms
  - group paths by root cell and destination cell
  - preserve different paths to the same destination cell

staticPortalPathCull.ts:
  - apply conservative camera-independent pruning
  - reject immediate reverse paths if enabled
  - reject paths whose destination bounds are impossible through ancestor apertures
  - report why paths were removed
```

These modules should consume:

```text
CompiledCellComplex
CompiledPrismCell
CompiledPortal
RigidTransform3
```

They should not know about:

```text
THREE.Camera
THREE.Scene
THREE.Mesh
WebGLRenderer
```

## 3.2 New Three.js renderer modules

```text
src/render/three/visiblePortalPaths.ts
src/render/three/cellRenderArchetypes.ts
src/render/three/portalClipData.ts
src/render/three/portalClipMaterial.ts
src/render/three/renderPortalInstances.ts
src/render/three/portalRenderDebugState.ts
```

Responsibilities:

```text
visiblePortalPaths.ts:
  - project portals into camera space
  - compute accumulated screen-space aperture polygons
  - discard paths with empty or tiny apertures
  - sort and budget visible paths

cellRenderArchetypes.ts:
  - build reusable InstancedMesh batches per cell/object/material
  - build root-cell meshes or include root cell as depth-0 instances

portalClipData.ts:
  - store per-visible-path clip polygons
  - upload clip data to uniforms, textures, or instanced attributes

portalClipMaterial.ts:
  - patch or create materials that discard fragments outside path aperture

renderPortalInstances.ts:
  - compact visible paths into instance buffers
  - set mesh.count dynamically
  - issue render calls

portalRenderDebugState.ts:
  - expose public render diagnostics
```

## 3.3 Existing files to modify

```text
src/render/three/createThreeApp.ts
src/render/three/buildCellMesh.ts
src/render/three/debugOverlay.ts
src/render/three/renderState.ts
src/glue/debugOptions.ts
```

Changes:

```text
createThreeApp.ts:
  - build path tables once after world load
  - call the new portal renderer each frame
  - keep old stencil renderer only as debug fallback while transitioning

buildCellMesh.ts:
  - either keep as source for non-instanced geometry
  - or split geometry construction into reusable archetype builders

debugOverlay.ts:
  - show portal-render stats

renderState.ts:
  - include visible portal path counts, max depth, and render budget flags

debugOptions.ts:
  - replace/augment "portal-stencil-renderer" with new options:
      portal-path-renderer
      portal-path-debug
      portal-clip-debug
```

---

# 4. Core data model

## 4.1 Portal path table

A portal path table is built once per possible root cell.

```ts
export interface PortalPathTable {
  readonly rootCellId: string;
  readonly maxDepth: number;
  readonly paths: readonly PortalRenderPath[];
  readonly pathsByDestinationCell: ReadonlyMap<string, readonly PortalRenderPath[]>;
  readonly pathsByParentPathId: ReadonlyMap<number, readonly PortalRenderPath[]>;
}
```

There should be one table per current cell:

```ts
export type PortalPathTablesByRootCell = ReadonlyMap<string, PortalPathTable>;
```

Why per root cell? Because the current player cell is the coordinate root for rendering. The same topological path means a different accumulated transform when the root cell changes.

---

## 4.2 Portal render path

```ts
export interface PortalRenderPath {
  readonly id: number;

  readonly rootCellId: string;
  readonly destinationCellId: string;
  readonly depth: number;

  readonly parentPathId?: number;

  readonly steps: readonly PortalRenderStep[];

  /**
   * Maps root-cell-local coordinates into the destination cell.
   * This is the movement-style accumulated transform.
   */
  readonly destinationFromRoot: RigidTransform3;

  /**
   * Maps destination-cell-local geometry back into root-cell coordinates.
   * This is usually the transform used for rendering geometry.
   */
  readonly rootFromDestination: RigidTransform3;

  /**
   * Conservative transformed destination bounds, if computed during static
   * pruning.
   */
  readonly rootSpaceBounds?: PortalPathBounds;
}
```

A step records one portal crossing:

```ts
export interface PortalRenderStep {
  readonly sourceCellId: string;
  readonly sourcePortalId: string;
  readonly targetCellId: string;
  readonly targetPortalId: string;
}
```

The important transform convention:

```text
destinationFromRoot:
  where the camera/root point would land after following the path

rootFromDestination:
  where destination-cell geometry must be placed to appear in root-cell space
```

For rendering:

```text
clipPosition =
  projectionMatrix
  * viewMatrixInRootCell
  * rootFromDestination
  * localDestinationCellPosition
```

---

# 5. Path enumeration

## 5.1 Enumeration rule

For rendering, the default should skip immediate reverse portals.

For a square cell:

```text
exact depth 1: 4
exact depth 2: 4 * 3
exact depth 3: 4 * 3^2
exact depth 10: 4 * 3^9 = 78,732
```

For a pentagonal cell:

```text
exact depth 1: 5
exact depth 2: 5 * 4
exact depth 3: 5 * 4^2
exact depth 10: 5 * 4^9 = 1,310,720
```

If immediate reversal is allowed, then the count becomes:

```text
square: 4^10
pentagon: 5^10
```

But for visual recursion, immediate reverse paths usually create useless “look back through the same doorway” branches, so the default should be:

```ts
skipImmediateReverse: true
```

## 5.2 Enumeration algorithm

```text
for each root cell:
  create depth-0 path:
    destinationCell = rootCell
    destinationFromRoot = identity
    rootFromDestination = identity

  breadth-first expand paths until maxDepth:
    for each portal in current destination cell:
      if skipImmediateReverse and portal is reverse of previous step:
        continue

      child.destinationFromRoot =
        composeRigidTransform3(portal.transformToTarget, parent.destinationFromRoot)

      child.rootFromDestination =
        invertRigidTransform3(child.destinationFromRoot)

      child.destinationCellId = portal.targetCellId
      child.parentPathId = parent.id
      child.steps = parent.steps + portal step
```

Use the existing `CompiledPortal.transformToTarget`; do not derive a second renderer-only portal transform. The current repo already compiles portal transforms from side identifications, and movement consumes those compiled transforms. 

---

# 6. Static path culling

Static culling should be conservative. It may leave too many paths, but it must not discard a path that can actually be seen.

## 6.1 Inputs

```ts
export interface StaticPortalPathCullOptions {
  readonly skipImmediateReverse: boolean;
  readonly maxKeptPaths?: number;
  readonly toleranceMeters: number;
}
```

## 6.2 Output

```ts
export interface StaticPortalPathCullResult {
  readonly keptPaths: readonly PortalRenderPath[];
  readonly rejectedPaths: readonly RejectedPortalRenderPath[];
}

export interface RejectedPortalRenderPath {
  readonly pathId: number;
  readonly reason:
    | "immediate-reverse"
    | "outside-ancestor-portal-plane"
    | "outside-ancestor-portal-slab"
    | "outside-ancestor-vertical-range"
    | "static-path-budget";
}
```

## 6.3 Conservative geometry tests

For each path, compute a transformed bound for the destination cell.

For a prism cell, the bound is:

```text
base polygon vertices at y = 0
base polygon vertices at y = heightMeters
```

Transform those vertices by `rootFromDestination`.

Then compare the transformed bound against each ancestor portal aperture.

A portal aperture should be represented by:

```ts
export interface PortalAperture {
  readonly sourceCellId: string;
  readonly portalId: string;
  readonly cornersRootSpace: readonly Vec3[]; // four vertical rectangle corners
  readonly planeRootSpace: Plane;
  readonly sidePlanesRootSpace: readonly Plane[];
}
```

Static culling can reject only when the **entire destination bound** is outside a required half-space or slab.

Do **not** reject based only on:

```text
room center
floor center
one floor point
object center
```

Those tests will create false negatives.

---

# 7. Runtime visible-path computation

This is the heart of the renderer.

## 7.1 Visible path contract

```ts
export interface VisiblePortalPath {
  readonly pathId: number;
  readonly destinationCellId: string;
  readonly depth: number;

  readonly rootFromDestinationMatrix: THREE.Matrix4;

  /**
   * Convex screen-space aperture after clipping all portals in the path.
   * Coordinates are normalized device coordinates.
   */
  readonly clipPolygonNdc: readonly Vec2[];

  readonly clipRectNdc: Rect2;
  readonly screenAreaPixels: number;

  readonly sortKey: PortalPathSortKey;
}
```

The root cell itself can be represented as a visible depth-0 path:

```ts
{
  pathId: 0,
  destinationCellId: currentCellId,
  depth: 0,
  rootFromDestinationMatrix: identity,
  clipPolygonNdc: fullScreenQuad,
}
```

That lets the same instancing machinery render the current cell and portal copies.

## 7.2 Runtime visibility algorithm

```text
input:
  current root cell
  camera
  path table for root cell
  viewport size
  visibility options

start with root path:
  aperture = full screen

for each path in parent-before-child order:
  if depth = 0:
    keep root path
    continue

  parentVisiblePath = visible path for parentPathId
  if parent is not visible:
    skip this path

  compute this path's next portal rectangle in root space
  project portal rectangle to NDC
  clip projected portal polygon against parent aperture
  if clipped polygon is empty:
    discard
  if screen area < minPortalScreenArea:
    discard
  if portal is fully behind camera:
    discard
  otherwise:
    keep VisiblePortalPath

sort visible paths:
  lower depth first
  larger screen area first
  stable path id tie-breaker

apply maxVisiblePaths budget
```

## 7.3 Aperture is accumulated

The visible window for a depth-4 path is not just portal 4. It is:

```text
portal 1 window
∩ portal 2 projected through portal 1
∩ portal 3 projected through portals 1-2
∩ portal 4 projected through portals 1-3
```

So the visible-path calculation should carry an accumulated `clipPolygonNdc`.

## 7.4 Runtime options

```ts
export interface VisiblePortalPathOptions {
  readonly maxDepth: number;
  readonly maxVisiblePaths: number;
  readonly minPortalScreenAreaPixels: number;
  readonly includeRootCell: boolean;
  readonly sortMode: "depth-then-area" | "area-then-depth";
}
```

Reasonable initial values:

```ts
const defaultPortalRenderOptions = {
  maxDepth: 10,
  maxVisiblePaths: 256,
  minPortalScreenAreaPixels: 16,
  includeRootCell: true,
  sortMode: "depth-then-area",
} as const;
```

For debugging:

```ts
maxVisiblePaths = 2048
minPortalScreenAreaPixels = 1
```

For VR:

```ts
maxVisiblePaths = 64 or 128
minPortalScreenAreaPixels = higher
```

---

# 8. Render archetypes

The renderer should not create one mesh per object per path. It should build reusable archetypes.

## 8.1 Render archetype contract

```ts
export interface CellRenderArchetype {
  readonly cellId: string;
  readonly archetypeId: string;

  readonly kind:
    | "floor"
    | "ceiling"
    | "solid-wall"
    | "portal-frame"
    | "static-object"
    | "dynamic-object-proxy";

  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;

  readonly pathIdAttribute: THREE.InstancedBufferAttribute;
}
```

There should be one `InstancedMesh` per compatible geometry/material group.

Examples:

```text
front cell floor
front cell ceiling
front cell north wall
front cell house mesh part 1
front cell house mesh part 2
right cell floor
right cell ceiling
...
```

## 8.2 Capacity versus visible count

Each archetype has fixed allocated capacity:

```ts
const mesh = new THREE.InstancedMesh(
  geometry,
  material,
  maxPortalInstancesPerArchetype,
);
```

Each frame sets the dynamic draw count:

```ts
mesh.count = visibleInstanceCount;
```

So:

```text
capacity:
  maximum allocated slots in the GPU buffer

mesh.count:
  number of slots actually drawn this frame
```

This avoids allocating or disposing every frame.

## 8.3 Per-frame instance update

```ts
function updateCellArchetypeInstances(
  archetypes: readonly CellRenderArchetype[],
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
): void {
  for (const archetype of archetypes) {
    const visiblePaths = visiblePathsByDestinationCell.get(archetype.cellId) ?? [];
    const count = Math.min(visiblePaths.length, archetype.capacity);

    for (let index = 0; index < count; index += 1) {
      const visiblePath = visiblePaths[index];

      archetype.mesh.setMatrixAt(index, visiblePath.rootFromDestinationMatrix);
      archetype.pathIdAttribute.setX(index, visiblePath.pathId);
    }

    archetype.mesh.count = count;
    archetype.mesh.instanceMatrix.needsUpdate = true;
    archetype.pathIdAttribute.needsUpdate = true;
  }
}
```

This is the correction to the “5000 invisible instances” idea.

The renderer does **not** do:

```text
5000 instances per object forever, most hidden
```

It does:

```text
capacity N per archetype
visible count M this frame
draw first M compacted instances
```

---

# 9. Clipping architecture

The renderer needs to cut each visible path image to its accumulated portal window.

There are two implementation levels.

---

## 9.1 Level A: debug scissor/rect clipping

This is easier and good for first integration.

For each visible path:

```text
use clipRectNdc
convert to WebGL scissor rect
render that path's instances
```

Pros:

```text
simple
easy to debug
requires no custom fragment shader
```

Cons:

```text
rectangular only
more draw calls
does not handle arbitrary nested portal polygons perfectly
```

This can validate the path-table architecture before shader clipping.

---

## 9.2 Level B: shader polygon clipping

This should be the long-term default.

Each visible path owns:

```text
clipPolygonNdc
```

Each instance owns:

```text
path id
```

A material patch does:

```glsl
vec2 ndc = (gl_FragCoord.xy / viewportSize) * 2.0 - 1.0;

if (!insideClipPolygon(ndc, pathId)) {
  discard;
}
```

For convex polygons, the inside test can be edge-halfspace based.

## 9.3 Clip data upload

Initial simple path:

```ts
const maxClipVerticesPerPath = 8;
const maxVisiblePaths = 256;
```

Use uniform arrays if small enough:

```ts
uniform vec4 clipPolygonData[MAX_VISIBLE_PATHS * MAX_CLIP_VERTICES_PER_PATH];
uniform int clipVertexCount[MAX_VISIBLE_PATHS];
```

If uniform limits become a problem, switch to a texture-backed data store:

```text
DataTexture row per path
RGBA float values store polygon vertices
```

Do not start with a complicated texture solution unless uniform limits force it.

---

# 10. Material strategy

## 10.1 Simple built-in materials first

For floor, ceiling, walls, and simple primitives:

```text
use custom ShaderMaterial or patched MeshStandardMaterial
```

## 10.2 GLTF/static object support later

For imported assets, use one of these strategies:

1. Patch material with `onBeforeCompile`.
2. Replace with simplified portal-compatible material.
3. Render detailed object only for shallow depth, use proxy for deep recursion.

A good first rule:

```text
depth 0-2:
  render full static objects

depth > 2:
  render only simple proxy geometry, or skip expensive objects
```

This protects the classroom renderer from heavy assets.

---

# 11. Depth and ordering

## 11.1 Opaque geometry

For opaque geometry, rely primarily on the depth buffer.

Every visible copy is transformed into the root-cell coordinate system using `rootFromDestination`, so ordinary depth testing should handle most occlusion.

Do not manually sort opaque cells as the main correctness mechanism.

## 11.2 Transparent geometry

Transparent objects should be limited or rendered after opaque geometry.

First version recommendation:

```text
avoid transparent portal-recursive objects
or render transparent objects only in root/depth-1 views
```

## 11.3 Portal frames

Portal frames/walls should render in the root cell normally.

The portal aperture is not the portal frame mesh. The aperture comes from compiled side geometry and cell height.

---

# 12. Dynamic objects

The current repo already has movement support for generic dynamic objects and player movement through compiled portals.  The renderer should treat dynamic objects as a separate overlay after static cell archetypes.

## 12.1 Static objects

Static objects are compiled into cell render archetypes.

```text
object belongs to destination cell
object appears through every visible path to that destination cell
```

## 12.2 Dynamic objects

Dynamic objects have current cell-local state.

For each dynamic object:

```text
find visible paths whose destinationCellId equals object.cellId
render object once per visible path
using:
  rootFromDestination * objectLocalPose
```

Suggested separate module:

```text
src/render/three/renderDynamicObjectInstances.ts
```

Initial support can be minimal:

```text
geodesci marmot
simple debug cube
player avatar later, if needed
```

---

# 13. Integration with `createThreeApp`

The frame loop should be reorganized around a renderer state object, but without introducing a heavyweight class.

## 13.1 Startup

```ts
const portalPathTables = buildPortalPathTables(world, {
  maxDepth: 10,
  skipImmediateReverse: true,
});

const staticallyCulledTables = cullPortalPathTables(world, portalPathTables, {
  toleranceMeters: 1e-6,
});

const archetypes = buildCellRenderArchetypes(world, {
  maxInstancesPerArchetype: 512,
});

const portalRenderState = createPortalRenderState({
  world,
  pathTables: staticallyCulledTables,
  archetypes,
});
```

## 13.2 Frame

```ts
function renderFrame(): void {
  const rootCellId = appState.playerPose.cellId;
  const pathTable = portalRenderState.pathTables.get(rootCellId);

  const visiblePaths = computeVisiblePortalPaths({
    world,
    rootCellId,
    pathTable,
    camera,
    viewport,
    options: portalRenderOptions,
  });

  updatePortalClipData(portalRenderState.clipData, visiblePaths);

  updatePortalInstanceBuffers({
    archetypes: portalRenderState.archetypes,
    visiblePaths,
  });

  renderPortalInstances({
    renderer,
    scene,
    camera,
    archetypes: portalRenderState.archetypes,
    clipData: portalRenderState.clipData,
  });

  updatePortalRenderDebugState(debugState, {
    rootCellId,
    candidatePathCount: pathTable.paths.length,
    visiblePathCount: visiblePaths.length,
    maxVisibleDepth: maxDepth(visiblePaths),
  });
}
```

---

# 14. Debug state

The renderer should expose structured debug data.

```ts
export interface PortalRenderDebugState {
  readonly enabled: boolean;
  readonly rootCellId: string;

  readonly maxConfiguredDepth: number;
  readonly candidatePathCount: number;
  readonly staticallyCulledPathCount: number;

  readonly visiblePathCount: number;
  readonly visiblePathCountByDepth: readonly {
    readonly depth: number;
    readonly count: number;
  }[];

  readonly renderedInstanceCount: number;
  readonly maxVisibleDepth: number;

  readonly clippedByFrustumCount: number;
  readonly clippedByScreenAreaCount: number;
  readonly clippedByBudgetCount: number;

  readonly budgetExhausted: boolean;
}
```

The debug overlay should show something like:

```text
cell: front
portal paths: 78,733 candidates / 312 visible
max depth visible: 7 / 10
instances drawn: 1,872
culled: frustum 41,203, area 37,100, budget 118
```

This will make performance problems concrete instead of mysterious.

---

# 15. Testing plan

The repo’s testing philosophy is behavior-focused and explicitly avoids freezing renderer internals.  The new tests should follow that.

## 15.1 Cell-complex tests

```text
tests/cell-complex/portalPaths.test.ts
```

Test:

```text
- depth-0 path exists for root cell
- depth-1 paths match outgoing portal count
- immediate reverse paths are skipped when configured
- paths preserve destination cell id
- different paths to the same destination cell are preserved
- rootFromDestination is inverse of destinationFromRoot
- cube path counts match square-cell branching for small depths
```

Do not test private loop structure.

## 15.2 Static culling tests

```text
tests/cell-complex/staticPortalPathCull.test.ts
```

Test:

```text
- static culling never removes depth-0 path
- immediate reverse removal is reported
- impossible bounds are rejected
- ambiguous bounds are kept
- rejection reasons are exposed
```

## 15.3 Visible path tests

```text
tests/render-contract/visiblePortalPaths.test.ts
```

Test:

```text
- a portal in front of the camera yields a visible path
- a portal behind the camera is omitted
- a tiny portal aperture is omitted below threshold
- nested paths inherit smaller accumulated aperture
- same destination cell through two paths produces two visible images
- recursion stops at configured max depth
```

## 15.4 Instance-buffer tests

```text
tests/render-contract/portalInstanceBuffers.test.ts
```

Test:

```text
- mesh.count equals visible path count, capped by capacity
- capacity is not changed during ordinary frame update
- path id attribute is written for each visible instance
- overflow reports budget exhaustion instead of reallocating silently
```

## 15.5 Debug-state tests

```text
tests/render-contract/portalRenderDebugState.test.ts
```

Test:

```text
- debug state can be constructed without WebGL context
- visible path counts by depth are summarized correctly
- budget exhaustion is reported when visible paths exceed capacity
```

---

# 16. Implementation milestones

Current status as of 2026-05-28:

```text
Milestone 1: complete.
Milestone 2: complete.
Milestone 3: partially implemented.
```

Milestone 1 is done in the codebase. `src/cell-complex/portalPaths.ts` implements `buildPortalPathTables(...)`, per-root tables, stable path ids, parent links, destination-cell grouping, accumulated transforms, inverse render transforms, and default immediate-reverse filtering. `tests/cell-complex/portalPaths.test.ts` covers the milestone acceptance points, including cube path generation through depth 10 and finite transforms. The adjacent static-culling pass is also already implemented in `src/cell-complex/staticPortalPathCull.ts` and documented in `_issues/_closed/17_portal_path_tables_and_static_culling.md`; that is ahead of what Milestone 1 strictly required.

Milestone 2 is now complete in the codebase. `src/render/three/visiblePortalPaths.ts` implements the per-frame camera-visible portal-path discovery pass, accumulated aperture clipping, near-plane handling, and visibility summaries. `tests/render-contract/visiblePortalPaths.test.ts` covers first-hop visibility, behind-camera rejection, parent-driven visibility, nested apertures, depth limits, budget limits, duplicate destinations, and `ShowCellPath(...)` live visibility reporting. The renderer also wires the new `portal-visible-path-debug` flag into the on-screen debug overlay and `window.noneuclidPortalDebug`.

Milestone 3 is partially implemented in the codebase. The active cell already renders through fixed-capacity archetype-backed `THREE.InstancedMesh` pools, capacities are derived from statically kept destination-path counts, and `window.noneuclidPortalDebug.ShowCellPath(...)` can optionally render destination-cell archetype instances through the same path machinery. However, ordinary camera-visible portal-copy rendering for every visible path is not yet enabled, so the full milestone is not complete.

## Milestone 1: path table only

Status: complete.

Implement:

```text
src/cell-complex/portalPaths.ts
tests/cell-complex/portalPaths.test.ts
```

No rendering changes yet.

Acceptance:

```text
cube path table builds for depth 10
path counts are sane
no NaN transforms
same destination via different paths preserved
```

Implemented evidence:

```text
src/cell-complex/portalPaths.ts
tests/cell-complex/portalPaths.test.ts
_issues/_closed/17_portal_path_tables_and_static_culling.md
```

---

## Milestone 2: visible path calculation

Status: complete.

Implement:

```text
src/render/three/visiblePortalPaths.ts
tests/render-contract/visiblePortalPaths.test.ts
```

Use fake/simple camera inputs where possible.

Acceptance:

```text
first-hop portal appears
behind-camera portal disappears
nested aperture shrinks
maxDepth works
maxVisiblePaths works
```

Implemented evidence:

```text
src/render/three/visiblePortalPaths.ts
tests/render-contract/visiblePortalPaths.test.ts
src/render/three/createThreeApp.ts
src/render/three/debugOverlay.ts
src/render/three/renderState.ts
src/glue/debugOptions.ts
_issues/_closed/17_dynamic_visible_portal_path_debug.md
```

---

## Milestone 3: simple instanced floors/walls

Status: partially implemented.

Implement:

```text
src/render/three/cellRenderArchetypes.ts
src/render/three/renderPortalInstances.ts
src/render/three/portalInstanceDebug.ts
tests/render-contract/cellRenderArchetypes.test.ts
tests/render-contract/portalInstanceBuffers.test.ts
```

Implemented scope:

```text
floor
ceiling
solid walls
portal frames
static objects
```

Dynamic objects remain out of scope for this milestone.

Currently implemented:

```text
no per-frame cell cloning
mesh.count changes dynamically
active cell renders through the depth-0 root path
ShowCellPath can switch between floor overlay mode and instance-backed debug rendering
```

Implemented evidence:

```text
src/render/three/cellRenderArchetypes.ts
src/render/three/renderPortalInstances.ts
src/render/three/portalInstanceDebug.ts
src/render/three/createThreeApp.ts
src/render/three/debugOverlay.ts
src/render/three/renderState.ts
src/glue/debugOptions.ts
tests/render-contract/cellRenderArchetypes.test.ts
tests/render-contract/portalInstanceBuffers.test.ts
tests/debugSettings.test.ts
_issues/_closed/20_milestone_03_archetype_instance_pool_and_debug_path_renders.md
```

Remaining for milestone completion:

```text
cube world should show connected cell copies through portals during ordinary rendering
visible paths returned by computeVisiblePortalPaths(...) should populate the shared instance buffers
the milestone should not be marked complete until ordinary portal-copy rendering is on
```

---

## Milestone 4: rectangular clipping

Implement clip rect first:

```text
clipRectNdc
scissor or simple shader rect discard
```

Acceptance:

```text
portal views are bounded by portal windows
debug overlay reports visible path count
movement through portal matches what was visible
```

---

## Milestone 5: polygon clipping shader

Implement:

```text
src/render/three/portalClipData.ts
src/render/three/portalClipMaterial.ts
```

Acceptance:

```text
nested portal windows clip correctly
depth > 3 works without stencil exhaustion
depth 10 is stable under budget
```

---

## Milestone 6: static objects

Add support for:

```text
asset objects
geodesci marmot static/dynamic path
object archetype grouping
```

Acceptance:

```text
objects appear in root cell and visible destination-cell copies
object rendering is capped by visible path count, not candidate path count
```

---

## Milestone 7: old renderer removal or fallback

Once the new path renderer is reliable:

```text
keep old stencil renderer only as a debug comparison
or remove it after tests cover the new contract
```

Acceptance:

```text
default portal mode uses path renderer
debug option can show path stats
cube no longer breaks under ordinary portal viewing
```

---

# 17. Specific correction to the original plan

Your original plan says:

```text
Every object on each face gets assigned 5000 instanced meshes, invisible at first.
```

The corrected architecture says:

```text
Each render archetype gets one InstancedMesh with fixed capacity.
Every frame, visible portal paths are compacted into the first N instance slots.
The renderer sets mesh.count = N.
Invisible preallocated instances are not drawn because they are beyond mesh.count.
```

So the object/render relationship becomes:

```text
object archetype:
  house mesh part A in cell front

visible paths to front:
  path 0
  path 17
  path 88
  path 301

instance buffer:
  slot 0 = path 0 matrix
  slot 1 = path 17 matrix
  slot 2 = path 88 matrix
  slot 3 = path 301 matrix

mesh.count = 4
```

Not:

```text
5000 slots all drawn with per-instance hidden flags
```

This is the performance-critical distinction.

---

# 18. Final architecture summary

The renderer should become a **portal path image renderer**:

```text
Compiled world:
  authoritative topology and transforms

Portal path table:
  all possible path images up to depth 10

Static culling:
  camera-independent conservative pruning

Visible path pass:
  camera-dependent recursive aperture projection and clipping

Render archetypes:
  reusable instanced geometry per cell/object/material

Instance compaction:
  only visible paths occupy active slots this frame

Shader clipping:
  each instance is clipped to its accumulated portal aperture

Debug state:
  exposes path counts, visible counts, budgets, and max depth
```

That architecture keeps the mathematical/runtime model inspectable, uses the existing compiled portal transforms, avoids recursive Three.js scene cloning, avoids stencil-depth limits, and makes depth-10 portal viewing a bounded visibility problem rather than an exponential draw problem.
