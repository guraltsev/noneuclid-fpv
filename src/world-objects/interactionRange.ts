/**
 * How far a person may be from a runtime object to interact with it: the one number the aim system (to focus and pick up) and the carry module (to refuse a pickup out of reach) both read.
 */
import type { RuntimeWorldObject } from "./runtimeObjectRegistry";

/**
 * Returns the maximum interaction distance in meters for an object: tooltip range, else interactable range, else 2.5.
 */
export function getRuntimeObjectInteractionRangeMeters(object: RuntimeWorldObject): number {
  return object.tooltip?.rangeMeters ?? object.interactable?.rangeMeters ?? 2.5;
}
