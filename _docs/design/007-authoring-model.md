> **Note:** this is an early design record; the spec shapes shown here (`start`, `sideFaces`) differ from the current
> `CellComplexSpec`. The current model is in [../MATHEMATICAL_MODEL.md](../MATHEMATICAL_MODEL.md) and the generated API reference.

# 007 - Authoring Model

## Current authoring format

Use TypeScript world specs first.

Do not start with JSON schema, visual editors, QR scanning, or a custom DSL. The first goal is to stabilize the runtime contract. Those other formats are later authoring inputs, not the initial source of truth.

World specs should be ordinary TypeScript values:

```ts
export const twoPrismLoop: CellComplexSpec = {
  id: "two-prism-loop",
  title: "Two Prism Loop",
  start: {
    cell: "room-a",
    position: [0, 0, 1.45],
    yawDegrees: 0,
  },
  cells: [
    {
      kind: "prism",
      id: "room-a",
      base: squareBase(4),
      height: 3,
      sideFaces: [
        { side: 0, kind: "portal", portal: "a-north" },
        { side: 1, kind: "wall" },
        { side: 2, kind: "wall" },
        { side: 3, kind: "wall" }
      ],
      decorations: []
    }
  ],
  portals: [
    {
      id: "a-north",
      from: { cell: "room-a", side: 0 },
      to: { cell: "room-b", side: 2 },
      orientation: { turnDegrees: 0 }
    }
  ]
};
```

This example is illustrative, not a final API. The exact spec shape should stabilize during the compiler work.

## Authoring priorities

A world author should be able to read one file and understand:

- what cells exist,
- what shape each cell is,
- which side faces are walls,
- which side faces are portals,
- how portals connect,
- where the player starts,
- which tools are enabled,
- what decorations are present.

Avoid hidden defaults for mathematically meaningful choices. Defaults are acceptable for visual style, lighting, and decoration scale.

## Portal authoring

In the first implementation, portal authoring should avoid arbitrary matrices. For a prism base with `n` vertices, side `i` means the side from vertex `i` to vertex `(i + 1) mod n`. Authoring should use side indexes `0` through `n - 1`, not unordered vertex pairs such as `(i, j)`.

Prefer restricted descriptions:

```ts
orientation: { turnDegrees: 0 | 90 | 180 | 270 | -90 }
```

or a named frame match:

```ts
match: "same-up" | "half-turn" | "quarter-turn-left" | "quarter-turn-right"
```

The compiler should compute the rigid transform and reject impossible glueings.

An expert matrix escape hatch can be added later, but it should not be the normal path.

## Future compiler step

Later authoring inputs should compile into the same checked `CellComplexSpec` or a closely related JSON-compatible intermediate format.

Future pipeline:

```text
TypeScript spec
       or
JSON spec
       or
visual authoring app output
       or
QR marker scan output
  -> authoring validation
  -> CellComplexSpec
  -> compileCellComplex(...)
  -> CompiledCellComplex
```

The runtime must not care which authoring input produced the spec.

## Future QR marker authoring

The QR idea should be a separate authoring app, not part of the VR runtime.

Possible workflow:

1. Print face cards or side cards with QR codes.
2. Each QR code encodes a world id, face id, side index, and orientation marker.
3. The authoring app scans two compatible side markers.
4. The app records a portal glueing proposal.
5. The app exports JSON.
6. The regular authoring validator checks the JSON.
7. The regular cell-complex compiler builds the runtime world.

A QR code should identify an authoring object. It should not contain arbitrary executable logic.

## What not to do now

Do not implement the QR app in the first implementation.

Do not add camera permissions to the VR app for QR scanning.

Do not create a full visual editor before the runtime works.

Do not support arbitrary malformed glueings in the name of flexibility. The compiler should reject unclear data loudly.
