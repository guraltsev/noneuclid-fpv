/**
 * The world's demonstration (design 017 section 9.2): a laser firing one beam, a Ruler measurement of that beam and a sign, made once when the world loads.
 * They are made by the modules' own commands, as a student would make them (place a laser, shoot a beam, measure it, put up a sign and set its text), so they are ordinary objects: the student can aim them, change them and delete them, and "Start over" removes them like anything else the student made. They come back when the world loads again.
 * A part whose tool the world's configuration switches off is left out, and the first refusal ends the run; nothing here throws.
 */
import type { CommandResult, EngineCommandBase } from "../../engine/moduleTypes";
import type { WorldDemoSpec } from "../../cell-complex/specs";
import type { RuntimeToolId } from "../../glue/toolIds";
import type { GeodesicEmitterPlaceCommand, GeodesicEmitterShootCommand } from "../../modules/geodesicEmitters/api";
import { geodesicEmitterToolId } from "../../modules/geodesicEmitters/api";
import type { GeodesicMeasurementsCreateLengthCommand } from "../../modules/geodesicMeasurements/api";
import { geodesicLengthToolId } from "../../modules/geodesicMeasurements/api";
import type { PlacedFlagsPlaceCommand, PlacedFlagsSetMessageCommand } from "../../modules/placedFlags/api";
import { placedFlagToolId } from "../../modules/placedFlags/api";

/** What the demo needs from the shell. */
export interface WorldDemoDeps {
  /** Submits a command for the local player; resolves with its result after the world's next step. */
  submit(command: EngineCommandBase): Promise<CommandResult>;
  /** True when the configuration lets the world use the tool. */
  isToolEnabled(toolId: RuntimeToolId): boolean;
  /** Where the player starts; the sign faces it. */
  readonly viewerPoint: { readonly x: number; readonly y: number; readonly z: number };
}

// A result's value, read as the plain object it is.
function valueOf(result: CommandResult): Readonly<Record<string, unknown>> | undefined {
  return result.ok && typeof result.value === "object" && result.value !== null ? (result.value as Readonly<Record<string, unknown>>) : undefined;
}

/**
 * Makes the demo: the laser and its beam, the ruler on it, the sign. Resolves when the commands have been answered; a refusal ends the part it belongs to (the beam's ruler needs the beam).
 */
export async function runWorldDemo(demo: WorldDemoSpec, deps: WorldDemoDeps): Promise<void> {
  if (deps.isToolEnabled(geodesicEmitterToolId)) {
    const place: GeodesicEmitterPlaceCommand = { kind: "geodesicEmitters/place", cellId: demo.cellId, point: demo.laser.position, yawRadians: demo.laser.yawRadians };
    const emitterId = valueOf(await deps.submit(place))?.emitterId;
    if (typeof emitterId === "string") {
      const shoot: GeodesicEmitterShootCommand = { kind: "geodesicEmitters/shoot", emitterId, yawRadians: demo.laser.yawRadians, lengthMeters: demo.laser.beamLengthMeters };
      const arcId = valueOf(await deps.submit(shoot))?.arcId;
      if (demo.ruler && typeof arcId === "string" && deps.isToolEnabled(geodesicLengthToolId)) {
        const measure: GeodesicMeasurementsCreateLengthCommand = { kind: "geodesicMeasurements/createLength", arcId };
        await deps.submit(measure);
      }
    }
  }

  if (demo.sign !== undefined && deps.isToolEnabled(placedFlagToolId)) {
    const place: PlacedFlagsPlaceCommand = {
      kind: "placedFlags/place",
      cellId: demo.cellId,
      point: demo.sign.position,
      eyePoint: deps.viewerPoint,
      flagType: "WoodenSign1",
    };
    const flagId = valueOf(await deps.submit(place))?.flagId;
    if (typeof flagId === "string") {
      const setText: PlacedFlagsSetMessageCommand = { kind: "placedFlags/setMessage", flagId, message: demo.sign.text };
      await deps.submit(setText);
    }
  }
}
