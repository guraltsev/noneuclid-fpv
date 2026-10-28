# 01 - Project brief

## Purpose

Build a private VR/FPS-style exploration environment for discrete non-Euclidean geometry models.

The experience should let middle-school students move through glued-cell worlds, shoot straight rays, leave markers, trace paths, compare measurements, and notice mathematical patterns with limited instructor guidance.

The software provides the environment. It does not teach theorems directly.

## Target audience

The primary student audience is a group of middle-school children using desktop computers and VR headsets during a one-week math course.

The primary developer audience is a professional mathematician who is a lower-intermediate programmer and uses LLM-assisted programming extensively.

## Developer experience goal

The code must remain inspectable. A mathematician should be able to read the important files, understand the public contracts, and modify worlds/tools without navigating enterprise architecture.

The project should tolerate a first implementation pass followed by a second, user-initiated cleanup pass. Do not demand perfect organization before the behavior exists.

## Correct teaching stance

The application is a playground, not a tutor.

It should provide:

- walkable glued cells,
- stable portals,
- collision rules,
- locally straight ray shooting,
- markers,
- path tracing,
- length and angle measurement tools when requested,
- reset/save/load support,
- teacher-authored worlds,
- simple debug views.

It should not initially provide:

- automatic theorem explanations,
- curvature computation,
- Gauss-Bonnet computation,
- holonomy computation,
- Euler characteristic computation,
- global point-to-point geodesic solving,
- adaptive lesson logic.

The instructor and the course materials are responsible for interpretation. The software is responsible for a coherent world and reliable tools.

## First core world

The first implemented worlds are 3D rooms made from prism cells. Each prism is a tall extrusion of a 2D polygon. Students walk inside the prism. Some vertical walls are portals. Floors and ceilings are ordinary barriers.

This gives a true 3D embodied experience while keeping the first implementation simpler than arbitrary 3D polyhedral cell complexes.

## Important non-goals

Do not optimize for publication.

Do not add:

- accounts,
- analytics,
- cloud databases,
- CMS tooling,
- login screens,
- public web-app architecture,
- multiplayer infrastructure during the first implementation,
- a plugin framework,
- a general theorem engine.

Do not chase visual fidelity. Use enough low-poly decoration and lighting to make the world friendly and legible.

## Important future directions

The scaffolding should leave room for:

- multiplayer exploration,
- richer cell types,
- user-authored glueings,
- a visual authoring app,
- QR-code marker workflows for face and edge glueings,
- point-to-point geodesic algorithms,
- more general tilings,
- cubes, tetrahedra, and arbitrary convex polyhedra.

Do not implement those future directions until a current stage explicitly asks for them.

## Closing note

Closed as a one-off bootstrap/design issue.

The project brief has been translated into the initial implementation posture:
the repository is now a private, inspectable Vite/TypeScript exploration app
scaffold rather than only a handoff packet. The code keeps the theorem-engine
non-goal visible by separating domain modules from rendering and by adding the
explicit no-curvature decision note.

## Evidence for closing

- `README.md` now describes the implementation scaffold and useful local
  commands.
- `src/main.ts` selects a starter prism world, compiles it, creates app state,
  and starts the Three.js app without embedding compiler, collision, ray, or
  theorem logic.
- `docs/design/003-no-curvature-engine.md` records the decision not to build
  curvature, Gauss-Bonnet, holonomy, Euler characteristic, or point-to-point
  geodesic machinery in the first runtime.
- `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` passed after
  the scaffold was added.
