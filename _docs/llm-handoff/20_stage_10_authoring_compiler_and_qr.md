# 20 - Stage 10: Authoring compiler and QR future

## Goal

Add optional authoring inputs beyond TypeScript, without changing the runtime model.

This is a later stage, likely next year.

## Correct architecture

All authoring inputs must compile to the same checked runtime path:

```text
authoring input
  -> authoring validation
  -> CellComplexSpec or JSON-compatible intermediate
  -> compileCellComplex(...)
  -> CompiledCellComplex
```

Do not let the VR runtime contain separate logic for QR-authored worlds.

## JSON authoring

Before QR, add JSON import/export if needed.

Files:

```text
src/authoring/jsonWorldSpec.ts
src/authoring/validateJsonWorldSpec.ts
src/authoring/loadWorldSpecFromFile.ts
tests/authoring/jsonWorldSpec.test.ts
```

Validation should catch:

- duplicate ids,
- missing cells,
- malformed face refs,
- invalid orientation strings,
- impossible prism dimensions,
- unsupported cell kinds.

## QR marker authoring app

The QR authoring app should be separate from the VR exploration app.

Possible separate folder later:

```text
authoring-app/
  index.html
  src/
    scanQr.ts
    buildGlueingDraft.ts
    exportWorldJson.ts
```

Do not add this folder until the runtime and JSON import are stable.

## QR code payloads

A QR payload should identify an authoring element, not encode arbitrary executable behavior.

Example payload shape:

```json
{
  "format": "flattened-cube-edge-marker-v1",
  "worldDraft": "draft-2027-a",
  "cell": "cell-03",
  "face": "north",
  "edgeOrder": "left-to-right"
}
```

The exact payload can change later. The important rule is that scanning produces a glueing proposal, then validation decides whether it is legal.

## QR workflow

Possible classroom or teacher workflow:

1. Teacher prints cards or labels for cells/faces/edges.
2. Teacher scans two edge markers that should be glued.
3. App asks for orientation if not determined by marker direction.
4. App stores a portal draft.
5. App validates the draft.
6. App exports JSON.
7. VR app loads JSON and compiles it normally.

## Tests to write

Required later tests:

- valid JSON world imports,
- invalid JSON world gives human-readable errors,
- QR payload parser rejects unknown format version,
- QR glueing draft produces expected portal spec,
- invalid QR glueing cannot bypass compiler validation.

## Exit criteria

A non-programmer-friendly authoring input can create worlds without changing movement, rendering, or tool code.

## Do not do in this stage

Do not use QR scanning as part of student exploration runtime unless explicitly requested.

Do not allow QR payloads to run code.

Do not bypass the compiler.
