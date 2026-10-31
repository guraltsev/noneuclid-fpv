# Coding mathematics: philosophy and guide

> **Status: living document, working draft.** Started 2026-10-31. Items carry the statuses of
> [design 012](design/012-engine-api.md): **Agreed** (decided by the maintainer), **Proposed** (under discussion),
> **Open**, **Rejected**. Every change gets a line in the [refinement log](#4-refinement-log).

## 1. The thesis

**Agreed.** There is a coding design philosophy that makes it possible not just to *implement* a mathematical idea in
code but to *map* mathematical ideas to code organisation and to visualisation.

This repository is a **test case** for the thesis (it must be able to produce counter-evidence, not only evidence) and
a **development playground** for refining the philosophy into precise principles (**Agreed**). The principles below are
a working draft.

## 2. Principles

Each principle is stated generally; the example shows it in this repository. All are **Proposed** unless marked.

**Model before code.** State the mathematical model in mathematics alone before writing code, and derive the code
organisation from it rather than the other way round.
*Example:* the model here is a space glued from flat polyhedral cells by isometries, with bodies moving along
geodesics; layers, state and queries are read off this description.

**Explanation is tiered, mathematics first** (**Agreed**). Documentation descends from the mathematical model, through
the correspondence between mathematical concepts and code, to the realisation, the architecture, the contracts and the
in-code narration.
*Example:* here the tiers are the model; the concept-to-code-to-visualisation table; `MATHEMATICAL_MODEL.md`;
`ARCHITECTURE.md`; module headers and JSDoc checked by `docs:check`; comments in the code.

**Intrinsic state.** Represent state in the terms the mathematical object itself provides, never through coordinates,
charts or embeddings the object does not have.
*Example:* a glued space has no global coordinates, so a point is "which cell, and where in it", and a relation between
two points also carries the homotopy class of the path joining them, because the same two points can be joined in
inequivalent ways.

**Abstraction separate from representation.** Name the mathematical operations (distance, geodesic, transport, group
action) and hide their computational representation behind them; only the abstraction is the mathematics.
*Example:* rigid motions are used only through compose, invert and apply; their matrices are invisible elsewhere, so a
change of geometry would replace one module, not the program.

**Structural levels become layers.** Structures living at different levels (combinatorial, metric, dynamical,
observational) become separate layers, and what is invariant at a lower level is computed without the levels above.
*Example:* how the cells are glued (and hence homotopy classes) is kept apart from their shapes, so homotopy classes
survive any deformation of the shapes.

**Store what is determined once; derive the rest; say which is which.** Keep as state only what nothing else
determines; recompute what is determined; label every field as real or derived.
*Example:* a geodesic with fixed endpoints is determined by those endpoints and its homotopy class, so it is derived,
not stored as independent truth.

**Ask the mathematics first.** Before designing an engineering mechanism (coordination, ordering, special cases), look
for the mathematical structure that decides the question.
*Example:* whether a world can have gravity is decided by whether its holonomy fixes a direction; where a carried object
is, even through a portal, is decided by the exponential map from the carrier.

**Let the algebra decide coordination.** When the mathematics says operations commute or associate, do not coordinate
them; when it says they do not, fix their order explicitly.
*Example:* moving the two ends of a path acts by $w \mapsto a^{-1} w\, b$; left and right multiplication commute, so two
people carrying the two ends need no locking.

**Visualisation is a view.** Each mathematical object has a declared visual form computed from the model, and nothing
visual feeds back into the model.
*Example:* the developing map is shown as copies of cells seen through portals; a cone angle becomes visible as the
wedge missing (or in excess) when one looks around a corner.

**Conventions are labelled.** A choice made for convenience or robustness is recorded as a convention, distinct from what
the mathematics forces.
*Example:* every corner where cells meet is treated as a hole for homotopy, even flat ones; this is a convention chosen
so that homotopy survives deformation, not a mathematical necessity.

**Tests state theorems.** Where possible, a test is a mathematical statement checked on random instances.
*Example:* property tests check that a rigid motion composed with its inverse is the identity, that composition is
associative, that isometries preserve distances, and that crossing a portal and back returns the original pose.

**The correspondence is explicit and checked.** Each piece of code realising a mathematical concept says which concept it
realises, and a tool verifies that the references in both directions exist.
*Example:* a module header names "the exponential map, Model section 5"; `docs:check`, which already verifies
references from documents into code, would also verify the reverse.

## 3. Record of this test case

**Evidence**: mathematics settling engineering questions (from design 012, 2026-10-30).

- Gravity: decided by whether the holonomy fixes a direction (012, P16).
- Location of a carried object beyond a portal: the exponential map (012, P4).
- What survives a deformation: homotopy depends only on the gluing (012, P2).
- Two people carrying one geodesic: no coordination, because left and right multiplication commute; a proposed
  locking mechanism was removed (012, P5).
- A static visibility cull in 3D: line stabbing in Plucker coordinates (012, section 6).

**Tensions**: places where the code does not yet follow the mathematics (**Proposed**, 2026-10-30).

- Orientation is stored as a yaw angle (197 places): a representation shortcut with no mathematical counterpart, which
  breaks under face portals and reflections. Violates *intrinsic state* and *abstraction separate from
  representation*.
- The visibility funnel exploits the prism shape (a plan sector plus the newest portal's top and bottom edges) instead
  of a general notion of visibility. Violates *model before code*.
- Every corner is a hole: allowed by *conventions are labelled*, but it is a convention, not mathematics.

## 4. Refinement log

| Date | Change |
| --- | --- |
| 2026-10-30 | Thesis, tiers, seven candidate principles, evidence and tensions first recorded in design 012. |
| 2026-10-31 | Moved into this document; thesis stated in the maintainer's words; the repository's two roles agreed; "tests state theorems" and a guide added. |
| 2026-10-31 | Restructured at the maintainer's request: each principle stated generally, followed by a concrete example; project-specific facts moved into examples or the record (section 3). The guide is folded into the principles ("model before code", "ask the mathematics first"); "the correspondence is explicit and checked" becomes a principle. |
