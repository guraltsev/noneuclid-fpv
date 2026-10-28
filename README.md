# NonEuclidean FPV

**NonEuclidean FPV** is a mathematical exploration world. You walk in first person through a 3D world made from rooms that are joined in surprising ways. The goal is to notice, test, and describe ideas from geometry.

It is designed for curious learners aged 12 and up, and for teachers who want an exploratory setting for discussing shapes, distance, paths, and what it means for a route to be straight.

## What can you explore?

Imagine making a room out of a polygonal floor and vertical walls. Some walls are **portals**: walking through one carries you to another room. The rooms fit together to model a larger space.

The program gives you a world and
tools so that you can make observations, compare ideas with other people, and
build an explanation.

## Start an activity

These two short activities open in a browser. They are examples of a particular
classroom deployment; the project itself is called **NonEuclidean FPV** and is
not tied to one school year or deployment name.

- [Activity 1: cube-world exploration](https://guraltsev.github.io/camp-2026-VR/?config=001)
- [Activity 2: tetrahedron-world exploration](https://guraltsev.github.io/camp-2026-VR/?config=002)
- [Activity 3: flat torus](https://guraltsev.github.io/camp-2026-VR/?config=003)
- [Activity 4: genus-2 torus](https://guraltsev.github.io/camp-2026-VR/?config=004)
- [Activity 5: torus moduli](https://guraltsev.github.io/camp-2026-VR/?config=005)

### Unrestricted mode (teachers and developers)

The activity links above are locked down. This link opens every menu and tool,
including world selection and the debug menu:

- [Unrestricted: all worlds, tools, and debug menu](https://guraltsev.github.io/camp-2026-VR/?config=full)

Debug features start switched off. For verbose logging and the on-screen
overlay, add `&debugLevel=verbose&debugOverlay=1`; use `&world=<id>` to pick a
world. This mode is not password-protected.

Local testing: run `npm install`, then `npm run dev`, and open the printed
address with the same `?config=...` parameters.

Use a recent desktop browser for the most dependable experience. A headset can
be used when the deployment offers WebXR and is served securely. Moving,
looking around, and the on-screen help are intended to be enough to begin;
work with a teacher or partner when a new tool is introduced.

## A good way to investigate

1. **Make a prediction.** For example: “If I cross these two portals, I think I
   will return to the place where I started.”
2. **Try it.** Walk, place a sign, draw a locally straight ray, or measure an
   angle or length.
3. **Record what happened.** Include a sketch, a route, measurements, and what
   you expected.
4. **Explain the evidence.** Did the result match the prediction? What rule of
   the world might explain it?

It is fine if the first result is puzzling. In this project, that is often the
beginning of the mathematics.

## For educators

Treat the experience as a laboratory. 
A useful session starts with one small question, gives students time to gather evidence, and ends with a conversation or written explanation. 

## Credits and reuse

The project’s source code is available under the [MIT License](LICENSE).
Models, textures, icons, and other third-party material keep their own terms;
they are not relicensed by the MIT License. See the complete
[third-party asset provenance and notices](_docs/ASSET_PROVENANCE.md) before
reusing or redistributing any asset.

## Project information for contributors

Development, testing, authoring, and deployment instructions are provided:

- [Architecture](_docs/ARCHITECTURE.md) and [mathematical model](_docs/MATHEMATICAL_MODEL.md)
- [Documentation home](_docs/Readme.md)
- [Development guide](_docs/DEVELOPMENT.md)
- [Deployment guide](_docs/DEPLOYMENT.md)
- [Open project work](_issues/)
