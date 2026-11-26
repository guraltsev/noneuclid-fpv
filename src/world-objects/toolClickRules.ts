/**
 * What a primary click accepts, per tool, as pure predicates of the aim: the kind of what the aim rests on ("floor" or an object kind) and whether it is within interaction range.
 * The tool clients (the `client.ts` of each module) decide whether to act with these, and the crosshair definition (`src/ui/crosshairDefinition.ts`) uses the same ones to say whether a click would act, so the two cannot drift apart.
 * Only the tool-independent facts are here; a protractor's side also needs the picked centre, which the client resolves with `resolveProtractorSideAt`.
 */

/** The kind of the floor in an aim pick. */
export const floorPickKind = "floor";

/** The kind of a beam segment in an aim pick. */
export const segmentPickKind = "geodesicModel/segment";
/** The kind of a meeting point (a crossing of two beams) in an aim pick. */
export const crossingPickKind = "geodesicModel/crossing";
/** The kind of a laser in an aim pick. */
export const laserPickKind = "geodesicEmitters/emitter";

/** What the Laser does with a click: on a laser (in range) it adds a beam; on the floor, a beam or a meeting point it places a laser, at any distance. */
export function laserToolAcceptsClick(objectKind: string, withinRange: boolean): boolean {
  if (objectKind === laserPickKind) return withinRange;
  return objectKind === floorPickKind || objectKind === crossingPickKind || objectKind === segmentPickKind;
}

/** The Sign accepts a click on the floor only. */
export function signToolAcceptsClick(objectKind: string): boolean {
  return objectKind === floorPickKind;
}

/** The Ruler accepts a click on a beam within range. */
export function rulerAcceptsClick(objectKind: string, withinRange: boolean): boolean {
  return objectKind === segmentPickKind && withinRange;
}

/** The Protractor's first pick is a laser or a meeting point within range. */
export function protractorAcceptsCenterClick(objectKind: string, withinRange: boolean): boolean {
  return withinRange && (objectKind === laserPickKind || objectKind === crossingPickKind);
}
