/**
 * Engine-allocated object ids: "<family>:<serial>" with one counter per family, never reused (design 013 section 5.1; no `Date.now()`).
 * A serial whose id is already taken in the registry (an authored object with that id) is skipped.
 */
import type { EngineIdSource } from "./moduleTypes";

/** Creates an id source; `isTaken` says whether an id is already in use. */
export function createEngineIdSource(isTaken: (id: string) => boolean): EngineIdSource {
  const serials = new Map<string, number>();
  return {
    next(family) {
      let serial = serials.get(family) ?? 0;
      let id = `${family}:${serial}`;
      while (isTaken(id)) {
        serial += 1;
        id = `${family}:${serial}`;
      }
      serials.set(family, serial + 1);
      return id;
    },
  };
}
