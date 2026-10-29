/**
 * Derives the rigid gluing map of every portal from the geometry of the two sides it joins.
 * For a portal on side S of cell A glued to side T of cell B, the transform g maps A-local coordinates to B-local coordinates so that (1) the midpoint of S goes to the midpoint of T, (2) the outward horizontal normal of S (leaving A) goes to the inward normal of T (entering B), (3) the direction of S (start to end) goes to the opposite of T's direction, as required when both cells are counterclockwise and the gluing preserves orientation, and (4) +z goes to +z. g = (R, t) is thus a proper rotation about the vertical axis followed by a translation, acting on points as x -> R x + t. Side lengths and cell heights are not compared: only midpoints are matched, so a length mismatch yields a gluing that is correct at the midpoint but not at the endpoints.
 */
import { rigidTransform3, transformDirection3, yawRigidTransform3 } from "../math/rigidTransform3";
import { normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3";
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
 * Builds g = (R, t) with R the rotation about +z by the angle that turns tangent_S into -tangent_T, and t = m_T - R m_S.
 * The angle is theta = atan2(cross(t_S, -t_T), dot(t_S, -t_T)) for the unit side tangents, and R is built from that one angle, so it is an exact yaw. R therefore sends tangent_S to -tangent_T, up to up and outward_S to inward_T (for counterclockwise cells the outward normal is the tangent rotated by -90 degrees), and t is chosen so the side midpoints m_S and m_T coincide. The tangent is negated for the target because the shared boundary is traversed in opposite directions by the two counterclockwise cells; the outward normal of the source becomes the inward normal of the target because stepping out of A is stepping into B.
 */
function derivePortalTransform(sourceSide: CompiledPrismSide, targetSide: CompiledPrismSide) {
  const sourceTangent = sideTangent(sourceSide);
  const reversedTargetTangent = scaleVec3(sideTangent(targetSide), -1);
  const angle = Math.atan2(
    sourceTangent.x * reversedTargetTangent.y - sourceTangent.y * reversedTargetTangent.x,
    sourceTangent.x * reversedTargetTangent.x + sourceTangent.y * reversedTargetTangent.y,
  );
  const rotation = yawRigidTransform3(angle);
  const translation = subVec3(sideMidpoint(targetSide), transformDirection3(rotation, sideMidpoint(sourceSide)));

  // `+ 0` turns a negative zero (sin of 0 negated) into +0 so that identity gluings compare equal to the identity matrix.
  return rigidTransform3({ ...rotation.rotation, m01: rotation.rotation.m01 + 0 }, translation);
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
