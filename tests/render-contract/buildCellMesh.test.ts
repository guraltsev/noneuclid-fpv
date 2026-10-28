import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { dodecahedron } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";
import { buildCellMesh } from "../../src/render/three/buildCellMesh";
import { SCENE_BACKGROUND_COLOR } from "../../src/render/three/sceneColors";
import { PORTAL_WALL_TEXTURE_URL } from "../../src/render/three/portalWallTexture";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

describe("buildCellMesh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds floor, ceiling, walls, and portal wall metadata", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const cell = compiled.cellsById.get("room-a");

    expect(cell).toBeDefined();
    const roomA = cell!;

    expect(roomA.portalBySideIndex.get(1)?.id).toBe("side-1");

    const preparedAssets: PreparedWorldAssets = {
      getTexture: () => new THREE.Texture(),
      getConfiguredTexture: () => new THREE.Texture(),
      instantiateGltf: () => ({
        scene: new THREE.Group(),
        animations: [],
      }),
    };
    const mesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "panel",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });

    expect(mesh.userData.kind).toBe("cell");
    expect(mesh.userData.portalSides).toEqual([
      {
        portalId: "side-1",
        sideIndex: 1,
        targetCellId: "room-b",
        targetPortalId: "side-3",
      },
    ]);

    const floor = mesh.getObjectByName("floor:room-a");
    const ceiling = mesh.getObjectByName("ceiling:room-a");
    const walls = mesh.getObjectByName("walls:room-a") as THREE.Group | null;
    const portal = mesh.getObjectByName("portal:side-1");
    const portalMesh = portal?.getObjectByName("portal-wall:side-1") as THREE.Mesh | undefined;
    const ceilingMesh = ceiling as THREE.Mesh | undefined;

    expect(floor).toBeDefined();
    expect(ceiling).toBeDefined();
    expect(walls).toBeDefined();
    expect(walls?.children).toHaveLength(roomA.sideCount);
    expect((ceilingMesh?.material as THREE.MeshStandardMaterial | undefined)?.userData.textureUrl).toBeUndefined();
    expect((ceilingMesh?.material as THREE.MeshStandardMaterial | undefined)?.color.getHex()).toBe(
      SCENE_BACKGROUND_COLOR,
    );
    expect(portal).toBeDefined();
    expect(portal?.userData.textureUrl).toBe(PORTAL_WALL_TEXTURE_URL);
    expect(portalMesh?.userData.kind).toBe("portal-wall-mesh");
    expect((portalMesh?.geometry as THREE.PlaneGeometry | undefined)?.parameters.height).toBe(roomA.heightMeters);
    expect(portalMesh?.position.y).toBeCloseTo(roomA.heightMeters / 2);
    expect((portalMesh?.material as THREE.MeshStandardMaterial | undefined)?.userData.textureUrl).toBe(
      PORTAL_WALL_TEXTURE_URL,
    );
  });

  it("renders portal panels and labels according to the selected portal panel mode", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a")!;
    const preparedAssets: PreparedWorldAssets = {
      getTexture: () => new THREE.Texture(),
      getConfiguredTexture: () => new THREE.Texture(),
      instantiateGltf: () => ({
        scene: new THREE.Group(),
        animations: [],
      }),
    };

    const noPanelMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });
    const panelOnlyMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "panel",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });

    vi.stubGlobal("document", {
      createElement(tagName: string) {
        if (tagName !== "canvas") {
          throw new Error(`Unexpected element request: ${tagName}`);
        }

        return {
          width: 0,
          height: 0,
          getContext(kind: string) {
            if (kind !== "2d") {
              return null;
            }

            return {
              clearRect() {},
              fillText() {},
              fillStyle: "#ffffff",
              font: "bold 96px system-ui, sans-serif",
              textAlign: "center",
              textBaseline: "middle",
            };
          },
        };
      },
    });

    const labeledMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "panel-with-text",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });
    const textOnlyMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "text-only",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });

    expect(noPanelMesh.getObjectByName("portal-wall:side-1")).toBeUndefined();
    expect(noPanelMesh.getObjectByName("portal-debug:room-a")).toBeUndefined();

    expect(panelOnlyMesh.getObjectByName("portal-wall:side-1")).toBeDefined();
    expect(panelOnlyMesh.getObjectByName("portal-debug:room-a")).toBeUndefined();
    expect(panelOnlyMesh.getObjectByName("portal-debug-label:room-a:side-1")).toBeUndefined();

    expect(labeledMesh.getObjectByName("portal-wall:side-1")).toBeDefined();
    expect(labeledMesh.getObjectByName("portal-debug-panel:room-a:side-1")).toBeDefined();
    expect(labeledMesh.getObjectByName("portal-debug-label:room-a:side-1")).toBeDefined();

    expect(textOnlyMesh.getObjectByName("portal-wall:side-1")).toBeUndefined();
    expect(textOnlyMesh.getObjectByName("portal-debug-panel:room-a:side-1")).toBeDefined();
    expect(textOnlyMesh.getObjectByName("portal-debug-label:room-a:side-1")).toBeDefined();
  });

  it("does not render floor outlines in ordinary cell meshes", () => {
    const compiled = compileCellComplex(dodecahedron);
    const top = compiled.cellsById.get("top")!;
    const mesh = buildCellMesh(top, {
      debugLevel: "off",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets: createPreparedAssets(),
    });

    expect(mesh.getObjectByName("floor:top")).toBeDefined();
    expect(mesh.getObjectByName("floor-outline:top")).toBeUndefined();
  });

  it("renders forbidden-zone wireframes only when the debug option is enabled", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a")!;
    const hiddenMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets: createPreparedAssets(),
      showForbiddenZoneWireframes: false,
    });
    const debugMesh = buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets: createPreparedAssets(),
      showForbiddenZoneWireframes: true,
    });

    expect(hiddenMesh.getObjectByName("forbidden-zone-wireframes:room-a")).toBeUndefined();

    const wireframeGroup = debugMesh.getObjectByName("forbidden-zone-wireframes:room-a") as THREE.Group | undefined;
    expect(wireframeGroup).toBeDefined();
    expect(wireframeGroup?.children).toHaveLength(roomA.forbiddenZones.length);
    expect(
      debugMesh.getObjectByName("forbidden-zone-wireframe:room-a:room-a:vertex-1")?.userData,
    ).toMatchObject({
      kind: "debug-wireframe",
      debugWireframeKind: "forbidden-zone",
      cellId: "room-a",
      junctionId: "room-a:vertex-1",
    });
    expect(
      debugMesh.getObjectByName("forbidden-zone-wireframe:room-a:room-a:vertex-1"),
    ).toBeInstanceOf(THREE.LineSegments);
    expect(
      (
        debugMesh.getObjectByName("forbidden-zone-wireframe:room-a:room-a:vertex-1") as THREE.LineSegments | undefined
      )?.geometry.getAttribute("position").count,
    ).toBe(104);
    expect(
      (
        debugMesh.getObjectByName("forbidden-zone-wireframe:room-a:room-a:vertex-1") as THREE.LineSegments | undefined
      )?.scale.y,
    ).toBeCloseTo(roomA.heightMeters);
  });

  it("labels portal side redirects as source side to target face and side", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a")!;
    const preparedAssets: PreparedWorldAssets = {
      getTexture: () => new THREE.Texture(),
      getConfiguredTexture: () => new THREE.Texture(),
      instantiateGltf: () => ({
        scene: new THREE.Group(),
        animations: [],
      }),
    };
    const drawnText: string[] = [];

    vi.stubGlobal("document", {
      createElement(tagName: string) {
        if (tagName !== "canvas") {
          throw new Error(`Unexpected element request: ${tagName}`);
        }

        return {
          width: 0,
          height: 0,
          getContext(kind: string) {
            if (kind !== "2d") {
              return null;
            }

            return {
              clearRect() {},
              fillText(text: string) {
                drawnText.push(text);
              },
              fillStyle: "#ffffff",
              font: "bold 96px system-ui, sans-serif",
              textAlign: "center",
              textBaseline: "middle",
            };
          },
        };
      },
    });

    buildCellMesh(roomA, {
      debugLevel: "basic",
      portalPanelMode: "text-only",
      eyeHeightMeters: 1.6,
      assets: preparedAssets,
    });

    expect(drawnText).toEqual(["1 -> room-b, 3"]);
  });

  it("reuses configured floor textures across matching meshes and keeps sRGB color space", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a")!;
    const sharedTexture = new THREE.Texture();
    const configuredTexture = new THREE.Texture();
    const getConfiguredTexture = vi.fn((request: Parameters<PreparedWorldAssets["getConfiguredTexture"]>[0]) => {
      configuredTexture.colorSpace = request.colorSpace;
      configuredTexture.repeat.set(request.repeatX, request.repeatY);
      return configuredTexture;
    });
    const assets: PreparedWorldAssets = {
      getTexture: () => sharedTexture,
      getConfiguredTexture,
      instantiateGltf: () => ({
        scene: new THREE.Group(),
        animations: [],
      }),
    };

    const firstMesh = buildCellMesh(roomA, {
      debugLevel: "off",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets,
    });
    const secondMesh = buildCellMesh(roomA, {
      debugLevel: "off",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets,
    });
    const firstMaterial = firstMesh.getObjectByName("floor:room-a") as THREE.Mesh | undefined;
    const secondMaterial = secondMesh.getObjectByName("floor:room-a") as THREE.Mesh | undefined;
    const firstMap = (firstMaterial?.material as THREE.MeshStandardMaterial | undefined)?.map;
    const secondMap = (secondMaterial?.material as THREE.MeshStandardMaterial | undefined)?.map;

    expect(getConfiguredTexture).toHaveBeenCalled();
    expect(firstMap).toBe(configuredTexture);
    expect(secondMap).toBe(configuredTexture);
    expect(firstMap?.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("keeps the fallback floor color when a runtime texture is unavailable", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a")!;
    const portalWallTexture = new THREE.Texture();
    const assets: PreparedWorldAssets = {
      getTexture: (assetPath) => assetPath.includes("abstract-fractal") ? portalWallTexture : undefined,
      getConfiguredTexture: (request) => request.assetPath.includes("abstract-fractal") ? portalWallTexture : undefined,
      instantiateGltf: () => ({
        scene: new THREE.Group(),
        animations: [],
      }),
    };

    const mesh = buildCellMesh(roomA, {
      debugLevel: "off",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets,
    });
    const floor = mesh.getObjectByName("floor:room-a") as THREE.Mesh | undefined;
    const material = floor?.material as THREE.MeshStandardMaterial | undefined;

    expect(material?.color.getHexString()).toBe("5b8f48");
    expect(material?.map).toBeNull();
    expect(material?.userData.missingTextureUrl).toBe(roomA.floorMaterial.kind === "floor-texture"
      ? roomA.floorMaterial.colorTexturePath
      : undefined);
  });
});

function createPreparedAssets(): PreparedWorldAssets {
  return {
    getTexture: () => new THREE.Texture(),
    getConfiguredTexture: () => new THREE.Texture(),
    instantiateGltf: () => ({
      scene: new THREE.Group(),
      animations: [],
    }),
  };
}

