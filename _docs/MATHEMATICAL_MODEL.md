# Mathematical model

This document states, precisely, the mathematics that NonEuclidean FPV implements and the exact place in the code
where each statement is realised. It is the contract between the geometry and the programs: when you change
`src/math`, `src/cell-complex`, `src/movement` or the geodesic code, this text should change with it.

**How this document stays true.** Every reference of the form `` `src/<dir>/<file>.ts#<symbol>` `` is verified by
`npm run docs:check` (and by `tests/docs/documentation.test.ts`): the file must exist and must declare `symbol` at top
level. A rename that is not reflected here fails the build. Statements of *behavior* are backed by the unit tests named
in each section. For module-by-module structure see [ARCHITECTURE.md](ARCHITECTURE.md) and the generated
[reference](generated/ARCHITECTURE_REFERENCE.md).

Contents: [1 Conventions](#1-conventions) ·
[2 Cells](#2-cells-convex-prisms) ·
[3 Gluing maps](#3-gluing-maps) ·
[4 Developing map and portal paths](#4-the-developing-map-and-portal-paths) ·
[5 Motion](#5-motion-of-bodies) ·
[6 Geodesics](#6-geodesics) ·
[7 Curve shortening](#7-curve-shortening) ·
[8 Visibility and rendering](#8-visibility-and-rendering-through-portals) ·
[9 Live deformation](#9-live-deformation-of-the-complex) ·
[10 Tolerances](#10-tolerances-and-constants) ·
[11 Assumptions and known gaps](#11-assumptions-and-known-gaps)

---

## 1. Conventions

**Frames.** All simulation geometry is expressed in a *cell-local* right-handed frame: $x$ to the right (east),
$y$ forward (north), $z$ up. A point is `Vec3 = (x, y, z)` (`src/math/vec3.ts#Vec3`), lengths are in **meters**, angles in
**radians**, and *yaw* is rotation about $+z$ (counter-clockwise seen from above). The renderer converts to the Three.js
convention ($x$ right, $y$ up, $-z$ forward) in exactly one place,
`src/render/three/worldAxes.ts#worldPointToThree`: $(x,y,z)\mapsto(x,\,z,\,-y)$.

**Rigid transforms.** A `RigidTransform3` (`src/math/rigidTransform3.ts#RigidTransform3`) is a pair $g=(R,t)$ with
$R$ a $3\times 3$ rotation matrix and $t$ a translation, acting by $g\cdot p = Rp + t$ on points and by $g\cdot d = Rd$
on directions (`src/math/rigidTransform3.ts#transformPoint3`, `src/math/rigidTransform3.ts#transformDirection3`).

- Composition: $(a\circ b)\cdot p = a\cdot(b\cdot p)$, i.e. $a\circ b=(R_aR_b,\;R_at_b+t_a)$ — `composeRigidTransform3(a, b)`
  applies **b first, then a** (`src/math/rigidTransform3.ts#composeRigidTransform3`).
- Inverse: $g^{-1}=(R^{\top},\,-R^{\top}t)$ (`src/math/rigidTransform3.ts#invertRigidTransform3`); valid because $R$ is
  orthogonal.
- Only *yaw* rotations are ever constructed from angles (`src/math/rigidTransform3.ts#yawRigidTransform3`); portal maps
  (Section 3) are also rotations about $z$, so every transform in the system lies in
  $SE(2)\times\{\mathrm{id}_z\}$ — vertical coordinates are never changed by gluing.

**Poses.** A body has a *cell id* and a local pose $g\in SE(3)$ in that cell's frame
(`src/movement/dynamicObject.ts#DynamicObjectState`). The player's `PlayerPose` stores position, yaw and pitch;
`src/movement/playerPose.ts#playerPoseToDynamicObject` and `src/movement/playerPose.ts#playerPoseFromDynamicObject`
convert, with yaw recovered as $\operatorname{atan2}(R_{10},R_{00})$. Pitch is view state only and never affects motion.

**Tolerance.** Comparisons use an absolute tolerance, `src/math/tolerances.ts#geometryTolerance` $=10^{-8}$ m, unless a
constant says otherwise (Section 8). The scale of every scene is classroom-sized (meters), which is why absolute
tolerances are used.

## 2. Cells: convex prisms

A **cell** is the closed solid
$$C \;=\; P\times[0,h],\qquad P\subset\mathbb R^2 \text{ a strictly convex polygon},\; h>0,$$
with $P$ given by its vertices $v_0,\dots,v_{n-1}$ in **counter-clockwise** order, $3\le n\le 8$. The vertical faces are
the **sides** $s_i=[v_i,v_{i+1}]$ (indices mod $n$); the floor ($z=0$) and ceiling ($z=h$) are always solid.

Validation (`src/cell-complex/validateCellComplexSpec.ts#validateCellComplexSpec`) enforces: positive area (signed area
$>0$, which is the CCW condition), *strict* convexity (every consecutive edge pair turns left:
$(v_i-v_{i-1})\times(v_{i+1}-v_i)>0$), $3\le n\le 8$ and $h>0$. The same predicate is available with a typed vertex-count
guard in `src/cell-complex/prismBase.ts#validatePrismBaseVertices`.

Compilation (`src/cell-complex/prismCells.ts#compilePrismCellGeometry`) derives for each side
$s_i$ its length $\ell_i=|v_{i+1}-v_i|$ and its **inward unit normal**
$$n_i \;=\; \frac{1}{\ell_i}\,(-(v_{i+1}-v_i)_y,\;(v_{i+1}-v_i)_x),$$
which points to the left of the CCW boundary, i.e. into $P$. The **signed clearance** of a point $p$ from side $s_i$ is
$$d_i(p) \;=\; (p-v_i)\cdot n_i ,$$
positive inside the half-plane that contains $P$ (`src/movement/collision.ts#signedDistanceToSide`). Because $P$ is convex,
$P=\{p:\,d_i(p)\ge 0\ \forall i\}$.

A side may carry at most one **portal** (Section 3); a side with no portal is a **wall**.

**Junctions.** For every base vertex $v$ that is an endpoint of a portal side, the compiler records a *portal junction*
(`src/cell-complex/prismCells.ts#compilePrismCellGeometry` → `portalJunctions`) and an invisible vertical exclusion
cylinder centred on $v$ with radius `src/cell-complex/forbiddenZones.ts#forbiddenPortalJunctionRadiusMeters` $=0.15$ m and
infinite height. Bodies and geodesics may not enter these cylinders. The reason is geometric and is explained in
Section 3 (cone points).

## 3. Gluing maps

A portal glues side $s$ of cell $A$ to side $s'$ of cell $B$, and the gluing must be **reciprocal**: $B$'s portal on
$s'$ must point back at $A$'s portal on $s$ (checked by `validateCellComplexSpec`). The gluing is realised by a rigid map
$g_{A\to B}$ ("`transformToTarget`") computed once at compile time
(`src/cell-complex/compilePortalTransforms.ts#compilePortalTransforms`).

**Construction.** Let $t$ be the unit tangent of $s$ (from $v_i$ to $v_{i+1}$), $o=-n$ its outward normal, $m$ its
midpoint, and $t',n',m'$ the corresponding data of $s'$. Form the orthonormal frames
$$F=[\,t\;\; e_z\;\; o\,],\qquad F'=[\,-t'\;\; e_z\;\; n'\,]$$
(a column is replaced by $t\times e_z$ if the supplied normal disagrees with it, which guarantees both frames are
right-handed, $\det=+1$). Then
$$R \;=\; F' F^{\top}\in SO(3),\qquad g_{A\to B}(p)\;=\;R\,p + (m' - R\,m).$$
Properties, all consequences of the construction:

1. $g_{A\to B}$ is a rotation about $z$ composed with a translation; it fixes $z$.
2. It sends the midpoint of $s$ to the midpoint of $s'$, the outward normal of $s$ to the inward normal of $s'$, and the
   tangent $t$ to $-t'$. So the *exterior* of $A$ across $s$ is mapped onto the *interior* of $B$ across $s'$: walking out
   of $A$ through $s$ continues, without turning, into $B$.
3. Reversing the boundary direction ($t\mapsto -t'$) is exactly the condition that two CCW-oriented polygons are glued
   **orientation-preservingly**; hence the horizontal part of a complex is an *oriented* flat surface (possibly with
   boundary where sides are walls). Orientation reversal (mirror gluings) is not representable.
4. Reciprocity: $g_{B\to A}=g_{A\to B}^{-1}$ (by symmetry of the construction; covered by `tests/cell-complex`).
5. When the two side lengths differ, only midpoints are matched; the code does **not** reject unequal lengths
   (Section 11).

**Cone points and the exclusion cylinders.** Going once around a vertex class (the set of cell corners identified by the
gluings) composes the gluing maps into a rotation of angle equal to the sum of the corner angles,
$\theta_v=\sum(\text{interior angles})$, taken modulo $2\pi$. If $\theta_v\not\equiv 0\pmod{2\pi}$ the vertex is a
*cone point* of curvature $2\pi-\theta_v$ and a straight line through it has no unique continuation (for a closed
surface the curvatures sum to $2\pi\chi$ by Gauss–Bonnet). The runtime deliberately contains **no** curvature or holonomy
computation (design record `design/003-no-curvature-engine.md`): it simply forbids every portal-incident vertex
neighborhood (Section 2), whether or not $\theta_v=2\pi$, so no motion or geodesic ever has to be continued through a
singular point. The exclusion radius is a pedagogical/numerical compromise, not a geometric invariant.

## 4. The developing map and portal paths

Fix a *root* cell $R$. A **portal path** is a sequence of portals $(p_1,\dots,p_k)$ leaving $R$, i.e. a walk
$R=C_0\xrightarrow{p_1}C_1\to\cdots\xrightarrow{p_k}C_k$ in the cell graph. Define
$$D_{\text{path}} \;=\; g_k\circ\cdots\circ g_1 \quad(\text{`destinationFromRoot'}),\qquad
D_{\text{path}}^{-1}\quad(\text{`rootFromDestination'}).$$
$D^{-1}$ takes coordinates of $C_k$ to the frame of $R$: it is the **developing map** along the path. Drawing $C_k$ in the
frame of $R$ by $D^{-1}$ is exactly what "looking through $k$ portals" means, and a straight line in the developed
picture is a locally straight line of the glued space.

`src/cell-complex/portalPaths.ts#buildPortalPathTables` enumerates paths breadth-first from every root up to a depth
bound (each `PortalRenderPath` stores its parent, its steps and both transforms, accumulating
$D_{\text{child}}=g\circ D_{\text{parent}}$ via `composeRigidTransform3`). A step that immediately undoes the previous one
(the reciprocal portal of the portal just used) is skipped when `skipImmediateReverse` is set. The number of paths
grows like $(\deg-1)^{\text{depth}}$, so the table is pruned *statically* by
`src/cell-complex/staticPortalPathCull.ts#buildStaticallyCulledPortalPathTables`. The cull is **intended** to discard a
path only when no line of sight can run along it; what the code actually tests is:

1. **Aperture tests.** The destination prism's corners are mapped into each ancestor portal's frame. The path is rejected
   if all corners lie behind an ancestor portal plane (`outside-ancestor-portal-plane`), or all lie below the floor or above
   the ceiling (`outside-ancestor-vertical-range`). The slack is $\max(\texttt{toleranceMeters},\,r_{\text{junction}}/2)\ge 0.075$ m.
2. **Plan-view transversal test** (words of three or more portals only; one- and two-portal words are never rejected by it).
   Does a segment from a point $\tau$ on the first portal edge to a point $\sigma$ on the last one exist that meets every
   intermediate portal edge (`no-static-line-transversal`)? It runs a conservative interval branch-and-bound first (at most
   8 subdivisions, box diameter $10^{-3}$), then a projective stage: the map $(u,v)\mapsto(u/(u+v),\,1/(u+v))$ turns the
   root and leaf edge lines into parallel lines, so orientation conditions become affine in $(\tau,\sigma)$ and feasibility
   is a union of convex polygons, decided by convex clipping.
3. **Budget.** At most `maxKeptPathsPerRoot` paths are kept per root (`static-path-budget`); this is the only rule that is
   lossy by design.

`src/cell-complex/staticPortalPathCull.ts#StaticPortalPathRejectReason` lists exactly the reasons the culler produces;
`src/cell-complex/staticPortalPathCull.ts#staticallyCullPortalPathTables` also drops every descendant of a rejected path
(with the parent's reason), so a kept path's parent is always kept. Two properties of the implementation weaken the "never removes a visible path" guarantee and are
tracked in [Section 11](#11-assumptions-and-known-gaps): the aperture slack rejects *more* as it grows, and the projective
stage does not test sight lines that cross the line sent to infinity. `buildStaticallyCulledPortalPathTables` gives kept paths new ids, so ids in its tables are sparse and differ from those of
`buildPortalPathTables` (`staticallyCullPortalPathTables` keeps the original ids and drops every descendant of a rejected path).

## 5. Motion of bodies

A body is a vertical cylinder (radius $r$, height $H$, offset $o$) attached to its local pose
(`src/movement/dynamicObject.ts#SimpleCollisionCylinder`); the player uses radius
`src/movement/playerBody.ts#DEFAULT_PLAYER_RADIUS_METERS` $=0.25$ m and height
`src/movement/playerBody.ts#DEFAULT_PLAYER_HEIGHT_METERS` $=1.6$ m with the eye at 1.45 m.

`src/movement/moveDynamicObject.ts#moveDynamicObject` advances a body by a displacement $\delta$ (already rotated into the
cell frame by `src/movement/movePlayer.ts#movePlayer`):

1. **Candidate.** $q=p+\delta$ for the pose translation $p$.
2. **Portal crossing (anchor rule).** Let $s^\star$ be the side with the most negative clearance $d_i(q)$. If $s^\star$ has
   a portal and the projection of $q$ onto the side's line falls within $[0,\ell]$ (otherwise the nearest portal side
   whose projection does fall within range, if any), the body **crosses**: its cell becomes the target cell and its pose
   becomes $g\circ(\text{pose})$ — position *and* heading are transported (`src/movement/portalCrossing.ts#crossDynamicObjectPortal`).
   Only the *anchor* (the pose origin) is tested; the cylinder may overlap the portal plane before the crossing happens.
   Before the crossing is accepted, the pose in the **target** cell is checked for floor, ceiling and exclusion-zone
   violations (the portal just used is ignored); if one occurs the body does not cross and stays put. Wall overlap in the
   target cell is deliberately not tested, because bodies legitimately cross close to a corner. The `"bounds"` mode is
   declared but unimplemented and throws if requested.
3. **Otherwise collision** (`src/movement/collision.ts#testCellCollision`), in this order:
   floor/ceiling ($z_c\mp H/2$ against $[0,h]$), exclusion cylinders (both a static overlap and a *swept* test of the
   segment from the previous to the candidate center against radius $\max(r_{\text{start}},r_{\text{end}})+r_{\text{zone}}$),
   then walls: a **non-portal** side blocks when $d_i(c)<r$ with $c$ the cylinder center. Portal sides never block.
4. **Response.** A wall hit pushes the candidate back along $n_i$ until $d_i(c)=r+10^{-6}$ — the tangential component is
   kept, so bodies *slide* along walls (`moveDynamicObject` → `resolveBlockedWallPosition`); only the first blocking side (in
   side order) is resolved and the pushed position is not re-tested, so a corner can still violate a second wall. Floor,
   ceiling and exclusion-zone hits revert to the previous pose (no sliding).

Because $g$ is a rigid motion and acts on the pose as a whole, heading and handedness are preserved by crossings, and a
round trip through a reciprocal pair returns the original pose up to floating-point error.

## 6. Geodesics

A **geodesic** here is a locally straight horizontal path at the constant beam height
`src/world-objects/geodesicCannon.ts#geodesicRayBeamHeightMeters` $=1.08$ m: in each cell it is a Euclidean line
segment, and at a portal it continues straight in the target cell after applying the gluing map.

**Tracing one segment.** `src/world-objects/geodesicCannon.ts#traceGeodesicSegment` takes a start point $a$ and unit
direction $d$ in a cell and returns the first event along $a+td$, $0<t\le L$:

- Against a side with endpoints $v,w$ (edge vector $e=w-v$): $t = \dfrac{(v-a)\times e}{d\times e}$ and
  $u=\dfrac{(v-a)\times d}{d\times e}\in[0,1]$ locates the hit along the side ($\times$ is the planar cross product);
  parallel sides ($|d\times e|\le 10^{-7}$) are skipped.
- Against an exclusion cylinder: ray–circle intersection (`intersectRayWithForbiddenZone`).
- The nearest event wins and yields one of four **terminals**
  (`src/world-objects/geodesicCannon.ts#GeodesicSegmentTerminal`): `open` (length exhausted), `wall-hit`,
  `forbidden-zone-hit`, or `portal-hit`. A portal hit records the continuation: target start
  $g(a+td)+\varepsilon\,Rd$ ($\varepsilon=10^{-4}$ m, to start strictly inside the next cell) and target direction $Rd$.

Iterating this (`src/world-objects/geodesicCannon.ts#traceGeodesicFromLiftedChord` and the emitter-aware variants) produces
the per-cell **segments** of a geodesic; the ordered list of portals crossed is its **portal word**
(`src/world-objects/geodesicCannon.ts#GeodesicPortalTraversal`).

**Intervals and endpoints.** A `GeodesicIntervalObject` is a geodesic arc with a `start` and an `end`
*attachment* (`src/world-objects/geodesicCannon.ts#GeodesicEndpointAttachment`): each end is attached to an
*anchor object* — an emitter ("cannon"), or a `FreeGeodesicEndObject` (a loose end that can be aimed). The interval stores
its portal word, so the arc is determined by (anchor positions, word) alone. This is the "geodesic end model" of
`_issues/31_geodesic_end_model_and_curve_shortening_rehaul.md`.

**Lifting (unfolding).** Given the word $w=(p_1,\dots,p_k)$ from the source anchor $a$ (in cell $C_0$) to the target
anchor $b$ (in cell $C_k$), the straight arc is the Euclidean segment from $a$ to the *developed* target
$$\tilde b \;=\; g_1^{-1}\circ g_2^{-1}\circ\cdots\circ g_k^{-1}\,(b)$$
in the frame of $C_0$ (`src/world-objects/geodesicCannon.ts#liftGeodesicEndpoint`; the inverses are applied from the
last portal back to the first). Its length is $|\tilde b-a|$ (nonzero lift required:
`src/world-objects/geodesicCannon.ts#geodesicHasNonzeroLiftedDisplacement`, minimum
`src/world-objects/geodesicCannon.ts#GEODESIC_MIN_LENGTH_METERS` $=0.15$ m). The direction at $a$ is the direction of
$\tilde b-a$, and re-tracing from $a$ in that direction for length $|\tilde b-a|$ must reproduce the word —
this is how `src/world-objects/geodesicCannon.ts#rebuildLockedGeodesicFromEndpointsAndPortalWord` rebuilds a *locked*
geodesic when its endpoints move. The reverse word (`src/world-objects/geodesicCannon.ts#reverseGeodesicPortalWord`) reads
the arc from the other end: reverse the order and swap source/target of each step.

**Why words, not just positions.** In a quotient space such as the torus two anchors are joined by infinitely many
geodesics, distinguished by the sequence of portals crossed. Keeping the word makes a rebuilt arc a continuous
deformation of the previous one rather than a jump to a different homotopy class
(`src/world-objects/geodesicCannon.ts#updatePortalWordForMovedEndpoint` extends or shortens the word when an endpoint is
carried through a portal).

## 7. Curve shortening

Tying two geodesic ends and releasing them produces a *moving pair*
(`src/world-objects/geodesicCannon.ts#CurveShorteningPairObject`): two arcs meeting at a **free vertex** $X$, whose other
ends $A$, $B$ are fixed by their anchors. The pair is advanced by
`src/world-objects/geodesicCannon.ts#advanceCurveShorteningPairs` as a discrete **gradient descent of the total length**
$$L(X)=|X-\tilde A|+|X-\tilde B|$$
measured in the developed frame (Section 6). With $u_A,u_B$ the unit tangents at $X$ pointing *away* from $X$ along the
two arcs, $\nabla_X L=-(u_A+u_B)$, so the descent direction is $u_A+u_B$ and the stationary condition is
$u_A+u_B=0$: the two arcs form a single straight line through $X$. Concretely each tick:

1. If the turn angle between $-u_A$ and $u_B$ is within
   `src/world-objects/geodesicCannon.ts#curveShorteningFuseAngleToleranceRadians` of $\pi$ (or $|u_A+u_B|\le10^{-7}$) the
   pair is marked *ready to fuse*; fusion
   (`src/world-objects/geodesicCannon.ts#fuseCurveShorteningPair`) replaces the two arcs by one locked geodesic whose
   portal word is the role-aware composition of the two words.
2. Otherwise $X$ moves by $\min(v\,\Delta t,\ \tfrac14\,\ell_{\min})$ ($v=0.4$ m/s by default,
   `src/world-objects/geodesicCannon.ts#curveShorteningDefaultSpeedMetersPerSecond`) along $(u_A+u_B)/|u_A+u_B|$, using the
   ordinary body motion of Section 5 so that crossing a portal updates the words.
3. Every affected arc is *previewed* (`src/world-objects/geodesicCannon.ts#previewRebuildGeodesicInterval`) before anything is
   committed: the candidate chord must re-trace to the stored portal word (the **homotopy check**, which changes only when
   the free vertex crosses a portal) without hitting a wall or a forbidden zone. A failed preview leaves state untouched
   and is not reported as a change, except that a forbidden-zone hit replaces the affected arc's free end by a new one at the
   last good point. The total length is also kept monotone: if the previewed total exceeds `previousTotalLengthMeters` by
   more than `src/world-objects/geodesicCannon.ts#curveShorteningLengthIncreaseToleranceMeters` ($10^{-4}$ m), the step is
   not committed (free vertex, arcs and recorded length stay as they were) and the tick is skipped; the recorded length is
   updated only by a committed tick. A pair whose fusion fails without a forbidden-zone hit reverts from *ready to fuse*
   to *moving*.
4. A step below `src/world-objects/geodesicCannon.ts#curveShorteningMinStepMeters` means one half has become shorter than
   the resolution of the method; that half is absorbed into the other
   (`absorbShortCurveShorteningHalf`).

This is local descent, not a global shortest-path solver: it finds *a* locally shortest geodesic in the current homotopy
class, never a minimum over classes. The full design, including the free-loop case in which both ends of one interval
attach to the same free vertex, is `_issues/32_phase_f_curve_shortening_algorithm_note.md`.

## 8. Visibility and rendering through portals

Rendering draws the cell the player is in plus every *destination cell visible through a chain of portals*, each as an
instance of that cell's mesh placed by the developing map of Section 4.

**Frames.** The root cell's frame is used directly as the Three.js world frame (Section 1). A path's matrix
$M_p = B\,D_p^{-1}\,B^{-1}$ is `rootFromDestination` conjugated by the basis change $B$ between the simulation frame and the
Three.js frame (`src/render/three/worldAxes.ts#rigidTransformToThreeMatrix`); yaw about $+z$ equals the same angle about
Three.js $y$. Cell meshes are authored directly in Three.js axes.

**Which paths are visible.** `src/render/three/visiblePortalPaths.ts#computeVisiblePortalPaths` walks the path table in order
(parents precede children) and keeps a path only if its parent was visible. For a path $p$ with parent $q$:

1. The *aperture* of the newest portal is a floor-to-ceiling quad in the destination cell of $q$
   (`src/render/three/visiblePortalPaths.ts#buildPortalApertureCorners`); it is mapped to the root frame by $q$'s
   `rootFromDestination` (`buildNewestPortalApertureInRoot`).
2. The quad is moved to camera space and clipped against the near plane, then projected with the camera's projection matrix
   and perspective division to a convex polygon in normalized device coordinates (NDC). With several cameras (stereo),
   the NDC points of all cameras are merged and replaced by their convex hull, which is conservative for every eye
   (`projectRootSpacePointsToConservativeNdc`).
3. That polygon is clipped by the parent's visible polygon with Sutherland–Hodgman convex clipping
   (`src/render/three/visiblePortalPaths.ts#clipConvexPolygonByConvexPolygon`). The root's polygon is the full NDC square.
4. If fewer than three vertices remain, or the pixel area $|A|\,w\,h/4$ is below `minPortalScreenAreaPixels`, the path and
   its whole subtree are dropped.

Survivors are sorted (`depth-then-area` or `area-then-depth`, ties by path id) and truncated to `maxVisiblePaths`. The
truncation happens *after* traversal, so with area-first ordering a child can survive while its parent was cut. Each result
carries the Three.js matrix, the clip polygon and its bounding rectangle
(`src/render/three/visiblePortalPaths.ts#VisiblePortalPath`).

**Instancing.** Each cell mesh part (floor, walls, portal frames, static objects; ceilings are skipped) is an
`InstancedMesh` whose geometry is baked in the cell's local frame
(`src/render/three/cellRenderArchetypes.ts#buildCellRenderArchetypes`). Every frame
`src/render/three/renderPortalInstances.ts#updateCellRenderArchetypeInstances` writes, for each visible path ending at the
cell, the matrix $M_p$ plus two attributes: the path id and a *clip index* (`-2` = unclipped root, `-1` = no clip slot, so the
instance is discarded). Capacity of a cell archetype is the largest number of statically kept paths that end at it over all
roots (`src/render/three/cellRenderArchetypes.ts#deriveCellRenderArchetypeCapacities`).

**Clipping on the GPU.** The clip polygons of all visible paths are packed in a float texture, one row per
(eye, clip index), one texel per vertex (`src/render/three/portalClipData.ts#createPortalClipData`). A patched Three.js
material (`src/render/three/portalClipMaterial.ts#patchPortalClipMaterial`) converts `gl_FragCoord` to NDC with the current
(per-eye) viewport and discards a fragment when its cross product with any polygon edge, multiplied by the polygon's winding
sign, is below $-10^{-5}$. Clipped instances are pushed slightly back in depth in the vertex shader so portal-seen
geometry never z-fights the wall that frames it. (A dithered smooth-edge variant exists but is disabled by
`src/render/three/renderQuality.ts#portalClipEdgeSmoothingEnabled`.)

**Stereo (WebXR).** The two eyes may be rooted in different cells. Each eye's visible set is expressed in a shared render
frame by left-multiplying `renderFromRoot` onto every path matrix
(`src/render/three/portalEyeFrameTransforms.ts#transformVisiblePortalResultToRenderFrame`), path ids are remapped per
(root cell, path id) so equal paths in both eyes share one instance
(`src/render/three/portalEyeFrameTransforms.ts#remapStereoPortalPathIds`), and the union is rendered once with per-eye
clip rows (`src/render/three/portalEyeFrameTransforms.ts#buildUnionVisiblePathById`).

**Objects seen through portals.** Runtime objects are drawn once per visible path of the cell they are in, with matrix
$M_p\cdot\text{local}$. An object whose collision cylinder reaches within $0.02$ m of a portal side also gets a *ghost* in the
neighbouring cell with pose $g\circ\text{pose}$
(`src/render/three/runtimeObjectGhostRecords.ts#collectPortalGhostRuntimeObjectRenderRecords`), so a creature half-way through a
portal is drawn on both sides.

**Aiming uses the same visibility.** `src/render/three/aimTarget.ts#resolveAimTargets` maps the camera's centre ray into each
visible destination cell by $M_p^{-1}$ for every path whose clip polygon contains the screen centre, intersects it with the
floor and with analytic object proxies there, and sorts hits by distance in the root frame (with fixed priorities so that,
for example, a protractor label beats a geodesic segment).

## 9. Live deformation of the complex

A *deformation family* (`src/runtime/worldGeometryDeformations.ts#WorldDeformationFamily`) is a parameterised set of cell
complexes with fixed topology. Its state is a point in the parameter space; the family can apply a state to the base
spec, produce **per-cell maps** carrying points and headings from the old complex to the new one
(`src/runtime/worldGeometryDeformations.ts#CellDeformationMap`), take a bounded step towards a target
state, and validate that a new snapshot preserves topology.

The implemented family is the **skewed flat torus**
(`src/runtime/deformations/torusSkewDeformation.ts#createTorusSkewDeformationFamily`): one cell over the parallelogram with
edges $u=(w,0)$ and $v=(a,b)$, opposite sides glued by translation, so the world is the flat torus $\mathbb R^2/(\mathbb Zu+\mathbb Zv)$.
The width $w$ is fixed; the skew $a\in[0,2w]$ and depth $b\in[w/2,2w]$ are the parameters. The footprint is centred, with
vertices at $\pm u/2\pm v/2$. A point with lattice coordinates $(\alpha,\beta)$ — $p=o+\alpha u+\beta v$, $o=-(u+v)/2$ — is
mapped to the point with the *same* coordinates in the new lattice, $o'+\alpha u'+\beta v'$, and $z$ is unchanged; directions
are mapped by the same linear part. A step moves $(a,b)$ along the straight segment towards the target by at most
`maxStepMeters` (default 0.08 m) and snaps when close.

`src/runtime/worldGeometrySession.ts#createWorldGeometrySession` keeps the committed *current* state, the *target*, at most
one build in flight and one finished snapshot. Each build normalizes the next state, applies it to the **base** spec (never to
the previous deformed spec, so error does not accumulate), recompiles the complex, validates topology preservation and rebuilds
the statically culled path tables — in a Web Worker with an inline fallback
(`src/runtime/worldGeometryWorkerClient.ts`, `src/runtime/worldGeometryWorker.ts#buildWorldGeometrySnapshotForRequest`).
The render loop polls once per frame; the swap is therefore atomic on the render thread.

On commit the application shell transports the player and runtime objects through the per-cell maps and then applies
`src/runtime/worldGeometryComputedObjects.ts#applyGeometryCommitComputedObjectPolicy`: unlocked geodesics (and the
measurements built on them) are deleted, geodesics locked between two emitters are re-solved with their endpoints' new
positions, and any that cannot be re-solved are deleted and reported. Tool selections tied to old geometry are cleared.

## 10. Tolerances and constants

| Quantity | Value | Where | Meaning |
| --- | --- | --- | --- |
| geometry tolerance | $10^{-8}$ m | `src/math/tolerances.ts#geometryTolerance` | default absolute tolerance for math primitives |
| junction exclusion radius | 0.15 m | `src/cell-complex/forbiddenZones.ts#forbiddenPortalJunctionRadiusMeters` | radius of the cylinder around portal-incident vertices |
| player radius / height | 0.25 m / 1.6 m | `src/movement/playerBody.ts#DEFAULT_PLAYER_RADIUS_METERS` | body cylinder |
| beam height | 1.08 m | `src/world-objects/geodesicCannon.ts#geodesicRayBeamHeightMeters` | height at which geodesics are traced and drawn |
| minimum geodesic length | 0.15 m | `src/world-objects/geodesicCannon.ts#GEODESIC_MIN_LENGTH_METERS` | shorter arcs are rejected |
| curve-shortening speed | 0.4 m/s | `src/world-objects/geodesicCannon.ts#curveShorteningDefaultSpeedMetersPerSecond` | descent speed of the free vertex |
| fuse angle tolerance | 0.03 rad | `src/world-objects/geodesicCannon.ts#curveShorteningFuseAngleToleranceRadians` | deviation from a straight angle that still counts as straight |
| camera clip planes | see source | `src/render/three/renderCameraClip.ts#renderCameraNearMeters` | near/far for every camera |

## 11. Assumptions and known gaps

These are properties the model *assumes* but the code does not (fully) enforce. They are recorded here so they are visible
rather than discovered.

- **Equal side lengths.** The portal map matches side midpoints only. Validation now rejects glued sides whose lengths
  differ by more than $10^{-6}$ m and `compileCellComplex` enforces it by default; only an explicit test-only option
  (`allowUnequalGluedSides`) bypasses it.
- **Unequal cell heights.** Gluing preserves $z$, so across a portal the usable aperture height is the smaller of the
  two cell heights; the taller side's extra wall height above the shorter cell is not modelled.
- **Orientation.** Only orientation-preserving gluings exist (Section 3).
- **Vertex neighborhoods** are excluded rather than resolved (Section 3); a world with a vertex of angle sum $2\pi$ still
  carries the exclusion cylinder.
- **Validation scope.** `validateCellComplexSpec` rejects shared portal sides, self-targeting portals, non-finite
  heights/vertices and unequal glued side lengths. Unequal cell heights across a portal are not rejected.
- **Culling soundness.** See Section 4: the aperture slack and the projective stage can in principle cull a visible path.
- **Wall overlap at crossings.** The target cell's walls are not tested when a body crosses a portal (Section 5).
- **Yaw conventions.** Rigid-transform yaw is $\operatorname{atan2}(R_{10},R_{00})$. The marmot derives its heading from
  its velocity as $\operatorname{atan2}(v_x,v_y)$, so it actually walks along $(-v_x,v_y)$ — a mirror of the authored velocity
  (`src/world-objects/geodesicMarmot.ts#yawFromVelocity`); deformation maps transport the *real* direction. Fixing this
  changes every authored marmot and is tracked in issue 41. (The placed-flag facing was wrong in the same way and is fixed.)
- **Curve shortening.** A step that would lengthen the pair is skipped rather than rolled back to a fused geodesic, so a pair
  whose recorded length is stale may stall without ever becoming ready to fuse; a free loop crossing a portal probably stalls
  (only one of its two roles has its word updated); a free loop shorter than the minimum geodesic length is deleted, but one
  between that length and four minimum steps still stalls. Fusion and absorption assume the non-free ends are emitters, and
  intervals are assumed to run emitter→free end with the emitter at the `start` role.
  The old "straightening" string survives as the render state of moving intervals.
