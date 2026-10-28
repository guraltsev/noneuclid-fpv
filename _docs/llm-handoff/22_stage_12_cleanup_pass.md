# 22 - Stage 12: Cleanup and documentation pass

## Goal

After the first functional implementation exists, perform a user-initiated cleanup pass focused on readability, organization, naming, and public documentation.

Do not do this prematurely.

## Entry conditions

Only begin this stage after:

- prism-cell worlds compile,
- desktop movement works,
- portal crossing works,
- straight rays work,
- basic rendering works,
- the main tests pass.

## Cleanup priorities

Work in this order:

1. Rename unclear files and symbols.
2. Split oversized files by real concepts.
3. Remove dead code and temporary scaffolding.
4. Move renderer glue out of domain modules if it leaked in.
5. Add public JSDoc to stable APIs.
6. Add block comments before dense logic.
7. Simplify tests that accidentally locked implementation details.
8. Update docs and decision notes.

## What counts as too large

A file is not bad merely because it is long.

Split a file when it mixes concepts that readers need to reason about separately.

Good split reasons:

- movement and ray tracing live in one file,
- compiler validation and renderer mesh building live in one file,
- authoring parsing and runtime compilation live in one file,
- one file has several public contracts with different audiences.

Bad split reasons:

- arbitrary line count,
- desire to look enterprise,
- creating one helper per tiny operation.

## Documentation pass

Public docs should explain:

- what the module provides,
- what inputs it accepts,
- what outputs it guarantees,
- important limitations,
- intentional errors.

Do not document source order.

Do not use docs to compensate for confusing code. Fix the code first when possible.

## Test cleanup

Review tests for implementation lock-in.

Replace tests that assert private details with tests that assert public behavior.

Do not weaken important behavior tests.

## Exit criteria

A new LLM session and the human developer can read the project map, inspect the main contracts, and safely change one behavior without first understanding the entire renderer.

## Do not do in this stage

Do not add major new features.

Do not rewrite working systems without behavior tests.

Do not introduce architecture frameworks.
