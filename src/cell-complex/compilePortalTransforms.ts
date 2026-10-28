/**
 * Derives the rigid gluing map of every portal from the geometry of the two sides it joins.
 * For a portal on side S of cell A glued to side T of cell B, the transform g maps A-local coordinates to B-local coordinates so that (1) the midpoint of S goes to the midpoint of T, (2) the outward horizontal normal of S (leaving A) goes to the inward normal of T (entering B), (3) the direction of S (start to end) goes to the opposite of T's direction, as required when both cells are counterclockwise and the gluing preserves orientation, and (4) +z goes to +z. g = (R, t) is thus a proper rotation about the vertical axis followed by a translation, acting on points as x -> R x + t. Side lengths and cell heights are not compared: only midpoints are matched, so a length mismatch yields a gluing that is correct at the midpoint but not at the endpoints.
 */
import { rigidTransform3, type Mat3 } from "../math/rigidTransform3";
import { crossVec3, normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3";
import type { CompiledPrismCellGeometry, CompiledPrismSide } from "./prismCells";
import type { AuthoredPortalSpec, CellComplexSpec, CompiledPortal, PrismCellSpec } from "./specs";

/**
 * Compiles every portal of every cell, returning for each cell id its CompiledPortal list in authored order.
 * @throws Error if a portal's target cell, target portal or compiled geometry cannot be found (normally prevented by spec validation).
 */
export function compilePortalTransforms(
  spec: CellComplexSpec,
  cellGeometryById: ReadonlyMap<string, CompiledPrismCellGeometry>,
): ReadonlyMap<string, readonly CompiledPortal[]> {
  const authoredCellsById = new Map(spec.cells.map((cell) => [cell.id, cell]));

  return new Map(
    spec.cells.map((cell) => [
      cell.id,
      cell.portals.map((portal) => compilePortal(portal, cell, authoredCellsById, cellGeometryById)),
    ]),
  );
}

/**
 * Resolves a single authored portal against its target and attaches reciprocalPortalId and transformToTarget.
 */
function compilePortal(
  portal: AuthoredPortalSpec,
  sourceCell: PrismCellSpec,
  authoredCellsById: ReadonlyMap<string, PrismCellSpec>,
  cellGeometryById: ReadonlyMap<string, CompiledPrismCellGeometry>,
): CompiledPortal {
  const sourceGeometry = cellGeometryById.get(sourceCell.id);
  const targetCell = authoredCellsById.get(portal.targetCellId);

  if (!sourceGeometry || !targetCell) {
    throw new Error(`Portal "${sourceCell.id}:${portal.id}" could not be resolved during compilation.`);
  }

  const targetPortal = targetCell.portals.find((candidate) => candidate.id === portal.targetPortalId);
  const targetGeometry = cellGeometryById.get(targetCell.id);

  if (!targetPortal || !targetGeometry) {
    throw new Error(`Portal "${sourceCell.id}:${portal.id}" targets missing compiled geometry.`);
  }

  return {
    ...portal,
    reciprocalPortalId: targetPortal.id,
    transformToTarget: derivePortalTransform(
      sourceGeometry.sides[portal.sideIndex],
      targetGeometry.sides[targetPortal.sideIndex],
    ),
  };
}

/**
 * Builds g = (R, t) with R = B_T B_S^T and t = m_T - R m_S.
 * B_S has columns (tangent_S, up, outward_S) and B_T has columns (-tangent_T, up, inward_T), each a right-handed orthonormal frame. R therefore sends tangent_S to -tangent_T, up to up and outward_S to inward_T, and t is chosen so the side midpoints m_S and m_T coincide. The tangent is negated for the target because the shared boundary is traversed in opposite directions by the two counterclockwise cells; the outward normal of the source becomes the inward normal of the target because stepping out of A is stepping into B.
 */
function derivePortalTransform(sourceSide: CompiledPrismSide, targetSide: CompiledPrismSide) {
  const up = vec3(0, 0, 1);
  const sourceTangent = sideTangent(sourceSide);
  const targetTangent = sideTangent(targetSide);
  const sourceOutward = vec3(-sourceSide.inwardNormal.x, -sourceSide.inwardNormal.y, 0);
  const targetInward = vec3(targetSide.inwardNormal.x, targetSide.inwardNormal.y, 0);
  const sourceBasis = orthonormalBasis(sourceTangent, up, sourceOutward);
  const targetBasis = orthonormalBasis(scaleVec3(targetTangent, -1), up, targetInward);
  const rotation = multiplyMat3(targetBasis, transposeMat3(sourceBasis));
  const sourceMidpoint = sideMidpoint(sourceSide);
  const targetMidpoint = sideMidpoint(targetSide);
  const translation = subVec3(targetMidpoint, multiplyMat3Vec3(rotation, sourceMidpoint));

  return rigidTransform3(rotation, translation);
}

/**
 * Unit horizontal direction from the side's start vertex to its end vertex.
 */
function sideTangent(side: CompiledPrismSide): Vec3 {
  return normalizeVec3(vec3(side.end.x - side.start.x, side.end.y - side.start.y, 0));
}

/**
 * Midpoint of the side's base edge at z = 0.
 */
function sideMidpoint(side: CompiledPrismSide): Vec3 {
  return vec3((side.start.x + side.end.x) / 2, (side.start.y + side.end.y) / 2, 0);
}

/**
 * Returns the matrix with columns (tangent, up, crossing), replacing `crossing` by tangent x up if the supplied vector disagrees with it.
 * For counterclockwise cells tangent x up always equals the outward normal (and (-tangent) x up the inward normal), so the supplied vector is used as is; the fallback is a defensive guard that keeps the result right-handed (determinant +1) so R stays a rotation, not a reflection.
 */
function orthonormalBasis(tangent: Vec3, up: Vec3, crossing: Vec3): Mat3 {
  const tangentUnit = normalizeVec3(tangent);
  const upUnit = normalizeVec3(up);
  const crossingUnit = normalizeVec3(crossing);
  const handednessCheck = normalizeVec3(crossVec3(tangentUnit, upUnit));

  if (
    Math.abs(handednessCheck.x - crossingUnit.x) > 1e-6 ||
    Math.abs(handednessCheck.y - crossingUnit.y) > 1e-6 ||
    Math.abs(handednessCheck.z - crossingUnit.z) > 1e-6
  ) {
    return mat3FromColumns(tangentUnit, upUnit, handednessCheck);
  }

  return mat3FromColumns(tangentUnit, upUnit, crossingUnit);
}

/**
 * Assembles a Mat3 whose columns are the three given axes.
 */
function mat3FromColumns(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Mat3 {
  return {
    m00: xAxis.x,
    m01: yAxis.x,
    m02: zAxis.x,
    m10: xAxis.y,
    m11: yAxis.y,
    m12: zAxis.y,
    m20: xAxis.z,
    m21: yAxis.z,
    m22: zAxis.z,
  };
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10 + a.m02 * b.m20,
    m01: a.m00 * b.m01 + a.m01 * b.m11 + a.m02 * b.m21,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02 * b.m22,
    m10: a.m10 * b.m00 + a.m11 * b.m10 + a.m12 * b.m20,
    m11: a.m10 * b.m01 + a.m11 * b.m11 + a.m12 * b.m21,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12 * b.m22,
    m20: a.m20 * b.m00 + a.m21 * b.m10 + a.m22 * b.m20,
    m21: a.m20 * b.m01 + a.m21 * b.m11 + a.m22 * b.m21,
    m22: a.m20 * b.m02 + a.m21 * b.m12 + a.m22 * b.m22,
  };
}

function multiplyMat3Vec3(matrix: Mat3, vector: Vec3): Vec3 {
  return vec3(
    matrix.m00 * vector.x + matrix.m01 * vector.y + matrix.m02 * vector.z,
    matrix.m10 * vector.x + matrix.m11 * vector.y + matrix.m12 * vector.z,
    matrix.m20 * vector.x + matrix.m21 * vector.y + matrix.m22 * vector.z,
  );
}

function transposeMat3(matrix: Mat3): Mat3 {
  return {
    m00: matrix.m00,
    m01: matrix.m10,
    m02: matrix.m20,
    m10: matrix.m01,
    m11: matrix.m11,
    m12: matrix.m21,
    m20: matrix.m02,
    m21: matrix.m12,
    m22: matrix.m22,
  };
}
