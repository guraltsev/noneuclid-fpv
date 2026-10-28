# 009 - Asset System

This document describes the intended asset and object authoring model. It is a design document only; it does not require the current implementation to already match every shape below.

The asset system should make authored worlds pleasant to read while keeping the runtime contracts explicit and testable. World authors should use named constructors such as `floorTexture(...)`, `house(...)`, `geo_mouse(...)`, and `geo_butterfly(...)`. The engine may implement those constructors through registries, manifests, and normalized specs, but the script-facing surface should stay direct and readable.

## Goals

- Let world scripts import assets by friendly names.
- Keep floor materials, object assets, and behavior objects discoverable in one system.
- Prefer GLB or GLTF models for 3D objects.
- Let every floor texture carry a default fallback color.
- Let every placeable object use the same orientation vocabulary: `forwardTilt`, `sideTilt`, and `turn`, in degrees.
- Allow simple behavior objects now without locking the long-term object-logic design too early.
- Keep runtime specs serializable and independent of JavaScript object instances.

## Non-goals

- Do not turn world scripts into low-level asset manifests.
- Do not expose raw Three.js objects or loaders in world scripts.
- Do not require authors to know radians, yaw, pitch, roll, material graph details, or texture loader behavior.
- Do not design the final general-purpose object logic system yet.
- Do not make OBJ the normal runtime asset format.

## Asset formats

Use GLB or GLTF for world models.

GLB is preferred when a model can be packaged as one file. GLTF with external textures is acceptable when source assets or tools produce that shape naturally. Both formats are well supported by Three.js and can represent scene hierarchy, materials, textures, skinning, and animation.

OBJ should be treated as an import or interchange format, not as the normal runtime asset format. OBJ is acceptable as a temporary source file, but assets should normally be converted to GLB or GLTF before being added to the main asset catalog.

Recommended source/runtime split:

```text
source files:
  .blend, .obj, .fbx, texture authoring files

runtime files:
  .glb or .gltf
  KTX2 color textures for tiled floors
  small manifest metadata
```

## Public layout

The exact directory layout may evolve, but new assets should move toward a deliberate structure under `public/assets` instead of the older `_legacy` bundle.

Possible layout:

```text
public/assets/
  models/
    small_house/
      small_house.glb
      license.txt
    mouse/
      mouse.glb
      license.txt
    butterfly/
      butterfly.glb
      license.txt
  textures/
    forest_leaves_02_4k/
      source/
        ...
      runtime/
        forest_leaves_02_color.ktx2
      license.txt
  manifest.json
```

The manifest should be optional at first if TypeScript definitions are easier, but the design should allow a manifest later.

## Named floor textures

World scripts should create floor materials with `floorTexture(...)`.

Named texture:

```js
grass = floorTexture("grass1");

PolygonFace("front", grass, square);
```

Named texture with author overrides:

```js
large_grass = floorTexture("grass1", {
  tileSize: 4,
});
```

Pure color:

```js
red = floorTexture({ color: "#d95f5f" });

PolygonFace("front", red, square);
```

JavaScript does not have Python-style named arguments, so use object parameters rather than syntax such as `floorTexture(color="red")`.

## Floor texture defaults

Every named floor texture must encode a default `floorColor`.

That color is not a decoration afterthought. It is part of the floor texture definition and should be available even when the texture itself is not loaded.

Uses for `floorColor`:

- fallback color if image texture loading fails,
- debug renderer color,
- minimap or non-Three renderer color,
- readable low-quality mode color,
- initial material color before texture upload completes.

Example definition:

```ts
interface FloorTextureDefinition {
  readonly name: string;
  readonly colorTexturePath: string;
  readonly floorColor: string;
  readonly defaultTileSizeMeters: number;
  readonly normalTexturePath?: string;
  readonly roughnessTexturePath?: string;
}
```

For the current runtime contract, default floor materials should point only to
`colorTexturePath`. Optional normal, bump, and roughness fields may remain in
the types for future experiments, but the stock texture library should not
preload them.

Example normalized spec:

```ts
type FloorMaterialSpec =
  | {
      readonly kind: "floor-color";
      readonly floorColor: string;
    }
  | {
      readonly kind: "floor-texture";
      readonly name: string;
      readonly colorTexturePath: string;
      readonly floorColor: string;
      readonly tileSizeMeters: number;
      readonly normalTexturePath?: string;
      readonly roughnessTexturePath?: string;
    };
```

## PolygonFace material argument

The long-term `PolygonFace` shape should accept a floor material object rather than only a color string.

Preferred:

```js
PolygonFace("front", floorTexture("grass1"), square);
```

Still acceptable as transition sugar:

```js
PolygonFace("front", "#d95f5f", square);
```

If color strings remain supported, the builder should normalize them as if the author had written:

```js
PolygonFace("front", floorTexture({ color: "#d95f5f" }), square);
```

## Object constructors

World authors should place objects through named constructors, not generic string dispatch.

Preferred:

```js
front_house = house("front-house", {
  position: [-1.2, 0, 0.6],
  scale: 3,
  turn: 12,
});

OnFace("front", [front_house]);
```

Avoid as the primary authoring style:

```js
place("house", "front-house", {
  position: [-1.2, 0, 0.6],
});
```

A registry may generate the named constructors internally, but the world script should read like direct object placement.

## Shared placement vocabulary

Every placeable object should accept the same base placement fields.

```ts
interface PlaceableObjectParams {
  readonly position: readonly [x: number, z: number, y: number];
  readonly scale?: number;
  readonly forwardTilt?: number;
  readonly sideTilt?: number;
  readonly turn?: number;
}
```

The orientation fields are degrees.

- `forwardTilt`: tip the object forward or backward.
- `sideTilt`: lean the object left or right.
- `turn`: rotate the object around the vertical floor axis.

Apply orientation in this authoring order:

```text
forwardTilt
then sideTilt
then turn
```

The runtime may normalize these to radians and matrices. Authors should not need to see `yawRadians` for placed objects.

## Static object assets

Static objects should be registered by friendly constructor name.

Example:

```js
small = small_house("small-house-1", {
  position: [0, 0, 0],
  scale: 2,
  turn: 45,
});
```

Definition shape:

```ts
interface StaticObjectDefinition {
  readonly constructorName: string;
  readonly modelPath: string;
  readonly defaultScale?: number;
  readonly defaultForwardTilt?: number;
  readonly defaultSideTilt?: number;
  readonly defaultTurn?: number;
}
```

Normalized static object specs should include enough data for the renderer to load the model and apply placement without needing the original constructor function.

## Behavior objects

Objects with logic will be implemented eventually, but the design is intentionally open for those for now.

The system should eventually support behavior objects that own:

- assets,
- placement defaults,
- collision defaults,
- animation defaults,
- update logic,
- portal traversal behavior,
- serialization rules,
- testable runtime contracts.

Do not finalize the general behavior object framework yet. The first implementation should only prove that named authoring constructors can create simple moving specs and that the runtime can update them through the existing dynamic-object movement pipeline.

## Initial behavior objects

Only two trivial behavior objects are planned for now:

- `geo_mouse`
- `geo_butterfly`

These replace the current marmot concept in authored examples. Both move at constant speed and may oscillate side to side.

Common params:

```ts
interface SimpleGeoCreatureParams extends PlaceableObjectParams {
  readonly speed?: number;
  readonly oscillationRate?: number;
  readonly oscillationMagnitude?: number;
}
```

Meanings:

- `speed`: forward speed in meters per second.
- `oscillationRate`: side-to-side oscillations per second.
- `oscillationMagnitude`: side-to-side motion magnitude in meters.
- `turn`: starting heading in degrees.
- `forwardTilt` and `sideTilt`: formally allowed, usually omitted.

Example:

```js
front_mouse = geo_mouse("front-mouse", {
  position: [-4.2, 0, -1.8],
  scale: 1,
  turn: 74,
  speed: 1.2,
  oscillationRate: 2,
  oscillationMagnitude: 0.15,
});

front_butterfly = geo_butterfly("front-butterfly", {
  position: [2, 1.4, -0.5],
  scale: 0.8,
  turn: -30,
  speed: 0.7,
  oscillationRate: 1.5,
  oscillationMagnitude: 0.25,
});
```

Default values should be gentle:

```text
speed: object-specific, nonzero
oscillationRate: 0
oscillationMagnitude: 0
turn: 0
```

If either oscillation value is zero, side-to-side oscillation is disabled.

## Oscillation semantics

Oscillation is side-to-side relative to the object's current heading. It should not change the object's long-term forward heading unless a future behavior explicitly asks for that.

Conceptually:

```text
forward displacement = heading * speed * deltaSeconds
side displacement = rightVector * f(time, oscillationRate, oscillationMagnitude)
```

The exact integration method can be chosen during implementation. The important authoring contract is that `oscillationRate` is measured in cycles per second and `oscillationMagnitude` is measured in meters.

## Asset preloading

Preloading should collect all referenced assets from the normalized world spec.

The preload pass should include:

- floor texture color maps,
- object GLB/GLTF models,
- behavior object visual models,
- shared renderer textures such as portal-wall textures.

The default runtime preload pass should not include EXR normals,
displacement/bump maps, or roughness maps for stock floor textures.

## Texture Re-encoding Guidance

When a new repeated floor texture is added, the default path should be:

- keep the source image in the source/textures area,
- generate a runtime `.ktx2` color map,
- keep the authored fallback `floorColor`,
- verify the result in motion, not only in still inspection.

Recommended first-pass encoding policy:

- use KTX2 Basis ETC1S first,
- keep sRGB metadata for color textures,
- include mipmaps,
- keep the runtime material color-only by default.

Promote an individual texture to UASTC when ETC1S causes visible artifacts on
large tiled floors, especially during motion or in VR. Do not switch the whole
library to UASTC without a specific visible reason.

The preload pass should not need to execute world-script constructors again. It should read normalized specs.

## Validation

The authoring layer should reject:

- unknown floor texture names,
- malformed floor colors,
- missing required model paths,
- malformed positions,
- non-finite scale values,
- non-finite orientation fields,
- negative speed values,
- negative oscillation rates,
- negative oscillation magnitudes,
- duplicate object ids within a world.

Errors should name the author-facing constructor when possible.

Example:

```text
geo_mouse("front-mouse", ...) has negative speed -1.
```

## Runtime contracts

The runtime should not depend on constructor functions or mutable registry state once a world has been compiled.

Runtime-facing specs should answer:

- what assets must be loaded,
- where the object begins,
- what static visual transform to apply,
- what behavior kind, if any, updates the object,
- what collision shape, if any, it owns.

The registry can be used to create specs from world scripts. Compiled worlds should be ordinary data.

## Open questions

- Should floor textures support wall or ceiling use later, or should those become separate material types?
- Should `tileSize` be one scalar or separate x/y tiling?
- Should behavior object specs store current phase for deterministic replay?
- Should `geo_butterfly` eventually have vertical bobbing separate from side-to-side oscillation?
- Should object constructors use singular names only, or should aliases be allowed for classroom readability?
