/**
 * Builds the crosshair definition's input (`src/ui/crosshairDefinition.ts`) from the current aim pick: which object the aim rests on, whether it is in range, whether the Hand could use it, and the Protractor's step.
 * Role: a read-only adapter between the shell's tool context and the pure definition; it changes nothing.
 */
import type { ToolContext } from "../../engine/moduleTypes";
import type { RuntimeToolId } from "../../glue/toolIds";
import type { CrosshairAim } from "../../ui/crosshairDefinition";
import { resolveProtractorSideAt, type ProtractorToolState } from "../../world-objects/protractorTool";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";

const protractorToolId: RuntimeToolId = "geodesicMeasurements/protractor";
const protractorModuleId = "geodesicMeasurements";

/** What the adapter reads: the tool context of the selected tool, the object reader, and whether the Hand has an action on an object. */
export interface CrosshairAimDeps {
  readonly tool: ToolContext;
  readonly objects: RuntimeObjectReader;
  readonly selectedTool: RuntimeToolId;
  /** True when the object offers an available action under the Hand, in range or not. */
  handCanUse(object: RuntimeWorldObject): boolean;
}

/** The aim as the crosshair needs it; undefined when nothing is hit. */
export function readCrosshairAim(deps: CrosshairAimDeps): CrosshairAim | undefined {
  const pick = deps.tool.currentPick();
  if (pick === undefined) return undefined;
  const object = pick.objectId === undefined ? undefined : deps.objects.get(pick.objectId);
  const aim: CrosshairAim = { objectKind: pick.objectKind, withinRange: pick.withinRange };
  if (deps.selectedTool === "none") {
    return { ...aim, usableByHand: object !== undefined && deps.handCanUse(object) };
  }
  if (deps.selectedTool !== protractorToolId) return aim;
  const center = deps.tool.getToolState<ProtractorToolState>(protractorModuleId)?.center;
  if (center === undefined) return { ...aim, protractorStep: "center" };
  return { ...aim, protractorStep: "side", protractorSideValid: resolveProtractorSideAt(deps.objects, center, pick) !== undefined };
}
