import { describe, expect, it } from "vitest";
import {
  classifyPointInPolygon2xy,
  polygonSignedArea2xy,
  validatePolygon2xy,
  type Polygon2xy,
} from "../../src/math/polygons";

describe("polygons", () => {
  const square: Polygon2xy = {
    vertices: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  };

  it("computes signed area in the x/y plane", () => {
    expect(polygonSignedArea2xy(square)).toBe(4);
  });

  it("classifies inside, outside, edge, and vertex points", () => {
    expect(classifyPointInPolygon2xy(square, { x: 0, y: 0 })).toBe("inside");
    expect(classifyPointInPolygon2xy(square, { x: 2, y: 0 })).toBe("outside");
    expect(classifyPointInPolygon2xy(square, { x: 1, y: 0 })).toBe("boundary");
    expect(classifyPointInPolygon2xy(square, { x: -1, y: -1 })).toBe("boundary");
  });

  it("accepts counterclockwise polygons and rejects invalid bases", () => {
    expect(() => validatePolygon2xy(square)).not.toThrow();
    expect(() => validatePolygon2xy({ vertices: square.vertices.slice().reverse() })).toThrow(/counterclockwise/);
    expect(() => validatePolygon2xy({ vertices: square.vertices.slice(0, 2) })).toThrow(/at least three/);
  });
});
