# 012 - Engine and API (next version)

> **Status: living design document, draft.** Direction agreed with the maintainer on 2026-10-30; no design is agreed
> yet. Every item below carries a status:
>
> - **Agreed**: decided by the maintainer; change it only with new evidence and an entry in the [decision log](#decision-log).
> - **Proposed**: a suggestion under discussion, not a decision. It may be rejected or rewritten.
> - **Open**: a question with no proposal yet.
> - **Rejected**: kept briefly with the reason, so it is not proposed again without new evidence.
>
> When an item changes status, update it in place and add a dated line to the decision log. Claims about the current
> code were checked on 2026-10-30; re-check them before relying on them.

This document designs the next version of the experience: noneuclid-fpv reorganised as a **non-Euclidean engine** with
a programmatic API. The desktop UI, the VR UI, automated tests, bots driven by external scripts, replay files and AI
agents are all **clients** of that engine. The long-term aim is a general non-Euclidean game engine.

## 1. Goal

**Agreed.** Turn the app into an engine with a programmatic API. Nothing a user can do may bypass the API: the
interface only calls it. The engine must be performant, extensible and scalable.

Why:

- **Automated testing.** Many behaviours (movement at corners, geodesic tie/untie/carry, picking through portals,
  visibility) are checked by hand in a browser or headset, and there are too many to keep checking by hand. Scenario
  scripts against a headless engine ("load an empty world, place two emitters, shoot, tie, carry, assert") should
  replace most of them.
- **Bots, external scripts and AI agents** that explore or act in the world (language and transport undecided).
- **Multiplayer is in scope**: several human and bot participants in one world.
- **Record and replay** of sessions and bug reports; headless benchmarks; multiple views of one world.
- **Hardware**: eventually an external camera can photograph a cell diagram and the result is compiled into a new
  world.

### Candidate experiences

**Agreed** (2026-10-30) as experiences the engine must be able to host:

1. **Glued prism worlds** (today): walking, with gravity, through prism rooms glued along vertical walls, with the
   geodesic and measuring instruments.
2. **The tesseract**: flying a spaceship through the boundary of the 4-cube: 8 Euclidean cubes glued along 24 square
   faces, three cubes around each of the 32 edges (cone angle 270 degrees) and four at each of the 16 vertices. It is
   the one-dimension-up analogue of the cube world.

3. **Non-orientability** (probably the third): some portals are glued by reflections (a Klein bottle world, a
   projective plane, a Mobius corridor).
4. **Non-compact worlds**: unbounded cells, or infinitely many cells (for example covering spaces). **The main target
   is a discrete hyperbolic plane tiling** (2026-10-30).

**Agreed priorities** (2026-10-30): the tesseract and the hyperbolic tiling are both primary; each is a major
generalisation (the tesseract in dimension, the tiling in scale). Non-orientability is simpler but secondary: the
design must not block it, but it gets no focused work now. *Proposed* meaning of "not blocking": the sealed transform
type and the pose representation admit mirror-image frames from the start, and the world compiler rejects reflecting
gluings with a clear error until they are supported; rendering of mirrored copies waits.

**Proposed**: requirements non-orientability puts on the engine:

- poses carry handedness: a frame in the full orthonormal frame bundle (frames related by O(3)), not only the
  right-handed ones (P16). On 2026-10-30 orientation was stored as a yaw angle in 197 places across 36 files, which
  cannot represent handedness; this strengthens P14 rule 1. Reflections that preserve the vertical keep walking with
  gravity possible;
- camera and VR hands are composed with the participant's frame, so after an odd number of reflections they are
  mirrored together: the hand still moves where it is seen, and the world looks mirrored (text reads backwards); no
  special case, provided nothing bypasses the frame;
- a cell copy seen through a reflection is drawn with a determinant -1 matrix, which reverses triangle winding and
  inverts back-face culling: mirrored and unmirrored instances need separate draws, or double-sided rendering;
- geodesic funnel and taut string run in one developed chart and survive; anything stored as a yaw (a cannon's aim)
  or a signed angle (the protractor) must define its behaviour under reflection.

**Proposed**: requirements non-compact worlds put on the engine (the engine should state which kinds it supports):

- unbounded cells: unbounded convex regions; mesh building, floor textures and draw distance need limits (fog, far
  clip); cell-local coordinates grow far out, so very large cells may be split into chunks;
- infinitely many cells: the complex cannot be listed, so per-root path tables are impossible and job 24's lazy path
  trie becomes mandatory; cells are created on demand with ids (for a covering space, a base cell plus a portal word,
  so words become cell coordinates); memory is bounded by dropping far cells except those holding objects; only the
  region near participants is simulated (interest management, which scalability needs anyway).

**Proposed**: the discrete hyperbolic plane, read as flat Euclidean cells with too many around each junction (for
example squares five per junction, the {4,5} tiling, 450 degrees; regular pentagons four per junction, {5,4}, 432
degrees). Cells are flat; curvature is negative and sits at the junctions (angle excess, already supported: the
genus-2 world has such a junction). Large-scale behaviour is that of the hyperbolic plane (exponential growth, unique
geodesics). This stays inside the agreed Euclidean scope. **Agreed (2026-10-30): all cells are flat until the Thurston
geometries** (section 2), which are far in the future. Requirements:

- **exponential growth**: cells within distance R grow exponentially, and since geodesics from a point never meet
  again, everything within draw distance is visible along exactly one line of sight, so visible cells also grow
  exponentially with draw distance. Draw distance becomes a hard, tuned budget (fog, depth cap); per-root tables
  for infinitely many cells are impossible, so job 24's lazy path trie is a near-term requirement. A regular tiling's
  symmetry group maps any cell to any other, so one root's trie (and static cull) serves every cell; precomputation is
  finite up to the depth cap, and the binding limit is exponential growth with depth. Only the region near
  participants is simulated;
- **canonical cell names**: cells are created on demand, and different portal words can reach the same cell (around a
  junction), so ids need a canonical form for words (the word problem of the tiling's group). These groups are
  automatic (Cannon; Epstein et al., *Word Processing in Groups*): a finite automaton gives each cell a unique shortest
  name; explicit codes exist for {7,3} and {5,4} (Margenstern). A module of the combinatorial layer (P15);
- **in our favour**: cell-local coordinates avoid the precision loss of global hyperbolic coordinates far from the
  origin; a regular tiling has one cell shape, so the instanced renderer draws all visible copies from one archetype;
- junctions remain holes for homotopy, forbidden zones apply, and the carry-drop rule (P4) applies; sweeping past an
  excess junction makes the endpoint jump the other way.

**Agreed as a distant future consideration** (2026-10-30), not a near experience:

- **A discrete Ricci-type flow**: the metric evolves while the learner is inside it, curvature living at junctions
  (angle deficits) and driven toward targets; in 2D in the spirit of Chow and Luo's combinatorial Ricci flow, in 3D
  of Regge-style curvature on edges. It is the reason corners are never guaranteed flat (P2).

**Proposed**: requirements the flow would put on the engine:

- the metric changes every tick, not occasionally: incremental, cheap metric updates and per-tick transport of
  objects across the change (far beyond job 30's rebuild-and-swap);
- flows can degenerate cells and need flips (as in the discrete conformal work of Gu, Luo, Sun and Wu), which change
  the combinatorial complex; ids and portal words must then be mapped through the flip, so "the combinatorics is
  fixed" holds only between flips;
- flows are integrated numerically and may need their own sub-steps within a tick (P8).

**Proposed**: requirements the tesseract puts on the engine:

- portals on faces of every orientation (no yaw-only shortcuts);
- a one-dimensional singular locus: exclusion tubes around singular edges in every direction (generalising the
  junction exclusion cylinders), and gluing validation by edge cycles, cone angles and holonomy (absorbs job 18);
- a full 3D visibility funnel through polygonal portals (the screen-space convex clipping generalises directly);
- a static cull by 3D line stabbing of portal sequences, replacing the plan-view argument (Teller and Sequin's
  cell-and-portal method, exact via linear programming in Plucker coordinates; possibly conservative at first);
- six-degree-of-freedom locomotion and VR comfort for flight (a cockpit as a fixed visual reference).

## 2. Principles

**Agreed** (design freedom elsewhere):

1. The engine owns all simulation state: world, participants, objects, geodesics, tool state, clock. It has no DOM and
   no three.js, and runs in Node, a worker or the browser (or, eventually, in a higher-performance language).
2. Everything is a command: typed plain data, with a result or an error. UI actions, bot actions and tests produce the
   same commands. Command logs can be replayed.
3. Time is explicit (a `step(dt)`-style advance), not wall clock.
4. Queries return plain data and never mutate. Events are a stream clients can subscribe to.
5. A participant is generic: the local player, a remote player, a bot and a creature follow the same movement and
   collision rules; only the source of their commands differs.
6. The renderer is a pure consumer of an engine snapshot. Rendering-side visibility work (static cull, funnel, GPU
   clip planes) may stay on the render side but is fed by engine queries.
7. The API is separate from the transport. In-process first; a thin adapter (worker, WebSocket, CLI) can come later.
   Which external client comes first (Node script, Python, an LLM agent loop) is undecided; the design must not depend
   on it.
8. Performance must not suffer from the split.

**Agreed non-requirements:**

- Bit-exact determinism is not needed. "Same up to floating-point tolerance" is enough; do not contort the math or
  random numbers for it. Seeded randomness is still welcome for reproducible tests.

**Agreed constraints:**

- Do not design for a specific external language or transport.
- Do not break the running app during the migration; the desktop and Quest builds keep working throughout, and every
  step leaves typecheck, tests and smoke green.

**Agreed geometry scope** (2026-10-30): the target is Euclidean polyhedral complexes: convex polyhedral cells glued
along faces of any orientation (floors, ceilings, slanted faces) by isometries of Euclidean 3-space. Today's vertical
prism cells with wall portals are a special case. All cells are flat until the Thurston geometries (hyperbolic, spherical,
products such as H2 x R, and the rest), which are a distant future goal, not a near one (2026-10-30). Until then the
design does not pay for them beyond the hedges in [P14](#p14-hedges-that-keep-other-geometries-reachable).

**Agreed: locomotion is a separate engine subsystem** (2026-10-30). The engine implements locomotion (gravity, up
directions, walking, flying) once, as its own subsystem, separate from collision and from motion along geodesics.
Experiences select and configure a locomotion model per participant (walking in prism worlds, flying in the
tesseract); they never implement gravity themselves. See [P16](#p16-locomotion-models-and-gravity-as-structure).

**Agreed: input mapping is a client concern** (2026-10-30). How device input becomes commands is decided by the UI,
not by the engine or by tool modules. Example: aiming a geodesic cannon on desktop, the UI stops moving the player and
routes mouse motion to the cannon's aim; in VR nothing is stopped and the aim follows the hand ray. Tool modules take
aim as command data and know nothing of locomotion or devices.

**Agreed (2026-10-30): no self-requested "hold participant" engine command.** Earlier agreed as a generic engine
command, then reopened (should stopping the player for aiming be a UI detach and reattach of controls, or an engine
feature?) and settled as follows:

1. Aiming and similar modes are pure UI: the UI detaches by writing **neutral values** to the locomotion slots (zero
   velocity, zero thrust), then reattaches. Merely going silent is wrong: a latest-value slot keeps its last value, so
   the player would keep walking.
2. What a body does under neutral input is a locomotion model parameter (a walker stands still; a flyer brakes to a
   hover or drifts with inertia, as the experience configures).
3. A freeze *imposed by an authority* (a teacher freezing students, a scripted moment) is a possible later engine
   feature, decided with roles (P5).

Reasons against a self-requested engine hold: neutral-input behaviour already covers the need; in VR the head keeps
moving and the camera must follow it, so a hold only rejects body motion, which the rig already does; and in
multiplayer a client able to pin itself (mid-air, immovable) has an unfair power.

**Agreed: the architecture mirrors the mathematics** (2026-10-30). The abstraction ("what is distance, what is a
geodesic") is separate from the representation ("how we compute": vectors, matrices). See
[P15](#p15-layers-that-mirror-the-mathematics).

**Proposed refinements of the principles** (not agreed; see section 4 for the reasoning):

- Principle 2 and "nothing may bypass the API": restrict to *shared simulation state*; client-local UI state (menu
  page, debug overlays, camera) need not pass through the engine ([P1](#p1-two-input-channels-control-state-and-commands), [P3](#p3-split-simulation-state-from-client-local-state)).
- Principle 4: "plain data" means *read-only, with no live handles*, not *deep-copied every frame* ([P7](#p7-snapshots-read-only-by-reference-serialised-only-at-the-transport)).
- Principle 8: state it as measurable budgets ([P12](#p12-performance-budgets)).

## 3. Where the code stands (checked 2026-10-30)

What is already engine-ready:

- Geometry, the segment-walk kernel, movement (swept collide-and-slide), geodesic tracing and curve shortening are pure
  TypeScript with good unit and property tests (fast-check). They are the base for the engine core.
- The runtime object registry has version counters, and objects that move are written only by their owners
  (`src/world-objects/worldObjectOwner.ts`). The frame snapshot from job 28 already gives the renderer one consistent
  read per frame.

What is not:

- `src/render/three/createThreeApp.ts` is 3,563 lines with 45 top-level `let` state variables, 39 `menuState =`
  assignments, ~25 getter/setter closures and ~45 `on*` callbacks passed to tool factories. Tool logic, UI and
  rendering are entangled there.
- **The interaction layer lives in `render/three`.** Aim picking (`src/render/three/aimTarget.ts`, 1,211 lines), the
  geodesic tools (`src/render/three/geodesicCannonTools.ts`, 1,271 lines) and `src/render/three/toolObjectRuntimes.ts`
  are exactly what scenario tests most need, and they import three.js. The coupling is shallow: `aimTarget` uses
  three.js only for `Vector3`/`Quaternion` at its edges, and the cannon tools need the scene only for a glow mesh and the
  renderer only for pointer lock. Job 32 already plans the move to `src/interaction/`.
- **Creatures import three.js** (`src/world-objects/simpleGeoCreature.ts`, `src/world-objects/geodesicMarmot.ts`) and are
  synced to meshes inside the simulation loop (`runtime.syncParent(cellMeshes)`).
- **Players and creatures move differently**: players through `movePlayer`, creatures through their own
  `runtime.update` and `moveDynamicObject`. Principle 5 is new work, not a refactor.
- **Wall-clock time inside the simulation**: object ids are built from `Date.now()` (placed flags, measured lengths,
  protractor angles), as is the reload confirmation; the step size is `clock.getDelta()` capped at
  `maxSimulationStepSeconds`.
- **Deformation commits happen when the worker finishes**, polled at the start of each frame, so a replay would apply
  them on a different tick.
- **`src/runtime/runtimeMenuState.ts` mixes kinds of state**: the selected tool (simulation) and menu open / current page
  (per-client UI).
- `src/runtime/runtimeCommands.ts` has a `RuntimeCommand` union with 4 kinds, of which 2 are dispatched (`go-home`,
  `reload-world`). Console helpers such as `placeObjectAt` (`src/render/three/appDebugHelpers.ts`) are an ad hoc
  precursor of the API.
- `npm run smoke` (headless browser smoke on four worlds) and `npm run edge` / `npm run cdp` (interactive browser
  debugging) exist and could drive the real renderer with the same command scripts.

## 4. Proposals under discussion

All items in this section are **Proposed** unless marked otherwise. Each states what it suggests, why, and the main
alternative.

### P1. Two input channels: control state and commands

Continuous input (movement axes, yaw and pitch, the aim ray, carry following the aim, rotate driven by yaw, the XR
physical head displacement) changes every frame. As logged commands it would be about 90 per second per participant.
**Agreed** (2026-10-30):

- **Control state** per participant: sampled each tick, latest value wins, idempotent.
- **Discrete commands**: ordered, logged, each with a result or an error.

A replay records both. *Rejected alternative:* everything as commands, with coalescing in the log.

**Proposed refinements:**

1. **Slots.** Control state is a set of named slots per participant: those of its locomotion model (a walker's move
   axes, a flyer's six-axis input) and those a tool session opens (the aim ray while rotating, the carry offset).
2. **Absolute values or rates, never deltas.** A latest-value slot loses all but the last of several deltas sent
   between ticks. Desktop mouse look (today `yawDeltaRadians` per frame) becomes an absolute yaw and pitch integrated
   by the client; movement becomes a velocity intent, not a per-frame displacement (today `localDisplacement` depends
   on the frame's dt).
3. **Edges are commands.** Anything that happens (fire, begin carry, drop) is a command, since a press shorter than a
   tick would vanish from a slot; only what is (aiming here, moving at this speed) goes in slots.
4. **Commands are self-contained.** A command never reads control state implicitly: "fire" carries its own ray, so
   over a network the shot uses the aim the player saw. See P2.

### P2. Two levels of command: intent and semantic

- **Intent commands** carry an aim ray in cell-local coordinates (cell id, origin, direction); the engine picks, so the
  result is authoritative and consistent across clients. The UI sends these.
- **Semantic commands** address things by id ("tie G1's endpoint B to emitter E2"). Tests, bots and LLM agents send
  these, since none of them can aim rays.

Intent commands resolve into semantic ones, and the log records the semantic form. *Alternative:* intent commands only,
with test helpers that compute rays.

**Agreed revision (2026-10-30), replacing the two levels above:** one level of semantic commands, with picking as a
query. Rule: **commands carry only intrinsic geometric data** (ids, and locations as a cell plus coordinates in that
cell); never rays, cameras or screen positions. Aiming is a UI convenience the engine provides as a read-only query.
Clients that do not aim (agents: "a flag 3 m ahead of me") build intrinsic locations with construction queries, the
basic one being the exponential map: walk the geodesic from a pose along a vector, through portals, and return where
it ends.

**Agreed (2026-10-30): relations carry a homotopy class.** A location is a point; a relation between two points is a
point pair plus a homotopy class of paths. The same target can be visible along several portal sequences at once, and
each line of sight is a different geodesic, so:

- picking returns the target, its intrinsic location and the homotopy class of the line of sight (the portal word
  from the viewer);
- commands relating two points carry endpoints plus a class: aim a geodesic at a target, connect two emitters,
  measure the distance to a particular copy of an object;
- commands about one location (place a flag) carry no class;
- the construction query (exponential map) also returns the word it traversed.

The engine reduces words to a canonical form, so two words for the same class give the same result.

**Agreed (2026-10-30): homotopy is taken in the space with every junction removed**, flat or not, with words reduced
by free cancellation (as today). Reason: homotopy must depend only on the combinatorics (the gluing pattern), never on
the metric. If only true cone points were holes, a deformation that changes a cone angle would change the set of holes
and make existing words ambiguous; deformations and flows (Teichmuller moves, a discrete Ricci-type flow) never
guarantee flat corners. A flatness guarantee is extra structure that can be added later. *Rejected:* removing only
true cone points.

- The UI asks the engine, through a read-only query, what a ray hits through portals; it gets a target id, hit
  point and line-of-sight word, then sends a semantic command ("tie G1 at B", "carry emitter E2").
- Tests, bots and agents send the same commands without the query. The log holds one kind of command, and no
  resolution step can differ between recording and replay.
- Data that is semantic in itself stays in the command: "fire cannon C in direction d" carries d.
- If the target moved or vanished between query and command, the command is validated (exists, in reach) and fails
  with an error (P1 refinement 4).

Cost: over a network the client picks against its own, possibly slightly stale, copy of the world, which it needs
anyway for predicting its own movement (P5).

### P3. Split simulation state from client-local state

Selected tool and active tool session are per-participant engine state. Menu open, current page, debug overlays, camera
and the VR palette are client-local and never enter the command log. This splits `RuntimeMenuState`.

### P4. Modal tools as per-participant tool sessions

Carry, rotate and aim become sessions with begin, update, commit and cancel. Begin, commit and cancel are commands;
updates (the new aim, the carry offset) arrive in control slots the session opens (P1), never derived from the
participant's locomotion input (input mapping is the client's job, section 2). In multiplayer an emitter has at most
one carrier (first come, first served); geodesics are derived and need no lock (P5).

**Agreed: carry is an attachment** (2026-10-30). The engine holds "object O is carried by participant P at an offset
in P's body frame" and composes it with P's pose, so the object crosses portals with its carrier; the client supplies
the offset (fixed in front of the camera on desktop, the hand pose in VR). This retires the player portal-crossing log
that the cannon tool replays today (`getPlayerPortalTransitionsSince`).

**Agreed: where an attached object is, and why release must be trivial** (2026-10-30; items 1 and 2 below; the
policies remain proposed). Today the carried emitter is stored in the
player's cell frame even when the point lies past a portal (an invalid pose for the whole carry), the locked
geodesic's portal word folds the *player's* crossings, and on release the code walks the segment from player to
emitter, re-homes the emitter and writes those crossings into the player's crossing log
(`src/render/three/geodesicCannonTools.ts`, `normalizeReleasedCarriedGeodesicCannon`). Instead:

1. The attached object's location is the endpoint of the geodesic from the carrier's position along the offset (the
   exponential map); it is well defined beyond portals.
2. The engine re-homes the object every tick, so its pose is always valid in the cell that contains it, and its portal
   crossings are its own, derived from its own motion between ticks. Release is then only a detach.

Policies to decide:

- The offset segment hits a wall. **Agreed** (2026-10-30): stop the object just short of the wall (refusing feels
  broken).
- The segment (not the object) sweeps across a junction or singular edge: the endpoint jumps (by the holonomy, in the
  cube world). Today only the emitter touching a forbidden zone is handled (it is destroyed); the swept-segment case
  is probably inconsistent (unverified). **Agreed** (2026-10-30): drop the emitter at its last valid position, so it
  stays continuous and no portal word becomes illegal. *Rejected alternatives:* allow the jump and change a locked
  geodesic's portal word to match (the geodesic would change homotopy class mid-carry); block the turn (no free
  turning near corners while carrying).
- The object crosses several portals in one tick: crossings chain in order via the segment walk.

Scenario tests this calls for: release in the carrier's cell; release one and two portals away; carrier crosses a
portal while carrying; offset segment swept across a junction, then release; offset segment against a wall.

### P5. Multiplayer: one authoritative engine

**Agreed goals (2026-10-30):**

1. **Classroom**, very important: a teacher and several students inhabiting the same world.
2. **Remote collaboration**: possibly.
3. **Games**: yes, but cooperative, on devices under our control; **no adversarial design** (no anti-cheat).

**Proposed, following from trust:**

- **Ownership instead of re-simulation** (extends `src/world-objects/worldObjectOwner.ts`). Each device owns its own
  participant (body, locomotion, attached objects, head pose), simulates it locally and publishes the result: instant
  movement, no prediction or reconciliation. The authority owns the shared world (geometry, geodesics, placed objects,
  creatures, deformations); commands editing it go to the authority and are applied in the step order of P8. Other
  participants' bodies are obstacles at their last known pose; brief inconsistencies are acceptable.
- **Conflicts are accidents, not attacks**: first come, first served ("already carried by Ana"); no lease system
  (see "one engine everywhere" below).
- **Roles are classroom guardrails, not security**: the teacher may freeze, teleport, reload, deform; students may be
  kept from reloading the world for everyone.
- **The authority is the local server** (superseding "the teacher's device"; see the two deployment modes below); the
  session ends if it stops; students who drop out rejoin and receive the current state.
- **Transport**: settled for the classroom by the two deployment modes below (WebSockets from a Node server); a
  browser-hosted authority with WebRTC signaling is no longer needed.

**Agreed (2026-10-30): one authority, which may be a powerful separate machine** responsible for intense
computations whose contained results are easily transferred over the network to devices (such as a Quest) that could
not do them. *Proposed:*

- **Where the authority runs is a deployment choice**, same engine code: in-process (single player, as today), the
  teacher's laptop, a strong classroom desktop, or a remote machine; eventually native code. A Node authority on a
  strong machine also serves the local network over WebSockets without a signaling service.
- **Heavy work is jobs that can run anywhere** (generalising P9): inputs and outputs are plain serialisable data; a
  job runner is a local worker or the authority, invisible to the submitting code. Candidates: deformation rebuilds,
  geodesic rebuilds and curve shortening, accelerator precomputation (the static cull of a regular tiling), compiling
  a world from a photo of a cell diagram, eventually the Ricci-type flow.
- **Results are compact and intrinsic**: the authority sends what was computed (a deformed metric plus the maps for
  carrying objects across; a geodesic's new path and portal word), and each device derives bulky data locally
  (meshes, instance buffers, trie nodes). Large precomputed tables are sent only when small, otherwise recomputed
  lazily on the device.
- **Standalone stays possible**: with no strong machine, a device runs everything itself with local runners.
- Ownership of bodies stays on the devices (latency; cheap); heavy shared computation goes to the authority.

**Agreed (2026-10-30): devices own their participants, with conventional delegated authority**: the host can issue
commands to the clients (teleport, freeze, change world) that the owning device carries out. This extends the owner
model (`ObjectHost.placeAt` sends a placement command to the owner, `src/world-objects/worldObjectOwner.ts`) across the
network; teacher control of devices happens through these commands, and the authority-imposed freeze (section 2)
belongs here. *Proposed details:* devices obey (trusted), apply the command at their next step and acknowledge it;
pose updates carry the last authority command applied, and the authority ignores updates that predate it (no snapping
back after a teleport); attachments follow their carrier (P4); targets are intrinsic locations with a geometry
version.

**Proposed (2026-10-30): one engine everywhere, split by ownership, not by code.** Raised by the maintainer: much of
the geometry cannot run only on a server (rendering's funnel and instances every frame; one's own movement; picking
for hover and laser every frame; while carrying, the locked geodesics are rebuilt every frame,
`rebuildConnectedGeodesicBetweenEmitters`, which a round trip would make trail behind the hand; measuring and
protractor previews). So:

1. The geometric core (math, complex, manifold, dynamics, queries) is one library running on every device and on the
   authority (principle 1); every client runs the full geometric logic on its replica.
2. Every piece of state has exactly one owner at a time: the authority for the shared world by default, each device
   for its own body. The owner computes it; everyone else reads their replica.
3. ~~A lease is a temporary transfer of ownership of the emitter and its locked geodesics~~ *Rejected (2026-10-30) as
   overengineering:* it would refuse two students each carrying one end of a geodesic, a good classroom activity.
   *Proposed instead:*
   - **Geodesics are derived, not owned.** A locked geodesic is determined by its two endpoints and its homotopy class
     (portal word); every device computes it from the endpoints it sees (its own carried end locally, the other from
     its replica).
   - **The class updates from both ends without coordination.** If one end moves along crossings a and the other along
     b, the new word is a^-1 w b, then freely reduced. Left and right multiplication commute, so each carrier reports
     only "my end crossed these portals", in any order.
   - **One carrier per emitter**: the authority gives a contested emitter to the first; the carry is the attachment of
     P4, nothing more.
   - While both ends move, each device sees the other's end slightly late (pictures differ by centimetres); they agree
     when movement stops.
   - **No other refusals.** A tie involving a geodesic whose far end is being carried is fine: the tie joins the words
     (roughly w1 w2) and the carrier's report b applies before or after with the same result, (w1 w2) b = w1 (w2 b);
     the merged geodesic then follows the carried emitter. `tieAndDetachGeodesicEndpoints` requires both selected ends
     at one emitter and the geodesics locked (pinned at both ends), not that any emitter is still. Deleting a geodesic
     whose end is carried is also fine (the carrier's reports for it are ignored); deleting the carried emitter ends
     the carry with an event saying why. The only geodesic rule in multiplayer is one carrier per emitter.
4. Heavy computation is jobs (above).

Not seamless: tight interactions between two owners (students bumping, two pushing one creature) are seen slightly
late, giving small overlaps or corrections, acceptable without adversaries; edits needing the authority (firing,
tying) take one round trip (~5-20 ms on a school network), which a local preview can hide if ever needed.

**Agreed (2026-10-30): two deployment modes.**

1. **Static site (GitHub Pages): single player only.** The engine runs in the page as its own authority; no network
   channel exists.
2. **Local server: multiplayer.** The server serves the app itself (it is the origin, so nothing needs discovering),
   runs the engine as the authority (and compute machine, if powerful) and talks to clients over WebSockets from Node.
   Students join as participants; the **admin** (teacher or developer) logs in with a password and gets teacher and
   debug powers (the debugger is an API client with a role, not a back door; its debug queries and commands are logged
   and replayable). The server may run on the teacher's laptop; the teacher is an admin client.

*Proposed details:* HTTPS/WSS (the local server already supports it), so the password never travels in clear; the
server stores only a password hash, never in the repository; light rate limiting on login. Each headset accepts the
server's certificate once (WebXR needs a secure context), as the local headset setup already requires
(`_docs/DEPLOYMENT.md`, `wwwserver/`). Remote collaboration over the internet would need the server reachable from
outside: later.

This replaces the earlier "teacher's device as authority" and the browser-hosted authority with WebRTC signaling, and
the public-key scheme below.

*Superseded (2026-10-30), kept for the record:* **a trusted local server recognised by a public key** (proposed by
the maintainer, then simplified by them into the two modes above). Its details were:

- **Keys**: the public key sits in the deployment's app config (`public/*.config.js`; `AppConfig` has a debug
  section), not in code, so deployments differ without a rebuild; the private key never enters the repository (like
  the local HTTPS certificates, already ignored by Git).
- **Handshake**: the app sends a random challenge, the server signs it, the app verifies with Web Crypto (ECDSA P-256
  everywhere; Ed25519 in newer Chromium); a verified server gets a role (debugger, teacher, authority), nobody else.
  Cooperative design does not make school Wi-Fi safe: without the check any laptop on the network could take over the
  headsets.
- **Discovery is the hard part**: a page cannot scan the network or listen for broadcasts. Options: (a) the local
  server also serves the app, so it is the origin and nothing needs discovering (the project already serves the app
  locally over HTTPS for headsets, `wwwserver/`, certificate accepted once); (b) the server address in the URL, typed or
  scanned as a QR code; (c) the public GitHub Pages site connecting to a private address, fragile (mixed content,
  browser restrictions on public-to-private requests, certificate trust). *Leaning:* (a), with (b) as fallback.
- **Fit**: a transport adapter (principle 7) carrying the same API; the debugger is a client with a role, not a back
  door; its extra powers are internal-state queries (today's diagnostics and performance counters in
  `src/render/three/appDebugHelpers.ts` and `runtimeDiagnostics`) and debug commands (such as `placeObjectAt`), logged
  and replayable. The same server can be the authority and compute machine above. It makes debugging on a Quest as easy
  as `npm run cdp` makes it on the desktop.

The original proposal below stands where it does not conflict with the above (client-side prediction is no longer
needed for owned bodies).

One engine instance is the authority; it can run in a browser tab, so a classroom needs no server. Clients predict only
their own movement; world edits (geodesic tools) make a round trip, since their rate is low. The owner model maps onto
authority. *Rejected alternatives, reasons:* lockstep needs bit-exact determinism, which is a non-requirement;
CRDT-style peer-to-peer does not fit geodesic topology edits. **Open sub-question:** roles and permissions (who may
deform or reload the world; teacher vs student).

### P6. Engine-allocated ids

Participant prefix plus counter: no coordination between clients, and replay reproduces them. Removes `Date.now()` ids.

### P7. Snapshots: read-only by reference, serialised only at the transport

Deep-copying a plain-data tree every frame conflicts with principle 8. In process, the renderer reads the engine's
immutable structures by reference, plus version counters (as the registry and the job 28 snapshot already do).
Serialisation happens only at a transport adapter. Events cover meaningful transitions (tied, crossed a portal, geometry
committed); poses are state, not events.

**Agreed (2026-10-30): two kinds of snapshot, in two places.**

- The **engine snapshot** is world state after a step (step number, geometry and its version, objects, participants);
  it knows nothing of cameras and **lives in the engine**. Precisely: the authoritative copy of shared state lives on
  the authority, and every device runs the full engine on a replica (see "one engine everywhere" in P5).
- The **render snapshot** is what the renderer computes from world state for one view (visibility, instances,
  clipping; today's `src/render/three/frameRenderSnapshot.ts`); it **lives on the client**, one per view.

**Open (2026-10-30): how state reaches readers and replicas** (the maintainer: "a subtle engineering problem"). To
be decided with a prototype measured on a Quest. What makes it subtle:

1. **Which thread the local engine runs on.** Sharing the main thread with the renderer (as today) allows reading the
   engine's values directly between steps at no cost; an engine in a worker (to free the main thread under a tight
   Quest budget) cannot be read directly, so every frame needs copies, a journal, or a shared-memory data layout.
   This drives everything else.
2. **Two directions**: world changes flow down from the authority; owned state (body poses, carried emitter
   positions, crossing reports) flows up from devices, at a different rhythm.
3. **Atomic steps**: a replica never shows half a step.
4. **Late joiners** need a full snapshot, then changes from that step on.
5. **Field classification**: authoritative state (sent); cheap derived data (recomputed everywhere, such as geodesic
   paths from endpoints and class); expensive derived data (computed once by its owner and sent, such as a
   curve-shortening result).
6. **Granularity**: objects are replaced as whole values today, so a large geodesic is re-sent for a small change.

**Agreed, tentatively (2026-10-30; the maintainer wants to revisit them once a prototype makes the trade-offs
concrete): three cheap commitments now** that keep every option open:

1. **Whole-value immutable state**: change an object by building a new value, never by editing fields in place (as
   world objects already are: `runtimeObjectRegistry.update({ ...cannon, cellId, localPose })`), including new engine
   state such as participants. Useful without a network: before and after can always be compared (tests, replays,
   debugging).
2. **One place all changes pass through**: engine state lives in one store, changed only through its methods (world
   objects already go through the registry and its version counter; player pose, menu and tool states are `let`
   variables in `createThreeApp.ts`, `menuState` alone assigned 39 times; this is job 31's aim). A network feed, a
   replay log or the renderer's change detection then hooks in at one place.
3. **A label on each field** when a kind of state is introduced: real state, cheap derived, or expensive derived (a
   geodesic's endpoints and portal word are real; its traced path can be recomputed). One line in a type comment.

*Candidate design, not agreed:*

- **Read view plus change journal.** The engine's immutable values are readable between steps without copying (a read
  view, valid until the next step; nobody keeps it across steps). Each step also publishes a change journal (objects
  added, updated, removed; participants moved; geometry version). Holders of history (replay recorder, debugger) and
  network feeds consume the journal. With nothing changed, publishing allocates nothing.
- **Client replica.** Each client keeps a replica of the engine snapshot, used for rendering and for simulating the
  body it owns (P5). In process the replica is the engine's read view (no copy); over a network it is kept current from
  the journal, which is also the network format (per step, only the changes). *Rejected alternative:* fully persistent
  snapshots with structural sharing (allocation per changed object, unneeded once the journal exists).

### P8. Time: host-chosen steps and a fixed order inside a step

**Agreed (2026-10-30): the host chooses the step size.** The engine is correct for any `dt` up to a cap.

- The desktop and Quest app step once per drawn frame with that frame's `dt` (as today): no blending, no added VR
  latency.
- Tests step as they like ("step 0.1 s ten times, then assert").
- A multiplayer authority may use a fixed tick (decided with P5). Blending across portals (two poses in different
  cells cannot be blended directly; the snapshot then gives the previous pose in the current cell's frame) is needed
  only for drawing other participants.
- Replays record each step's `dt` and repeat the same steps.
- The engine guarantees results independent of step size up to tolerance, enforced by property tests (many small
  steps land where one large step does).
- Instead of capping `dt` as today (`maxSimulationStepSeconds`, which loses time after a hitch), a host may split a
  long frame into several capped steps; catching up or dropping time is host policy.

**Agreed (2026-10-30): the order of work inside one step.**

1. Apply queued commands in arrival order; each succeeds or fails and returns its result.
2. Read the control slots (latest values).
3. Locomotion, then dynamics: participants and creatures move, collide and cross portals; attached objects are
   re-homed.
4. Module systems in a fixed, declared order (for example curve shortening, then dependent measurements).
5. Finalize the step: its state and its events, all in the step's geometry.
6. Deform, if a deformation job is ready: carry everything across the deformation map (with push-out), record the
   step number in the log, and emit one "geometry changed" event with the new geometry version.
7. Publish the snapshot, in the new geometry.

**Agreed (2026-10-30, maintainer): all commands are done before a deformation; the geometry is deformed only at the
end, when everything else in the step is committed.** The geometry never changes inside a step. (Step 5 was briefly
reopened over when to commit; options considered: start of step, as today, rejected because commands formed against
the old geometry would be read in the new one; end of step; between steps.) *Proposed detail:* events are finalized
before the deformation (step 5), so a listener sees the step's events in the old geometry, then "geometry changed",
then a snapshot in the new geometry; no event mixes the two. Which tool state survives a deformation is still to be
listed per module.

Rendering is not part of a step; the renderer reads the published snapshot. Deforming last (today the frame loop
commits at the start) keeps the whole step in one geometry: clients formed their commands against the last published
snapshot, so its geometry is the one their intrinsic locations refer to; everything is then carried across the
deformation together, and the published snapshot is in the geometry their next commands will use.

*Proposed:* commands carry the geometry version they were formed against; a command formed before a commit is carried
across the deformation map or rejected with "geometry changed" (matters once commands travel over a network).

Kept from the earlier proposal: the VR head pose comes from the latest XR frame, so the head offset stays on the
client, applied on top of the engine's body pose; room-scale walking reaches the engine as an absolute head position in
its own control slot (absolute values, P1), and the step result returns the accepted displacement (today a same-frame
round trip, `xrRig.consumePhysicalInput` then `acceptPhysicalMove`).

### P9. Long-running work as jobs

Deformation rebuilds and world loading: the command returns a job handle, completion is an event, and the commit applies
at a tick boundary. The log records the commit tick; replay waits for the build to reach it.

### P10. Perception queries

Rendering visibility stays per view on the render side, but bots and agents need "what can I see, in which direction"
from the engine. Once job 32 makes `visiblePortalPaths` three-free, the plan-view funnel can answer that.

### P11. A serialisable API, generated schemas

"Eventually a faster language" is read as *the API is serialisable*, not *the internals must be portable now*. Generate
JSON Schema from the command and query types; it gives LLM agents tool definitions and other languages bindings. The
docs tooling (`scripts/docs/lib.mjs`) already parses TypeScript with the compiler API.

### P12. Performance budgets

Make principle 8 measurable, for example: engine tick under X ms at Y objects on Quest; the frame allocation contract
(`tests/render-contract/frameAllocations.test.ts`) stays green; a headless benchmark per world.

**Agreed (2026-10-30): the target is 90 Hz on Quest**, an 11.1 ms frame, shared with the browser, the WebXR compositor
and GPU submission.

*Proposed split, to be checked against a baseline:*

| Part | Budget on Quest |
| --- | --- |
| Engine step (commands, locomotion, dynamics, module systems) | 2 ms |
| Render preparation (visibility funnel, instances, clipping) | 3 ms |
| UI and overlays | 1 ms |
| Headroom (browser, compositor, spikes) | the rest |

No per-frame allocation when nothing changed (`tests/render-contract/frameAllocations.test.ts`). *Baseline:* the app
already measures `moveMs`, `objectsMs`, `portalMs`, `uiMs` and the total (debug overlay and in-headset panel); read them
on a Quest in two or three worlds (cube, genus-2, dodecahedron), walking and carrying a geodesic.

### P13. World creation from photos is an authoring client

The photo-to-world pipeline produces a `CellComplexSpec` and sends a load-world command. It is outside the engine.

### P14. Hedges that keep other geometries reachable

**Agreed** (2026-10-30). The Thurston geometries are a distant future goal (section 2); three rules, cheap while
building the Euclidean polyhedral target, keep a later move contained instead of a rewrite. Reason: in the projective (Klein) model of hyperbolic space, and locally of
spherical space, geodesics are straight lines and planes are linear, so incidence and orientation code (segment walk,
portal crossing, development, funnel tests, static cull, clip planes) survives; only metric code (distances, lengths,
angles, collision bands, speeds, tolerances, shading) changes. Spherical wrap-around and the non-isotropic geometries
(H2 x R, Nil, Sol, ...) need raymarching or nonlinear projection whatever we do now.

1. **Sealed transform math**: no field access to `RigidTransform3` outside `src/math`, enforced by `docs:check`.
   On 2026-10-30 there were 157 such accesses (92 in `render/three`). The Euclidean polyhedral target breaks the
   yaw-only assumptions at most of those sites anyway, so sealing them then costs little extra.
2. **Incidence separated from metric**: distance, length, angle, "move along" and "offset by r" go through one metric
   module. On 2026-10-30 there were 129 direct Euclidean metric calls outside `src/math`.
3. **Opaque poses in the API**: clients never do geometry arithmetic on poses; they query the engine.

Explicitly not: a geometry type parameter, generics over the isometry group, or 4x4 homogeneous transforms now. The
abstraction exists as a module boundary named after mathematical concepts (P15) with one implementation.

### P15. Layers that mirror the mathematics

Lowest first:

| Layer | Mathematical content |
| --- | --- |
| Model geometry | Points, tangent vectors, isometries, half-spaces; distance, angle, geodesics (exponential map), isometry action. The abstraction: "what is distance, what is a geodesic". |
| Representation | Vectors, rotation matrix plus translation (or quaternions, 4x4). "How we compute"; opaque above this layer. |
| Combinatorial complex | Cells, faces, the gluing pattern, junctions, edge cycles; ids, portal words, homotopy. Unchanged while the metric moves (changed only by flips). |
| Metric | Cell shapes as convex polytopes (intersections of half-spaces), lengths, angles, cone angles, holonomy; a point in a space of metrics that deformations and flows move; validation in the spirit of Poincare's polyhedron theorem. |
| Manifold | Charts; poses as points of the frame bundle (cell plus isometry); portal words as holonomy elements; developing map; geodesic flow across charts (the segment walk); transport across portals. |
| Dynamics | Bodies, integration along geodesics, collision. Knows nothing of gravity. |
| Locomotion | Locomotion models (walker, flyer, ...), up fields and gravity, built on dynamics (P16). |
| Modules | Instruments, world rules (P17). |
| Engine | State, participants, commands, time. |
| Clients | Renderer, UI, transports. |

Not every algorithm can be written against distance and geodesics alone: collision sweeps, the funnel, curve
shortening and the static cull use Euclidean-specific facts (flat development, linear clipping, convexity of
distance). Each algorithm is written against the abstraction where possible and marked Euclidean-specific where not,
so the boundary shows what another geometry would have to supply. With one implementation the abstraction is a module
boundary, not runtime polymorphism, so hot loops stay monomorphic.

### P16. Locomotion models, and gravity as structure

A pose is a point of the orthonormal frame bundle; a control input is a velocity in the body frame (linear and angular
velocity, an element of the Lie algebra of the isometry group). A locomotion model restricts it:

- **flyer**: all six degrees of freedom;
- **walker**: horizontal translation and yaw, plus gravity along an up field.

A walker needs an up field that portals respect: a parallel direction field, which exists exactly when every gluing
(equivalently, the holonomy) preserves it. Today's prism worlds glue by yaw rotations and horizontal translations,
which is why gravity works; the tesseract's edge holonomies are quarter turns about all three axes and preserve no
direction, so it is a flight experience.

Locomotion is an engine layer of its own, between dynamics and modules. A locomotion model turns control input plus
world structure into a motion that dynamics executes; dynamics itself knows nothing of gravity. The engine ships the
models; an experience picks one per participant and sets its parameters (speeds, gravity strength, up-field source).

Up-field sources, all implemented by the engine:

1. **Derived from the holonomy**: when every gluing preserves a direction, the engine finds it; walking needs no
   authoring. Covers today's prism worlds.
2. **Authored per cell**, when no parallel field exists. When a gluing does not carry one cell's up onto the next, the
   crossing follows a policy the experience chooses and the engine implements: snap instantly (harsh in VR), reorient
   the body smoothly over time (briefly unsupported), or refuse walker crossings through that portal.
3. **Carried by the body** ("magnet boots"): up follows the feet; needs no global structure.

Creatures and bots use the same models. This makes principle 5 concrete: participants share dynamics, collision and
locomotion code; only the source of commands differs.

### P17. Experiences as static compositions of modules

An experience is a list of modules fixed at build time (instruments, world rules) plus the configured locomotion models
it uses. Each module
exports its command, query and event types, its state, its per-tick systems and a client-side view. The experience's
command type is the TypeScript union of its modules' types, so dispatch is exhaustively checked per experience and the
core never needs editing. No runtime plugin loading. The instruments are a module like any other and use only the
public module interface; needing a back door means the module interface is wrong. *Alternatives:* one closed union in
the core; a dynamic plugin registry.

## 5. Open questions

- **Multiplayer**: if P5 is not adopted, the model is open; in any case: what is shared vs client-local state, latency
  and rejoin, how portal crossing and geodesic tools behave when several participants edit one world.
- **Command granularity and error model**; versioning of the API.
- **Snapshot shape** consumed by the renderer and how to keep per-frame cost low (jobs 28, 29); see P7.
- **Wire format and transport adapter**, once the first external client is chosen.
- **Migration order**: how to move the `createThreeApp.ts` closure into the engine incrementally while the app keeps
  working and the tests keep passing; see section 6.

## 6. Phasing and existing jobs

**Proposed.** Split the program into phases, each useful on its own:

- **Phase 0, headless single participant.** Move picking and tools out of `render/three` (job 32's `src/interaction/`),
  remove `Date.now()` from simulation, build the engine state and command path, and a scenario-test harness. Pays off
  automated testing first.
- **Early, ahead of both primary experiences: lazy path trie plus per-frame funnel.** Precomputed per-root tables
  do not fit either primary target (the tiling is infinite; the tesseract's tables would be large and need 3D tests).
  With job 24's lazy trie, nodes are created only when the per-frame funnel (already exact and self-pruning) reaches
  them. Whether the static cull stays, as a per-node cache ("no eye in this root cell can ever see through this
  node"; `src/cell-complex/staticLineCone.ts` was written for that use), is **decided by measurement** (below). If it
  stays, in 3D a conservative version is cheap (linear-programming feasibility in Plucker coordinates without the
  quadric, or 2D projections, as today's plan-view cull already is); the exact Teller-Sequin test (polytope meets the
  Plucker quadric) can wait.
- **Agreed (2026-10-30): evaluate the static cull's performance before deciding its future.** On record: job 20
  measured only its build cost (depth 10, all roots: 5 ms for the torus moduli world to 207 ms for the dodecahedron;
  496 to 15,665 kept paths per root); job 21 measured the funnel examining 171 of ~1,800 paths (9.5%) on the cube at a
  40 degree field of view. The per-frame saving has never been measured (no funnel run on an unculled table).
  *Hypothesis:* small, because the funnel visits only children of visible paths and rejects an invisible child at its
  first constant-size sector clip, so the static cull saves one cheap clip per such child per frame, while it costs
  startup time and a recomputation (and structure clone) on every deformation. *Proposed method:* compare (A)
  precomputed culled tables, (B) lazy trie with funnel only, (C) lazy trie with the static cull cached per node, on
  startup and deformation cost, memory, per-frame funnel time and examined nodes (mono and stereo) and per-frame
  allocations; every example world plus a hyperbolic-tiling prototype (a tesseract prototype once 3D portals exist);
  several depth caps and fields of view; **on a Quest**. Keep the static cull only if C beats B on Quest frame time by
  a margin that pays for its startup and deformation cost.

  **First measurement (2026-10-30, desktop Node, not Quest).** `computeVisiblePortalPaths` with the app's options
  (2,000 max visible paths, 16 px minimum area), 300 random cameras per world (70 degree vertical field of view,
  1920x1080), median of 5 timings, on the statically culled versus the unculled table at the same depth (the deepest
  whose unculled table fits in memory):

  | World | Depth | Paths per root, culled / unculled | Examined, culled / unculled | Visible | Time per call, culled / unculled |
  | --- | --- | --- | --- | --- | --- |
  | cube | 8 | 841 / 13,121 | 175 / 314 | 147 / 147 | 110 / 112 us |
  | icosahedron | 8 | 250 / 766 | 78 / 103 | 69 / 69 | 49 / 51 us |
  | torus moduli | 8 | 841 / 13,121 | 175 / 315 | 147 / 147 | 106 / 121 us |
  | dodecahedron | 6 | 666 / 6,826 | 135 / 273 | 107 / 107 | 74 / 80 us |
  | genus-2 | 5 | 1,209 / 22,409 | 177 / 490 | 124 / 124 | 90 / 107 us |

  Rerun with `tests/render-contract/funnelStaticCullBenchmark.test.ts` (skipped unless `FUNNEL_CULL_BENCH` is set);
  a second run with another seed agreed within noise. Visible sets are identical (funnel exact, static cull
  conservative). Without the static cull the funnel examines
  1.3 to 2.8 times as many paths but takes only 2 to 19% longer (at most ~17 us per call, under 0.2% of a 90 Hz
  frame); time is dominated by visible paths. The static cull's real effect was table size (15 to 18 times fewer
  stored paths for the cube and genus-2), which a lazy trie does not need: it creates only examined nodes.
  *Reading:* B (lazy trie, funnel only) is sufficient for correctness and nearly as fast; the static cull gives some
  speed for memory. *Pending:* Quest and stereo; depth 10; the hyperbolic tiling, where exponential branching may make
  rejected children matter more.
- **Agreed (2026-10-30): the static cull stays as an optional accelerator.** For regular geometries it can be
  precomputed smartly (by symmetry one root serves every cell; being view-independent, it can even be precomputed
  offline and shipped with the world). Keeping that path is cheap if it sits behind a hook. *Proposed contract:*
  - **one hook in the trie**: before creating a node the funnel asks a *pruning oracle* "can this word ever be visible
    from anywhere in the root cell?"; the default answers yes; the static cull is one implementation;
  - **Agreed acceptance criterion (2026-10-30): the static cull is localized**: a few well-defined hook points
    (essentially the trie's node expansion), not sprawling, and not symbiotic with the main pipeline. The main
    pipeline never depends on it: the worker does not have to build it, instance capacities do not come from it, and
    the renderer works unchanged without it. Its debugging aids (rejected words and reasons) live with the plugin as
    its own optional debug view. Removing it means deleting its module and its registration. (First stated as "one
    call"; refined by the maintainer to "localized".) On 2026-10-30, ten files outside its own modules referenced it (geometry worker and session, startup in
    `createThreeApp.ts`, `cellRenderArchetypes.ts`, `stereoPortalFrame.ts`, `portalDebugRuntime.ts`,
    `appDebugHelpers.ts`, `appDebugLogging.ts`, `portalPathDebug.ts`, `portalPaths.ts`);
  - **memory lives with the plugin**: cone data or precomputed tables sit in the plugin's side table keyed by trie
    node, not in the trie's node layout, so with the plugin off nothing is paid;
  - **conservative**: an oracle never rejects a visible word; the brute-force property test
    (`tests/render-contract/visiblePortalPaths.property.test.ts`) runs against any oracle;
  - **metric-dependent**: the plugin declares its dependence on cell shapes and is invalidated or recomputed on
    deformation; experiences with continuous metric change leave it off.

  This generalises to **optional accelerators**: conservative, opt-in, invalidated by metric changes, measured against
  the default path, with the engine correct without any of them; experiences list them like other modules (P17).
- **Phase 1, participants and multiplayer.** Generic participants (players, bots, creatures), the authority model,
  ownership and delegated commands, roles.
- **Phase 2, transports and external clients.**

Existing jobs to absorb or reorder rather than duplicate (see `.agents/jobs/README.md` for conventions): job 31 (one
state holder and one command path; proposed: build its `appSession` as engine state, not a shell-side holder), job 32
(layer DAG; its `src/interaction/` move is the first engine step), job 33 (decompose runtime monoliths), job 30
(incremental deformation rebuild), job 24 (lazy path trie), job 35 (torus family as Teichmüller space).

## 7. Deliverables

**Agreed** targets for the design work:

1. This document, completed: layers, API surface (commands, queries, events), participant and multiplayer model,
   snapshot contract, transport boundary, error model, testing strategy.
2. A migration plan as numbered jobs in `.agents/jobs/` following the README template, ordered so that each job leaves
   typecheck, tests and smoke green and scenario tests replace manual checks as early as possible.
3. A list of the manual checks (see `.agents/jobs/_reports/`) that become automatable, and in which job.
4. Which existing open jobs and issues are superseded.

## Decision log

| Date | Change |
| --- | --- |
| 2026-10-30 | Direction agreed: engine with a programmatic API; sections 1, 2 (principles, non-requirements, constraints) and 7 agreed. |
| 2026-10-30 | Brief moved from `.agents/engine_api_brief.md` into this living document; review feedback added as proposals P1-P13, none agreed. |
| 2026-10-30 | Geometry scope agreed: Euclidean polyhedral complexes (section 2); other model geometries are not a goal. Hedges proposed as P14; gravity under face portals added as an open question. |
| 2026-10-30 | Agreed: locomotion and gravity belong to the experience; the tesseract (flight) is a candidate experience; the architecture mirrors the mathematics. Proposed: tesseract requirements, P15 (layers), P16 (locomotion models), P17 (static module composition). Gravity question closed into P16. |
| 2026-10-30 | Correction: locomotion is a separate engine subsystem, not experience code; experiences select and configure models and never implement gravity. Section 2, P15 (new Locomotion layer), P16 (up-field sources and crossing policies) and P17 updated. |
| 2026-10-30 | Agreed: input mapping is a client concern; tool modules take aim as data; the engine offers a generic hold-participant command. P4 corrected: tool session updates are client commands, not derived from locomotion input. |
| 2026-10-30 | Agreed: P1 (control state with latest value wins, plus discrete commands); carry as an engine attachment with a client-supplied offset (P4). Proposed P1 refinements: slots, absolute values or rates only, edges as commands, self-contained commands; P4 updates move to session slots. |
| 2026-10-30 | Proposed (P4): an attached object's location is the endpoint of the geodesic along the offset, re-homed every tick, so release is a detach; open policies for wall hits, segments swept across junctions, multi-portal ticks; scenario tests listed. Raised by the maintainer: release of a carried emitter lying in another cell. |
| 2026-10-30 | Agreed: attachment location by the geodesic along the offset, re-homed every tick, release as a detach (P4). Proposed: wall hits stop short, swept junctions drop the emitter. Proposed revision of P2: one level of semantic commands, picking as a query. |
| 2026-10-30 | Agreed (P4): when the carry segment sweeps across a junction, the emitter is dropped at its last valid position; jumping and blocking the turn rejected. |
| 2026-10-30 | Agreed (P4): when the carry segment hits a wall, the object stops just short of it. |
| 2026-10-30 | Agreed (P2 revision): one level of semantic commands; picking is a query; commands carry only intrinsic geometric data; construction queries (exponential map) for clients that do not aim. |
| 2026-10-30 | Agreed (P2): relations between two points carry a homotopy class; picking returns the line-of-sight portal word. Raised by the maintainer. Open question added: homotopy with every junction removed (today) or only true cone points. |
| 2026-10-30 | Agreed: homotopy with every junction removed (depends on combinatorics only; corners never guaranteed flat; flatness is later superstructure). Agreed future experience: discrete Ricci-type flow; its requirements proposed. P15 splits the complex into combinatorial and metric layers. |
| 2026-10-30 | Correction: the Ricci-type flow is a distant future consideration, not the third experience. Agreed candidate experiences: non-orientability (probably third) and non-compact worlds; their requirements proposed. |
| 2026-10-30 | Agreed: the main non-compact target is a discrete hyperbolic plane tiling. Proposed reading (flat cells, angle-excess junctions) and requirements (exponential growth, canonical cell names via automatic groups). Open: flat or hyperbolic cells; priority versus the tesseract. |
| 2026-10-30 | Agreed: for now, all cells are flat (the hyperbolic tiling uses flat cells with angle-excess junctions). |
| 2026-10-30 | Refined: all cells are flat until the Thurston geometries, which become a distant future goal (previously "not a goal"); P14 hedges keep them reachable. |
| 2026-10-30 | Agreed priorities: tesseract and hyperbolic tiling both primary; non-orientability secondary (do not block, do not focus). Proposed: what "not blocking" means; lazy trie plus funnel early in the plan, ahead of both. |
| 2026-10-30 | Reopened: the "hold participant" engine command. Proposed instead: UI detach by neutral slot values; neutral-input behaviour as a locomotion parameter; authority-imposed freeze later with roles. |
| 2026-10-30 | Corrected (maintainer question): the static cull is not optional in 3D; with the lazy trie it becomes a per-node cache, conservative in 3D (exact Teller-Sequin later). The tiling's static cull is precomputable from one root by symmetry. |
| 2026-10-30 | Agreed: evaluate the static cull's performance (per-frame saving never measured) before deciding its future; proposed A/B/C comparison on Quest with a decision rule. Replaces "static cull as a per-node cache" as a premature conclusion. |
| 2026-10-30 | Agreed: no self-requested hold command; the UI detaches by writing neutral slot values; neutral-input behaviour is a locomotion parameter; an authority-imposed freeze is a possible later feature with roles. |
| 2026-10-30 | Agreed: P14 (sealed transform math, incidence separated from metric, opaque poses in the API). |
| 2026-10-30 | First static-cull measurement (desktop): the per-frame saving is 2 to 19% of funnel time, at most ~17 us per call; provisionally the static cull is a candidate for removal. Pending Quest, depth 10 and the hyperbolic tiling. |
| 2026-10-30 | Agreed (maintainer): the static cull stays as an optional accelerator (smart precomputation for regular geometries); "candidate for removal" withdrawn. Proposed: pruning-oracle hook, plugin-owned memory, conservative contract, metric invalidation; the category of optional accelerators. |
| 2026-10-30 | Agreed acceptance criterion: the static-cull check is one call in the entire rendering code (trie node expansion); today ten files outside its modules reference it. |
| 2026-10-30 | Refined: "one call" is too strong; the criterion is "localized": few well-defined hook points, not sprawling, not symbiotic with the main pipeline. |
| 2026-10-30 | Agreed (P8): host-chosen step size with step-size-independent results; fixed order inside a step (commands, slots, locomotion and dynamics, module systems, job commits, events and snapshot). Proposed: commands carry a geometry version. Fixed tick everywhere rejected. |
| 2026-10-30 | Reopened (P8 step 5): when a finished deformation is committed; options A (start), B (end), C (between steps). |
| 2026-10-30 | Agreed (P8): all commands before a deformation; geometry deformed only at the end of a step; the geometry never changes inside a step. Step order now has seven steps. Proposed: events finalized before the deformation, then one "geometry changed" event. |
| 2026-10-30 | Agreed (P5 goals): classroom first (several students in one world), remote collaboration possibly, cooperative games on controlled devices, no adversarial design. Proposed: device-owned participants and authority-owned shared world, simple leases, roles as guardrails, teacher's device as authority, transport caveat. |
| 2026-10-30 | Agreed (P5): one authority, possibly a powerful separate machine doing intense computations with compact results sent to devices. Proposed: authority placement as deployment choice; jobs with location-transparent runners; compact intrinsic results; standalone fallback. |
| 2026-10-30 | Agreed (P5): devices own their participants, with delegated authority (the host issues teleport, freeze, change-world commands that devices carry out). Proposed: obey and acknowledge, stale-pose guard, attachments follow, versioned targets. |
| 2026-10-30 | Agreed (P7): engine snapshot (world state) lives in the engine; render snapshot (per view) lives on the client. Proposed: read view plus change journal; client replica (in process the read view, over a network fed by the journal). |
| 2026-10-30 | Proposed (P5, maintainer's question whether a central engine can work): one engine on every device, split by ownership not code; leases transfer ownership (carry runs on the carrier's device). P7 wording corrected: the authoritative copy lives on the authority, replicas everywhere. |
| 2026-10-30 | Rejected as overengineering (maintainer): leases transferring ownership of emitters and geodesics. Proposed instead: geodesics are derived from endpoints and class; the class updates from both ends without coordination (a^-1 w b; left and right multiplication commute); one carrier per emitter. |
| 2026-10-30 | Corrected (maintainer question): no refusal of ties or deletes on geodesics with a carried end; the claimed "still emitter" precondition does not exist in the code, and associativity makes the order irrelevant. |
| 2026-10-30 | Agreed (P12): 90 Hz on Quest. Proposed: budget split (engine step 2 ms, render preparation 3 ms, UI 1 ms); baseline from the app's per-phase timings on a Quest. |
| 2026-10-30 | Open (P7): how state reaches readers and replicas (read view, journal, worker or main thread, wire format); subtleties listed; to be decided with a Quest prototype. Proposed commitments now: immutable whole-value state, one change choke point, field classification. Read view plus journal kept as a candidate. |
| 2026-10-30 | Proposed by the maintainer (P5): a trusted local server recognised by a public key, with debug access, also carrying multiplayer coordination. Details proposed: key in app config, challenge-response, roles, discovery options (leaning: server serves the app), fit as a transport adapter. |
| 2026-10-30 | Agreed (maintainer's simplification): two deployment modes, a static site for single player only and a local server for multiplayer with a password-protected admin. The public-key scheme, the teacher's device as authority and WebRTC signaling are superseded; classroom transport is WebSockets from Node. |
| 2026-10-30 | Agreed tentatively (P7): the three commitments (whole-value immutable state, one place for changes, field labels); to revisit with a prototype. |
