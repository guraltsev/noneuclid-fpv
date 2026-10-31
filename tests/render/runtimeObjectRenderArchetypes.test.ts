/**
 * Runtime-object render archetypes (src/render/three/runtimeObjectRenderArchetypes.ts): one `THREE.InstancedMesh`
 * per source mesh, drawn once per visible portal path. Each archetype bakes its source mesh's transform (relative
 * to the object root) into a cloned geometry and hides the source mesh, so only the instanced copies are drawn.
 * Capacity is fixed at creation (`recordCount * maxVisiblePaths`, at least 1).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeObjectRenderArchetype,
  deriveRuntimeObjectRenderArchetypeCapacity,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { collectRuntimeObjectRenderSourceMeshes } from "../../src/render/three/runtimeObjectRenderRecords";

describe("runtime object render archetypes", () => {
  it("collects, hides and bakes a source mesh's transform into the archetype geometry", () => {
    const root = new THREE.Group();
    const sourceMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    sourceMesh.position.set(2, 0, 0);
    root.add(sourceMesh);

    const [source] = collectRuntimeObjectRenderSourceMeshes("mouse-a", root, "geo-mouse:mouse-a");
    const archetype = buildRuntimeObjectRenderArchetype(source, 2, undefined);
    archetype.mesh.geometry.computeBoundingBox();

    expect(sourceMesh.visible).toBe(false);
    expect(source.archetypeKey).toBe("geo-mouse:mouse-a:mesh:0");
    expect(archetype.mesh.count).toBe(0);
    expect(archetype.portalPathIdAttribute.count).toBe(2);
    expect(archetype.portalClipIndexAttribute.count).toBe(2);
    expect(archetype.mesh.geometry.boundingBox?.min.x).toBeCloseTo(1.5);
    expect(archetype.mesh.geometry.boundingBox?.max.x).toBeCloseTo(2.5);
  });

  it("sizes shared archetypes for every record across visible portal paths", () => {
    expect(deriveRuntimeObjectRenderArchetypeCapacity(0, 2000)).toBe(1);
    expect(deriveRuntimeObjectRenderArchetypeCapacity(1, 2000)).toBe(2000);
    expect(deriveRuntimeObjectRenderArchetypeCapacity(6, 2000)).toBe(12000);
  });
});
