/**
 * Dispatch for the public API object (`window.noneuclid.api`): a call is a path of names through nested plain objects of functions, plus arguments, and its result is converted to plain JSON-safe data.
 * Used by the server channel (src/glue/serverChannel.ts) and the console; knows nothing about the network or the renderer.
 */

/** Path segments that never resolve, whatever the object holds. */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

/** A nested object whose leaves are functions (namespaces of the API). */
export type ApiObject = { readonly [name: string]: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walks `path` through own properties of plain objects starting at `api`, calls the function found there with `args`, awaits it and returns its result as plain data.
 * Throws `Error("no such API function: a.b")` for an unknown segment, a forbidden segment (`__proto__`, `prototype`, `constructor`) or a non-function at the end.
 */
export async function callApi(api: ApiObject, path: readonly string[], args: readonly unknown[]): Promise<unknown> {
  const name = path.join(".");
  let current: unknown = api;
  for (const segment of path) {
    if (
      FORBIDDEN_SEGMENTS.has(segment) ||
      !isPlainObject(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new Error(`no such API function: ${name}`);
    }
    current = current[segment];
  }
  if (typeof current !== "function") {
    throw new Error(`no such API function: ${name}`);
  }
  const owner = path.length > 1 ? resolveOwner(api, path) : api;
  const result = await (current as (...callArgs: unknown[]) => unknown).apply(owner, args as unknown[]);
  return toPlainData(result);
}

function resolveOwner(api: ApiObject, path: readonly string[]): unknown {
  let current: unknown = api;
  for (const segment of path.slice(0, -1)) {
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Returns the names of the API's functions as `{ namespace: [function names] }` (nested objects use dotted namespace names), sorted. */
export function listApi(api: ApiObject): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const visit = (object: ApiObject, prefix: string): void => {
    for (const key of Object.keys(object).sort()) {
      const value = object[key];
      if (typeof value === "function") {
        (result[prefix] ??= []).push(key);
      } else if (isPlainObject(value)) {
        visit(value, prefix === "" ? key : `${prefix}.${key}`);
      }
    }
  };
  visit(api, "");
  // Functions directly on the API object are listed under "".
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Converts a value to JSON-safe plain data: a `Map` with all-string keys becomes an object, any other `Map` an array of `[key, value]`; a `Set` and typed arrays become arrays; an `Error` becomes `{ name, message }`; functions are dropped; plain objects, arrays and primitives are kept.
 * Throws `Error("result is not plain data (cycle)")` for a cycle.
 */
export function toPlainData(value: unknown): unknown {
  return convert(value, new Set());
}

function convert(value: unknown, ancestors: Set<object>): unknown {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  const object = value as object;
  if (ancestors.has(object)) {
    throw new Error("result is not plain data (cycle)");
  }
  ancestors.add(object);
  try {
    if (object instanceof Error) {
      return { name: object.name, message: object.message };
    }
    if (object instanceof Map) {
      const entries = [...object.entries()];
      if (entries.every(([key]) => typeof key === "string")) {
        return Object.fromEntries(entries.map(([key, entry]) => [key, convert(entry, ancestors)]));
      }
      return entries.map(([key, entry]) => [convert(key, ancestors), convert(entry, ancestors)]);
    }
    if (object instanceof Set) {
      return [...object].map((entry) => convert(entry, ancestors));
    }
    if (ArrayBuffer.isView(object) && !(object instanceof DataView)) {
      return Array.from(object as unknown as ArrayLike<number | bigint>, (entry) => convert(entry, ancestors));
    }
    if (Array.isArray(object)) {
      return object.map((entry) => convert(entry, ancestors));
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object)) {
      const converted = convert((object as Record<string, unknown>)[key], ancestors);
      if (converted !== undefined) {
        result[key] = converted;
      }
    }
    return result;
  } finally {
    ancestors.delete(object);
  }
}
