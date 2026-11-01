# createThreeApp factories are `const`s built in order

After job 33 the shell wires ~50 factories (`runtimeObjectActions`, `aimFeedback`, `xrSessionController`, `portalFramePass`, `geometryCommit`, `desktopInputHandlers`, ...) as `const` handles, not hoisted functions. Using a handle before its factory line is a temporal-dead-zone error at runtime that `tsc` does not report; a dep that is needed earlier than its factory is passed as a `() => handle.x()` wrapper (see `geometryCommit` deps). Symptom: `Cannot access 'x' before initialization` when the app starts or on the first geometry commit.

Also: `appDebugHelpers.ts` and `geodesicCreatureDebug.ts` form an import cycle if the latter imports `roundNumber` from the former (`docs:check` FAIL import cycles), so the small private copy stays.