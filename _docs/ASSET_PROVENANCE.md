# Third-party asset provenance and notices

This is the canonical asset manifest for NonEuclidean FPV. It covers every
third-party file presently under `public/assets`, which Vite copies into a
site build. The project [MIT License](../LICENSE) applies only to
project-authored source and documentation; it does **not** change the terms of
any item below.

## How to read this record

- **Runtime** means the current application requests the item. **Public only**
  means Vite currently deploys it even though the app does not request it.
- **Source-only** files are kept for authoring or rebuilding, not for browser
  loading. They remain accidentally public until
  [issue 34](../.agents/jobs/02_asset_footprint_and_provenance.md)
  completes the source/runtime split.
- The repository did not preserve original download dates, checksums, or an
  upstream version number. The sources and local license records below were
  reconciled on 2026-08-03. Do not claim a more exact version than the source
  page records.
- **Blocked** is a release gate, not a license. It means the asset must not be
  used in a new deployment or redistributed separately until
  [issue 40](../_issues/40_resolve_unverified_public_assets.md) resolves it.

When an asset moves, update its path in this file in the same change. Keep this
record and any required local license text with the asset; generated KTX2 files
remain derivatives of their listed source material.

## Runtime models and images with established provenance

All entries in this table are runtime-distributed unless stated otherwise. For
Creative Commons Attribution 3.0 material, retain the supplied credit and a
link to [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

| Path | Original work, creator, and source | License | Required attribution |
| --- | --- | --- | --- |
| `baloon/Balloon.glb` | [Balloon, Poly by Google](https://poly.pizza/m/d1gDDhM7pTf) | CC BY 3.0 | “Balloon by Poly by Google via Poly Pizza.” |
| `Bench/Bench.glb` | [Bench, Danni Bittman](https://poly.pizza/m/dfDUkVthkMT) | CC BY 3.0 | “Bench by Danni Bittman via Poly Pizza.” |
| `bicycle/Bicycle.glb` | [Bicycle, Poly by Google](https://poly.pizza/m/19VoUuA2pcN) | CC BY 3.0 | “Bicycle by Poly by Google via Poly Pizza.” |
| `butterfly/Butterfly.glb` | [Butterfly, Poly by Google](https://poly.pizza/m/2ZwYwkTVnfG) | CC BY 3.0 | “Butterfly by Poly by Google via Poly Pizza.” |
| `cactus/Cactus.glb` (public only) | [Cactus, SoyMaria](https://poly.pizza/m/7S5Snphkam) | CC BY 3.0 | “Cactus by SoyMaria via Poly Pizza.” |
| `flowerPot/flower_pot.glb` | [Flower Pot, Zsky](https://poly.pizza/m/XOT4ajEFjU) | CC BY 3.0 | “Flower Pot by Zsky via Poly Pizza.” |
| `lowpolyhands/Lowpolyhands.glb` | [Low poly hands, Anastasiia Ku](https://poly.pizza/m/cGaYRuiPCMe) | CC BY 3.0 | “Low poly hands by Anastasiia Ku via Poly Pizza.” |
| `mapMarker/MapMarker.glb` (public only) | [Map Marker, Chris Ross](https://poly.pizza/m/6ij4nru_NPh) | CC BY 3.0 | “Map Marker by Chris Ross via Poly Pizza.” |
| `mouse/Mouse.glb` | [Mouse, Poly by Google](https://poly.pizza/m/cWxdxmp7yaE) | CC BY 3.0 | “Mouse by Poly by Google via Poly Pizza.” |
| `questionblock/questionBlock.glb` | [?-Block, Studio Creality](https://poly.pizza/m/dIC3dNIL84K) | CC BY 3.0 | “?-Block by Studio Creality via Poly Pizza.” |
| `rover/rover.glb` | [Space rover, Poly by Google](https://poly.pizza/m/dhLVA8z7cGo) | CC BY 3.0 | “Space rover by Poly by Google via Poly Pizza.” |
| `simplesuitcase/SimpleSuitcase.glb` (public only) | [Simple Suitcase, Don Carson](https://poly.pizza/m/023W-XcCmir) | CC BY 3.0 | “Simple Suitcase by Don Carson via Poly Pizza.” |
| `small_house/small_house.glb` | [Small House, Jarlan Perez](https://poly.pizza/m/053kskrV4U_) | CC BY 3.0 | “Small House by Jarlan Perez via Poly Pizza.” |
| `stopsign/stop_sign.glb` (public only) | [Stop sign, Poly by Google](https://poly.pizza/m/60GyU9CdZ9r) | CC BY 3.0 | “Stop sign by Poly by Google via Poly Pizza.” |
| `streetlight/StreetLight.glb` (public only) | [Street Light, J-Toastie](https://poly.pizza/m/MRv3Lubm2V) | CC BY 3.0 | “Street Light by J-Toastie via Poly Pizza.” |
| `Tree1/Tree.glb` | [Tree, Poly by Google](https://poly.pizza/m/6pwiq7hSrHr) | CC BY 3.0 | “Tree by Poly by Google via Poly Pizza.” |
| `computerlarge/ComputerLarge.glb` | [Computer Large, Quaternius](https://poly.pizza/m/or4LLmesjq) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Credit not required; “Computer Large by Quaternius via Poly Pizza” is retained. |
| `FloweGroup/flower_group.glb` | [Flower Group, Quaternius](https://poly.pizza/m/hfPzQAedOe) | CC0 1.0 | Credit not required; “Flower Group by Quaternius via Poly Pizza” is retained. |
| `grass1/Grass.glb` | [Grass, Quaternius](https://poly.pizza/m/vUJjrRsFp4) | CC0 1.0 | Credit not required; “Grass by Quaternius via Poly Pizza” is retained. |
| `TreeSwirl/tree_swirl.glb` | [Tree Swirl, Quaternius](https://poly.pizza/m/czV0Ck0h2G) | CC0 1.0 | Credit not required; “Tree Swirl by Quaternius via Poly Pizza” is retained. |
| `trafficCone/Cone.glb` | [Traffic Cone, Quaternius](https://poly.pizza/m/aDIrUbMbW3) | CC0 1.0 | Credit not required; “Traffic Cone by Quaternius via Poly Pizza” is retained. |
| `WoodenSign1/WoodenSign1.glb`, `WoodenSign1/WoodenSign1.png`, `WoodenSign2/WoodenSign2.glb`, `WoodenSign2/Wooden Sign2.png`, `WoodenSign2/WoodenSign2.png` | [Wooden Sign, iPoly3D](https://poly.pizza/m/3MStJYAez7) | CC0 1.0 | Credit not required; “Wooden Sign by iPoly3D via Poly Pizza” is retained. |
| `flashlight/Flashlight.glb` | [Flashlight, Jarlan Perez](https://poly.pizza/m/1UrYBPWN1U_) | CC BY 3.0 | “Flashlight by Jarlan Perez via Poly Pizza.” |
| `flashlight/Lightsaber.glb`, `flashlight/Lightsaber.png` | [My First Lightsaber, Derek Elsby](https://poly.pizza/m/3KZ2s28Fohm) | CC BY 3.0 | “My First Lightsaber by Derek Elsby via Poly Pizza.” |
| `flashlight/Post.glb` (public only) | [Post, Quaternius](https://poly.pizza/m/jnuIFJsXZJ) | CC0 1.0 | Credit not required; “Post by Quaternius via Poly Pizza” is retained. |

The first four Quaternius and iPoly3D entries above correct earlier local
records that named a creator but omitted the page’s CC0 grant. The local
`license.txt` files remain with the files as convenient credit copies.

## Legacy Sketchfab models

These assets are currently public. The following are runtime-distributed by
some example worlds: `clock_low_poly`, `low_poly_campfire`, `low_poly_rocks`,
`low_poly_emergency_button`, and `racoon-animation`; the others are public
only. Each folder’s `license.txt` preserves the source’s required wording.

| Path | Original work, creator, and source | License | Required attribution |
| --- | --- | --- | --- |
| `_legacy/clock_low_poly/**` | [Clock (Low Poly), game_travel](https://sketchfab.com/3d-models/clock-low-poly-a8bf334c411b4acaa2dcfc827f28ebf6) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | “This work is based on ‘Clock (Low Poly)’ by game_travel, licensed under CC BY 4.0.” |
| `_legacy/house-low-poly/**` | [House - Lowpoly, rkmorello](https://sketchfab.com/3d-models/house-lowpoly-4b85ef1104fa4243ad46df0a87105aed) | CC BY 4.0 | “This work is based on ‘House - Lowpoly’ by rkmorello, licensed under CC BY 4.0.” |
| `_legacy/imp/**` | [Imp Character, Inuciian](https://sketchfab.com/3d-models/imp-character-e4dd9c9d9ad14976a4ce0d1f6049292e) | CC BY 4.0 | “This work is based on ‘Imp Character’ by Inuciian, licensed under CC BY 4.0.” |
| `_legacy/low_poly_campfire/**` | [Low Poly Campfire, Afloat Above the World](https://sketchfab.com/3d-models/low-poly-campfire-a1637e2556b44876b3d98bf203d4e9c4) | CC BY 4.0 | “This work is based on ‘Low Poly Campfire’ by Afloat Above the World, licensed under CC BY 4.0.” |
| `_legacy/low_poly_cat_walk/**` | [Low Poly Cat Walk, volkanongun](https://sketchfab.com/3d-models/low-poly-cat-walk-13674c3dbb074f73b6563a75c28b0fe0) | CC BY 4.0 | “This work is based on ‘Low Poly Cat Walk’ by volkanongun, licensed under CC BY 4.0.” |
| `_legacy/low_poly_emergency_button/**` | [Low Poly Emergency Button, ZeroCardinal](https://sketchfab.com/3d-models/low-poly-emergency-button-d4e61a2f1afb447aa381b912c9a68a90) | CC BY 4.0 | “This work is based on ‘Low Poly Emergency Button’ by ZeroCardinal, licensed under CC BY 4.0.” |
| `_legacy/low_poly_rabbit/**` | [Low poly rabbit, Tin3D](https://sketchfab.com/3d-models/low-poly-rabbit-284412021a4c42879b894271c0bcc634) | CC BY 4.0 | “This work is based on ‘Low poly rabbit’ by Tin3D, licensed under CC BY 4.0.” |
| `_legacy/low_poly_rocks/**` | [Low Poly Rocks, Michael Hooper](https://sketchfab.com/3d-models/low-poly-rocks-9823ec262054408dbe26f6ddb9c0406e) | CC BY 4.0 | “This work is based on ‘Low Poly Rocks’ by Michael Hooper, licensed under CC BY 4.0.” |
| `_legacy/low_poly_tree_wind/**` | [Low Poly Tree Wind, Anskar](https://sketchfab.com/3d-models/low-poly-tree-wind-82ad872d9b994af9a6b74a453c03e01f) | CC BY 4.0 | “This work is based on ‘Low Poly Tree Wind’ by Anskar, licensed under CC BY 4.0.” |
| `_legacy/racoon-animation/**` | [Low-poly Racoon Run Animation, avatrass](https://sketchfab.com/3d-models/low-poly-racoon-run-animation-ee040f4719fa4b449176f860921a7655) | CC BY 4.0 | “This work is based on ‘Low-poly Racoon Run Animation’ by avatrass, licensed under CC BY 4.0.” |

## Floor textures

`runtime/*.ktx2` is runtime-distributed. The rest of each texture folder is
source-only authoring material, although it is temporarily public because of
the issue 34 packaging defect. The KTX2 output is generated from the listed
color/diffuse map and inherits its source asset’s license.

| Paths | Source, creator | License | Attribution |
| --- | --- | --- | --- |
| `textures/forest_leaves_02_4k/**` | [Forest Leaves 02, Rob Tuytel / Poly Haven](https://polyhaven.com/a/forest_leaves_02) | CC0 1.0 | Not required; source retained. |
| `textures/ganges_river_pebbles_4k/**` | [Ganges River Pebbles, Amal Kumar / Poly Haven](https://polyhaven.com/a/ganges_river_pebbles) | CC0 1.0 | Not required; source retained. |
| `textures/gravelly_sand_4k/**` | [Gravelly Sand, Dario Barresi / Poly Haven](https://polyhaven.com/a/gravelly_sand) | CC0 1.0 | Not required; source retained. |
| `textures/red_mud_stones_4k/**` | [Red Mud Stones, Rob Tuytel / Poly Haven](https://polyhaven.com/a/red_mud_stones) | CC0 1.0 | Not required; source retained. |
| `textures/snow_02_4k/**` | [Snow 02, Poly Haven](https://polyhaven.com/a/snow_02) | CC0 1.0 | Not required; source retained. |
| `textures/Fabric022_4K-JPG/**` | [Fabric 022, ambientCG](https://ambientcg.com/view?id=Fabric022) | CC0 1.0 | Not required; source retained. |
| `textures/Metal048C_4K-JPG/**` | [Metal 048 C, ambientCG](https://ambientcg.com/view?id=Metal048C) | CC0 1.0 | Not required; source retained. |
| `textures/PavingStones114_4K-JPG/**` | [Paving Stones 114, ambientCG](https://ambientcg.com/view?id=PavingStones114) | CC0 1.0 | Not required; source retained. |
| `textures/PavingStones138_4K-JPG/**` | [Paving Stones 138, ambientCG](https://ambientcg.com/view?id=PavingStones138) | CC0 1.0 | Not required; source retained. |
| `textures/Tiles118_4K-JPG/**` | [Tiles 118, ambientCG](https://ambientcg.com/view?id=Tiles118) | CC0 1.0 | Not required; source retained. |
| `textures/Tiles132A_4K-JPG/**` | [Tiles 132 A, ambientCG](https://ambientcg.com/view?id=Tiles132A) | CC0 1.0 | Not required; source retained. |
| `textures/WoodFloor064_4K-JPG/**` | [Wood Floor 064, ambientCG](https://ambientcg.com/view?id=WoodFloor064) | CC0 1.0 | Not required; source retained. |

## Icons and transcoder

| Paths | Source and license | Attribution / status |
| --- | --- | --- |
| `icons/arrow-circle.png`, `icons/arrow-circle-inverted.png` | [Rotate icon, ChilliColor / Flaticon](https://www.flaticon.com/free-icons/rotate), Flaticon free-use terms with attribution | Credit ChilliColor and Flaticon. The inverted file is a project-made derivative. |
| `icons/aim.png`, `icons/aim-inverted.png` | [Aim icon, Creative Stall Premium / Flaticon](https://www.flaticon.com/free-icons/aim), Flaticon free-use terms with attribution | Credit Creative Stall Premium and Flaticon. The inverted file is a project-made derivative. |
| `icons/add.png` | [Plus icon, dmitri13 / Flaticon](https://www.flaticon.com/free-icons/plus), Flaticon free-use terms with attribution | Credit dmitri13 and Flaticon. |
| `icons/lock.png` | [Privacy icon, meaicon / Flaticon](https://www.flaticon.com/free-icons/privacy), Flaticon free-use terms with attribution | Credit meaicon and Flaticon. |
| `icons/protractor.png` | [Protractor icon, Freepik / Flaticon](https://www.flaticon.com/free-icons/protractor), Flaticon free-use terms with attribution | Credit Freepik and Flaticon. |
| `icons/unlink.png`, `icons/unlink-inverted.png` | [Unlink icon, Maniprasanth / Flaticon](https://www.flaticon.com/free-icons/unlink), Flaticon free-use terms with attribution | Credit Maniprasanth and Flaticon. The inverted file is a project-made derivative. |
| `icons/arrowkeys.svg` | [Circle Up, Font Awesome Free 6.5.1 / Fonticons, Inc.](https://fontawesome.com/icons/circle-up?f=classic&s=solid); [matching free icons](https://fontawesome.com/search?o=r&m=free) | CC BY 4.0 | “Font Awesome Free 6.5.1 by Fonticons, Inc.” The left, right, and down arrows are rotations of the supplied up-arrow glyph. |
| `icons/ruler.svg` | [Ruler, Phosphor Icons](https://github.com/phosphor-icons/core/blob/main/assets/regular/ruler.svg); [matching icons](https://phosphoricons.com/?q=ruler) | MIT | “Copyright 2023 Phosphor Icons.” |
| `icons/ruler-inverted.svg` | Same as `icons/ruler.svg`, with strokes recolored white for dark backgrounds | MIT | “Copyright 2023 Phosphor Icons.” |
| `icons/trash.svg` | [Trash 2, Feather Icons](https://github.com/feathericons/feather/blob/main/icons/trash-2.svg); [matching icons](https://feathericons.com) | MIT | “Copyright 2013-2023 Cole Bemis.” |
| `icons/mouse-button-left.svg`, `icons/mouse-button-right.svg` | [Iconoir](https://iconoir.com); [MIT license](https://github.com/iconoir-icons/iconoir/blob/main/LICENSE) | MIT | “Copyright 2021 Luca Burgio.” |
| `icons/a-alphabet.svg` through `icons/z-alphabet.svg` | [UXWing Alphabet icons](https://uxwing.com/wp-content/themes/uxwing/download/education-school/q-alphabet-icon.svg) | [UXWing license](https://uxwing.com/license/) | Attribution is not required; this project voluntarily credits UXWing. The files are used only as application assets, not offered as a separate icon collection, and are not relicensed. |
| `icons/carry.svg`, `icons/carry-inverted.svg` | [Reply Map Location Black, UXWing](https://uxwing.com/wp-content/themes/uxwing/download/location-travel-map/reply-map-location-black-icon.svg) | [UXWing license](https://uxwing.com/license/) | Attribution is not required; this project voluntarily credits UXWing. `carry-inverted.svg` is a white-color project-made derivative. Both files are application assets only, not offered as a separate icon collection, and are not relicensed. |
| `ktx2/basis_transcoder.js`, `ktx2/basis_transcoder.wasm` | [Basis Universal](https://github.com/BinomialLLC/basis_universal), copied from Three.js r164’s `examples/jsm/libs/basis` | Apache-2.0; the required license copy is at [`public/assets/ktx2/LICENSE.txt`](../public/assets/ktx2/LICENSE.txt). |

## Blocked, unverified, or incorrect historical records

Do **not** infer a license from a filename, a host site, or a nearby asset. The
following files have no sufficient provenance in this repository. They are
listed here to make the problem visible and are governed by issue 40. They must
be removed from a release, replaced with documented material, or have their
original acquisition record verified before reuse.

| Paths | Problem | Current distribution |
| --- | --- | --- |
| `_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg`, `_legacy/car.gltf`, `_legacy/scene.bin`, `_legacy/photo-wall-texture-pattern.jpg`, `_legacy/skybox-1.png`, `_legacy/skybox-2.jpg`, `_legacy/skybox-3.jpg`, `_legacy/skybox-4.jpg`, `_legacy/skybox-5.jpg`, `_legacy/skybox-6.jpg`, `_legacy/Ground037_1K-JPG.zip`, `_legacy/Ground037_1K-JPG/**` | No reliable origin/license record. The abstract image is currently requested for portal walls. | Public; portal-wall use is blocked and must be replaced or verified. |

## Adding an asset

Before committing an asset, record its exact path, original work title,
creator, source URL, license URL/version, required credit, acquisition/version
information, and whether it is source-only or runtime-distributed. Keep
required license and notice text with redistributable binaries. Do not add a
file to `public/` until this record is complete.

For icon discovery, [SVG Repo’s ruler collection](https://www.svgrepo.com/vectors/ruler/)
is another useful source of SVG candidates. It hosts icons from multiple
creators and licenses, so record the individual icon page and its actual terms;
do not treat the collection page as a single license grant.

For low-poly 3D models, [Poly Pizza](https://poly.pizza/) is another useful
source. Record the individual model page, creator, license version, and any
required credit; models on the site do not all share one attribution rule.

[UXWing](https://uxwing.com/) is another good SVG icon source. Its license does
not require credit for allowed use, but record the exact icon URL and its
terms. Do not copy UXWing files into a separately redistributable icon library,
because its terms prohibit redistribution and sublicensing.
