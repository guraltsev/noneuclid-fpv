/**
 * Deformation family for the one-cell torus world: the cell "torus-room" is a prism whose footprint is a parallelogram with edge vectors u = (w, 0) and v = (a, b), and opposite sides glued by translation (side-0 with side-2, side-1 with side-3).
 * The state is width w (the shipped UI keeps it fixed, but the family allows a width change), skew a = skewXMeters in [0, 2w] and depth b = depthMeters in [w/2, 2w]; changing (a, b) changes the flat torus R^2/(Zu + Zv) while keeping the same combinatorics.
 * The per-cell map sends a point p = o_old + alpha u_old + beta v_old to o_new + alpha u_new + beta v_new, where o = -(u+v)/2 is the footprint's first vertex, and keeps the height z; directions map by the same linear part. So lattice coordinates (alpha, beta) are invariant, which is what carries players and objects across a commit.
 * Stepping moves (w, a, b) together along a straight segment in (w, a, b) space by at most maxStepMeters per rebuild (the allowed set is convex, so every point of the segment is allowed). Snapshot validation requires unchanged topology and equal lengths of opposite sides.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CellComplexSpec, PrismCellSpec } from "../../cell-complex/specs";
import { vec3, type Vec3 } from "../../math/vec3";
import {
  applyPrismBaseReplacements,
  transformCellObjectsWithMaps,
  transformStartingPositionWithMap,
  validateTopologyPreservingSnapshot,
  type CellDeformationMap,
  type DynamicGeometryStepOptions,
  type WorldDeformationFamily,
} from "../worldGeometryDeformations";

/** Parameters (meters) of the torus-room parallelogram: horizontal edge w, skew a and depth b. */
export interface TorusSkewDeformationState {
  readonly kind: "torus-skew";
  /** Always "torus-room"; the family only deforms that single cell. */
  readonly cellId: "torus-room";
  /** Length w of the horizontal lattice vector u = (w, 0); positive and finite. */
  readonly widthMeters: number;
  /** Height b of the second lattice vector v = (a, b); must lie in [w/2, 2w]. */
  readonly depthMeters: number;
  /** Horizontal component a of v (the shear); must lie in [0, 2w]. */
  readonly skewXMeters: number;
}

interface TorusLatticeFrame {
  readonly origin: { readonly x: number; readonly y: number };
  readonly u: { readonly x: number; readonly y: number };
  readonly v: { readonly x: number; readonly y: number };
}

const torusCellId = "torus-room";
const expectedPortalPairs = [
  ["side-0", 0, "side-2"],
  ["side-1", 1, "side-3"],
  ["side-2", 2, "side-0"],
  ["side-3", 3, "side-1"],
] as const;
const dimensionToleranceMeters = 1e-6;

/** Default torus parameters: w = 15 m, b = 15 m, a = 0 (a square). */
export const defaultTorusSkewDeformationState: TorusSkewDeformationState = {
  kind: "torus-skew",
  cellId: torusCellId,
  widthMeters: 15,
  depthMeters: 15,
  skewXMeters: 0,
};

/**
 * Creates the "torus-skew" WorldDeformationFamily; applyToSpec rebuilds the parallelogram footprint and carries startingPosition and cell objects from the inferred base state to the requested one.
 */
export function createTorusSkewDeformationFamily(): WorldDeformationFamily<TorusSkewDeformationState> {
  return {
    kind: "torus-skew",
    canApplyToSpec(baseSpec) {
      return validateTorusSkewBaseSpec(baseSpec).length === 0;
    },
    normalizeState(baseSpec, state) {
      // Inference is only needed (and only attempted) for a missing width or depth, so an explicit
      // state still normalizes for a base footprint that is itself outside the family's range.
      const needsInference = isMissingNumber(state.widthMeters) || isMissingNumber(state.depthMeters);
      const inferred = needsInference ? inferTorusSkewState(baseSpec) : state;
      return normalizeTorusSkewState({
        ...state,
        cellId: torusCellId,
        // Only a missing (undefined/NaN) value falls back to the inferred one; 0 and other
        // explicit values are kept so range validation can reject them.
        widthMeters: isMissingNumber(state.widthMeters) ? inferred.widthMeters : state.widthMeters,
        depthMeters: isMissingNumber(state.depthMeters) ? inferred.depthMeters : state.depthMeters,
      });
    },
    applyToSpec(baseSpec, state) {
      const errors = validateTorusSkewBaseSpec(baseSpec);
      if (errors.length > 0) {
        throw new Error(`Cannot apply world deformation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
      }

      const normalized = normalizeTorusSkewState(state);
      const baseState = inferTorusSkewState(baseSpec);
      const mapsByCellId = createTorusSkewCellDeformationMaps(baseState, normalized);
      const replaced = applyPrismBaseReplacements(baseSpec, [
        {
          cellId: normalized.cellId,
          baseVertices: buildTorusParallelogramVertices(normalized),
        },
      ]);

      return {
        ...replaced,
        startingPosition: transformStartingPositionWithMap(baseSpec.startingPosition, mapsByCellId),
        cells: replaced.cells.map((cell) => transformCellObjectsWithMaps(cell, mapsByCellId)),
      };
    },
    createDynamicObjectMaps(previous, next) {
      return createTorusSkewCellDeformationMaps(previous, next);
    },
    nextStep(current, target, options) {
      return nextTorusSkewStep(current, target, options);
    },
    validateSnapshot(previousWorld, nextWorld) {
      return [
        ...validateTopologyPreservingSnapshot(previousWorld, nextWorld),
        ...validateCompiledTorusSkewSnapshot(nextWorld),
      ];
    },
  };
}

/**
 * Returns the four footprint vertices (counter-clockwise, centered at the origin) of the parallelogram spanned by u = (w, 0) and v = (a, b).
 */
export function buildTorusParallelogramVertices(
  state: Pick<TorusSkewDeformationState, "widthMeters" | "depthMeters" | "skewXMeters">,
): readonly { readonly x: number; readonly y: number }[] {
  const u = { x: state.widthMeters, y: 0 };
  const v = { x: state.skewXMeters, y: state.depthMeters };

  return [
    { x: -0.5 * u.x - 0.5 * v.x, y: -0.5 * u.y - 0.5 * v.y },
    { x: 0.5 * u.x - 0.5 * v.x, y: 0.5 * u.y - 0.5 * v.y },
    { x: 0.5 * u.x + 0.5 * v.x, y: 0.5 * u.y + 0.5 * v.y },
    { x: -0.5 * u.x + 0.5 * v.x, y: -0.5 * u.y + 0.5 * v.y },
  ];
}

/**
 * Builds the single-entry map {torus-room} that preserves lattice coordinates between the previous and next parallelogram frames and leaves z unchanged.
 */
export function createTorusSkewCellDeformationMaps(
  previous: TorusSkewDeformationState,
  next: TorusSkewDeformationState,
): ReadonlyMap<string, CellDeformationMap> {
  const previousFrame = torusLatticeFrame(previous);
  const nextFrame = torusLatticeFrame(next);

  return new Map([
    [
      torusCellId,
      {
        cellId: torusCellId,
        mapPoint(point) {
          const coordinates = latticeCoordinates(previousFrame, point);
          return vec3(
            nextFrame.origin.x + coordinates.alpha * nextFrame.u.x + coordinates.beta * nextFrame.v.x,
            nextFrame.origin.y + coordinates.alpha * nextFrame.u.y + coordinates.beta * nextFrame.v.y,
            point.z,
          );
        },
        mapDirection(direction) {
          const coordinates = latticeDirectionCoordinates(previousFrame, direction);
          return vec3(
            coordinates.alpha * nextFrame.u.x + coordinates.beta * nextFrame.v.x,
            coordinates.alpha * nextFrame.u.y + coordinates.beta * nextFrame.v.y,
            direction.z,
          );
        },
      },
    ],
  ]);
}

/**
 * Moves (widthMeters, skewXMeters, depthMeters) together from current toward target along a straight segment by at most maxStepMeters in the Euclidean metric, snapping to the target when the remaining distance is within max(maxStepMeters, snapTolerance); the result is normalized (range-checked).
 */
export function nextTorusSkewStep(
  current: TorusSkewDeformationState,
  target: TorusSkewDeformationState,
  options: DynamicGeometryStepOptions,
): TorusSkewDeformationState {
  const maxStepMeters = Math.max(0, options.maxStepMeters);
  const snapToleranceMeters = options.snapToleranceMeters ?? 1e-9;
  const deltaW = target.widthMeters - current.widthMeters;
  const deltaA = target.skewXMeters - current.skewXMeters;
  const deltaB = target.depthMeters - current.depthMeters;
  const distance = Math.hypot(deltaW, deltaA, deltaB);

  if (distance <= Math.max(maxStepMeters, snapToleranceMeters)) {
    return normalizeTorusSkewState(target);
  }

  const stepScale = maxStepMeters / distance;
  const widthMeters = current.widthMeters + deltaW * stepScale;
  // The allowed set is convex in (w, a, b), so the exact point is in range; the clamps only remove rounding error.
  const depthMeters = clamp(current.depthMeters + deltaB * stepScale, widthMeters / 2, widthMeters * 2);
  const skewXMeters = clamp(current.skewXMeters + deltaA * stepScale, 0, widthMeters * 2);
  return normalizeTorusSkewState({ ...current, widthMeters, depthMeters, skewXMeters });
}

/**
 * Returns errors unless the spec has exactly one cell, "torus-room", with 4 base vertices, positive finite height, portals side-0..side-3 on sides 0..3 paired 0<->2 and 1<->3 to itself, and a footprint that is the centred parallelogram (within 1e-6 m) of its own w, a, b.
 */
export function validateTorusSkewBaseSpec(baseSpec: CellComplexSpec): readonly string[] {
  const errors: string[] = [];
  const cell = baseSpec.cells.find((candidate) => candidate.id === torusCellId);

  if (!cell) {
    return [`Expected a "${torusCellId}" cell.`];
  }

  if (baseSpec.cells.length !== 1) {
    errors.push(`Expected world deformation to apply to one cell, found ${baseSpec.cells.length}.`);
  }

  if (cell.baseVertices.length !== 4) {
    errors.push(`Expected "${torusCellId}" to have 4 base vertices, found ${cell.baseVertices.length}.`);
  }

  if (cell.baseVertices.length === 4) {
    const [v0, v1, , v3] = cell.baseVertices;
    const expected = buildTorusParallelogramVertices({
      widthMeters: Math.hypot(v1.x - v0.x, v1.y - v0.y),
      skewXMeters: v3.x - v0.x,
      depthMeters: v3.y - v0.y,
    });
    const matches = cell.baseVertices.every(
      (vertex, index) =>
        Math.abs(vertex.x - expected[index].x) <= dimensionToleranceMeters &&
        Math.abs(vertex.y - expected[index].y) <= dimensionToleranceMeters,
    );
    if (!matches) {
      errors.push(
        `Cell "${torusCellId}" footprint must be the centred parallelogram with u = (w, 0) and v = (a, b), vertices -u/2-v/2, u/2-v/2, u/2+v/2, -u/2+v/2.`,
      );
    }
  }

  for (const [portalId, sideIndex, targetPortalId] of expectedPortalPairs) {
    const portal = cell.portals.find((candidate) => candidate.id === portalId);
    if (!portal) {
      errors.push(`Expected portal "${torusCellId}:${portalId}".`);
      continue;
    }

    if (
      portal.sideIndex !== sideIndex ||
      portal.targetCellId !== torusCellId ||
      portal.targetPortalId !== targetPortalId
    ) {
      errors.push(`Portal "${torusCellId}:${portalId}" does not match the torus side pairing.`);
    }
  }

  if (cell.heightMeters <= 0 || !Number.isFinite(cell.heightMeters)) {
    errors.push(`Cell "${torusCellId}" must have a finite positive height.`);
  }

  return errors;
}

/**
 * Reads (w, a, b) from a base spec's torus-room footprint as w = |v1 - v0| and (a, b) = v3 - v0; throws if the cell is missing or the values are out of range.
 */
export function inferTorusSkewState(baseSpec: CellComplexSpec): TorusSkewDeformationState {
  const cell = requireTorusCell(baseSpec);
  const vertices = cell.baseVertices;
  const bottom = subtract2(vertices[1], vertices[0]);
  const left = subtract2(vertices[3], vertices[0]);
  const widthMeters = length2(bottom);
  const depthMeters = left.y;
  const skewXMeters = left.x;

  return normalizeTorusSkewState({
    kind: "torus-skew",
    cellId: torusCellId,
    widthMeters,
    depthMeters,
    skewXMeters,
  });
}

function validateCompiledTorusSkewSnapshot(world: CompiledCellComplex): readonly string[] {
  const errors: string[] = [];
  const cell = world.cellsById.get(torusCellId);
  if (!cell) {
    return [`Compiled world deformation is missing "${torusCellId}".`];
  }

  const oppositePairs = [
    [0, 2],
    [1, 3],
  ] as const;
  for (const [leftIndex, rightIndex] of oppositePairs) {
    const left = cell.sides[leftIndex];
    const right = cell.sides[rightIndex];
    if (!left || !right) {
      errors.push(`Compiled world deformation is missing side ${leftIndex} or ${rightIndex}.`);
      continue;
    }

    if (Math.abs(left.lengthMeters - right.lengthMeters) > dimensionToleranceMeters) {
      errors.push(`Torus opposite sides ${leftIndex} and ${rightIndex} are not length-compatible.`);
    }
  }

  return errors;
}

function normalizeTorusSkewState(state: TorusSkewDeformationState): TorusSkewDeformationState {
  if (state.cellId !== torusCellId) {
    throw new Error(`World deformation only supports cell "${torusCellId}".`);
  }

  if (!(state.widthMeters > 0) || !Number.isFinite(state.widthMeters)) {
    throw new Error(`World deformation widthMeters must be finite and positive; received ${state.widthMeters}.`);
  }

  if (!(state.depthMeters > 0) || !Number.isFinite(state.depthMeters)) {
    throw new Error(`World deformation depthMeters must be finite and positive; received ${state.depthMeters}.`);
  }

  if (!Number.isFinite(state.skewXMeters)) {
    throw new Error(`World deformation A must be finite; received ${state.skewXMeters}.`);
  }

  if (state.depthMeters < state.widthMeters / 2 || state.depthMeters > state.widthMeters * 2) {
    throw new Error(
      `World deformation B must be between ${state.widthMeters / 2}m and ${state.widthMeters * 2}m; received ${state.depthMeters}.`,
    );
  }

  if (state.skewXMeters < 0 || state.skewXMeters > state.widthMeters * 2) {
    throw new Error(
      `World deformation A must be between 0m and ${state.widthMeters * 2}m; received ${state.skewXMeters}.`,
    );
  }

  return {
    kind: "torus-skew",
    cellId: torusCellId,
    widthMeters: state.widthMeters,
    depthMeters: state.depthMeters,
    skewXMeters: state.skewXMeters,
  };
}

function isMissingNumber(value: number | undefined): boolean {
  return value === undefined || Number.isNaN(value);
}

function requireTorusCell(baseSpec: CellComplexSpec): PrismCellSpec {
  const cell = baseSpec.cells.find((candidate) => candidate.id === torusCellId);
  if (!cell) {
    throw new Error(`Expected a "${torusCellId}" cell.`);
  }

  return cell;
}

function torusLatticeFrame(state: TorusSkewDeformationState): TorusLatticeFrame {
  const u = { x: state.widthMeters, y: 0 };
  const v = { x: state.skewXMeters, y: state.depthMeters };

  return {
    origin: {
      x: -0.5 * u.x - 0.5 * v.x,
      y: -0.5 * u.y - 0.5 * v.y,
    },
    u,
    v,
  };
}

function latticeCoordinates(
  frame: TorusLatticeFrame,
  point: Vec3,
): { readonly alpha: number; readonly beta: number } {
  const offset = {
    x: point.x - frame.origin.x,
    y: point.y - frame.origin.y,
  };
  const beta = offset.y / frame.v.y;
  const alpha = (offset.x - beta * frame.v.x) / frame.u.x;

  return { alpha, beta };
}

function latticeDirectionCoordinates(
  frame: TorusLatticeFrame,
  direction: Vec3,
): { readonly alpha: number; readonly beta: number } {
  const beta = direction.y / frame.v.y;
  const alpha = (direction.x - beta * frame.v.x) / frame.u.x;

  return { alpha, beta };
}

function subtract2(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
  };
}

function length2(vector: { readonly x: number; readonly y: number }): number {
  return Math.hypot(vector.x, vector.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
