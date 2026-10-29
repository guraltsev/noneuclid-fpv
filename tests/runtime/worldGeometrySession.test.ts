import { describe, expect, it } from "vitest";
import { torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { deformationStatesEqual } from "../../src/runtime/worldGeometryDeformations";
import { createWorldGeometrySession, type WorldGeometrySnapshot } from "../../src/runtime/worldGeometrySession";
import {
  buildWorldGeometrySnapshotForRequest,
  type BuildWorldGeometrySnapshotRequest,
  type BuildWorldGeometrySnapshotResponse,
} from "../../src/runtime/worldGeometryWorker";
import type { WorldGeometryBuildClient } from "../../src/runtime/worldGeometryWorkerClient";
import type { TorusSkewDeformationState } from "../../src/runtime/deformations/torusSkewDeformation";

describe("world geometry session", () => {
  it("keeps only one build in flight", () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client);

    session.setTarget(skewState(1));
    session.setTarget(skewState(2));

    expect(client.requests).toHaveLength(1);
    expect(session.state.buildInFlight).toBe(true);
  });

  it("drops stale responses after cancel and a newer target", async () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client);

    session.setTarget(skewState(1));
    const first = client.requests[0];
    session.cancel();
    session.setTarget(skewState(2));
    const second = client.requests[1];

    client.resolve(first.requestId, buildWorldGeometrySnapshotForRequest(first));
    await flushPromises();
    expect(session.pollReadySnapshot()).toBeUndefined();
    expect(session.state.version).toBe(0);

    client.resolve(second.requestId, buildWorldGeometrySnapshotForRequest(second));
    await flushPromises();
    const ready = session.pollReadySnapshot();

    expect(ready?.version).toBe(1);
    expect(ready?.deformation).toMatchObject({ skewXMeters: 0.05 });
  });

  it("advances toward the target through the active family's nextStep", () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client, { maxStepMeters: 0.05 });

    session.setTarget(skewState(0.2));

    expect(client.requests[0].deformation).toMatchObject({ skewXMeters: 0.05 });
  });

  it("reaches a target with a different width without recording an error", async () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client, { maxStepMeters: 1 });

    session.setTarget({ kind: "torus-skew", cellId: "torus-room", widthMeters: 40, depthMeters: 20, skewXMeters: 0 });
    expect(session.state.lastError).toBeUndefined();

    for (let round = 0; round < 40; round += 1) {
      const request = client.requests[client.requests.length - 1];
      client.resolve(request.requestId, buildWorldGeometrySnapshotForRequest(request));
      await flushPromises();
      session.pollReadySnapshot();
      expect(session.state.lastError).toBeUndefined();
      if (deformationStatesEqual(session.state.current, session.state.target)) {
        break;
      }
    }

    expect(session.state.current).toMatchObject({ widthMeters: 40 });
  });

  it("advances torus skew by at most maxStepMeters per committed snapshot", async () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client, { maxStepMeters: 0.05 });

    session.setTarget(skewState(0.11));
    client.resolve(1, buildWorldGeometrySnapshotForRequest(client.requests[0]));
    await flushPromises();
    const first = session.pollReadySnapshot();

    expect(first?.deformation).toMatchObject({ skewXMeters: 0.05 });
    expect(client.requests[1].deformation).toMatchObject({ skewXMeters: 0.1 });
  });

  it("preserves the old committed snapshot after failed builds", async () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client);

    session.setTarget(skewState(1));
    client.resolve(1, {
      kind: "failed",
      requestId: 1,
      message: "boom",
    });
    await flushPromises();

    expect(session.pollReadySnapshot()).toBeUndefined();
    expect(session.state.version).toBe(0);
    expect(session.state.lastError).toBe("boom");
  });

  it("cancel prevents further queued steps", async () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client, { maxStepMeters: 0.05 });

    session.setTarget(skewState(0.2));
    session.cancel();
    client.resolve(1, buildWorldGeometrySnapshotForRequest(client.requests[0]));
    await flushPromises();

    expect(session.pollReadySnapshot()).toBeUndefined();
    expect(client.requests).toHaveLength(1);
    expect(session.state.buildInFlight).toBe(false);
  });

  it("schedules builds again on the first setTarget after a cancel", () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client, { maxStepMeters: 0.05 });

    session.setTarget(skewState(0.2));
    session.cancel();
    expect(session.state.target).toEqual(session.state.current);

    session.setTarget(skewState(0.2));

    expect(client.requests).toHaveLength(2);
    expect(session.state.buildInFlight).toBe(true);
  });

  it("ignores nudge after dispose without recording an error", () => {
    const client = createDeferredBuildClient();
    const session = createTestSession(client);

    session.dispose();
    session.nudge({ kind: "static-world", target: { kind: "static-world" } });
    session.nudge({ kind: "torus-skew", target: skewState(1) });

    expect(client.requests).toHaveLength(0);
    expect(session.state.lastError).toBeUndefined();
  });
});

function createTestSession(
  buildClient: WorldGeometryBuildClient,
  stepOptions: { readonly maxStepMeters: number } = { maxStepMeters: 0.05 },
) {
  return createWorldGeometrySession({
    baseSpec: torus,
    initialSnapshot: createInitialSnapshot(),
    buildClient,
    portalPathOptions: {
      maxDepth: 3,
      skipImmediateReverse: true,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 1_000,
    },
    stepOptions,
    nowMs: createIncrementingClock(),
  });
}

function createInitialSnapshot(): WorldGeometrySnapshot {
  const world = compileCellComplex(torus);
  return {
    version: 0,
    deformation: skewState(0),
    spec: torus,
    world,
    staticCull: buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 3,
      skipImmediateReverse: true,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 1_000,
    }),
    buildStats: {
      requestedAtMs: 0,
      completedAtMs: 0,
      worker: false,
    },
  };
}

function createDeferredBuildClient(): WorldGeometryBuildClient & {
  readonly requests: BuildWorldGeometrySnapshotRequest[];
  resolve(requestId: number, response: BuildWorldGeometrySnapshotResponse): void;
} {
  const requests: BuildWorldGeometrySnapshotRequest[] = [];
  const resolvers = new Map<number, (response: BuildWorldGeometrySnapshotResponse) => void>();

  return {
    worker: false,
    requests,
    buildSnapshot(request) {
      requests.push(request);
      return new Promise((resolve) => {
        resolvers.set(request.requestId, resolve);
      });
    },
    resolve(requestId, response) {
      const resolve = resolvers.get(requestId);
      if (!resolve) {
        throw new Error(`Missing request ${requestId}.`);
      }

      resolvers.delete(requestId);
      resolve(response);
    },
    dispose() {},
  };
}

function skewState(skewXMeters: number): TorusSkewDeformationState {
  return {
    kind: "torus-skew",
    cellId: "torus-room",
    widthMeters: 15,
    depthMeters: 15,
    skewXMeters,
  };
}

function createIncrementingClock(): () => number {
  let now = 0;
  return () => {
    now += 10;
    return now;
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
