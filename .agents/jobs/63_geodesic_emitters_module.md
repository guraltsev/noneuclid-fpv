# Job 63 - Create the geodesic emitters module: renames, place, shoot, extend, delete

Status: queued.
Resolves: nothing fully; with job 64, the emitter part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md).

## Goal

Emitters are a module. Everything a person does to create or remove an emitter or its geodesics is a command, so a script can do it too.

## Depends on

Jobs 61 and 62.

## Before you start

- Read 013 sections 5.3, 5.7, 8, 9, 10, 12.2, 13.1 and 16, and job 54's Report. Read `src/render/three/geodesicCannonTools.ts`,
  `src/world-objects/geodesic/cannon.ts` and `src/modules/carry/module.ts`.

## Background

`geodesicCannonTools.ts` writes the registry directly: place, shoot, extend, add, delete. Emitter ids and arc ids come from
`engine.ids`, which exists only for such legacy writers. The string `"geodesic-cannon"` appears about 210 times in 73 files.

## Decisions

- **First commit, names only:** kind `geodesicEmitters/emitter`; `GeodesicCannonObject` becomes `GeodesicEmitterObject`, with its constructors
  and guards; tool ids `geodesicEmitters/<noun>`; the id families `geodesicEmitters/emitter:<n>` and `geodesicModel/arc:<n>`. No alias.
  The word "locked" goes from the identifiers it is left in (`rebuildLocked`, `lockedGeodesicIds`, `removeUnlockedGeodesicsFromCannon`).
- `src/modules/geodesicEmitters/`: `api.ts`, `index.ts`, `module.ts`, `client.ts`, with the world part over `world-objects/geodesic`, which stays
  in place. It requires `geodesicModelToken`. Add it to `onlyVia`'s exceptions in 12.2 only for `cannon.ts` and `carryEnd.ts`; other reads
  go through the model's `queries` (`connectsEmitters`, `isTied`).
- Commands, all with `requiresTool` for the tool that issues them:
  `geodesicEmitters/place { cellId, point, yawRadians }`, `geodesicEmitters/shoot { emitterId, yawRadians, lengthMeters }`,
  `geodesicEmitters/extend { arcId, lengthMeters }`, `geodesicEmitters/deleteGeodesic { emitterId, arcId }`, `geodesicEmitters/remove { emitterId }`.
  Commands carry cell-local data, never rays: the client resolves its aim first (`AimPick.cellId`, `point`).
- Results carry the new ids. Refusals have stable codes: `geodesicEmitters/notAnEmitter`, `/notAttached`, `/blocked`, `/tooShort`.
- The client part holds the tool descriptors; the tools act only through `ToolContext.submit` and read through `ToolContext.read`.
  The core tool `base` stops marking carry, rotate and aim as `main-tool`, and the palette reads `entry.kind` for the main list.
- Hand-written follow-ups after these writes are deleted: `removeProtractorAnglesFor*`, `removeMeasuredGeodesicLengthsForGeodesic` and
  `requestSelectableHitboxDebugSync` go where the derive ticks already do the work. Verify each: an audit called them redundant, not proven.
- `rebuiltGeodesicIds` on carry events and in `worldGeometryComputedObjects` has no production reader: delete it.

## Steps

1. The rename commit. Done when `grep -rn '"geodesic-cannon"' src tests` is empty.
2. The module and commands, moved from the tools, with a contract test: each command's success and each refusal; a refusal changes nothing
   (registry version unchanged).
3. The tools through `ToolContext`. `legacyWorldWriters` shrinks.
4. `_docs/MATHEMATICAL_MODEL.md` where it names the emitter.

## Tests and checks

The existing emitter and shooting tests keep their assertions on geometry. Smoke, release, bench counters.

## Do not

Do not change rotate, aim or carry here (job 64). Do not add `publicApi` (job 65).

## Done when

`geodesicCannonTools.ts` no longer writes for place, shoot, extend or delete, and `grep -n "engine.ids" src/render` shows none of those.
