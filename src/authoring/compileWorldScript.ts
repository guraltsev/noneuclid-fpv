/**
 * World-script compiler: runs a world script's JavaScript text against a sandboxed name scope and returns the resulting CellComplexSpec (authoring script -> CellComplexSpec stage of the pipeline).
 * The script sees only the builder calls (PolygonFace, Portal, OnFace, startingHouse, ...), the floorTexture helper and the world object library (tree, house, geodesic_marmot, ...), plus variables it assigns itself. It is executed with `new Function` and a `with` block over a Proxy that claims every string name, so referencing any other identifier (including standard JS globals such as Math or Array) throws a ReferenceError; this is a convenience scope for trusted bundled scripts, not a security sandbox.
 */
import type { CellComplexSpec } from "../cell-complex/specs";
import { worldObjectLibrary } from "../world-objects/library";
import { worldFloorTextureLibrary } from "../world-assets/floorTextures";
import { createWorldBuilder } from "./worldBuilder";

/**
 * Options for compileWorldScript.
 */
export interface CompileWorldScriptOptions {
  /** Script name (usually a file name) included in error messages. */
  readonly sourceName?: string;
}

/**
 * Executes world-script source text and returns the world it builds.
 * Throws an Error whose message is `World script "<sourceName>" failed: <cause>` for syntax errors, unknown names, builder validation failures, or assignment to a reserved name. The result is not run through validateCellComplexSpec here; compileCellComplex validates it later.
 */
export function compileWorldScript(sourceText: string, options: CompileWorldScriptOptions = {}): CellComplexSpec {
  const builder = createWorldBuilder();
  const globals = {
    PolygonFace: builder.PolygonFace,
    Portal: builder.Portal,
    OnFace: builder.OnFace,
    startingHouse: builder.startingHouse,
    startingQuestionCube: builder.startingQuestionCube,
    startingPosition: builder.startingPosition,
    ...worldFloorTextureLibrary,
    ...worldObjectLibrary,
  } as const;
  const assignedValues = new Map<string, unknown>();
  const scope = new Proxy(Object.create(null) as Record<string, unknown>, {
    // Claiming every string key makes all identifier lookups in the `with` block hit this proxy, so typos fail loudly instead of silently reading real globals.
    has(_target, key) {
      return typeof key === "string";
    },
    get(_target, key) {
      // Required so the `with` statement does not consult unscopables and hide names.
      if (key === Symbol.unscopables) {
        return undefined;
      }

      if (typeof key !== "string") {
        return undefined;
      }

      if (key in globals) {
        return globals[key as keyof typeof globals];
      }

      if (assignedValues.has(key)) {
        return assignedValues.get(key);
      }

      throw new ReferenceError(`Unknown authoring name "${key}".`);
    },
    // Sloppy-mode assignments such as `square = [...]` in the script land here, giving scripts simple variables without declarations; reserved names cannot be shadowed.
    set(_target, key, value) {
      if (typeof key !== "string") {
        return false;
      }

      if (key in globals) {
        throw new Error(`Cannot assign to reserved authoring name "${key}".`);
      }

      assignedValues.set(key, value);
      return true;
    },
    // Keeps proxy invariants satisfied for the `with` machinery when properties are probed.
    getOwnPropertyDescriptor() {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: undefined,
      };
    },
  });

  try {
    const execute = new Function(
      "scope",
      `with (scope) {\n${sourceText}\n}`,
    ) as (scope: object) => void;
    execute(scope);
    return builder.build();
  } catch (error) {
    throw new Error(formatWorldScriptError(error, options.sourceName));
  }
}

function formatWorldScriptError(error: unknown, sourceName?: string): string {
  const prefix = sourceName ? `World script "${sourceName}"` : "World script";

  if (error instanceof Error) {
    return `${prefix} failed: ${error.message}`;
  }

  return `${prefix} failed.`;
}
