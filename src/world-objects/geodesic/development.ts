/**
 * Development of portal words: inverse portal transforms, cached per compiled portal (a compiled world is immutable, so a WeakMap keyed by portal is always valid); pure.
 */
import type { CompiledPortal } from "../../cell-complex/specs";
import { invertRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";

// Inverse of each compiled portal's transform, computed once. A compiled world is immutable and a rebuilt world has new portal
// objects, so a WeakMap keyed by the portal is always valid.
const inversePortalTransforms = new WeakMap<CompiledPortal, RigidTransform3>();

/** Inverse of the portal's `transformToTarget`, cached per compiled portal. */
export function inversePortalTransform(portal: CompiledPortal): RigidTransform3 {
  let inverse = inversePortalTransforms.get(portal);
  if (!inverse) {
    inverse = invertRigidTransform3(portal.transformToTarget);
    inversePortalTransforms.set(portal, inverse);
  }

  return inverse;
}
