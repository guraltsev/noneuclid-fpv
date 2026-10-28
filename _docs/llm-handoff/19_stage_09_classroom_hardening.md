# 19 - Stage 09: Classroom hardening

## Goal

Make the experience robust enough for a one-week course with middle-school students and limited instructor intervention.

This stage is about reliability, reset, diagnosis, and low-friction deployment.

## Files to create

```text
src/classroom/teacherReset.ts
src/classroom/preflightChecks.ts
src/classroom/exportDiscoveryLog.ts
src/render/three/classroomOverlay.ts
tests/classroom/preflightChecks.test.ts
tests/classroom/discoveryLogExport.test.ts
```

## Reset behavior

Provide:

- reset current player to spawn,
- clear rays,
- clear markers,
- clear path traces,
- reset entire world state,
- switch world if multiple worlds exist.

Reset must be reachable from desktop and VR.

## Preflight checks

Preflight should report:

- page loaded,
- secure context status,
- WebXR availability if detectable,
- current world compiled successfully,
- assets loaded or missing,
- controls initialized,
- tests/build version if available.

Do not hide failures behind a blank screen.

## Error screens

When a world spec fails to compile, show a readable error:

```text
World failed to compile.
Portal p-east references missing cell room-7.
```

Do not show only stack traces to classroom users.

## Discovery log export

Provide a local export button for JSON.

The export should contain:

- world id,
- app version/build timestamp if available,
- ordered action events,
- no personal data unless the instructor explicitly adds labels.

## Deployment check

Verify:

```bash
npm run build
npm run deploy:pages
```

or manually inspect the build output before pushing to `gh-pages`.

The app must work when served from a repository subpath, not only from `/`.

## Manual classroom script

Create a short checklist for the instructor:

1. Open the GitHub Pages URL.
2. Confirm the start screen appears.
3. Confirm preflight is green enough.
4. Enter desktop mode.
5. Move, reset, fire ray.
6. Enter VR if headset is available.
7. Confirm reset still works.

## Tests to write

Required tests:

- reset returns app state to spawn,
- reset clears temporary tools,
- preflight reports insecure context when supplied such an environment flag,
- export contains world id and ordered events,
- export excludes undefined/internal fields.

## Exit criteria

The instructor can run a class session without developer intervention for ordinary resets and recoverable errors.

## Do not do in this stage

Do not add cloud storage.

Do not add analytics.

Do not add accounts.

Do not add multiplayer.
