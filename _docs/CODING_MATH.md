# Coding mathematics: philosophy and guide

> **Status: living document, working draft.** Started 2026-10-31. Items carry the statuses of
> [design 012](design/012-engine-api.md): **Agreed** (decided by the maintainer), **Proposed** (under discussion),
> **Open**, **Rejected**. Every change gets a line in the [refinement log](#7-refinement-log).

This document records a *philosophy* of coding mathematics, and a guide to practising it. It is a metadocument: it is
about how this repository maps mathematics to code, not about what the program does. What the program computes is in
[MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md); how it is organised is in [ARCHITECTURE.md](ARCHITECTURE.md); the
design of its next version is in [design 012](design/012-engine-api.md).

## 1. The thesis

**Agreed (2026-10-31).** There is a coding design philosophy that makes it possible not just to *implement* a
mathematical idea in code but to *map* mathematical ideas to code organisation and to visualisation: the structure of
the program, and what the learner sees, follow from the structure of the mathematics.

This repository has two roles with respect to the thesis (**Agreed**):

- **A test case.** It produces evidence for the thesis and, just as carefully, counter-evidence: places where the code
  does not follow the mathematics ([section 6](#6-tensions)). A test case that cannot fail tests nothing.
- **A development playground.** It is where the philosophy is refined into precise principles. The principles in
  [section 3](#3-principles-working-draft) are a draft; when a concrete decision shows one too loose or wrong, it is
  sharpened and the change is logged.

## 2. Tiers of explanation

**Agreed (2026-10-30):** explanation is multi-tiered, and the top tier is mathematical: first the model, then how the
mathematical abstraction maps to the code organisation.

*Proposed tiers*, top down, with what each holds in this repository:

1. **The model**, mathematics only. Here: a Euclidean polyhedral complex and its gluing isometries; junctions and the
   singular locus; the space with junctions removed, where homotopy lives; poses as points of the frame bundle;
   geodesics and the exponential map; the developing map; holonomy; the space of metrics; observers and visibility.
2. **The correspondence**: mathematical concept, code organisation, visualisation, and the tests that check each
   correspondence. Here: layers that mirror mathematical structures (design 012, P15); a dictionary (portal word to
   `src/world-objects/geodesic/portalWord.ts`, exponential map to the segment walk, developing map to the path trie,
   gluing isometry to the compiled portal transform, ...); how each object becomes visible (the developing map as
   instanced cell copies seen through portals, a geodesic as a beam, a cone angle as the missing or extra wedge seen
   around a junction, holonomy as a flag returning rotated after a loop); which parts are abstract and which are
   Euclidean-specific.
3. **The realisation**: precise statements, conventions, tolerances and known gaps, with machine-checked code
   references. Here: [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md), which today starts at representation level
   (`RigidTransform3 = (R, t)`) and interleaves mathematics with code; tiers 1 and 2 would sit above it.
4. **The architecture**: program organisation and data flow ([ARCHITECTURE.md](ARCHITECTURE.md)).
5. **Contracts**: module headers, JSDoc, generated references, enforced by `npm run docs:check`.
6. **Narration**: comments inside the code ([documentation_style.md](documentation_style.md)).

*Proposed: traceability in both directions.* Each module in a mathematical layer names, in its header, the concept it
realises ("Realises: the exponential map, Model section 5"); the correspondence table points back to the module.
`docs:check` already verifies references from documents into code; it would also verify that such modules name an
existing tier-1 concept.

## 3. Principles (working draft)

All **Proposed** (2026-10-31), drawn from decisions made in design 012. Each has a statement, the mathematical reason,
where this repository applies it, and its known limits.

### 3.1 State is intrinsic

State is expressed in terms the mathematics has, never in a chart or embedding it does not have: a location is a cell
plus coordinates in that cell; a relation between two points is the pair plus a homotopy class (a portal word).
*Why:* a glued space has no global coordinates; any global chart is an artefact that breaks somewhere. *Here:* design
012, P2 (commands carry only intrinsic data). *Limit:* intrinsic data needs construction queries (the exponential map)
for clients that think in directions and distances.

### 3.2 Abstraction is separate from representation

"What is distance, what is a geodesic" is kept apart from "how we compute it" (vectors, matrices). *Why:* the same
mathematical object has many representations; only the abstraction is the mathematics. *Here:* 012, P14 (sealed
transform math) and P15 (layers). *Limit:* not every algorithm can be written against the abstraction alone;
Euclidean-specific algorithms are marked as such rather than forced into it.

### 3.3 Combinatorics is separate from metric

What depends only on how the pieces are glued (ids, portal words, homotopy) is kept apart from what depends on shapes
(lengths, angles, cone angles). *Why:* the combinatorial structure is invariant under deformation; the metric is a
point in a space that deformations and flows move. *Here:* 012, P2 (homotopy with every junction removed) and P15 (two
layers). *Limit:* flips in a discrete flow change the combinatorics too; "fixed" holds between flips.

### 3.4 Store what is real; derive the rest, and say which is which

Only state that is not determined by other state is stored as truth; derived objects are recomputed, and every field
is labelled real, cheap derived or expensive derived. *Why:* a locked geodesic is determined by its endpoints and its
homotopy class; storing it as independent truth invites inconsistency. *Here:* 012, P5 (geodesics are derived) and P7
(field labels). *Limit:* expensive derived data is still computed once and shared, so it behaves like state in transit.

### 3.5 Let the algebra decide coordination and order

When the mathematics says operations commute or associate, the code does not coordinate them; when it says they do not,
the order is fixed explicitly. *Why:* moving the two ends of a path acts by $w \mapsto a^{-1} w\, b$, and left and right
multiplication commute, so two carriers need no lock. *Here:* 012, P5 (no leases). *Limit:* floating-point results agree
only up to tolerance; exact algebra holds for the combinatorial part.

### 3.6 Visualisation is a view of the model

What the learner sees is computed from the model and never feeds back into it; each mathematical object has a stated
visual form. *Why:* the visual form is a choice among many; the model is not. *Here:* principle 6 of design 012 (the
renderer consumes engine snapshots); the visual column of the correspondence (section 2).

### 3.7 Conventions are labelled as conventions

A choice made for convenience or robustness is recorded as such, distinct from what the mathematics forces. *Why:*
otherwise a convention is later defended as a theorem, or a theorem dropped as a convention. *Here:* "every junction is
a hole" (012, P2) is a convention chosen for robustness under deformation.

### 3.8 Tests state theorems

Where possible, tests are mathematical statements checked on random instances. *Here:* the property tests state group
laws: a rigid motion composed with its inverse is the identity, composition is associative, isometries preserve
distances (`tests/math/rigidTransform3.property.test.ts`); reversing a portal word twice gives it back
(`tests/world-objects/geodesic/geodesicPortalWord.property.test.ts`); crossing a portal and its reciprocal returns the
pose (`tests/movement/portalCrossing.property.test.ts`). *Limit:* some behaviour (visual comfort, performance) is not a
theorem and is tested otherwise.

## 4. A guide: coding a mathematical experience

**Proposed (2026-10-31).** A working order, distilled from the principles:

1. **State the model first**, in mathematics only (tier 1), before any code.
2. **Identify the structures and their levels** (combinatorial, metric, dynamics, observation) and make each a layer.
3. **Choose the intrinsic state**, and list what is derived from it.
4. **Name the abstractions** (distance, geodesic, transport, ...) and hide their representations behind them.
5. **Ask the algebra** before adding any coordination, locking or ordering mechanism.
6. **Decide the visual form** of each mathematical object, as a separate mapping.
7. **Label the conventions.**
8. **Write the correspondence** (tier 2) and its traceability; state the laws as property tests.
9. **Record evidence and tensions** as the work proceeds (sections 5 and 6).

## 5. Evidence

Mathematics settling engineering questions, from design 012 (2026-10-30):

| Engineering question | Settled by | Where |
| --- | --- | --- |
| Can a world have gravity? | Whether the holonomy fixes a direction (a parallel up field) | 012, P16 |
| Where is a carried object, even beyond a portal? | The exponential map from the carrier | 012, P4 |
| What must survive a deformation? | Homotopy depends only on combinatorics | 012, P2 |
| Do two carriers of one geodesic need coordination? | No: left and right multiplication commute; a proposed mechanism (leases) was removed | 012, P5 |
| Is a static visibility cull possible in 3D? | Line stabbing in Plucker coordinates | 012, section 6 |

## 6. Tensions

Counter-evidence: places where the code does not (yet) follow the mathematics. **Proposed** (2026-10-30). Whether the
philosophy absorbs each one, or it is irreducible engineering, is the test.

| Tension | Why it is one |
| --- | --- |
| Orientation stored as a yaw angle (197 places across 36 files) | A representation shortcut with no mathematical counterpart; breaks under face portals and reflections |
| The 2.5D visibility funnel (plan sector plus the newest portal's top and bottom edges) | Exploits the prism structure instead of a general notion of visibility |
| Every junction is a hole | A convention chosen for robustness under deformation, not forced by the mathematics |

## 7. Refinement log

| Date | Change |
| --- | --- |
| 2026-10-30 | Thesis, tiers, seven candidate principles, evidence and tensions first recorded in design 012. |
| 2026-10-31 | Moved here from design 012 into their own document; thesis stated in the maintainer's words; the two roles of the repository (test case, playground) agreed; principle 3.8 (tests state theorems) and the guide (section 4) added as proposals. |
