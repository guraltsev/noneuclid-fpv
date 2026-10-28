/**
 * Compatibility re-export of the spec validator, which now lives in cell-complex/validateCellComplexSpec so the compiler does not import the authoring layer.
 * `validateAuthoringSpec` is an alias of `validateCellComplexSpec`; new code should import the latter.
 */
import { validateCellComplexSpec } from "../cell-complex/validateCellComplexSpec";

/**
 * Alias of `validateCellComplexSpec`: validates a world spec and returns the list of problems found, empty when valid.
 */
export const validateAuthoringSpec = validateCellComplexSpec;
