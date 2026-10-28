# 001 - Stack

## What did we decide?

Use a single Vite TypeScript application with Three.js for rendering, WebXR
through Three.js when the project reaches VR work, and Vitest for behavior
tests.

## Why now?

The project needs a small inspectable browser app. Vite keeps the static build
simple, Three.js keeps the geometry/runtime code visible, and Vitest fits the
TypeScript toolchain without adding a separate test architecture.

## What are we explicitly not deciding?

We are not choosing React, Next.js, A-Frame, Unity, Godot, a backend, accounts,
or a monorepo for this first implementation.

## What would cause us to revisit this?

Revisit if classroom VR testing exposes a hard WebXR limitation, if the app
needs a real multi-screen UI, or if future authoring tools become large enough
to justify their own package.
