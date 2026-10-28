/**
 * Abstracts where world-geometry snapshots are built: a dedicated module Web Worker, or an inline fallback on the main thread.
 * WorldGeometryBuildClient is the only interface the geometry session depends on, which keeps the session testable and independent of Worker availability.
 * Responses are correlated to requests by requestId, and every pending request is resolved (with a "failed" response) on worker error or disposal so promises never hang.
 */
import {
  buildWorldGeometrySnapshotForRequest,
  type BuildWorldGeometrySnapshotRequest,
  type BuildWorldGeometrySnapshotResponse,
} from "./worldGeometryWorker";

/** Asynchronous builder of world-geometry snapshots, backed either by a Worker or by the main thread. */
export interface WorldGeometryBuildClient {
  /** True when builds run in a Web Worker, false when they run inline on the main thread. */
  readonly worker: boolean;
  /**
   * Builds one snapshot; always resolves (never rejects) with a "built" or "failed" response carrying the same requestId.
   */
  buildSnapshot(request: BuildWorldGeometrySnapshotRequest): Promise<BuildWorldGeometrySnapshotResponse>;
  /** Releases the client; pending and later requests resolve as "failed" and any worker is terminated. */
  dispose(): void;
}

/**
 * Returns a Worker-backed client when Worker exists and can be constructed, otherwise the inline client.
 */
export function createDefaultWorldGeometryBuildClient(): WorldGeometryBuildClient {
  if (typeof Worker === "undefined") {
    return createInlineWorldGeometryBuildClient();
  }

  try {
    return createWorkerWorldGeometryBuildClient();
  } catch {
    return createInlineWorldGeometryBuildClient();
  }
}

/**
 * Returns a client that builds on the main thread in a setTimeout(0) task; after dispose it resolves requests as "failed".
 */
export function createInlineWorldGeometryBuildClient(): WorldGeometryBuildClient {
  let disposed = false;

  return {
    worker: false,
    buildSnapshot(request) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            disposed
              ? {
                  kind: "failed",
                  requestId: request.requestId,
                  message: "World geometry build client was disposed.",
                }
              : buildWorldGeometrySnapshotForRequest(request),
          );
        }, 0);
      });
    },
    dispose() {
      disposed = true;
    },
  };
}

/**
 * Spawns worldGeometryWorker.ts as a module Worker and returns a client that posts requests to it; throws synchronously if the Worker cannot be created.
 */
export function createWorkerWorldGeometryBuildClient(): WorldGeometryBuildClient {
  const worker = new Worker(new URL("./worldGeometryWorker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, (response: BuildWorldGeometrySnapshotResponse) => void>();
  let disposed = false;

  worker.addEventListener("message", (event: MessageEvent<BuildWorldGeometrySnapshotResponse>) => {
    const resolve = pending.get(event.data.requestId);
    if (!resolve) {
      return;
    }

    pending.delete(event.data.requestId);
    resolve(event.data);
  });

  worker.addEventListener("error", (event) => {
    for (const [requestId, resolve] of pending) {
      resolve({
        kind: "failed",
        requestId,
        message: event.message || "World geometry worker failed.",
      });
    }
    pending.clear();
  });

  return {
    worker: true,
    buildSnapshot(request) {
      if (disposed) {
        return Promise.resolve({
          kind: "failed",
          requestId: request.requestId,
          message: "World geometry build client was disposed.",
        });
      }

      return new Promise((resolve) => {
        pending.set(request.requestId, resolve);
        worker.postMessage(request);
      });
    },
    dispose() {
      disposed = true;
      for (const [requestId, resolve] of pending) {
        resolve({
          kind: "failed",
          requestId,
          message: "World geometry build client was disposed.",
        });
      }
      pending.clear();
      worker.terminate();
    },
  };
}
