/**
 * The shape machine's picture: the current (white) and target (green) parallelograms, the target's Shift and Height labelled in meters, and the "Same world as the start" badge, drawn with uikit containers.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../ui/paletteDefinition";
import { borderColor, textColor } from "./tokens";

/**
 * Draw the current (white) and target (green) deformation parallelograms into a 900x220 pixel box. Lines are made of small dot Containers because uikit has no line primitive. Original meter-space lattice points are stored in userData for inspection.
 */
export function createWorldDeformationDiagram(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geometry-computer-actions" }>,
): Container {
  const diagramWidthPixels = 900;
  const diagramHeightPixels = 220;
  const fitted = fitParallelogramDiagramPoints(
    diagramWidthPixels,
    diagramHeightPixels,
    [
      createDiagramLatticePoints(content.widthMeters, content.current.aMeters, content.current.bMeters),
      createDiagramLatticePoints(content.widthMeters, content.target.aMeters, content.target.bMeters),
    ],
  );
  const current = fitted[0] ?? [];
  const target = fitted[1] ?? [];
  const diagram = new Container({
    width: "100%",
    height: diagramHeightPixels,
    positionType: "relative",
    borderRadius: 14,
    backgroundColor: "#0a1114",
    borderColor,
    borderWidth: 2,
    overflow: "hidden",
    flexShrink: 0,
    renderOrder: 1002,
  });

  addParallelogramLines(diagram, current, "#f8fafc", "current", 1004, 7);
  addParallelogramLines(diagram, target, "#34d399", "target", 1008, 4);
  diagram.add(createDiagramPoint(current[0], "#f8fafc"));
  // The two sides of the target that carry its numbers: the top side is the Shift, the left side the Height.
  const shiftLabel = content.parameters.find((parameter) => parameter.axis === "a");
  const heightLabel = content.parameters.find((parameter) => parameter.axis === "b");
  if (shiftLabel !== undefined) {
    diagram.add(createDiagramLabel(
      `${shiftLabel.name} ${shiftLabel.valueLabel}`,
      clampDiagramLabelX((target[2].x + target[3].x) / 2 - 56, diagramWidthPixels),
      Math.max(6, target[3].y - 30),
      "#34d399",
    ));
  }
  if (heightLabel !== undefined) {
    diagram.add(createDiagramLabel(
      `${heightLabel.name} ${heightLabel.valueLabel}`,
      clampDiagramLabelX(Math.min(target[0].x, target[3].x) - 150, diagramWidthPixels),
      (target[0].y + target[3].y) / 2 - 10,
      "#34d399",
    ));
  }

  if (content.sameAsStart) {
    diagram.add(createSameAsStartBadge(content.sameAsStartLabel));
  }

  diagram.userData.scenePaletteIconSrc = "world-deformation-parallelogram";
  diagram.userData.scenePaletteItemId = "geometry-computer:diagram";
  diagram.userData.scenePaletteDiagramWorldPoints = {
    current: createDiagramLatticePoints(content.widthMeters, content.current.aMeters, content.current.bMeters),
    target: createDiagramLatticePoints(content.widthMeters, content.target.aMeters, content.target.bMeters),
  };
  return diagram;
}

// The green pill in the corner of the picture that says the target is the same flat torus as the start.
function createSameAsStartBadge(label: string): Container {
  const badge = new Container({
    positionType: "absolute",
    positionLeft: 12,
    positionTop: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingX: 14,
    paddingY: 6,
    borderRadius: 999,
    backgroundColor: "#166534",
    borderColor: "#34d399",
    borderWidth: 1,
    renderOrder: 1010,
    depthTest: false,
    depthWrite: false,
  });
  badge.add(new Text({
    text: label,
    fontSize: 16,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    wordBreak: "keep-all",
    renderOrder: 1011,
    depthTest: false,
    depthWrite: false,
  }));
  badge.userData.scenePaletteItemId = "geometry-computer:same-as-start";
  return badge;
}

// Four corners of the parallelogram in world meters: (0,0), (X,0), (X+a,b), (a,b).
function createDiagramLatticePoints(
  widthMeters: number,
  aMeters: number,
  bMeters: number,
): readonly DiagramPoint[] {
  return [
    { x: 0, y: 0 },
    { x: widthMeters, y: 0 },
    { x: widthMeters + aMeters, y: bMeters },
    { x: aMeters, y: bMeters },
  ];
}

// Uniformly scale and center all shapes into the diagram box minus padding, flipping y (world up becomes pixel down). Degenerate extents are treated as at least 1 m.
function fitParallelogramDiagramPoints(
  diagramWidthPixels: number,
  diagramHeightPixels: number,
  shapes: readonly (readonly DiagramPoint[])[],
): readonly (readonly DiagramPoint[])[] {
  const allPoints = shapes.flat();
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const paddingLeft = 128;
  const paddingRight = 42;
  const paddingTop = 52;
  const paddingBottom = 28;
  const worldWidth = Math.max(maxX - minX, 1);
  const worldHeight = Math.max(maxY - minY, 1);
  const scale = Math.min(
    (diagramWidthPixels - paddingLeft - paddingRight) / worldWidth,
    (diagramHeightPixels - paddingTop - paddingBottom) / worldHeight,
  );
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = (diagramWidthPixels - drawnWidth) / 2 - minX * scale;
  const originY = (diagramHeightPixels + drawnHeight) / 2 + minY * scale;

  return shapes.map((shape) => shape.map((point) => ({
    x: originX + point.x * scale,
    y: originY - point.y * scale,
  })));
}

// Keep a label's left edge inside the diagram so it does not run off the right side.
function clampDiagramLabelX(x: number, diagramWidthPixels: number): number {
  return Math.max(12, Math.min(diagramWidthPixels - 260, x));
}

// 2D point in diagram pixels (or meters before fitting).
interface DiagramPoint {
  readonly x: number;
  readonly y: number;
}

// Draw the four edges; the first dot of each edge carries an item id and its segment endpoints in userData.
function addParallelogramLines(
  parent: Container,
  points: readonly DiagramPoint[],
  color: string,
  labelPrefix: string,
  renderOrder: number,
  thicknessPixels: number,
): void {
  for (const [index, [start, end]] of [
    [points[0], points[1]],
    [points[1], points[2]],
    [points[2], points[3]],
    [points[3], points[0]],
  ].entries()) {
    const dots = createDiagramSegmentDots(start, end, color, renderOrder, thicknessPixels);
    for (let dotIndex = 0; dotIndex < dots.length; dotIndex += 1) {
      const dot = dots[dotIndex];
      if (dotIndex === 0) {
        dot.userData.scenePaletteItemId = `geometry-computer:diagram:${labelPrefix}:edge:${index}`;
        dot.userData.scenePaletteDiagramSegment = { start, end };
      }
      parent.add(dot);
    }
  }
}

// Sample the segment with dots spaced at about 0.75 of the line thickness, at least 2 pixels apart.
function createDiagramSegmentDots(
  start: DiagramPoint,
  end: DiagramPoint,
  color: string,
  renderOrder: number,
  thicknessPixels: number,
): readonly Container[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const stepCount = Math.max(1, Math.ceil(length / Math.max(2, thicknessPixels * 0.75)));
  const dots: Container[] = [];

  for (let index = 0; index <= stepCount; index += 1) {
    const t = index / stepCount;
    const x = start.x + dx * t;
    const y = start.y + dy * t;
    dots.push(new Container({
      width: thicknessPixels,
      height: thicknessPixels,
      positionType: "absolute",
      positionLeft: x - thicknessPixels / 2,
      positionTop: y - thicknessPixels / 2,
      borderRadius: 999,
      backgroundColor: color,
      zIndexOffset: renderOrder,
      renderOrder,
      depthTest: false,
      depthWrite: false,
    }));
  }

  return dots;
}

// Filled 12 pixel marker centered on point.
function createDiagramPoint(point: DiagramPoint, color: string): Container {
  return new Container({
    width: 12,
    height: 12,
    positionType: "absolute",
    positionLeft: point.x - 6,
    positionTop: point.y - 6,
    borderRadius: 999,
    backgroundColor: color,
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
}

// Absolutely positioned text label; left/top are in diagram pixels.
function createDiagramLabel(text: string, x: number, y: number, color: string): Text {
  return new Text({
    text,
    positionType: "absolute",
    positionLeft: x,
    positionTop: y,
    fontSize: 15,
    fontWeight: "bold",
    color,
    fill: color,
    wordBreak: "keep-all",
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
}
