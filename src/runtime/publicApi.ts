/**
 * Holder of the public API object `window.noneuclid.api`: a plain object of namespaces of functions that are calls on the app's state.
 * The object is created once (by main.ts); namespaces whose lifetime is one app run are installed and removed with that app (see render/three/appDebugHelpers.ts). A module's `publicApi` is such a namespace, `api.<moduleId>`.
 */
import { listApi, type ApiObject } from "./apiCall";

/** The mutable API object: namespace name to an object of functions. */
export type PublicApi = Record<string, ApiObject | undefined>;

/** The shape of `window.noneuclid`. */
export interface NoneuclidGlobal {
  readonly api: PublicApi;
}

type WindowWithNoneuclid = typeof window & { noneuclid?: NoneuclidGlobal };

/** Returns `window.noneuclid.api`, creating `window.noneuclid` (with its `help` function) on first use. */
export function getPublicApi(): PublicApi {
  const target = window as WindowWithNoneuclid;
  if (!target.noneuclid) {
    const api: PublicApi = {};
    api.help = ((path?: unknown) => describeApi(api, path)) as unknown as ApiObject;
    target.noneuclid = { api };
  }
  return target.noneuclid.api;
}

/**
 * The public API's own `help(path?)`: the names of its functions as `{ namespace: [names] }`, narrowed to `path` (a namespace such as
 * `"motion"`, or one function such as `"motion.run"`) when given. Throws for a path that names nothing. A namespace with a `usage()`
 * function describes its arguments there.
 */
export function describeApi(api: ApiObject, path?: unknown): Record<string, string[]> {
  const listing = listApi(api);
  if (path === undefined || path === null || path === "") return listing;
  if (typeof path !== "string") throw new Error("help: the path is a string such as \"motion\" or \"motion.run\"");
  const result: Record<string, string[]> = {};
  const dot = path.lastIndexOf(".");
  for (const [namespace, names] of Object.entries(listing)) {
    if (namespace === path || namespace.startsWith(`${path}.`)) {
      result[namespace] = names;
    } else if (dot > 0 && namespace === path.slice(0, dot) && names.includes(path.slice(dot + 1))) {
      result[namespace] = [path.slice(dot + 1)];
    } else if (dot < 0 && namespace === "" && names.includes(path)) {
      result[namespace] = [path];
    }
  }
  if (Object.keys(result).length === 0) throw new Error(`help: no API namespace or function "${path}"`);
  return result;
}

/** Installs the modules' public functions as `api.<moduleId>`; the function it returns removes them, for the app's dispose. */
export function installModuleApis(publicApis: ReadonlyMap<string, ApiObject>): () => void {
  for (const [moduleId, namespace] of publicApis) setApiNamespace(moduleId, namespace);
  return () => {
    for (const moduleId of publicApis.keys()) setApiNamespace(moduleId, undefined);
  };
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
