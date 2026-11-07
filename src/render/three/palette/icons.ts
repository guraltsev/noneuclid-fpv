/**
 * Icon factories of the in-scene palette panel: each wraps an Image, a lucide icon or a small container and records its source in userData.scenePaletteIconSrc for inspection.
 */
import { Component, Container, Image, Text } from "@pmndrs/uikit";
import { ArrowLeft, Settings, X } from "@pmndrs/uikit-lucide";
import { publicAssetUrl } from "../../../glue/assetUrls";
import type { RuntimeToolId } from "../../../glue/toolIds";
import type { PaletteDefinition } from "../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../world-objects/toolObjects";
import { textColor } from "./tokens";

// Asset URLs for icons, resolved through publicAssetUrl.
const signIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};

const aimIconSource = publicAssetUrl("icons/aim-inverted.png");

const carryIconSource = publicAssetUrl("icons/carry-inverted.svg");

const lockIconSource = publicAssetUrl("icons/lock.png");

const unlinkIconSource = publicAssetUrl("icons/unlink-inverted.png");

const rayToolIconSource = publicAssetUrl("flashlight/Lightsaber.png");

const protractorToolIconSource = publicAssetUrl("icons/protractor.png");

const measureLengthToolIconSource = publicAssetUrl("icons/ruler-inverted.svg");

const worldMapToolIconSource = publicAssetUrl("icons/world-map-inverted.svg");

/**
 * Icon for a tool id; unknown ids get an invisible 64x64 placeholder.
 */
export function createToolIcon(
  toolId: RuntimeToolId,
  signType: PlacedFlagType | undefined,
): Component<any> {
  if (toolId === "placedFlags/flag") {
    return createSignIcon(signType ?? "WoodenSign1");
  }

  if (toolId === "geodesicEmitters/emitter") {
    return createRayIcon();
  }

  if (toolId === "geodesicMeasurements/protractor") {
    return createProtractorIcon();
  }

  if (toolId === "geodesicMeasurements/length") {
    return createMeasureLengthIcon();
  }

  if (toolId === "worldMap/map") {
    return createWorldMapIcon();
  }

  return new Container({ width: 64, height: 64, opacity: 0 });
}

// Icon helpers: each wraps an Image and records its source in userData.scenePaletteIconSrc for inspection.
function createMeasureLengthIcon(): Component<any> {
  const image = new Image({
    src: measureLengthToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = measureLengthToolIconSource;
  return image;
}

function createWorldMapIcon(): Component<any> {
  const image = new Image({
    src: worldMapToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = worldMapToolIconSource;
  return image;
}

function createRayIcon(): Component<any> {
  const image = new Image({
    src: rayToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = rayToolIconSource;
  return image;
}

function createProtractorIcon(): Component<any> {
  const image = new Image({
    src: protractorToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = protractorToolIconSource;
  return image;
}

/** Icon of a geodesic cannon header action: a plus for "add-geodesic", the carry or aim image otherwise. */
export function createGeodesicCannonActionIcon(actionId: "add-geodesic" | "aim" | "carry"): Component<any> {
  if (actionId === "add-geodesic") {
    return createPlusIcon();
  }

  const source = actionId === "carry"
    ? carryIconSource
    : aimIconSource;
  const image = new Image({
    src: source,
    width: 28,
    height: 28,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = source;
  return image;
}

function createPlusIcon(): Component<any> {
  const text = new Text({
    text: "+",
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  });
  text.userData.scenePaletteIconSrc = "plus";
  return text;
}

/** Unlink image (24 px) used by the tie-and-detach action. */
export function createUnlinkIcon(): Component<any> {
  const image = new Image({
    src: unlinkIconSource,
    width: 24,
    height: 24,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = unlinkIconSource;
  return image;
}

/**
 * Composite emitter-line-lock-line-emitter glyph shown in place of Aim for connected geodesics.
 */
export function createConnectedGeodesicSegmentStatus(): Container {
  const status = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 168,
    height: 28,
  });

  status.add(
    createConnectedGeodesicSegmentEmitter(),
    createConnectedGeodesicSegmentLine(),
    createLockIcon(),
    createConnectedGeodesicSegmentLine(),
    createConnectedGeodesicSegmentEmitter(),
  );
  return status;
}

function createConnectedGeodesicSegmentEmitter(): Container {
  return new Container({
    width: 4,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
  });
}

function createConnectedGeodesicSegmentLine(): Container {
  return new Container({
    width: 50,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
  });
}

function createLockIcon(): Component<any> {
  const image = new Image({
    src: lockIconSource,
    width: 22,
    height: 22,
    marginLeft: 8,
    marginRight: 8,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = lockIconSource;
  return image;
}

function createSignIcon(signType: PlacedFlagType): Container {
  const icon = new Container({
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
  });
  icon.add(createSignImage(signType, 82));
  return icon;
}

/** Square image of a sign type at `size` pixels. */
export function createSignImage(signType: PlacedFlagType, size: number): Component<any> {
  const image = new Image({
    src: signIconSources[signType],
    width: size,
    height: size,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = signIconSources[signType];
  return image;
}

/**
 * Lucide icon for a header action id; "none" has no icon.
 */
export function createHeaderIcon(
  actionId: PaletteDefinition["leftAction"]["id"],
): InstanceType<typeof Settings> | InstanceType<typeof X> | InstanceType<typeof ArrowLeft> | undefined {
  const iconProperties = {
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  };

  switch (actionId) {
    case "settings":
      return new Settings(iconProperties);
    case "close":
      return new X(iconProperties);
    case "back":
      return new ArrowLeft(iconProperties);
    case "none":
      return undefined;
  }
}
