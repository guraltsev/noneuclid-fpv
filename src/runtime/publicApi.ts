/**
 * Holder of the public API object `window.noneuclid.api`: a plain object of namespaces of functions that are calls on the app's state.
 * The object is created once (by main.ts); namespaces whose lifetime is one app run are installed and removed with that app (see render/three/appDebugHelpers.ts).
 */
import type { ApiObject } from "./apiCall";

/** The mutable API object: namespace name to an object of functions. */
export type PublicApi = Record<string, ApiObject | undefined>;

/** The shape of `window.noneuclid`. */
export interface NoneuclidGlobal {
  readonly api: PublicApi;
}

type WindowWithNoneuclid = typeof window & { noneuclid?: NoneuclidGlobal };

/** Returns `window.noneuclid.api`, creating `window.noneuclid` on first use. */
export function getPublicApi(): PublicApi {
  const target = window as WindowWithNoneuclid;
  target.noneuclid ??= { api: {} };
  return target.noneuclid.api;
}

/** Installs (or, with `undefined`, removes) one namespace of the public API. */
export function setApiNamespace(name: string, namespace: ApiObject | undefined): void {
  const api = getPublicApi();
  if (namespace === undefined) {
    delete api[name];
  } else {
    api[name] = namespace;
  }
}
